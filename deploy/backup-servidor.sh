#!/usr/bin/env bash
# Backup COMPLETO da VPS: bancos de dados de todos os sistemas (em container ou instalados direto), volumes e
# pastas dos sistemas, configurações do servidor (/etc: Nginx, certificados, cron, serviços), o CRM (banco,
# arquivos, sessões do WhatsApp, .env) e um raio-x do servidor.
#
#   sudo bash deploy/backup-servidor.sh                    -> salva em /var/backups/servidor/AAAAMMDD-HHMM
#   sudo bash deploy/backup-servidor.sh --destino /mnt/hd  -> salva em outro disco
#   sudo bash deploy/backup-servidor.sh --tudo             -> inclui também volumes maiores que 10 GB
#
# Não para nenhum sistema: os bancos são copiados com as ferramentas de cada um (cópia consistente com tudo no ar).
# Tudo sai CRIPTOGRAFADO com a chave pública do backup do CRM (BACKUP_AGE_RECIPIENT do .env), ou --chave age1...:
# nada sem criptografia é gravado no disco. Para abrir, só com a chave privada (que fica com você, fora da VPS).
# Guarda os 3 backups completos mais recentes na pasta padrão.

set -uo pipefail
source "$(dirname "$0")/lib.sh"
exigir_root

DESTINO_BASE=/var/backups/servidor
CHAVE=""
TUDO=0
LIMITE_GB=10
GUARDAR=3
while [ $# -gt 0 ]; do
  case "$1" in
    --destino) DESTINO_BASE="${2:?Informe a pasta}"; shift 2 ;;
    --chave) CHAVE="${2:?Informe a chave pública age1...}"; shift 2 ;;
    --tudo) TUDO=1; shift ;;
    *) fatal "Opção desconhecida: $1" ;;
  esac
done
[ -n "$CHAVE" ] || CHAVE="$(env_get BACKUP_AGE_RECIPIENT)"
[[ "$CHAVE" == age1* ]] || fatal "Chave de criptografia não encontrada. Use --chave age1... (a mesma chave pública do backup do CRM)."

STAMP="$(date +%Y%m%d-%H%M)"
DEST="$DESTINO_BASE/$STAMP"
LOG="$DEST/registro.log"
MANIFESTO="$DEST/.partes"
umask 077
mkdir -p "$DEST" || fatal "Não consegui criar $DEST."
exec 9>"$DESTINO_BASE/.trava"
flock -n 9 || fatal "Já tem um backup do servidor em andamento."
# Prioridade baixa: os sistemas continuam respondendo enquanto o backup roda.
renice -n 10 $$ >/dev/null 2>&1 || true
ionice -c2 -n7 -p $$ >/dev/null 2>&1 || true

docker_ok() { command -v docker >/dev/null 2>&1 && timeout 10 docker info >/dev/null 2>&1; }
DOCKER=0; docker_ok && DOCKER=1

# ---------- Criptografia (age): no servidor, na imagem de backup do CRM ou num alpine ----------
IMG_BACKUP="$(prefixo_imagens)-backup:$(env_get CRM_VERSION)"
CIFRA=()
if command -v age >/dev/null 2>&1; then
  CIFRA=(age -r "$CHAVE")
elif [ "$DOCKER" -eq 1 ] && docker image inspect "$IMG_BACKUP" >/dev/null 2>&1; then
  CIFRA=(docker run --rm -i --network none --entrypoint age "$IMG_BACKUP" -r "$CHAVE")
elif [ "$DOCKER" -eq 1 ]; then
  docker run --rm alpine:3 sh -c 'apk add --no-cache age >/dev/null && age --version' >/dev/null 2>&1 || fatal "Não encontrei o age (criptografia). Instale com: sudo apt install age"
  CIFRA=(docker run --rm -i alpine:3 sh -c "apk add --no-cache age >/dev/null 2>&1 && exec age -r '$CHAVE'")
else
  fatal "Não encontrei o age (criptografia). Instale com: sudo apt install age"
fi
echo test | "${CIFRA[@]}" >/dev/null 2>>"$LOG" || fatal "A criptografia não funcionou (veja $LOG). Confira a chave pública."

# Imagem com tar para ler volumes do Docker (sem baixar nada, se possível).
IMG_TAR=""
if [ "$DOCKER" -eq 1 ]; then
  for i in alpine:3 alpine:latest busybox:latest "$IMG_BACKUP"; do docker image inspect "$i" >/dev/null 2>&1 && { IMG_TAR="$i"; break; }; done
  [ -n "$IMG_TAR" ] || { docker pull -q alpine:3 >/dev/null 2>&1 && IMG_TAR=alpine:3; }
fi

OK=0; FALHAS=0; AVISOS=0
: > "$MANIFESTO"
tamanho() { du -h "$1" 2>/dev/null | cut -f1; }

# salvar ARQUIVO "descrição" comando...  ->  comando | gzip | age > DEST/ARQUIVO.age
# O comando escreve na saída padrão; tar com "arquivo mudou durante a leitura" (código 1) conta como aviso, não falha.
salvar() {
  local arq="$1" desc="$2"; shift 2
  local out="$DEST/$arq.age"
  info "$desc"
  echo "== $(date '+%H:%M:%S') $desc" >> "$LOG"
  "$@" 2>>"$LOG" | gzip -c -6 | "${CIFRA[@]}" > "$out" 2>>"$LOG"
  local st=("${PIPESTATUS[@]}")
  if [ "${st[0]}" -eq 0 ] || { [ "${st[0]}" -eq 1 ] && [ "${TAR_TOLERANTE:-0}" -eq 1 ]; }; then
    if [ "${st[1]}" -eq 0 ] && [ "${st[2]}" -eq 0 ] && [ -s "$out" ]; then
      [ "${st[0]}" -eq 1 ] && { AVISOS=$((AVISOS + 1)); echo "   (alguns arquivos mudaram durante a cópia: normal com o sistema no ar)" >> "$LOG"; }
      ok "$desc ($(tamanho "$out"))"
      printf 'OK\t%s\t%s\t%s\n' "$arq.age" "$(tamanho "$out")" "$desc" >> "$MANIFESTO"
      OK=$((OK + 1))
      return 0
    fi
  fi
  rm -f "$out"
  erro "FALHOU: $desc (detalhes em $LOG)"
  printf 'FALHOU\t%s\t-\t%s\n' "$arq.age" "$desc" >> "$MANIFESTO"
  FALHAS=$((FALHAS + 1))
  return 1
}
pular() { aviso "$1"; printf 'FORA\t-\t-\t%s\n' "$1" >> "$MANIFESTO"; AVISOS=$((AVISOS + 1)); }
nome_seguro() { echo "$1" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-80; }

# ---------- Produtores (escrevem na saída padrão) ----------
# As senhas dos bancos são lidas DENTRO de cada container: não passam por esta tela nem pelo registro.
dump_postgres() {
  docker exec "$1" sh -c 'U="${POSTGRES_USER:-${POSTGRESQL_USERNAME:-postgres}}"; export PGPASSWORD="${POSTGRES_PASSWORD:-${POSTGRESQL_POSTGRES_PASSWORD:-${POSTGRESQL_PASSWORD:-}}}"
    if [ -n "${POSTGRESQL_POSTGRES_PASSWORD:-}" ]; then U=postgres; fi
    exec pg_dumpall -U "$U" --clean --if-exists'
}
dump_mysql() {
  docker exec "$1" sh -c 'D="$(command -v mariadb-dump || command -v mysqldump)"; [ -n "$D" ] || { echo "sem mysqldump" >&2; exit 1; }
    P="${MARIADB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"
    [ -z "$P" ] && for f in "${MARIADB_ROOT_PASSWORD_FILE:-}" "${MYSQL_ROOT_PASSWORD_FILE:-}"; do [ -n "$f" ] && [ -r "$f" ] && P="$(cat "$f")"; done
    MYSQL_PWD="$P" exec "$D" -uroot --all-databases --single-transaction --quick --routines --events --triggers --hex-blob'
}
dump_mongo() {
  docker exec "$1" sh -c 'U="${MONGO_INITDB_ROOT_USERNAME:-}"; P="${MONGO_INITDB_ROOT_PASSWORD:-}"
    if [ -n "$U" ]; then exec mongodump --quiet --archive -u "$U" -p "$P" --authenticationDatabase admin; else exec mongodump --quiet --archive; fi'
}
dump_redis() {
  docker exec "$1" sh -c 'C="$(command -v redis-cli || command -v valkey-cli || command -v keydb-cli)"; [ -n "$C" ] || exit 1
    export REDISCLI_AUTH="${REDIS_PASSWORD:-}"; [ -n "$REDISCLI_AUTH" ] || unset REDISCLI_AUTH
    F="/tmp/backup-$$.rdb"; "$C" --rdb "$F" >/dev/null 2>&1 && cat "$F"; S=$?; rm -f "$F"; exit $S'
}
tar_volume() { docker run --rm --network none --user 0 -v "$1":/v:ro --entrypoint tar "$IMG_TAR" -C /v -cf - .; }
tar_host() { tar -C / --warning=no-file-changed --ignore-failed-read "${EXCLUIR[@]}" -cf - "$@"; }
tipo_banco() {
  case "$1" in
    *postgres*|*postgis*|*timescale*|*pgvector*) echo postgres ;;
    *mariadb*|*mysql*|*percona*) echo mysql ;;
    *mongo*) echo mongo ;;
    *redis*|*valkey*|*keydb*) echo redis ;;
  esac
}

info "Backup completo do servidor $(hostname) em $DEST"

# ---------- Espaço em disco ----------
# Estimativa grosseira: pastas do sistema + volumes do Docker; comprimido costuma ficar com metade ou menos.
ESTIMATIVA_KB=$(du -sxk /etc /root /home /var/www /srv /opt /usr/local /var/spool/cron 2>/dev/null | awk '{s+=$1} END {print s+0}')
if [ "$DOCKER" -eq 1 ]; then
  VOL_KB=$(for v in $(docker volume ls -q); do docker run --rm --network none -v "$v":/v:ro --entrypoint du "$IMG_TAR" -sk /v 2>/dev/null | cut -f1; done | awk '{s+=$1} END {print s+0}')
  ESTIMATIVA_KB=$((ESTIMATIVA_KB + VOL_KB))
fi
LIVRE_KB=$(df -Pk "$DESTINO_BASE" | awk 'NR==2 {print $4}')
NECESSARIO_KB=$((ESTIMATIVA_KB * 6 / 10 + 1048576))
info "Dados a copiar: ~$((ESTIMATIVA_KB / 1024)) MB (antes de comprimir) · livre em $DESTINO_BASE: $((LIVRE_KB / 1024)) MB"
[ "$LIVRE_KB" -ge "$NECESSARIO_KB" ] || fatal "Pouco espaço: precisa de uns $((NECESSARIO_KB / 1024)) MB livres. Libere espaço, use --destino em outro disco ou apague backups antigos em $DESTINO_BASE."

# ---------- 00: raio-x do servidor (sem senhas, fica legível) ----------
info "Raio-x do servidor"
bash "$RAIZ/deploy/raio-x.sh" "$DEST/00-raio-x.txt" >/dev/null 2>>"$LOG" && ok "Raio-x salvo (00-raio-x.txt)" || aviso "Raio-x incompleto (veja $LOG)"

# ---------- 10-19: bancos de dados em containers ----------
VOLUMES_COBERTOS=" "
# Projeto do docker compose do CRM: o que roda nesta pasta (ou o nome padrão, a pasta).
CRM_PROJETO="$([ "$DOCKER" -eq 1 ] && docker ps -a --filter "label=com.docker.compose.project.working_dir=$RAIZ" --format '{{.Label "com.docker.compose.project"}}' | head -1)"
CRM_PROJETO="${CRM_PROJETO:-$(sed -n 's/^name: *//p' "$RAIZ/docker-compose.yml" 2>/dev/null | head -1)}"
CRM_PROJETO="${CRM_PROJETO:-$(basename "$RAIZ")}"
if [ "$DOCKER" -eq 1 ]; then
  n=10
  while IFS=$'\t' read -r cid nome imagem projeto; do
    [ -n "$cid" ] || continue
    t=$(tipo_banco "$imagem"); [ -n "$t" ] || continue
    rot="${projeto:-avulso}/${nome}"
    arq="$(printf '%02d' "$n")-banco-$(nome_seguro "${projeto:-avulso}-$nome")"
    feito=0
    case "$t" in
      postgres) salvar "$arq.sql.gz" "Banco PostgreSQL $rot (todos os bancos e usuários)" dump_postgres "$cid" && feito=1 ;;
      mysql) salvar "$arq.sql.gz" "Banco MySQL/MariaDB $rot (todos os bancos)" dump_mysql "$cid" && feito=1 ;;
      mongo) salvar "$arq.mongo.archive.gz" "Banco MongoDB $rot" dump_mongo "$cid" && feito=1 ;;
      redis)
        # O Redis da Evolution (WhatsApp) é só cache: não precisa de cópia.
        if [ "$projeto" = "$CRM_PROJETO" ]; then pular "Redis $rot: cache do WhatsApp, não precisa de backup"; feito=1
        else salvar "$arq.rdb.gz" "Redis $rot" dump_redis "$cid" && feito=1; fi ;;
    esac
    n=$((n + 1)); [ "$n" -le 29 ] || n=29
    # Com a cópia do banco feita, a pasta de dados dele (volume) não precisa ir de novo.
    if [ "$feito" -eq 1 ]; then
      while IFS=$'\t' read -r vol destino; do
        case "$destino" in /var/lib/postgresql*|/var/lib/mysql*|/data/db|/data/configdb|/bitnami/*|/data) VOLUMES_COBERTOS="$VOLUMES_COBERTOS$vol " ;; esac
      done < <(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\t"}}{{.Destination}}{{"\n"}}{{end}}{{end}}' "$cid")
    fi
  done < <(docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Label "com.docker.compose.project"}}')
fi

# ---------- 30-39: bancos instalados direto no servidor ----------
if systemctl is-active --quiet postgresql 2>/dev/null && command -v pg_dumpall >/dev/null 2>&1; then
  salvar "30-banco-postgresql-do-sistema.sql.gz" "PostgreSQL instalado no servidor (todos os bancos)" runuser -u postgres -- pg_dumpall --clean --if-exists
fi
if { systemctl is-active --quiet mysql 2>/dev/null || systemctl is-active --quiet mariadb 2>/dev/null; }; then
  D="$(command -v mariadb-dump || command -v mysqldump || true)"
  OPT=(); [ -r /etc/mysql/debian.cnf ] && OPT=(--defaults-file=/etc/mysql/debian.cnf)
  [ -n "$D" ] && salvar "31-banco-mysql-do-sistema.sql.gz" "MySQL/MariaDB instalado no servidor (todos os bancos)" "$D" "${OPT[@]}" --all-databases --single-transaction --quick --routines --events --triggers --hex-blob
fi
if systemctl is-active --quiet mongod 2>/dev/null && command -v mongodump >/dev/null 2>&1; then
  salvar "32-banco-mongodb-do-sistema.archive.gz" "MongoDB instalado no servidor" mongodump --quiet --archive
fi

# ---------- 40-59: volumes do Docker (dados dos sistemas) ----------
if [ "$DOCKER" -eq 1 ] && [ -n "$IMG_TAR" ]; then
  n=40
  EM_USO=" $(docker ps -aq | xargs -r docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' 2>/dev/null | tr '\n' ' ') "
  for v in $(docker volume ls -q); do
    case "$VOLUMES_COBERTOS" in *" $v "*) continue ;; esac
    # Banco do CRM já foi copiado acima; volume anônimo sem uso é resto de container apagado.
    if [[ "$v" =~ ^[0-9a-f]{64}$ ]] && [[ "$EM_USO" != *" $v "* ]]; then continue; fi
    KB=$(docker run --rm --network none -v "$v":/v:ro --entrypoint du "$IMG_TAR" -sk /v 2>/dev/null | cut -f1)
    if [ "${KB:-0}" -gt $((LIMITE_GB * 1048576)) ] && [ "$TUDO" -eq 0 ]; then
      pular "Volume $v ($((KB / 1048576)) GB) ficou de fora por ser maior que $LIMITE_GB GB: rode com --tudo para incluir"
      continue
    fi
    desc="Volume $v"
    [ "$v" = "${CRM_PROJETO}_evolution" ] && desc="Volume $v (sessões do WhatsApp: os aparelhos conectados)"
    [ "$v" = "${CRM_PROJETO}_uploads" ] && desc="Volume $v (arquivos do CRM: logos, fotos, mídias do chat)"
    TAR_TOLERANTE=1 salvar "$(printf '%02d' "$n")-volume-$(nome_seguro "$v").tar.gz" "$desc" tar_volume "$v"
    n=$((n + 1)); [ "$n" -le 59 ] || n=59
  done
fi

# ---------- 60: pastas do servidor ligadas aos containers (fora dos volumes) ----------
EXCLUIR=(--exclude='*/node_modules' --exclude='*/.cache' --exclude='*/.npm' --exclude='*/__pycache__' --exclude="${DEST#/}" --exclude="${DESTINO_BASE#/}" --exclude="${RAIZ#/}/backups" --exclude='var/lib/docker' --exclude='proc' --exclude='sys' --exclude='dev' --exclude='run')
if [ "$DOCKER" -eq 1 ]; then
  mapfile -t PASTAS < <(docker ps -aq | xargs -r docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}{{"\n"}}{{end}}{{end}}' 2>/dev/null \
    | grep -vE '^/(proc|sys|dev|run|var/run|etc|tmp)(/|$)|docker\.sock$|^$' | sort -u | sed 's#^/##')
  [ "${#PASTAS[@]}" -gt 0 ] && TAR_TOLERANTE=1 salvar "60-pastas-dos-containers.tar.gz" "Pastas do servidor usadas pelos containers (${#PASTAS[@]})" tar_host "${PASTAS[@]}"
fi

# ---------- 70-79: configurações e arquivos do servidor ----------
TAR_TOLERANTE=1 salvar "70-configuracao-etc.tar.gz" "Configurações do servidor (/etc: Nginx, certificados SSL, cron, serviços, SSH, usuários)" tar_host etc
existentes() { local p; for p in "$@"; do [ -e "/$p" ] && printf '%s\n' "$p"; done; return 0; }
mapfile -t SISTEMAS < <(existentes opt var/www srv usr/local/bin usr/local/etc usr/local/lib/systemd var/spool/cron)
[ "${#SISTEMAS[@]}" -gt 0 ] && TAR_TOLERANTE=1 salvar "71-sistemas-opt-www-srv.tar.gz" "Sistemas e sites (/opt, /var/www, /srv, /usr/local, cron)" tar_host "${SISTEMAS[@]}"
mapfile -t CASAS < <(existentes root home)
[ "${#CASAS[@]}" -gt 0 ] && TAR_TOLERANTE=1 salvar "72-usuarios-root-home.tar.gz" "Pastas dos usuários (/root e /home, sem caches)" tar_host "${CASAS[@]}"

info "Lista de pacotes e serviços (para remontar o servidor)"
inventario_sistema() {
  echo "### Pacotes instalados manualmente (apt-mark showmanual)"; apt-mark showmanual 2>/dev/null
  echo "### Todos os pacotes (dpkg --get-selections)"; dpkg --get-selections 2>/dev/null
  echo "### Serviços habilitados"; systemctl list-unit-files --state=enabled --no-pager 2>/dev/null
  echo "### Crontab do root"; crontab -l 2>/dev/null
  echo "### Imagens Docker"; docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' 2>/dev/null
  echo "### Containers (com projeto e pasta do docker compose)"; docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null
  echo "### Regras do firewall"; ufw status verbose 2>/dev/null; iptables-save 2>/dev/null
}
salvar "80-inventario-pacotes-servicos.txt.gz" "Lista de pacotes, serviços, imagens e containers" inventario_sistema

# ---------- LEIA-ME e conferência ----------
( cd "$DEST" && sha256sum ./*.age > SHA256SUMS 2>/dev/null )
TOTAL="$(du -sh "$DEST" | cut -f1)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
{
  echo "BACKUP COMPLETO DO SERVIDOR $(hostname) - $(date '+%d/%m/%Y %H:%M')"
  echo "Pasta: $DEST · Total: $TOTAL · Partes OK: $OK · Falhas: $FALHAS · Avisos: $AVISOS"
  echo
  echo "Cada arquivo .age está CRIPTOGRAFADO com a chave pública do backup do CRM ($CHAVE)."
  echo "Para abrir, é preciso a chave PRIVADA (arquivo chave-backup-crm.txt, que fica fora da VPS)."
  echo
  echo "PARTES"
  awk -F'\t' '{printf "  [%s] %-58s %6s  %s\n", $1, $2, $3, $4}' "$MANIFESTO"
  echo
  echo "O QUE NÃO ENTRA"
  echo "  - Programas do sistema operacional (Ubuntu, Docker): reinstalam pela lista em 80-inventario."
  echo "  - Imagens Docker: baixam de novo (o CRM, do GitHub; os outros, do Docker Hub)."
  echo "  - /var/lib/docker inteiro: os dados que importam (bancos e volumes) já estão nas partes acima."
  echo "  - Caches (node_modules, .cache, .npm) e os backups diários do CRM (já criptografados em $RAIZ/backups)."
  echo
  echo "BAIXAR PARA O SEU COMPUTADOR (PowerShell no Windows, um comando):"
  echo "  scp -r ${SUDO_USER:-usuario}@${IP:-IP-DA-VPS}:$DEST C:\\Backups\\"
  echo
  echo "ABRIR UMA PARTE (no computador com o age instalado):"
  echo "  age -d -i chave-backup-crm.txt 10-banco-....sql.gz.age > 10-banco-....sql.gz"
  echo "  (depois descompacte com 7-Zip, ou: gzip -d arquivo.gz)"
  echo
  echo "RESTAURAR"
  echo "  PostgreSQL (.sql.gz):  age -d -i chave.txt ARQ.age | gunzip | docker exec -i CONTAINER psql -U USUARIO -d postgres"
  echo "  MySQL/MariaDB:         age -d -i chave.txt ARQ.age | gunzip | docker exec -i CONTAINER sh -c 'MYSQL_PWD=\"\$MARIADB_ROOT_PASSWORD\" mariadb -uroot'"
  echo "  MongoDB:               age -d -i chave.txt ARQ.age | gunzip | docker exec -i CONTAINER mongorestore --archive --drop -u USUARIO -p SENHA --authenticationDatabase admin"
  echo "  Volume (.tar.gz):      age -d -i chave.txt ARQ.age | gunzip | docker run --rm -i -v VOLUME:/v alpine:3 tar -C /v -x"
  echo "  Pastas (.tar.gz):      age -d -i chave.txt ARQ.age | gunzip | sudo tar -C / -x   (cuidado: sobrescreve os arquivos)"
  echo "  CRM (só ele):          use o backup diário com deploy/restaurar.sh (veja docs/DEPLOY.md)."
  echo
  echo "Conferir se os arquivos chegaram inteiros: sha256sum -c SHA256SUMS"
} > "$DEST/LEIA-ME.txt"
rm -f "$MANIFESTO"

# Dono: quem chamou o sudo (para baixar com scp sem ser root). Os arquivos já estão criptografados.
if [ -n "${SUDO_USER:-}" ]; then chown -R "$SUDO_USER" "$DEST"; fi
chmod 700 "$DEST"

# Guarda os N mais recentes só na pasta padrão (num disco escolhido com --destino, quem cuida é você).
if [ "$DESTINO_BASE" = /var/backups/servidor ]; then
  ls -1d "$DESTINO_BASE"/2[0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9] 2>/dev/null | sort | head -n -"$GUARDAR" | while read -r velho; do rm -rf "$velho" && info "Backup antigo apagado: $velho"; done
fi

echo
cat "$DEST/LEIA-ME.txt"
echo
if [ "$FALHAS" -gt 0 ]; then
  erro "Backup terminou com $FALHAS falha(s). Veja $LOG e mande para análise."
  exit 1
fi
ok "Backup completo concluído: $DEST ($TOTAL)."
