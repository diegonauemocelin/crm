#!/usr/bin/env bash
# Leva o CRM inteiro para outra VPS: código, .env (segredos), banco, arquivos enviados, sessões do WhatsApp (sem ler
# QR Code de novo), site do Nginx, certificado HTTPS e agendamentos. Rode na VPS ATUAL, como root:
#
#   sudo bash deploy/migrar.sh root@IP-DA-VPS-NOVA              -> só confere as duas VPS e mostra o plano (não para nada)
#   sudo bash deploy/migrar.sh root@IP-DA-VPS-NOVA --executar   -> migra (o CRM fica fora do ar enquanto copia)
#
# Antes: acesso SSH da VPS atual para a nova (senha ou chave; a senha é pedida uma vez só).
# Depois: aponte o DNS do CRM (e das landing pages) para o IP novo. A VPS atual fica com o CRM PARADO e sem .env
# (renomeado para .env.migrado), para nunca subir em dois lugares ao mesmo tempo (o WhatsApp derrubaria as sessões).
# Para desistir e voltar para a atual: sudo bash deploy/migrar.sh --voltar
#
# Autossuficiente (não depende de lib.sh): dá para rodar direto do GitHub sem atualizar o CRM:
#   cd /opt/usaparts-crm && sudo git fetch origin main && sudo git show origin/main:deploy/migrar.sh > /root/migrar.sh
#   sudo bash /root/migrar.sh root@IP-DA-VPS-NOVA

set -euo pipefail

cor() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { cor "1;34" "==> $*"; }
ok() { cor "1;32" "  ✔ $*"; }
aviso() { cor "1;33" "  ! $*"; }
fatal() { cor "1;31" "  ✖ $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fatal "Rode como root (sudo)."
RAIZ=/opt/usaparts-crm
PROJETO=usaparts-crm
VOLUMES=(pgdata uploads evolution)
cd "$RAIZ"
dc() { docker compose --project-directory "$RAIZ" -f "$RAIZ/docker-compose.yml" "$@"; }

# ---------- Voltar para a VPS atual ----------
if [ "${1:-}" = "--voltar" ]; then
  [ -f .env.migrado ] || fatal "Nada para voltar: não há $RAIZ/.env.migrado."
  mv .env.migrado .env
  for f in /root/migracao-cron/*; do [ -f "$f" ] && mv "$f" /etc/cron.d/; done
  dc up -d --remove-orphans
  ok "CRM ligado de novo nesta VPS. Aponte o DNS de volta para o IP desta VPS e PARE o CRM na nova:"
  echo "    (na nova) cd $RAIZ && docker compose down"
  exit 0
fi

DESTINO="${1:?Informe a VPS nova. Ex.: root@203.0.113.10}"
EXECUTAR=0
[ "${2:-}" = "--executar" ] && EXECUTAR=1
[[ "$DESTINO" == *@* ]] || DESTINO="root@$DESTINO"
[ -f .env ] || fatal "Sem $RAIZ/.env: o CRM não está instalado aqui (ou já foi migrado)."

mkdir -p /root/.ssh && chmod 700 /root/.ssh
CM="/root/.ssh/migrar-%r@%h"
SSH=(ssh -o ControlMaster=auto -o ControlPath="$CM" -o ControlPersist=30m -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
remoto() { "${SSH[@]}" "$DESTINO" "$@"; }

command -v rsync >/dev/null || { apt-get install -y -qq rsync >/dev/null || fatal "Instale o rsync nesta VPS: apt install rsync"; }

info "1/8 Conferindo a VPS nova ($DESTINO)"
remoto true || fatal "Não conectou por SSH em $DESTINO."
ok "SSH funcionando"
OS_NOVO="$(remoto '. /etc/os-release && echo "$PRETTY_NAME"')"
MEM_NOVO="$(remoto "awk '/MemTotal/ {printf \"%d\", \$2/1024}' /proc/meminfo")"
DISCO_NOVO="$(remoto "df -Pm / | awk 'NR==2 {print \$4}'")"
ok "Sistema: $OS_NOVO · memória: ${MEM_NOVO} MB · disco livre: ${DISCO_NOVO} MB"
remoto "test ! -e $RAIZ/.env" || fatal "A VPS nova já tem um CRM em $RAIZ (.env existe). Nada foi alterado."
for v in "${VOLUMES[@]}"; do
  remoto "command -v docker >/dev/null && docker volume inspect ${PROJETO}_$v >/dev/null 2>&1" && fatal "A VPS nova já tem o volume ${PROJETO}_$v. Nada foi alterado."
done

info "2/8 O que vai ser copiado"
TOTAL_MB=0
for v in "${VOLUMES[@]}"; do
  docker volume inspect "${PROJETO}_$v" >/dev/null 2>&1 || { aviso "Volume ${PROJETO}_$v não existe aqui (ignorado)"; continue; }
  mb="$(docker run --rm -v "${PROJETO}_$v":/v:ro alpine:3 du -sm /v | cut -f1)"
  TOTAL_MB=$((TOTAL_MB + mb))
  ok "Volume $v: ${mb} MB"
done
CODIGO_MB="$(du -sm --exclude=backups --exclude=node_modules "$RAIZ" | cut -f1)"
TOTAL_MB=$((TOTAL_MB + CODIGO_MB))
ok "Pasta $RAIZ (sem os backups): ${CODIGO_MB} MB"
[ "$DISCO_NOVO" -gt $((TOTAL_MB * 2 + 4000)) ] || fatal "Pouco disco na VPS nova: ${DISCO_NOVO} MB livres para ${TOTAL_MB} MB de dados (mais as imagens)."
VHOSTS=()
for f in /etc/nginx/sites-available/usaparts-crm /etc/nginx/sites-available/usaparts-crm-lp; do [ -f "$f" ] && VHOSTS+=("$f"); done
[ ${#VHOSTS[@]} -gt 0 ] || fatal "Site do CRM no Nginx não encontrado (/etc/nginx/sites-available/usaparts-crm)."
DOMINIOS="$(grep -hE '^\s*server_name' "${VHOSTS[@]}" | sed -E 's/^\s*server_name\s+//; s/;//' | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')"
CERTS="$(grep -hoE '/etc/letsencrypt/live/[^/]+' "${VHOSTS[@]}" | sed 's#.*/##' | sort -u | tr '\n' ' ')"
ok "Sites: $DOMINIOS"
ok "Certificados: ${CERTS:-nenhum}"
CRONS="$(ls /etc/cron.d/usaparts-crm* 2>/dev/null | tr '\n' ' ' || true)"
ok "Agendamentos: ${CRONS:-nenhum}"
[ "$MEM_NOVO" -ge 3500 ] || aviso "A VPS nova tem ${MEM_NOVO} MB de memória (o ideal é 4 GB ou mais)."

if [ "$EXECUTAR" -eq 0 ]; then
  echo
  ok "Tudo conferido. Nada foi parado nem copiado."
  echo "    Para migrar (o CRM fica fora do ar enquanto copia, uns minutos por GB):"
  echo "    sudo bash $0 $DESTINO --executar"
  exit 0
fi

info "3/8 Programas na VPS nova (Docker, Nginx, Certbot)"
remoto 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq ca-certificates curl nginx certbot python3-certbot-nginx rsync git >/dev/null'
remoto 'command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null'
remoto 'docker compose version >/dev/null' || fatal "Docker Compose não ficou disponível na VPS nova."
ok "Instalados"

info "4/8 Backup de segurança e parada do CRM nesta VPS"
dc run --rm --no-deps backup /usr/local/bin/backup.sh || fatal "O backup falhou. Nada foi parado."
dc down
ok "CRM parado aqui (volumes e dados mantidos)"

# A partir daqui, qualquer falha deixa a atual pronta para religar.
falhou() { cor "1;31" "  ✖ A migração parou no meio. Para religar o CRM nesta VPS: sudo bash $0 --voltar" >&2; }
trap falhou ERR

info "5/8 Copiando a pasta do CRM (código e .env)"
remoto "mkdir -p $RAIZ && chmod 750 $RAIZ"
rsync -aHAX --numeric-ids -e "${SSH[*]}" --exclude 'backups/' --exclude 'node_modules/' "$RAIZ/" "$DESTINO:$RAIZ/"
# Os backups antigos ficam nesta VPS; na nova, a pasta vazia com o dono do container de backup (usuário postgres, 70).
remoto "mkdir -p $RAIZ/backups && chown 70:70 $RAIZ/backups && chmod 700 $RAIZ/backups"
[ -f /root/.docker/config.json ] && { remoto 'mkdir -p /root/.docker && chmod 700 /root/.docker'; rsync -a -e "${SSH[*]}" /root/.docker/config.json "$DESTINO:/root/.docker/config.json"; }
ok "Copiada"

info "6/8 Copiando banco, arquivos e sessões do WhatsApp"
for v in "${VOLUMES[@]}"; do
  V="${PROJETO}_$v"
  docker volume inspect "$V" >/dev/null 2>&1 || continue
  remoto "docker volume create --label com.docker.compose.project=$PROJETO --label com.docker.compose.volume=$v $V >/dev/null"
  docker run --rm -v "$V":/v:ro alpine:3 tar -C /v -cf - . | remoto "docker run --rm -i -v $V:/v alpine:3 tar -C /v -xpf -"
  ok "$v"
done

info "7/8 Site no Nginx, certificado e agendamentos"
LISTA=()
for f in "${VHOSTS[@]}"; do LISTA+=("${f#/}"); done
for c in $CERTS; do LISTA+=("etc/letsencrypt/live/$c" "etc/letsencrypt/archive/$c" "etc/letsencrypt/renewal/$c.conf"); done
for f in etc/letsencrypt/options-ssl-nginx.conf etc/letsencrypt/ssl-dhparams.pem etc/letsencrypt/accounts; do [ -e "/$f" ] && LISTA+=("$f"); done
for f in $CRONS; do LISTA+=("${f#/}"); done
tar -C / -czf - "${LISTA[@]}" | remoto 'tar -C / -xzpf -'
for f in "${VHOSTS[@]}"; do remoto "ln -sf $f /etc/nginx/sites-enabled/$(basename "$f")"; done
remoto 'nginx -t && systemctl reload nginx'
ok "Nginx com o site e o certificado do CRM"

info "8/8 Subindo o CRM na VPS nova"
remoto "cd $RAIZ && { docker compose pull --quiet --ignore-pull-failures || true; } && docker compose up -d --remove-orphans --wait"
PORTA="$(grep -E '^CRM_HTTP_PORT=' .env | cut -d= -f2)"
PORTA="${PORTA:-8180}"
for _ in $(seq 1 60); do remoto "curl -fsS --max-time 3 http://127.0.0.1:$PORTA/api/health" >/dev/null 2>&1 && break; sleep 2; done
SAUDE="$(remoto "curl -fsS --max-time 3 http://127.0.0.1:$PORTA/api/health" || true)"
[ -n "$SAUDE" ] || fatal "O CRM não respondeu na VPS nova. Veja: (na nova) cd $RAIZ && docker compose logs --tail 80 api. Para religar aqui: sudo bash $0 --voltar"
ok "CRM no ar na VPS nova: $SAUDE"
trap - ERR

# A atual nunca mais sobe sozinha: sem .env o deploy e o WhatsApp não rodam; os agendamentos saem do cron.
mv .env .env.migrado
mkdir -p /root/migracao-cron
for f in $CRONS; do mv "$f" /root/migracao-cron/; done
echo "Migrado para $DESTINO em $(date '+%d/%m/%Y %H:%M')" > "$RAIZ/MIGRADO.txt"

IP_NOVO="${DESTINO#*@}"
echo
ok "Migração concluída."
echo "  1. Aponte no DNS para $IP_NOVO: $DOMINIOS"
echo "  2. Na VPS nova, depois que o DNS apontar: certbot renew --dry-run"
echo "  3. Na VPS nova: cd $RAIZ && sudo bash deploy/seguranca-vps.sh   (firewall e proteções)"
echo "  4. Confira no CRM: login, Chat e Configurações › Números de WhatsApp (as sessões voltam sozinhas)."
echo "  Nesta VPS o CRM ficou parado, com os dados e os backups (para voltar: sudo bash $0 --voltar)."
