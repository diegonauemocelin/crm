#!/usr/bin/env bash
# Inventário SOMENTE LEITURA da VPS. Não instala, não altera e não reinicia nada.
# Uso: sudo bash deploy/inventario.sh [crm.usaparts.com.br]
# Gera um relatório em ./inventario-AAAAMMDD-HHMM.txt para conferência antes da instalação.

set -uo pipefail
DOMINIO="${1:-crm.usaparts.com.br}"
PORTA="${CRM_HTTP_PORT:-8180}"
SAIDA="inventario-$(date +%Y%m%d-%H%M).txt"

secao() { printf '\n===== %s =====\n' "$1"; }
tem() { command -v "$1" >/dev/null 2>&1; }

{
  echo "Inventário da VPS - $(date -Iseconds) - host $(hostname)"

  secao "Sistema operacional"
  cat /etc/os-release 2>/dev/null | grep -E '^(PRETTY_NAME|VERSION_ID)='
  uname -r

  secao "Recursos (CPU / memória / disco)"
  nproc
  free -h
  df -h -x tmpfs -x devtmpfs

  secao "Portas em escuta"
  ss -tulpn 2>/dev/null | sort -k5

  secao "Porta reservada para o CRM ($PORTA em 127.0.0.1)"
  if ss -tln | awk '{print $4}' | grep -qE "[:.]$PORTA$"; then echo "OCUPADA - escolha outra em CRM_HTTP_PORT"; else echo "livre"; fi

  secao "Serviços em execução"
  systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '{print $1}'

  secao "Servidor web"
  for s in nginx apache2 httpd caddy traefik; do
    systemctl is-active --quiet "$s" 2>/dev/null && echo "$s: ATIVO"
  done
  if tem nginx; then
    nginx -v 2>&1
    echo "-- sites habilitados:"
    ls -l /etc/nginx/sites-enabled/ 2>/dev/null
    echo "-- server_name configurados:"
    nginx -T 2>/dev/null | grep -E '^\s*server_name' | sort -u
  fi
  tem apache2ctl && apache2ctl -S 2>/dev/null

  secao "Certificados Let's Encrypt"
  if tem certbot; then certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry'; else echo "certbot não instalado"; fi
  systemctl list-timers --no-pager 2>/dev/null | grep -i certbot || true

  secao "Docker"
  if tem docker; then
    docker --version
    docker compose version 2>/dev/null || echo "docker compose (v2) NÃO encontrado"
    echo "-- containers:"
    docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
    echo "-- redes:"
    docker network ls
    echo "-- volumes:"
    docker volume ls
  else
    echo "Docker NÃO instalado"
  fi

  secao "Firewall"
  tem ufw && ufw status verbose
  tem fail2ban-client && fail2ban-client status 2>/dev/null

  secao "Bancos de dados no host"
  for s in postgresql mysql mariadb redis-server redis mongod; do
    systemctl is-active --quiet "$s" 2>/dev/null && echo "$s: ATIVO"
  done

  secao "DNS de $DOMINIO"
  getent ahostsv4 "$DOMINIO" | awk '{print $1}' | sort -u | sed 's/^/aponta para: /'
  echo "IP público desta VPS: $(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo 'não foi possível consultar')"

  secao "Diretório de instalação"
  ls -ld /opt/usaparts-crm 2>/dev/null || echo "/opt/usaparts-crm ainda não existe"
} 2>&1 | tee "$SAIDA"

echo
echo "Relatório salvo em $SAIDA. Envie o conteúdo para conferência antes de instalar."
