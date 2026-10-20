#!/usr/bin/env bash
# Raio-x da VPS (SOMENTE LEITURA): uso de CPU, memória e disco, sistemas instalados, bancos de dados e se cabe
# mais um sistema. Não instala, não altera, não reinicia nada e não mostra senhas.
#   sudo bash deploy/raio-x.sh
# Gera raio-x-<servidor>-AAAAMMDD-HHMM.txt na pasta atual: mande esse arquivo (ou o texto) para análise.

set -uo pipefail
export LC_ALL=C
SAIDA="${1:-raio-x-$(hostname -s 2>/dev/null || echo vps)-$(date +%Y%m%d-%H%M).txt}"

tem() { command -v "$1" >/dev/null 2>&1; }
secao() { printf '\n===== %s =====\n' "$1"; }
# Bytes -> "1,2 GB" / "350 MB".
tam() { awk -v b="${1:-0}" 'BEGIN { if (b >= 1073741824) printf "%.1f GB", b/1073741824; else if (b >= 1048576) printf "%.0f MB", b/1048576; else printf "%.0f KB", b/1024 }'; }
kb() { awk -v k="$(grep -E "^$1:" /proc/meminfo | awk '{print $2}')" 'BEGIN { print k+0 }'; }
docker_ok() { tem docker && timeout 10 docker info >/dev/null 2>&1; }

# Tipo do banco pela imagem do container.
tipo_banco() {
  case "$1" in
    *postgres*|*postgis*|*timescale*|*pgvector*|*supabase/postgres*) echo postgres ;;
    *mariadb*|*mysql*|*percona*) echo mysql ;;
    *mongo*) echo mongo ;;
    *redis*|*valkey*|*keydb*) echo redis ;;
    *) echo "" ;;
  esac
}

# Bancos de um container (nome<TAB>bytes), com as credenciais lidas DENTRO do container (nada sai dele).
bancos_postgres() {
  timeout 60 docker exec "$1" sh -c 'U="${POSTGRES_USER:-${POSTGRESQL_USERNAME:-postgres}}"; PGPASSWORD="${POSTGRES_PASSWORD:-${POSTGRESQL_PASSWORD:-}}" psql -U "$U" -d postgres -AtF "	" -c "SELECT datname, pg_database_size(datname) FROM pg_database WHERE NOT datistemplate ORDER BY 2 DESC" 2>/dev/null || PGPASSWORD="${POSTGRES_PASSWORD:-${POSTGRESQL_PASSWORD:-}}" psql -U "$U" -d "${POSTGRES_DB:-$U}" -AtF "	" -c "SELECT datname, pg_database_size(datname) FROM pg_database WHERE NOT datistemplate ORDER BY 2 DESC"' 2>/dev/null \
    | grep -vE '^postgres	'
}
bancos_mysql() {
  timeout 60 docker exec "$1" sh -c 'B="$(command -v mariadb || command -v mysql)"; [ -n "$B" ] || exit 1
    P="${MARIADB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"
    [ -z "$P" ] && for f in "${MARIADB_ROOT_PASSWORD_FILE:-}" "${MYSQL_ROOT_PASSWORD_FILE:-}"; do [ -n "$f" ] && [ -r "$f" ] && P="$(cat "$f")"; done
    Q="SELECT s.schema_name, COALESCE(SUM(t.data_length + t.index_length), 0) FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name GROUP BY s.schema_name ORDER BY 2 DESC"
    MYSQL_PWD="$P" "$B" -uroot -N -B -e "$Q" 2>/dev/null || MYSQL_PWD="${MARIADB_PASSWORD:-${MYSQL_PASSWORD:-}}" "$B" -u"${MARIADB_USER:-${MYSQL_USER:-root}}" -N -B -e "$Q"' 2>/dev/null \
    | grep -vE '^(information_schema|performance_schema|mysql|sys)	'
}
bancos_mongo() {
  timeout 60 docker exec "$1" sh -c 'M="$(command -v mongosh || command -v mongo)"; [ -n "$M" ] || exit 1
    U="${MONGO_INITDB_ROOT_USERNAME:-}"; P="${MONGO_INITDB_ROOT_PASSWORD:-}"
    if [ -n "$U" ]; then "$M" --quiet -u "$U" -p "$P" --authenticationDatabase admin --eval "db.adminCommand({listDatabases:1}).databases.forEach(d => print(d.name + \"\t\" + d.sizeOnDisk))"
    else "$M" --quiet --eval "db.adminCommand({listDatabases:1}).databases.forEach(d => print(d.name + \"\t\" + d.sizeOnDisk))"; fi' 2>/dev/null \
    | grep -vE '^(admin|config|local)	'
}
info_redis() {
  timeout 30 docker exec "$1" sh -c 'C="$(command -v redis-cli || command -v valkey-cli || command -v keydb-cli)"; [ -n "$C" ] || exit 1
    export REDISCLI_AUTH="${REDIS_PASSWORD:-}"; [ -n "$REDISCLI_AUTH" ] || unset REDISCLI_AUTH
    echo "chaves: $($C DBSIZE 2>/dev/null) · memória: $($C INFO memory 2>/dev/null | sed -n "s/^used_memory_human://p" | tr -d "\r")"' 2>/dev/null
}

TOTAL_BANCOS=0
TOTAL_SERVIDORES=0
LISTA_BANCOS=""
registrar_bancos() { # $1 = onde (rótulo), stdin = nome<TAB>bytes
  local onde="$1" n=0 linha nome bytes
  while IFS=$'\t' read -r nome bytes; do
    [ -n "$nome" ] || continue
    n=$((n + 1))
    printf '    - %-32s %s\n' "$nome" "$(tam "${bytes:-0}")"
  done
  TOTAL_SERVIDORES=$((TOTAL_SERVIDORES + 1))
  TOTAL_BANCOS=$((TOTAL_BANCOS + n))
  LISTA_BANCOS="${LISTA_BANCOS}${onde}: ${n} banco(s)\n"
  [ "$n" -gt 0 ] || echo "    (nenhum banco de usuário, ou não deu para ler: confira a senha/usuário do container)"
}

{
  echo "Raio-x da VPS - $(date '+%d/%m/%Y %H:%M') - servidor $(hostname 2>/dev/null)"
  echo "(Somente leitura: nada foi alterado. Senhas não aparecem neste relatório.)"

  # ---------- Recursos ----------
  MEM_T=$(kb MemTotal); MEM_D=$(kb MemAvailable); SW_T=$(kb SwapTotal); SW_L=$(kb SwapFree)
  NUCLEOS=$(nproc 2>/dev/null || echo 1)
  read -r L1 L5 L15 _ < /proc/loadavg
  DISCO=$(df -PB1 / | awk 'NR==2 {print $2, $3, $4}')
  read -r D_T D_U D_L <<< "$DISCO"

  secao "Resumo dos recursos"
  echo "Sistema: $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") · kernel $(uname -r)"
  echo "Ligado há: $(uptime -p 2>/dev/null || cat /proc/uptime)"
  echo "CPU: $NUCLEOS núcleo(s) · carga média 1/5/15 min: $L1 / $L5 / $L15"
  echo "Memória: total $(tam $((MEM_T * 1024))) · em uso $(tam $(((MEM_T - MEM_D) * 1024))) · disponível $(tam $((MEM_D * 1024))) ($(awk -v d="$MEM_D" -v t="$MEM_T" 'BEGIN{printf "%.0f", d*100/t}')% livre)"
  echo "Swap: total $(tam $((SW_T * 1024))) · em uso $(tam $(((SW_T - SW_L) * 1024)))"
  echo "Disco (/): total $(tam "$D_T") · em uso $(tam "$D_U") · livre $(tam "$D_L") ($(awk -v l="$D_L" -v t="$D_T" 'BEGIN{printf "%.0f", l*100/t}')% livre)"
  df -h -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null | awk 'NR==1 || $6 != "/"' | sed 's/^/  /'

  secao "Memória por processo (os 15 que mais usam)"
  ps -eo rss=,comm= --sort=-rss 2>/dev/null | head -15 | awk '{printf "  %8.0f MB  %s\n", $1/1024, $2}'

  # ---------- Sistemas instalados ----------
  INSTALACOES=0
  secao "Sistemas em Docker (cada projeto = uma instalação)"
  if docker_ok; then
    docker --version
    echo
    PROJETOS=$(docker ps -a --format '{{.Label "com.docker.compose.project"}}' | sort -u | grep -v '^$' || true)
    for p in $PROJETOS; do
      INSTALACOES=$((INSTALACOES + 1))
      DIR=$(docker ps -a --filter "label=com.docker.compose.project=$p" --format '{{.Label "com.docker.compose.project.working_dir"}}' | head -1)
      echo "* Projeto \"$p\"${DIR:+ (pasta $DIR)}"
      docker ps -a --filter "label=com.docker.compose.project=$p" --format '{{.Names}} · {{.Image}} · {{.Status}}' | sed 's/^/    /'
    done
    AVULSOS=$(docker ps -a --format '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Image}}\t{{.Status}}' | awk -F'\t' '$2 == ""')
    if [ -n "$AVULSOS" ]; then
      echo "* Containers avulsos (sem docker compose):"
      echo "$AVULSOS" | awk -F'\t' '{printf "    %s · %s · %s\n", $1, $3, $4}'
      INSTALACOES=$((INSTALACOES + $(echo "$AVULSOS" | wc -l)))
    fi
    [ -n "$PROJETOS$AVULSOS" ] || echo "Nenhum container."

    secao "Uso de memória e CPU por container (agora)"
    timeout 30 docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}' 2>/dev/null | sed 's/^/  /'
    LIMITES=$(docker ps -q | xargs -r docker inspect -f '{{.HostConfig.Memory}}' 2>/dev/null | awk '{s+=$1} END {print s+0}')
    SEM_LIMITE=$(docker ps -q | xargs -r docker inspect -f '{{.Name}} {{.HostConfig.Memory}}' 2>/dev/null | awk '$2 == 0 {print substr($1,2)}' | tr '\n' ' ')
    echo "  Soma dos limites de memória definidos: $(tam "$LIMITES")${SEM_LIMITE:+ · sem limite: $SEM_LIMITE}"

    secao "Espaço usado pelo Docker"
    timeout 60 docker system df 2>/dev/null | sed 's/^/  /'
    echo "  -- volumes (dados dos sistemas):"
    timeout 120 docker system df -v 2>/dev/null | awk '/^Local Volumes space usage/ {f=1; next} /^Build cache usage/ {f=0} f && NF' | sed 's/^/  /'
  else
    echo "Docker não instalado ou parado."
  fi

  secao "Sites no servidor web"
  SITES=0
  if [ -d /etc/nginx ]; then
    echo "Nginx: $(systemctl is-active nginx 2>/dev/null || echo '?')"
    for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
      [ -f "$f" ] || continue
      NOMES=$(grep -hE '^\s*server_name' "$f" | sed -E 's/^\s*server_name\s+//; s/;.*//' | tr '\n' ' ' | xargs -n1 2>/dev/null | sort -u | tr '\n' ' ')
      DESTINO=$(grep -hoE '(proxy_pass|root)\s+[^;]+' "$f" | head -2 | tr '\n' ' ')
      echo "  * $(basename "$f"): ${NOMES:-sem server_name} → ${DESTINO:-?}"
      SITES=$((SITES + 1))
    done
  fi
  if tem apache2ctl; then echo "Apache:"; apache2ctl -S 2>/dev/null | grep -E 'namevhost|port' | sed 's/^/  /'; fi
  [ "$SITES" -gt 0 ] || [ -d /etc/nginx ] || echo "Nenhum Nginx encontrado."

  secao "Serviços instalados à parte (systemd, fora do sistema operacional)"
  # Só arquivos de verdade: os atalhos (links) são de serviços que vieram com o sistema ou com pacotes.
  PROPRIOS=$(find /etc/systemd/system -maxdepth 1 -type f -name '*.service' 2>/dev/null | xargs -r -n1 basename | grep -vE '^(dbus-|snap|sshd|syslog|cloud-|getty|display-manager|network|systemd-)' || true)
  if [ -n "$PROPRIOS" ]; then
    for s in $PROPRIOS; do echo "  * $s: $(systemctl is-active "$s" 2>/dev/null || echo '?')"; INSTALACOES=$((INSTALACOES + 1)); done
  else
    echo "  Nenhum."
  fi
  # PM2 sem rodar o comando pm2 (ele iniciaria um processo novo): só olha os processos que já existem.
  PM2=$(ps -eo user=,args= 2>/dev/null | grep -E 'PM2 v|pm2 ' | grep -v grep | awk '{print $1}' | sort -u | tr '\n' ' ')
  [ -n "$PM2" ] && echo "  PM2 (Node.js) rodando para: $PM2"
  echo "  Servidores de banco/web instalados direto no sistema:"
  for s in nginx apache2 postgresql mysql mariadb mongod redis-server php8.3-fpm php8.2-fpm php8.1-fpm php7.4-fpm; do
    systemctl is-active --quiet "$s" 2>/dev/null && echo "    $s: ATIVO"
  done

  secao "Portas abertas para conexão"
  ss -tlnpH 2>/dev/null | awk '{split($6, p, "\""); printf "  %-28s %s\n", $4, p[2]}' | sort -u

  # ---------- Bancos de dados ----------
  secao "Bancos de dados"
  if docker_ok; then
    while IFS=$'\t' read -r nome imagem projeto; do
      [ -n "$nome" ] || continue
      t=$(tipo_banco "$imagem")
      [ -n "$t" ] || continue
      rot="container $nome (${projeto:-avulso}, $imagem)"
      case "$t" in
        postgres) echo "* PostgreSQL · $rot"; registrar_bancos "$rot" < <(bancos_postgres "$nome") ;;
        mysql) echo "* MySQL/MariaDB · $rot"; registrar_bancos "$rot" < <(bancos_mysql "$nome") ;;
        mongo) echo "* MongoDB · $rot"; registrar_bancos "$rot" < <(bancos_mongo "$nome") ;;
        redis) echo "* Redis (cache/fila) · $rot · $(info_redis "$nome")" ;;
      esac
    done < <(docker ps --format '{{.Names}}\t{{.Image}}\t{{.Label "com.docker.compose.project"}}')
  fi
  if systemctl is-active --quiet postgresql 2>/dev/null && tem runuser; then
    echo "* PostgreSQL instalado direto no sistema"
    registrar_bancos "PostgreSQL do sistema" < <(timeout 60 runuser -u postgres -- psql -AtF $'\t' -c "SELECT datname, pg_database_size(datname) FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 2 DESC" 2>/dev/null)
  fi
  if { systemctl is-active --quiet mysql 2>/dev/null || systemctl is-active --quiet mariadb 2>/dev/null; } && { tem mariadb || tem mysql; }; then
    echo "* MySQL/MariaDB instalado direto no sistema"
    B=$(command -v mariadb || command -v mysql)
    OPT=(); [ -r /etc/mysql/debian.cnf ] && OPT=(--defaults-file=/etc/mysql/debian.cnf)
    registrar_bancos "MySQL do sistema" < <(timeout 60 "$B" "${OPT[@]}" -N -B -e "SELECT s.schema_name, COALESCE(SUM(t.data_length + t.index_length), 0) FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name GROUP BY s.schema_name ORDER BY 2 DESC" 2>/dev/null \
      | grep -vE '^(information_schema|performance_schema|mysql|sys)	')
  fi
  echo
  echo "Total: $TOTAL_BANCOS banco(s) de dados em $TOTAL_SERVIDORES servidor(es) de banco (fora o Redis, que é cache)."

  # ---------- Disco ----------
  secao "O que ocupa o disco (pastas principais)"
  for d in /opt /var/www /srv /home /root /var/log /var/lib/docker; do
    [ -d "$d" ] && printf '  %-18s %s\n' "$d" "$(timeout 120 du -sh "$d" 2>/dev/null | cut -f1)"
  done
  echo "  -- dentro de /opt e /var/www:"
  for d in /opt/* /var/www/*; do [ -d "$d" ] && printf '    %-40s %s\n' "$d" "$(timeout 120 du -sh "$d" 2>/dev/null | cut -f1)"; done
  tem journalctl && echo "  Logs do sistema (journal): $(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[KMGT]?B?' | head -1)"

  secao "Backups"
  for d in /opt/usaparts-crm/backups /var/backups/servidor; do
    [ -d "$d" ] || continue
    ULT=$(ls -1t "$d" 2>/dev/null | head -1)
    echo "  $d: $(du -sh "$d" 2>/dev/null | cut -f1) · mais recente: ${ULT:-nenhum}${ULT:+ ($(date -r "$d/$ULT" '+%d/%m/%Y %H:%M' 2>/dev/null))}"
  done

  # ---------- Conclusão ----------
  secao "CONCLUSÃO"
  DISP_MB=$((MEM_D / 1024)); TOT_MB=$((MEM_T / 1024)); LIVRE_GB=$((D_L / 1073741824))
  echo "Instalações encontradas: $INSTALACOES (projetos/containers Docker e serviços próprios) · $SITES site(s) no Nginx"
  echo "Bancos de dados: $TOTAL_BANCOS em $TOTAL_SERVIDORES servidor(es) de banco"
  echo -n "Memória: "
  if [ "$DISP_MB" -ge 1024 ]; then echo "OK — ${DISP_MB} MB disponíveis de ${TOT_MB} MB. Cabe mais um sistema médio (até uns 700 MB)."
  elif [ "$DISP_MB" -ge 512 ]; then echo "APERTADA — ${DISP_MB} MB disponíveis de ${TOT_MB} MB. Só cabe um sistema leve (até uns 300 MB); nos picos pode faltar."
  else echo "NO LIMITE — ${DISP_MB} MB disponíveis de ${TOT_MB} MB. Não recomendo instalar outro sistema sem aumentar a memória da VPS."; fi
  if [ "${LIMITES:-0}" -gt $((MEM_T * 1024)) ] 2>/dev/null; then echo "  Atenção: a soma dos limites dos containers ($(tam "$LIMITES")) passa da memória total: se todos subirem juntos, falta memória."; fi
  if [ "$SW_T" -gt 0 ] && [ $((SW_T - SW_L)) -gt $((SW_T / 2)) ]; then echo "  Atenção: mais da metade da swap em uso — sinal de que a memória já está curta."; fi
  echo -n "Disco: "
  if [ "$LIVRE_GB" -ge 20 ]; then echo "OK — ${LIVRE_GB} GB livres."
  elif [ "$LIVRE_GB" -ge 5 ]; then echo "ATENÇÃO — ${LIVRE_GB} GB livres; dá para um sistema pequeno, mas vigie backups e logs."
  else echo "POUCO — ${LIVRE_GB} GB livres. Libere espaço antes de instalar qualquer coisa."; fi
  echo -n "CPU: "
  awk -v l="$L15" -v n="$NUCLEOS" 'BEGIN { r = l / n; if (r < 0.5) print "OK — carga baixa (" l " em " n " núcleo(s))."; else if (r < 0.8) print "MODERADA — " l " em " n " núcleo(s)."; else print "ALTA — " l " em " n " núcleo(s): o servidor já está ocupado." }'
  echo
  echo "Relatório gerado por deploy/raio-x.sh (somente leitura)."
} 2>&1 | tee "$SAIDA"

chmod 600 "$SAIDA" 2>/dev/null
[ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER" "$SAIDA" 2>/dev/null
echo
echo "Relatório salvo em $(realpath "$SAIDA" 2>/dev/null || echo "$SAIDA"). Mande o arquivo (ou cole o texto) para análise."
