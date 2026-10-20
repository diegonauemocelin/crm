#!/usr/bin/env bash
# Backup COMPLETO da VPS: bancos de dados de todos os sistemas (em container ou instalados direto), volumes e
# pastas dos sistemas, configurações do servidor (/etc: Nginx, certificados, cron, serviços), o CRM (banco,
# arquivos, sessões do WhatsApp, .env) e um raio-x do servidor.
#
#   sudo bash deploy/backup-servidor.sh                    -> salva em /var/backups/servidor/AAAAMMDD-HHMM
#   sudo bash deploy/backup-servidor.sh --destino /mnt/hd  -> salva em outro disco
#   sudo bash deploy/backup-servidor.sh --tudo             -> inclui também volumes maiores que 10 GB
#   sudo bash deploy/backup-servidor.sh --drive gdrive:Backups-VPS
#        -> manda cada parte direto para o Google Drive (rclone), sem ocupar o disco da VPS
#
# Google Drive: precisa do rclone configurado uma vez (veja docs/DEPLOY.md, "Backup no Google Drive").
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
REMOTO=""
LIMITE_GB=10
GUARDAR=3
while [ $# -gt 0 ]; do
  case "$1" in
    --destino) DESTINO_BASE="${2:?Informe a pasta}"; shift 2 ;;
    --chave) CHAVE="${2:?Informe a chave pública age1...}"; shift 2 ;;
    --tudo) TUDO=1; shift ;;
    --drive) REMOTO="${2:?Informe o destino do rclone, ex.: gdrive:Backups-VPS}"; REMOTO="${REMOTO%/}"; shift 2 ;;
    *) fatal "Opção desconhecida: $1" ;;
  esac
done
[ -n "$CHAVE" ] || CHAVE="$(env_get BACKUP_AGE_RECIPIENT)"
[[ "$CHAVE" == age1* ]] || fatal "Chave de criptografia não encontrada. Use --chave age1... (a mesma chave pública do backup do CRM)."
if [ -n "$REMOTO" ]; then
  command -v rclone >/dev/null 2>&1 || fatal "rclone não instalado. Veja docs/DEPLOY.md, \"Backup no Google Drive\"."
  [[ "$REMOTO" == *:* ]] || fatal "Destino do Google Drive no formato remoto:pasta (ex.: gdrive:Backups-VPS)."
  timeout 60 rclone mkdir "$REMOTO" >/dev/null 2>&1 && timeout 60 rclone lsf --max-depth 1 "$REMOTO" >/dev/null 2>&1 \
    || fatal "Não consegui acessar $REMOTO. Confira o rclone (rclone config) e o nome do remoto."
  # No Drive, a VPS guarda só o registro e o LEIA-ME enquanto roda (são enviados no fim e apagados daqui).
  DESTINO_BASE=/var/tmp/backup-servidor
fi

STAMP="$(date +%Y%m%d-%H%M)"
DEST="$DESTINO_BASE/$STAMP"
LOG="$DEST/registro.log"
MANIFESTO="$DEST/.partes"
# A pasta base fica "atravessável" (0711) para o usuário do sudo baixar com scp; cada backup fica 700 e é dele.
install -d -m 0711 "$DESTINO_BASE" || fatal "Não consegui criar $DESTINO_BASE."
exec 9>"$DESTINO_BASE/.trava"
flock -n 9 || fatal "Já tem um backup do servidor em andamento."
umask 077
mkdir -p "$DEST" || fatal "Não consegui criar $DEST."
# Interrompido antes de terminar: não deixa pasta pela metade (o registro fica em ultimo-erro.log).
encerrar() {
  if [ ! -f "$DEST/LEIA-ME.txt" ]; then cp -f "$LOG" "$DESTINO_BASE/ultimo-erro.log" 2>/dev/null; rm -rf "$DEST"
  elif [ -n "$REMOTO" ]; then cp -f "$LOG" "$DESTINO_BASE/ultimo.log" 2>/dev/null; rm -rf "$DEST"; fi
}
trap encerrar EXIT
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
humano() { awk -v b="${1:-0}" 'BEGIN { if (b >= 1073741824) printf "%.1fG", b/1073741824; else if (b >= 1048576) printf "%.0fM", b/1048576; else printf "%.0fK", b/1024 }'; }
# Grava a parte: no disco (DEST) ou direto no Google Drive (rclone rcat: envia enquanto é gerada, sem arquivo local).
gravar() { if [ -n "$REMOTO" ]; then rclone rcat --low-level-retries 20 "$REMOTO/$STAMP/$1"; else cat > "$DEST/$1"; fi; }
# Tamanho da parte gravada (vazio = não chegou).
gravado() {
  if [ -n "$REMOTO" ]; then
    local b; b=$(timeout 120 rclone lsjson --files-only "$REMOTO/$STAMP/$1" 2>/dev/null | grep -o '"Size":[0-9]*' | head -1 | cut -d: -f2)
    [ "${b:-0}" -gt 0 ] && humano "$b"
  else
    [ -s "$DEST/$1" ] && tamanho "$DEST/$1"
  fi
}

# salvar ARQUIVO "descrição" comando...  ->  comando | gzip | age > DEST/ARQUIVO.age
# O comando escreve na saída padrão; tar com "arquivo mudou durante a leitura" (código 1) conta como aviso, não falha.
salvar() {
  local arq="$1" desc="$2"; shift 2
  local tam
  info "$desc"
  echo "== $(date '+%H:%M:%S') $desc" >> "$LOG"
  "$@" 2>>"$LOG" | gzip -c -6 | "${CIFRA[@]}" 2>>"$LOG" | gravar "$arq.age" 2>>"$LOG"
  local st=("${PIPESTATUS[@]}")
  if [ "${st[0]}" -eq 0 ] || { [ "${st[0]}" -eq 1 ] && [ "${TAR_TOLERANTE:-0}" -eq 1 ]; }; then
    if [ "${st[1]}" -eq 0 ] && [ "${st[2]}" -eq 0 ] && [ "${st[3]}" -eq 0 ] && tam="$(gravado "$arq.age")" && [ -n "$tam" ]; then
      [ "${st[0]}" -eq 1 ] && { AVISOS=$((AVISOS + 1)); echo "   (alguns arquivos mudaram durante a cópia: normal com o sistema no ar)" >> "$LOG"; }
      ok "$desc ($tam)"
      printf 'OK\t%s\t%s\t%s\n' "$arq.age" "$tam" "$desc" >> "$MANIFESTO"
      OK=$((OK + 1))
      return 0
    fi
  fi
  if [ -n "$REMOTO" ]; then rclone deletefile "$REMOTO/$STAMP/$arq.age" >/dev/null 2>&1; else rm -f "$DEST/$arq.age"; fi
  erro "FALHOU: $desc (detalhes em $LOG)"
  printf 'FALHOU\t%s\t-\t%s\n' "$arq.age" "$desc" >> "$MANIFESTO"
  FALHAS=$((FALHAS + 1))
  return 1
}
pular() { aviso "$1"; printf 'FORA\t-\t-\t%s\n' "$1" >> "$MANIFESTO"; AVISOS=$((AVISOS + 1)); }
nome_seguro() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-80; }

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
    "$C" --rdb - 2>/dev/null && exit 0
    F="/tmp/backup-$$.rdb"; "$C" --rdb "$F" >/dev/null 2>&1 && cat "$F"; S=$?; rm -f "$F"; exit $S'
}
tar_volume() { docker run --rm --network none --user 0 -v "$1":/v:ro --entrypoint tar "$IMG_TAR" -C /v -cf - .; }
tar_host() { tar -C / --warning=no-file-changed --ignore-failed-read "${EXCLUIR[@]}" -cf - "$@"; }
# O container tem a ferramenta de cópia? (imagem com "postgres" no nome pode ser um exportador ou um painel.)
tem_ferramenta() {
  local f
  case "$2" in postgres) f=pg_dumpall ;; mysql) f="mariadb-dump mysqldump" ;; mongo) f=mongodump ;; redis) f="redis-cli valkey-cli keydb-cli" ;; esac
  docker exec "$1" sh -c "for b in $f; do command -v \$b >/dev/null 2>&1 && exit 0; done; exit 1" >/dev/null 2>&1
}
tipo_banco() {
  case "$1" in
    *postgres*|*postgis*|*timescale*|*pgvector*) echo postgres ;;
    *mariadb*|*mysql*|*percona*) echo mysql ;;
    *mongo*) echo mongo ;;
    *redis*|*valkey*|*keydb*) echo redis ;;
  esac
}

ONDE="$DEST"; [ -n "$REMOTO" ] && ONDE="$REMOTO/$STAMP (Google Drive)"
info "Backup completo do servidor $(hostname) em $ONDE"

# ---------- Espaço em disco ----------
# Estimativa grosseira: pastas do sistema + volumes do Docker; comprimido costuma ficar com metade ou menos.
ESTIMATIVA_KB=$(du -sxk /etc /root /home /var/www /srv /opt /usr/local /var/spool/cron 2>/dev/null | awk '{s+=$1} END {print s+0}')
if [ "$DOCKER" -eq 1 ]; then
  VOL_KB=$(for v in $(docker volume ls -q); do docker run --rm --network none -v "$v":/v:ro --entrypoint du "$IMG_TAR" -sk /v 2>/dev/null | cut -f1; done | awk '{s+=$1} END {print s+0}')
  BIND_KB=$(docker ps -aq | xargs -r docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}{{"\n"}}{{end}}{{end}}' 2>/dev/null \
    | grep -vE '^/(proc|sys|dev|run|var/run|etc|tmp|opt|var/www|srv|usr/local|root|home)(/|$)|docker\.sock$|^$' | sort -u | xargs -r du -sxk 2>/dev/null | awk '{s+=$1} END {print s+0}')
  ESTIMATIVA_KB=$((ESTIMATIVA_KB + VOL_KB + BIND_KB))
fi
LIVRE_KB=$(df -Pk "$DESTINO_BASE" | awk 'NR==2 {print $4}')
NECESSARIO_KB=$((ESTIMATIVA_KB * 6 / 10 + 1048576))
# No Google Drive as partes não passam pelo disco: só precisa de folga para o registro.
[ -n "$REMOTO" ] && NECESSARIO_KB=51200
info "Dados a copiar: ~$((ESTIMATIVA_KB / 1024)) MB (antes de comprimir) · livre em $DESTINO_BASE: $((LIVRE_KB / 1024)) MB"
[ "$LIVRE_KB" -ge "$NECESSARIO_KB" ] || fatal "Pouco espaço: precisa de uns $((NECESSARIO_KB / 1024)) MB livres. Libere espaço, use --destino em outro disco ou apague backups antigos em $DESTINO_BASE."

# ---------- 00: raio-x do servidor (sem senhas, fica legível) ----------
info "Raio-x do servidor"
bash "$(dirname "$0")/raio-x.sh" "$DEST/00-raio-x.txt" >/dev/null 2>>"$LOG" && ok "Raio-x salvo (00-raio-x.txt)" || aviso "Raio-x incompleto (veja $LOG)"

# ---------- 10-19: bancos de dados em containers ----------
VOLUMES_COBERTOS=" "
DADOS_BANCO=()
REINST_BANCOS=()
REINST_VOLUMES=()
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
    if ! tem_ferramenta "$cid" "$t"; then pular "Container $rot ($imagem) não tem a ferramenta de cópia de banco: tratado como sistema comum (volumes e pastas)"; continue; fi
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
    if [ "$feito" -eq 1 ] && [ "$t" != redis ] || { [ "$t" = redis ] && [ "$projeto" != "$CRM_PROJETO" ] && [ "$feito" -eq 1 ]; }; then
      ext=sql.gz; [ "$t" = mongo ] && ext=mongo.archive.gz; [ "$t" = redis ] && ext=rdb.gz
      usuario="$(docker exec "$cid" sh -c 'echo "${POSTGRES_USER:-${POSTGRESQL_USERNAME:-postgres}}"' 2>/dev/null)"
      servico="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$cid" 2>/dev/null)"
      REINST_BANCOS+=("$t	${projeto:-}	$nome	${servico:-}	$arq.$ext.age	${usuario:-postgres}")
    fi
    n=$((n + 1)); [ "$n" -le 29 ] || n=29
    # Com a cópia do banco feita, a pasta de dados dele (volume) não precisa ir de novo.
    if [ "$feito" -eq 1 ]; then
      while IFS=$'\t' read -r vol destino; do
        case "$destino" in /var/lib/postgresql*|/var/lib/mysql*|/data/db|/data/configdb|/bitnami/*|/data) VOLUMES_COBERTOS="$VOLUMES_COBERTOS$vol " ;; esac
      done < <(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\t"}}{{.Destination}}{{"\n"}}{{end}}{{end}}' "$cid")
      # Pasta de dados do banco montada do servidor (bind): também não vai crua (a cópia já foi feita).
      while IFS=$'\t' read -r origem destino; do
        case "$destino" in /var/lib/postgresql*|/var/lib/mysql*|/data/db|/data/configdb|/bitnami/*|/data) DADOS_BANCO+=(--exclude="${origem#/}") ;; esac
      done < <(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}{{"\t"}}{{.Destination}}{{"\n"}}{{end}}{{end}}' "$cid")
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
    arqv="$(printf '%02d' "$n")-volume-$(nome_seguro "$v").tar.gz"
    vproj="$(docker volume inspect -f '{{index .Labels "com.docker.compose.project"}}' "$v" 2>/dev/null)"
    # Volume sem a marca do docker compose: o projeto é o do container que usa o volume.
    [ -n "$vproj" ] || vproj="$(docker ps -a --filter "volume=$v" --format '{{.Label "com.docker.compose.project"}}' | grep -v '^$' | head -1)"
    TAR_TOLERANTE=1 salvar "$arqv" "$desc" tar_volume "$v" && REINST_VOLUMES+=("$v	$vproj	$arqv.age")
    n=$((n + 1)); [ "$n" -le 59 ] || n=59
  done
fi

# ---------- 60: pastas do servidor ligadas aos containers (fora dos volumes) ----------
# Já vão inteiras nas partes 70-72: não repete.
JA_COPIADAS='^/(opt|var/www|srv|usr/local|root|home)(/|$)'
EXCLUIR=(--exclude='*/node_modules' --exclude='*/.cache' --exclude='*/.npm' --exclude='*/__pycache__' --exclude="${DEST#/}" --exclude="${DESTINO_BASE#/}" --exclude="${RAIZ#/}/backups" --exclude='var/lib/docker' "${DADOS_BANCO[@]}")
if [ "$DOCKER" -eq 1 ]; then
  mapfile -t PASTAS < <(docker ps -aq | xargs -r docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}{{"\n"}}{{end}}{{end}}' 2>/dev/null \
    | grep -vE '^/(proc|sys|dev|run|var/run|etc|tmp)(/|$)|docker\.sock$|^$' | grep -vE "$JA_COPIADAS" | sort -u | sed 's#^/##')
  # Pastas dos projetos docker compose (docker-compose.yml, .env) fora das pastas copiadas abaixo.
  mapfile -t PROJETOS_FORA < <(docker ps -aq | xargs -r docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null | grep -v '^$' | grep -vE "$JA_COPIADAS" | sort -u | sed 's#^/##')
  PASTAS+=("${PROJETOS_FORA[@]}")
  # Pasta dentro de outra da lista vai uma vez só (a de fora já leva a de dentro).
  mapfile -t PASTAS < <(printf '%s\n' "${PASTAS[@]}" | grep -v '^$' | sort -u | awk '{ for (i in p) if (index($0, p[i] "/") == 1) next; p[NR] = $0; print }')
  [ "${#PASTAS[@]}" -gt 0 ] && TAR_TOLERANTE=1 salvar "60-pastas-dos-containers.tar.gz" "Pastas do servidor usadas pelos containers e projetos fora de /opt (${#PASTAS[@]})" tar_host "${PASTAS[@]}"
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

# ---------- Passo a passo para remontar o servidor (com os nomes desta VPS, sem senhas) ----------
parte_de() { awk -F'\t' -v p="$1" '$1 == "OK" && index($2, p) == 1 {print $2; exit}' "$MANIFESTO"; }
como_reinstalar() {
  local p70 p71 p72 p60 linha t proj nome serv arq usr dir v vproj varq s sites servicos
  p60=$(parte_de 60-); p70=$(parte_de 70-); p71=$(parte_de 71-); p72=$(parte_de 72-)
  sites=$(for f in /etc/nginx/sites-enabled/*; do [ -f "$f" ] && grep -hE '^\s*server_name' "$f" | sed -E 's/^\s*server_name\s+//; s/;.*//'; done | tr ' ' '\n' | grep -v '^_\?$' | sort -u | tr '\n' ' ')
  servicos=$(find /etc/systemd/system -maxdepth 1 -type f -name '*.service' 2>/dev/null | xargs -r -n1 basename | grep -vE '^(dbus-|snap|sshd|syslog|cloud-|getty|display-manager|network|systemd-)' | tr '\n' ' ')
  cat <<TXT
COMO REMONTAR O SERVIDOR $(hostname) A PARTIR DESTE BACKUP ($STAMP)
Feito para esta VPS: nomes de pastas, sistemas, sites e partes do backup são os reais. Nenhuma senha aparece aqui
(as senhas estão dentro do backup criptografado: .env dos sistemas e /etc).

Sites que este servidor atende: ${sites:-nenhum encontrado}
Sistemas: $(printf '%s\n' "${REINST_BANCOS[@]}" | cut -f2 | sort -u | grep -v '^$' | tr '\n' ' ')${servicos:+· serviços: $servicos}

PASSO 1 · VPS NOVA
  Ubuntu $(. /etc/os-release 2>/dev/null && echo "$VERSION_ID") (o mesmo de hoje), com pelo menos $(awk '/MemTotal/ {printf "%.0f", $2/1048576}' /proc/meminfo) GB de memória.
  Entre como root (ssh root@IP-NOVO).

PASSO 2 · PROGRAMAS
  apt update && apt install -y ca-certificates curl nginx certbot python3-certbot-nginx age
  curl -fsSL https://get.docker.com | sh
  (A lista completa do que estava instalado está na parte 80-inventario, seção "Pacotes instalados manualmente".)
TXT
  if [ -n "$servicos" ]; then
    echo "  Serviços próprios deste servidor e como iniciam (instale o que eles usam, ex.: Node.js na mesma versão):"
    for s in $servicos; do echo "    $s: $(grep -hE '^(ExecStart|WorkingDirectory)=' "/etc/systemd/system/$s" 2>/dev/null | tr '\n' ' ')"; done
    command -v node >/dev/null 2>&1 && echo "    Node.js hoje: $(node -v 2>/dev/null)"
  fi
  cat <<TXT

PASSO 3 · COPIAR O BACKUP E A CHAVE PARA A VPS NOVA
  Copie esta pasta do backup para /root/restaurar (Bitvise/WinSCP) e o arquivo da chave privada para /root/chave-backup-crm.txt.
  Na VPS nova, deixe prontos estes atalhos (cole as duas linhas):
    K=/root/chave-backup-crm.txt; B=/root/restaurar
    abrir() { age -d -i "\$K" "\$B/\$1" | gunzip; }

PASSO 4 · ARQUIVOS DOS SISTEMAS
TXT
  [ -n "$p71" ] && echo "  abrir $p71 | tar -C / -x          # /opt (sistemas, docker-compose.yml e .env), /var/www, /srv, /usr/local"
  [ -n "$p72" ] && echo "  abrir $p72 | tar -C / -x          # /root e /home"
  [ -n "$p60" ] && echo "  abrir $p60 | tar -C / -x          # pastas usadas pelos containers fora de /opt"
  cat <<TXT

PASSO 5 · CONFIGURAÇÕES DO SERVIDOR (só o necessário: NÃO extraia o /etc inteiro numa VPS nova, isso quebra rede e usuários)
TXT
  [ -n "$p70" ] && {
    printf '  abrir %s | tar -C / -x etc/nginx/sites-available etc/nginx/sites-enabled etc/letsencrypt' "$p70"
    for s in $servicos; do printf ' etc/systemd/system/%s' "$s"; done
    printf ' etc/cron.d
'
    echo "  nginx -t && systemctl reload nginx"
    [ -n "$servicos" ] && echo "  systemctl daemon-reload"
    echo "  Crontab do root (se havia): veja a seção \"Crontab do root\" na parte 80-inventario e cole com: crontab -e"
  }
  echo
  echo "PASSO 6 · BANCOS DE DADOS E VOLUMES (um sistema por vez)"
  for proj in $(printf '%s\n' "${REINST_BANCOS[@]}" "${REINST_VOLUMES[@]}" | awk -F'\t' '{ if (NF == 6) print $2; else print $2 }' | sort -u | grep -v '^$'); do
    dir=$(docker ps -a --filter "label=com.docker.compose.project=$proj" --format '{{.Label "com.docker.compose.project.working_dir"}}' | head -1)
    echo "  -- Sistema \"$proj\" (pasta ${dir:-?})"
    echo "     cd ${dir:-/opt/$proj}"
    for linha in "${REINST_BANCOS[@]}"; do
      IFS=$'\t' read -r t p nome serv arq usr <<< "$linha"; [ "$p" = "$proj" ] || continue
      echo "     docker compose up -d ${serv:-SERVIÇO-DO-BANCO}        # só o banco, vazio"
      echo "     sleep 15"
      case "$t" in
        postgres) echo "     abrir $arq | docker compose exec -T ${serv:-db} psql -U $usr -d postgres" ;;
        mysql) echo "     abrir $arq | docker compose exec -T ${serv:-db} sh -c 'C=\$(command -v mariadb || command -v mysql); MYSQL_PWD=\"\${MARIADB_ROOT_PASSWORD:-\$MYSQL_ROOT_PASSWORD}\" exec \$C -uroot'" ;;
        mongo) echo "     abrir $arq | docker compose exec -T ${serv:-db} sh -c 'mongorestore --archive --drop -u \"\$MONGO_INITDB_ROOT_USERNAME\" -p \"\$MONGO_INITDB_ROOT_PASSWORD\" --authenticationDatabase admin'" ;;
        redis) echo "     (Redis: pare o container, copie o arquivo aberto como dump.rdb para a pasta de dados dele e suba de novo)" ;;
      esac
    done
    for linha in "${REINST_VOLUMES[@]}"; do
      IFS=$'\t' read -r v vproj varq <<< "$linha"; [ "$vproj" = "$proj" ] || continue
      echo "     docker volume create $v"
      echo "     abrir $varq | docker run --rm -i -v $v:/v alpine:3 tar -C /v -x"
    done
    if [ "$proj" = "$CRM_PROJETO" ]; then
      echo "     bash deploy/deploy.sh       # CRM: baixa as imagens da versão instalada, aplica o banco e sobe tudo"
    else
      echo "     docker compose up -d --build   # sobe o resto do sistema (monta as imagens a partir do código em ${dir:-a pasta})"
    fi
  done
  for linha in "${REINST_VOLUMES[@]}"; do
    IFS=$'\t' read -r v vproj varq <<< "$linha"; [ -z "$vproj" ] || continue
    echo "  -- Volume avulso $v: docker volume create $v && abrir $varq | docker run --rm -i -v $v:/v alpine:3 tar -C /v -x"
  done
  [ -n "$servicos" ] && { echo; echo "PASSO 7 · SERVIÇOS PRÓPRIOS"; for s in $servicos; do echo "  systemctl enable --now $s"; done; }
  cat <<TXT

PASSO 8 · ENDEREÇOS (DNS) E CERTIFICADOS
  No painel do domínio, aponte ${sites:-os sites} para o IP da VPS nova.
  Depois que apontar (pode levar alguns minutos): certbot renew --dry-run   (os certificados vieram no /etc/letsencrypt)

PASSO 9 · CONFERIR
  Abra cada site. No CRM: Configurações › Números de WhatsApp — as sessões voltam com o backup; se algum número
  pedir QR Code, leia de novo pelo celular.

PASSO 10 · SEGURANÇA
  shred -u /root/chave-backup-crm.txt     # a chave privada não fica na VPS
  Rode o script de segurança do CRM: bash /opt/usaparts-crm/deploy/seguranca-vps.sh
TXT
}

# ---------- LEIA-ME e conferência ----------
if [ -n "$REMOTO" ]; then
  # O Google Drive confere cada envio (md5); a lista serve para conferir de novo depois de baixar.
  timeout 300 rclone md5sum "$REMOTO/$STAMP" > "$DEST/MD5SUMS" 2>>"$LOG"
  TOTAL="$(timeout 120 rclone size --json "$REMOTO/$STAMP" 2>/dev/null | grep -o '"bytes":[0-9]*' | cut -d: -f2)"; TOTAL="$(humano "${TOTAL:-0}")"
else
  ( cd "$DEST" && sha256sum ./*.age > SHA256SUMS 2>/dev/null )
  TOTAL="$(du -sh "$DEST" | cut -f1)"
fi
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
{
  echo "BACKUP COMPLETO DO SERVIDOR $(hostname) - $(date '+%d/%m/%Y %H:%M')"
  echo "Pasta: $ONDE · Total: $TOTAL · Partes OK: $OK · Falhas: $FALHAS · Avisos: $AVISOS"
  echo
  echo "Cada arquivo .age está CRIPTOGRAFADO com a chave pública do backup do CRM ($CHAVE)."
  echo "Para abrir, é preciso a chave PRIVADA (arquivo chave-backup-crm.txt, que fica fora da VPS)."
  echo
  echo "PASSO A PASSO PARA REMONTAR O SERVIDOR: veja COMO-REINSTALAR.txt (nesta mesma pasta)."
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
  if [ -n "$REMOTO" ]; then
    echo "ONDE ESTÁ: no Google Drive, pasta $STAMP dentro de ${REMOTO#*:} (baixe pelo navegador ou pelo Google Drive para computador)."
  else
    echo "BAIXAR PARA O SEU COMPUTADOR (PowerShell no Windows, um comando):"
    echo "  scp -r ${SUDO_USER:-usuario}@${IP:-IP-DA-VPS}:$DEST C:\\Backups\\"
  fi
  echo
  echo "ABRIR UMA PARTE (no computador com o age instalado):"
  echo "  age -d -i chave-backup-crm.txt 10-banco-....sql.gz.age > 10-banco-....sql.gz"
  echo "  (depois descompacte com 7-Zip, ou: gzip -d arquivo.gz)"
  echo
  echo "RESTAURAR"
  echo "  Antes: pare os containers do sistema e deixe só o do banco no ar (ex.: docker compose stop api evolution), ou"
  echo "  restaure num container de banco novo e vazio. Com o sistema gravando, a restauração fica pela metade."
  echo "  PostgreSQL (.sql.gz):  age -d -i chave.txt ARQ.age | gunzip | docker exec -i CONTAINER psql -U USUARIO -d postgres -v ON_ERROR_STOP=0"
  echo "                         (aviso de que o usuário conectado não pode ser apagado é normal)"
  echo "  MySQL/MariaDB:         age -d -i chave.txt ARQ.age | gunzip | docker exec -i CONTAINER sh -c 'C=\$(command -v mariadb || command -v mysql); MYSQL_PWD=\"\${MARIADB_ROOT_PASSWORD:-\$MYSQL_ROOT_PASSWORD}\" exec \$C -uroot'"
  echo "  MongoDB:               age -d -i chave.txt ARQ.age | gunzip | docker exec -i CONTAINER mongorestore --archive --drop -u USUARIO -p SENHA --authenticationDatabase admin"
  echo "  Volume (.tar.gz):      age -d -i chave.txt ARQ.age | gunzip | docker run --rm -i -v VOLUME:/v alpine:3 tar -C /v -x"
  echo "  Pastas (.tar.gz):      age -d -i chave.txt ARQ.age | gunzip | sudo tar -C / -x   (cuidado: sobrescreve os arquivos)"
  echo "  CRM (só ele):          use o backup diário com deploy/restaurar.sh (veja docs/DEPLOY.md)."
  echo
  if [ -n "$REMOTO" ]; then echo "Conferir se os arquivos baixados estão inteiros: md5sum -c MD5SUMS"; else echo "Conferir se os arquivos chegaram inteiros: sha256sum -c SHA256SUMS"; fi
} > "$DEST/LEIA-ME.txt"
como_reinstalar > "$DEST/COMO-REINSTALAR.txt"
rm -f "$MANIFESTO"
[ "$FALHAS" -eq 0 ] && touch "$DEST/.completo"
if [ -n "$REMOTO" ]; then
  info "Enviando LEIA-ME, raio-x e registro para o Google Drive"
  for f in LEIA-ME.txt COMO-REINSTALAR.txt 00-raio-x.txt MD5SUMS registro.log .completo; do
    [ -f "$DEST/$f" ] && { timeout 300 rclone copyto "$DEST/$f" "$REMOTO/$STAMP/$f" 2>>"$LOG" || { erro "Não consegui enviar $f"; FALHAS=$((FALHAS + 1)); }; }
  done
fi

# Dono: quem chamou o sudo (para baixar com scp sem ser root). Os arquivos já estão criptografados.
if [ -n "${SUDO_USER:-}" ]; then chown -R "$SUDO_USER" "$DEST"; fi
chmod 700 "$DEST"

# Guarda os N mais recentes só na pasta padrão (num disco escolhido com --destino, quem cuida é você).
# Só depois de um backup sem falhas, e só conta os completos: backup bom nunca é apagado por um que deu errado.
if [ -n "$REMOTO" ] && [ "$FALHAS" -eq 0 ]; then
  timeout 300 rclone lsf --dirs-only "$REMOTO" 2>/dev/null | tr -d '/' | grep -E '^2[0-9]{7}-[0-9]{4}$' | sort | while read -r d; do
    timeout 60 rclone lsf "$REMOTO/$d/.completo" >/dev/null 2>&1 && echo "$d"
  done | head -n -"$GUARDAR" | while read -r velho; do timeout 600 rclone purge "$REMOTO/$velho" && info "Backup antigo apagado do Google Drive: $velho"; done
elif [ "$DESTINO_BASE" = /var/backups/servidor ] && [ "$FALHAS" -eq 0 ]; then
  for d in "$DESTINO_BASE"/2[0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]; do [ -f "$d/.completo" ] && echo "$d"; done | sort | head -n -"$GUARDAR" \
    | while read -r velho; do rm -rf "$velho" && info "Backup antigo apagado: $velho"; done
fi

echo
cat "$DEST/LEIA-ME.txt"
echo
if [ "$FALHAS" -gt 0 ]; then
  erro "Backup terminou com $FALHAS falha(s). Veja $LOG e mande para análise."
  exit 1
fi
ok "Backup completo concluído: $ONDE ($TOTAL)."
