#!/usr/bin/env bash
# Primeira instalação do CRM na VPS. Rode como root, dentro de /opt/usaparts-crm (clone do repositório):
#
#   sudo BACKUP_AGE_RECIPIENT="age1..." bash deploy/instalar.sh crm.usaparts.com.br admin@usaparts.com.br "Nome do Admin"
#
# O que ele faz (e só isso):
#  1. Confere pré-requisitos (Docker, Compose, Nginx, Certbot, porta livre, DNS).
#  2. Cria o .env com segredos aleatórios (se ainda não existir).
#  3. Sobe os containers do CRM (rede, banco e volumes próprios) e cria o primeiro administrador.
#  4. Adiciona UM vhost novo no Nginx para o domínio do CRM e emite o certificado HTTPS só para ele.
# Não altera outros sites, bancos, containers, portas nem regras de firewall existentes.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$RAIZ"
exigir_root

DOMINIO="${1:?Informe o domínio. Ex.: crm.usaparts.com.br}"
ADMIN_EMAIL="${2:?Informe o e-mail do primeiro administrador}"
ADMIN_NOME="${3:-Administrador}"
VHOST="/etc/nginx/sites-available/usaparts-crm"

info "1/6 Conferindo pré-requisitos"
command -v docker >/dev/null || fatal "Docker não instalado. Veja docs/DEPLOY.md (seção Docker) e rode de novo."
docker compose version >/dev/null 2>&1 || fatal "Docker Compose v2 não encontrado (pacote docker-compose-plugin)."
command -v nginx >/dev/null || fatal "Nginx não encontrado. Este script adiciona um vhost ao Nginx existente."
command -v certbot >/dev/null || fatal "Certbot não encontrado (apt install certbot python3-certbot-nginx)."
command -v git >/dev/null || fatal "Git não encontrado."
ok "Docker, Compose, Nginx, Certbot e Git presentes"

PORTA="$(porta_http)"
if ss -tln | awk '{print $4}' | grep -qE "[:.]$PORTA$" && ! dc ps -q web 2>/dev/null | grep -q .; then
  fatal "A porta $PORTA já está em uso por outro serviço. Defina CRM_HTTP_PORT no .env com uma porta livre."
fi
ok "Porta interna $PORTA livre"

if [ -f "$VHOST" ] || [ -L /etc/nginx/sites-enabled/usaparts-crm ]; then
  aviso "Vhost do CRM já existe ($VHOST). Será mantido."
fi
if nginx -T 2>/dev/null | grep -E '^\s*server_name' | grep -qw "$DOMINIO" && [ ! -f "$VHOST" ]; then
  fatal "Já existe outro site no Nginx usando $DOMINIO. Nada foi alterado."
fi

IP_DNS="$(getent ahostsv4 "$DOMINIO" | awk 'NR==1{print $1}')"
IP_VPS="$(curl -4 -fsS --max-time 5 https://api.ipify.org || true)"
if [ -z "$IP_DNS" ]; then
  fatal "$DOMINIO não resolve no DNS. Crie o registro A apontando para $IP_VPS."
elif [ -n "$IP_VPS" ] && [ "$IP_DNS" != "$IP_VPS" ]; then
  aviso "$DOMINIO aponta para $IP_DNS, mas o IP desta VPS parece ser $IP_VPS. O certificado pode falhar."
else
  ok "DNS de $DOMINIO aponta para esta VPS ($IP_DNS)"
fi

info "2/6 Configuração (.env)"
if [ ! -f .env ]; then
  : "${BACKUP_AGE_RECIPIENT:?Informe BACKUP_AGE_RECIPIENT (chave pública age). Veja docs/DEPLOY.md, seção Backup.}"
  umask 077
  cat > .env <<EOF
# Gerado por deploy/instalar.sh em $(date -Iseconds). NUNCA versionar este arquivo.
CRM_DOMAIN=$DOMINIO
CRM_HTTP_PORT=$PORTA
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')
APP_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
BACKUP_AGE_RECIPIENT=$BACKUP_AGE_RECIPIENT
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=30
BACKUP_HOUR=3
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_NAME=$ADMIN_NOME
GITHUB_REPO=
GITHUB_TOKEN=
EOF
  chmod 600 .env
  ok ".env criado com segredos aleatórios (permissão 600)"
  aviso "Guarde uma cópia do APP_ENCRYPTION_KEY em local seguro: sem ele, o 2FA e a senha do SMTP não podem ser lidos após uma restauração."
else
  ok ".env existente mantido"
fi

mkdir -p backups && chown 70:70 backups && chmod 700 backups

info "3/6 Subindo os containers"
bash deploy/deploy.sh

info "4/6 Criando perfis padrão e o primeiro administrador"
dc run --rm --no-deps api prisma db seed

info "5/6 Vhost do Nginx para $DOMINIO"
if [ ! -f "$VHOST" ]; then
  sed -e "s/__DOMINIO__/$DOMINIO/g" -e "s/__PORTA__/$PORTA/g" deploy/nginx-crm.conf.template > "$VHOST"
  ln -sf "$VHOST" /etc/nginx/sites-enabled/usaparts-crm
  if ! nginx -t; then
    rm -f /etc/nginx/sites-enabled/usaparts-crm "$VHOST"
    fatal "Configuração do Nginx inválida. O vhost foi removido e nada mais foi alterado."
  fi
  systemctl reload nginx
  ok "Vhost criado e Nginx recarregado (demais sites intactos)"
fi

info "6/6 Certificado HTTPS (Let's Encrypt) só para $DOMINIO"
certbot --nginx -d "$DOMINIO" -m "$ADMIN_EMAIL" --agree-tos --non-interactive --redirect --hsts --keep-until-expiring
ok "Certificado emitido; a renovação automática do certbot já cobre este domínio"

if curl -fsS --max-time 10 "https://$DOMINIO/api/health" >/dev/null; then
  ok "https://$DOMINIO respondendo"
else
  aviso "Não foi possível acessar https://$DOMINIO daqui. Teste pelo navegador."
fi

echo
ok "Instalação concluída. Acesse https://$DOMINIO com o e-mail $ADMIN_EMAIL e a senha provisória exibida acima."
echo "   No primeiro acesso o sistema pede a troca da senha e a configuração do 2FA."
