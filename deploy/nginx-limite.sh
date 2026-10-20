#!/usr/bin/env bash
# Ajusta o vhost do CRM no Nginx da VPS para os arquivos do chat (até 64 MB) e envios demorados.
# Mexe só no arquivo do CRM (/etc/nginx/sites-available/usaparts-crm): confere com "nginx -t" e, se der erro,
# volta o arquivo como estava. Pode rodar mais de uma vez.
#   sudo bash deploy/nginx-limite.sh

set -euo pipefail
source "$(dirname "$0")/lib.sh"
exigir_root

VHOST=/etc/nginx/sites-available/usaparts-crm
[ -f "$VHOST" ] || { aviso "Vhost $VHOST não encontrado (Nginx do CRM não instalado por aqui). Nada a fazer."; exit 0; }

if grep -q 'client_max_body_size 70m;' "$VHOST" && grep -q 'proxy_read_timeout 300s;' "$VHOST"; then
  ok "Nginx do CRM já aceita arquivos de até 64 MB."
  exit 0
fi

COPIA="$(mktemp)"
cp -p "$VHOST" "$COPIA"
sed -i -E 's/client_max_body_size[[:space:]]+[0-9]+[kKmM]?;/client_max_body_size 70m;/g; s/proxy_read_timeout[[:space:]]+[0-9]+s;/proxy_read_timeout 300s;/g' "$VHOST"
grep -q 'client_max_body_size' "$VHOST" || sed -i -E '0,/server_name[^;]*;/s//&\n    client_max_body_size 70m;/' "$VHOST"

if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx
  rm -f "$COPIA"
  ok "Nginx do CRM ajustado: arquivos de até 64 MB no chat (demais sites intactos)."
else
  cp -p "$COPIA" "$VHOST"
  rm -f "$COPIA"
  fatal "O Nginx recusou o ajuste; o arquivo voltou como estava. Nada mudou."
fi
