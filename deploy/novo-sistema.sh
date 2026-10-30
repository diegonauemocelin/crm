#!/usr/bin/env bash
# Prepara nesta VPS o espaço de OUTRO sistema, separado do CRM (outro repositório, outro subdomínio). Rode como root:
#
#   sudo bash deploy/novo-sistema.sh importacao importacao.usaparts.com.br ti@usaparts.com.br
#   sudo bash deploy/novo-sistema.sh importacao importacao.usaparts.com.br ti@usaparts.com.br 8280   (porta escolhida)
#
# Antes: o DNS do subdomínio (registro A) precisa apontar para esta VPS.
# O que ele faz (e só isso):
#   1. pasta própria /opt/<nome> (o código do outro sistema vem do GitHub dele, clonado ali);
#   2. reserva uma porta local livre (só 127.0.0.1; padrão a partir de 8280) para o sistema publicar;
#   3. UM vhost no Nginx para o subdomínio, com logs próprios, e o certificado HTTPS só para ele;
#   4. deixa em /opt/<nome> as regras de separação e um docker-compose de exemplo (projeto, rede e volumes próprios).
# Não altera o CRM (pasta, .env, containers, banco, vhost), outros sites, firewall nem Docker.
# É autossuficiente: dá para rodar direto do GitHub sem atualizar o CRM (veja docs/DEPLOY.md, "Outro sistema na VPS").

set -euo pipefail

cor() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { cor "1;34" "==> $*"; }
ok() { cor "1;32" "  ✔ $*"; }
aviso() { cor "1;33" "  ! $*"; }
fatal() { cor "1;31" "  ✖ $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fatal "Rode como root (sudo)."

NOME="${1:?Informe o nome do sistema. Ex.: importacao}"
DOMINIO="${2:?Informe o subdomínio. Ex.: importacao.usaparts.com.br}"
EMAIL="${3:?Informe o e-mail para o aviso do certificado (Let's Encrypt)}"
PORTA="${4:-}"
PASTA="/opt/$NOME"
VHOST="/etc/nginx/sites-available/$NOME"

[[ "$NOME" =~ ^[a-z][a-z0-9-]{2,30}$ ]] || fatal "Nome inválido: $NOME (letras minúsculas, números e hífen)."
case "$NOME" in usaparts-crm | crm | usaparts-bi | usaparts-assistente | evolution) fatal "O nome $NOME já é de um sistema desta VPS." ;; esac
[[ "$DOMINIO" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || fatal "Subdomínio inválido: $DOMINIO"
command -v nginx >/dev/null || fatal "Nginx não encontrado."
command -v certbot >/dev/null || fatal "Certbot não encontrado (apt install certbot python3-certbot-nginx)."
command -v docker >/dev/null || aviso "Docker não encontrado: o exemplo de docker-compose precisa dele."

porta_ocupada() {
  ss -Hltn "( sport = :$1 )" 2>/dev/null | grep -q . && return 0
  grep -rqsE "proxy_pass\s+https?://(127\.0\.0\.1|localhost):$1\b" /etc/nginx/sites-enabled /etc/nginx/conf.d && return 0
  grep -qsE "^[A-Z_]*PORT=$1$" /opt/*/.env 2>/dev/null && return 0
  grep -qsxF "$1" /opt/*/.porta 2>/dev/null && return 0
  return 1
}

info "1/5 Conferindo o DNS de $DOMINIO"
IP_DNS="$(getent ahostsv4 "$DOMINIO" | awk 'NR==1{print $1}')"
IP_VPS="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
[ -n "$IP_DNS" ] || fatal "$DOMINIO ainda não resolve. Crie o registro A apontando para esta VPS e espere propagar."
if [ -n "$IP_VPS" ] && [ "$IP_DNS" != "$IP_VPS" ]; then
  aviso "$DOMINIO aponta para $IP_DNS, mas esta VPS é $IP_VPS (normal se houver proxy/CDN na frente)."
fi
ok "DNS: $DOMINIO -> $IP_DNS"
if [ ! -f "$VHOST" ] && nginx -T 2>/dev/null | grep -E '^\s*server_name' | grep -qw "$DOMINIO"; then
  fatal "$DOMINIO já está em outro site do Nginx. Nada foi alterado."
fi

info "2/5 Pasta própria $PASTA"
if [ -d "$PASTA" ]; then
  ok "Já existe: mantida (nada dentro foi alterado)"
else
  mkdir -p "$PASTA"
  chmod 750 "$PASTA"
  ok "Criada (só root acessa)"
fi

info "3/5 Porta local do sistema"
if [ -f "$PASTA/.porta" ]; then
  PORTA="$(cat "$PASTA/.porta")"
  ok "Já reservada: 127.0.0.1:$PORTA"
else
  if [ -n "$PORTA" ]; then
    [[ "$PORTA" =~ ^[0-9]{4,5}$ ]] || fatal "Porta inválida: $PORTA"
    porta_ocupada "$PORTA" && fatal "A porta $PORTA já está em uso nesta VPS. Escolha outra ou deixe em branco."
  else
    PORTA=8280
    while porta_ocupada "$PORTA"; do PORTA=$((PORTA + 10)); done
  fi
  echo "$PORTA" > "$PASTA/.porta"
  ok "Reservada: 127.0.0.1:$PORTA (o sistema publica só nela; o Nginx faz o HTTPS)"
fi

info "4/5 Regras de separação e docker-compose de exemplo em $PASTA"
cat > "$PASTA/SEPARACAO.md" <<EOF
# $NOME ($DOMINIO)

Sistema separado do CRM nesta VPS. Preparado por deploy/novo-sistema.sh em $(date '+%d/%m/%Y %H:%M').

- Código: clone o repositório DESTE sistema aqui ($PASTA). Nunca dentro de /opt/usaparts-crm.
- Docker compose com \`name: $NOME\`: containers, rede e volumes ficam com o prefixo $NOME e não se misturam aos do CRM.
- Banco de dados próprio, num container deste projeto. Não use o banco do CRM (container usaparts-crm-db).
- Publique só 127.0.0.1:$PORTA (nunca 0.0.0.0 nem as portas 80/443): o Nginx da VPS faz o HTTPS e repassa.
- Limite de memória em cada container (deploy.resources.limits.memory), para não derrubar o CRM se a memória acabar.
- Segredos num .env só deste sistema ($PASTA/.env, permissão 600), fora do Git.
- Site do Nginx: $VHOST (logs em /var/log/nginx/$NOME.*.log). O certificado renova sozinho (certbot).
- O backup completo do servidor (deploy/backup-servidor.sh do CRM) já inclui /opt e os volumes do Docker.
- Os scripts do CRM (deploy, limpar-imagens, enxugar-servidor) não mexem neste sistema.

Para remover tudo um dia:
  docker compose -f $PASTA/docker-compose.yml down -v
  rm -f /etc/nginx/sites-enabled/$NOME $VHOST && systemctl reload nginx
  certbot delete --cert-name $DOMINIO
  rm -rf $PASTA
EOF
if [ ! -f "$PASTA/docker-compose.exemplo.yml" ]; then
  cat > "$PASTA/docker-compose.exemplo.yml" <<EOF
# Exemplo para o $NOME: ajuste imagens e variáveis ao sistema e salve como docker-compose.yml.
name: $NOME

services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:$PORTA:8080"   # a porta interna (8080) é a que o sistema escuta dentro do container
    depends_on: [db]
    networks: [$NOME]
    deploy:
      resources:
        limits: { memory: 512m }

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: $NOME
      POSTGRES_USER: $NOME
      POSTGRES_PASSWORD: \${DB_PASSWORD:?defina DB_PASSWORD no .env}
    volumes:
      - dados:/var/lib/postgresql/data
    networks: [$NOME]
    deploy:
      resources:
        limits: { memory: 384m }

networks:
  $NOME: {}

volumes:
  dados: {}
EOF
fi
ok "SEPARACAO.md e docker-compose.exemplo.yml"

info "5/5 Site no Nginx e certificado HTTPS só para $DOMINIO"
if [ -f "$VHOST" ]; then
  ok "Vhost já existe ($VHOST): mantido"
else
  cat > "$VHOST" <<EOF
# Vhost EXCLUSIVO do sistema $NOME (criado por deploy/novo-sistema.sh do CRM). Não altera nenhum outro site.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;

    server_tokens off;
    client_max_body_size 70m;

    access_log /var/log/nginx/$NOME.access.log;
    error_log  /var/log/nginx/$NOME.error.log;

    location / {
        proxy_pass http://127.0.0.1:$PORTA;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF
  ln -sf "$VHOST" "/etc/nginx/sites-enabled/$NOME"
  if ! nginx -t; then
    rm -f "/etc/nginx/sites-enabled/$NOME" "$VHOST"
    fatal "Configuração do Nginx inválida. O vhost foi removido e nada mais foi alterado."
  fi
  systemctl reload nginx
  ok "Vhost criado e Nginx recarregado (demais sites intactos)"
fi
certbot --nginx -d "$DOMINIO" -m "$EMAIL" --agree-tos --non-interactive --redirect --hsts --keep-until-expiring
ok "Certificado emitido; a renovação automática do certbot já cobre este subdomínio"

echo
TOTAL_MB="$(free -m | awk '/^Mem:/ {print $2}')"
LIVRE_MB="$(free -m | awk '/^Mem:/ {print $7}')"
if [ "${TOTAL_MB:-0}" -lt 3500 ]; then
  aviso "Memória da VPS: ${TOTAL_MB} MB no total, ${LIVRE_MB} MB disponíveis. Com o CRM e mais um sistema, o ideal é 4 GB ou mais."
else
  ok "Memória da VPS: ${TOTAL_MB} MB no total, ${LIVRE_MB} MB disponíveis."
fi
ok "Pronto. Próximo passo: clone o repositório do $NOME em $PASTA e suba o sistema em 127.0.0.1:$PORTA."
echo "    Enquanto nada responder nessa porta, https://$DOMINIO mostra \"502 Bad Gateway\" (normal)."
echo "    Regras: $PASTA/SEPARACAO.md"
