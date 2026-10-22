#!/usr/bin/env bash
# Subdomínio das landing pages (ex.: lp.usaparts.com.br). Rode como root, dentro de /opt/usaparts-crm:
#
#   sudo bash deploy/landing-pages.sh lp.usaparts.com.br ti@usaparts.com.br
#
# Antes: o DNS do subdomínio (registro A, ou CNAME para o domínio do CRM) precisa apontar para esta VPS.
# O que ele faz (e só isso): adiciona UM vhost no Nginx para o subdomínio e emite o certificado HTTPS só para ele.
# Não altera outros sites, o vhost do CRM, containers nem firewall. Depois, informe o subdomínio no CRM
# (E-mail marketing › Landing pages › Subdomínio e medição).

set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$RAIZ"
exigir_root

DOMINIO="${1:?Informe o subdomínio. Ex.: lp.usaparts.com.br}"
EMAIL="${2:?Informe o e-mail para o aviso do certificado (Let's Encrypt)}"
VHOST="/etc/nginx/sites-available/usaparts-crm-lp"
PORTA="$(porta_http)"

[[ "$DOMINIO" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || fatal "Subdomínio inválido: $DOMINIO"
command -v nginx >/dev/null || fatal "Nginx não encontrado."
command -v certbot >/dev/null || fatal "Certbot não encontrado (apt install certbot python3-certbot-nginx)."

info "1/3 Conferindo o DNS de $DOMINIO"
IP_DNS="$(getent ahostsv4 "$DOMINIO" | awk 'NR==1{print $1}')"
IP_VPS="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
[ -n "$IP_DNS" ] || fatal "$DOMINIO ainda não resolve. Crie o registro DNS e espere propagar."
if [ -n "$IP_VPS" ] && [ "$IP_DNS" != "$IP_VPS" ]; then
  aviso "$DOMINIO aponta para $IP_DNS, mas esta VPS é $IP_VPS (normal se houver proxy/CDN na frente)."
fi
ok "DNS: $DOMINIO -> $IP_DNS"

info "2/3 Vhost do Nginx para $DOMINIO"
if [ -f "$VHOST" ]; then
  ok "Vhost já existe ($VHOST): mantido"
else
  sed -e "s/__DOMINIO__/$DOMINIO/g" -e "s/__PORTA__/$PORTA/g" deploy/nginx-lp.conf.template > "$VHOST"
  ln -sf "$VHOST" /etc/nginx/sites-enabled/usaparts-crm-lp
  if ! nginx -t; then
    rm -f /etc/nginx/sites-enabled/usaparts-crm-lp "$VHOST"
    fatal "Configuração do Nginx inválida. O vhost foi removido e nada mais foi alterado."
  fi
  systemctl reload nginx
  ok "Vhost criado e Nginx recarregado (demais sites intactos)"
fi

info "3/3 Certificado HTTPS (Let's Encrypt) só para $DOMINIO"
certbot --nginx -d "$DOMINIO" -m "$EMAIL" --agree-tos --non-interactive --redirect --hsts --keep-until-expiring
ok "Certificado emitido; a renovação automática do certbot já cobre este subdomínio"
registrar "landing-pages" "vhost e certificado para $DOMINIO"

echo
ok "Pronto. Agora informe $DOMINIO no CRM: E-mail marketing › Landing pages › Subdomínio e medição."
