#!/usr/bin/env bash
# Segurança da VPS (Fase 8). Dois modos:
#
#   sudo bash deploy/seguranca-vps.sh              -> DIAGNÓSTICO, somente leitura: não instala nem altera nada.
#   sudo bash deploy/seguranca-vps.sh --fail2ban [--meu-ip 200.1.2.3]   -> instala/ativa o fail2ban com DUAS regras:
#        1) SSH: bane por 1 hora o IP que errar a senha 5 vezes em 10 minutos;
#        2) CRM: bane por 1 hora o IP que errar o login do CRM 15 vezes em 10 minutos (lê só o log do CRM).
#      O IP de onde você está conectado agora (SSH) entra na lista de exceções, para você não se bloquear.
#
# Firewall (ufw) e configuração do SSH NÃO são alterados por este script: a VPS tem outros sistemas,
# então o diagnóstico só mostra o que está aberto e a recomendação, para decidirmos juntos.

set -uo pipefail
source "$(dirname "$0")/lib.sh"

LOG_CRM=/var/log/nginx/usaparts-crm.access.log
tem() { command -v "$1" >/dev/null 2>&1; }
secao() { printf '\n\033[1m===== %s =====\033[0m\n' "$1"; }

porta_ssh() {
  local p
  p="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
  echo "${p:-22}"
}

# IP de quem está rodando o script por SSH. O sudo não repassa SSH_CLIENT, então também procura a sessão
# SSH dona deste terminal. Pode ser informado à mão: --fail2ban --meu-ip 200.1.2.3
ip_atual() {
  local ip="${MEU_IP:-}"
  [ -n "$ip" ] || ip="${SSH_CLIENT:-}"; ip="${ip%% *}"
  [ -n "$ip" ] || { ip="${SSH_CONNECTION:-}"; ip="${ip%% *}"; }
  [ -n "$ip" ] || ip="$(who -m 2>/dev/null | sed -nE 's/.*\(([0-9a-fA-F:.]+)\).*/\1/p')"
  if [ -z "$ip" ]; then
    local tty
    tty="$(ps -o tty= -p $$ 2>/dev/null | tr -d ' ')"
    [ -n "$tty" ] && [ "$tty" != "?" ] && ip="$(who 2>/dev/null | awk -v t="$tty" '$2 == t { gsub(/[()]/, "", $NF); print $NF; exit }')"
  fi
  [[ "$ip" =~ ^[0-9a-fA-F:.]+$ ]] && echo "$ip" || echo ""
}

diagnostico() {
  exigir_root
  secao "Portas abertas para a internet (não só 127.0.0.1)"
  ss -tlnpH 2>/dev/null | awk '$4 !~ /^(127\.|\[::1\]|::1)/ {print $4, $6}' | sort -u
  echo "Esperado: SSH ($(porta_ssh)), 80 e 443. Qualquer outra porta aberta é de outro sistema da VPS: confira se precisa estar pública."

  secao "Containers com porta publicada para fora"
  if tem docker; then
    docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '0\.0\.0\.0|:::' || echo "nenhum (bom: o CRM publica só em 127.0.0.1)"
  fi
  echo "Atenção: o Docker abre portas por conta própria, mesmo com ufw ligado."

  secao "Firewall (ufw)"
  if tem ufw; then ufw status verbose; else echo "ufw não instalado"; fi

  secao "SSH"
  if tem sshd; then
    sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries) '
    echo "Recomendado: login por chave (pubkeyauthentication yes), passwordauthentication no e permitrootlogin prohibit-password ou no."
    echo "NÃO mude isso antes de confirmar que entra com chave em outra janela: dá para ficar trancado para fora."
  fi
  echo "Tentativas de senha errada no SSH nas últimas 24 h: $(journalctl -u ssh -u sshd --since '24 hours ago' 2>/dev/null | grep -cE 'Failed password|Invalid user')"

  secao "fail2ban"
  if tem fail2ban-client && systemctl is-active --quiet fail2ban; then
    fail2ban-client status
    for j in sshd usaparts-crm; do fail2ban-client status "$j" 2>/dev/null | grep -E 'Currently|Total' | sed "s/^/  [$j] /"; done
  else
    echo "não está ativo. Para instalar com as regras do CRM: sudo bash deploy/seguranca-vps.sh --fail2ban"
  fi

  secao "Login do CRM: erros nas últimas linhas do log"
  if [ -f "$LOG_CRM" ]; then
    echo "Tentativas recusadas por IP (das últimas 20 mil linhas):"
    tail -n 20000 "$LOG_CRM" | grep -E '"POST /api/auth/(login|2fa/verify) HTTP/[0-9.]+" (401|429) ' | awk '{print $1}' | sort | uniq -c | sort -rn | head -10
  else
    echo "log $LOG_CRM não encontrado"
  fi

  secao "Atualizações automáticas de segurança"
  if dpkg -l unattended-upgrades 2>/dev/null | grep -q '^ii'; then echo "unattended-upgrades instalado"; else echo "unattended-upgrades NÃO instalado (recomendado: apt install unattended-upgrades)"; fi
  echo "Pacotes com atualização pendente: $(apt list --upgradable 2>/dev/null | grep -c upgradable)"
  [ -f /var/run/reboot-required ] && echo "O servidor pede reinicialização para concluir atualizações."

  secao "Memória"
  free -h
  if tem docker; then docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' 2>/dev/null; fi

  secao "Relógio (2FA depende dele)"
  timedatectl 2>/dev/null | grep -E 'Local time|synchronized'

  secao "Backups do CRM"
  local dir
  dir="$(env_get BACKUP_DIR)"; dir="${dir:-$RAIZ/backups}"
  ls -1t "$dir"/crm-db-*.dump.age 2>/dev/null | head -3 || echo "nenhum backup encontrado em $dir"
  echo "Teste de restauração (num banco separado, sem mexer na produção): sudo bash deploy/restaurar.sh --teste <arquivo .dump.age> <chave privada>"
}

instalar_fail2ban() {
  exigir_root
  local ssh_port meu_ip
  ssh_port="$(porta_ssh)"
  meu_ip="$(ip_atual)"

  if ! tem fail2ban-client; then
    info "Instalando o fail2ban"
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban >/dev/null || fatal "Não foi possível instalar o fail2ban."
  fi

  info "Regra do login do CRM (só lê $LOG_CRM)"
  cat > /etc/fail2ban/filter.d/usaparts-crm.conf <<'EOF'
# Login, 2FA e recuperação de senha recusados no CRM (log de acesso do Nginx no formato padrão).
[Definition]
failregex = ^<HOST> \S+ \S+ \[[^\]]*\] "POST /api/auth/(login|2fa/verify|forgot-password|reset-password) HTTP/[0-9.]+" (401|429)
ignoreregex =
datepattern = %%d/%%b/%%Y:%%H:%%M:%%S %%z
EOF

  # Exceções: a própria máquina e o IP de onde você está conectado agora.
  local ignore="127.0.0.1/8 ::1"
  [ -n "$meu_ip" ] && ignore="$ignore $meu_ip"

  cat > /etc/fail2ban/jail.d/usaparts-crm.conf <<EOF
# Criado por deploy/seguranca-vps.sh. Para desfazer: apague este arquivo e rode "systemctl restart fail2ban".
[DEFAULT]
ignoreip = $ignore

[sshd]
enabled  = true
port     = $ssh_port
# Ubuntu chama o serviço de "ssh" e o OpenSSH novo registra as tentativas como "sshd-session".
journalmatch = _SYSTEMD_UNIT=sshd.service + _SYSTEMD_UNIT=ssh.service + _COMM=sshd + _COMM=sshd-session
maxretry = 5
findtime = 10m
bantime  = 1h

[usaparts-crm]
enabled  = true
port     = http,https
filter   = usaparts-crm
logpath  = $LOG_CRM
maxretry = 15
findtime = 10m
bantime  = 1h
EOF

  [ -f "$LOG_CRM" ] || { touch "$LOG_CRM"; aviso "Log do CRM ainda não existia; criado vazio."; }

  info "Conferindo a configuração"
  fail2ban-client -t >/dev/null || fatal "Configuração inválida; nada foi ativado. Apague /etc/fail2ban/jail.d/usaparts-crm.conf e me mande a saída de: fail2ban-client -t"
  if [ -s "$LOG_CRM" ]; then
    fail2ban-regex "$LOG_CRM" /etc/fail2ban/filter.d/usaparts-crm.conf 2>/dev/null | grep -E '^(Lines|Failregex):' | sed 's/^/  /'
  fi

  systemctl enable --now fail2ban >/dev/null 2>&1
  systemctl restart fail2ban
  sleep 2
  fail2ban-client status
  ok "fail2ban ativo (SSH na porta $ssh_port e login do CRM)."
  [ -n "$meu_ip" ] && ok "Seu IP atual ($meu_ip) nunca é banido." || aviso "Não identifiquei seu IP de conexão: cuidado para não errar a senha do SSH 5 vezes."
  echo "Para desbanir um IP: sudo fail2ban-client unban <ip>"
}

if [ "${2:-}" = "--meu-ip" ]; then MEU_IP="${3:-}"; fi

case "${1:-}" in
  --fail2ban) instalar_fail2ban ;;
  ""|--diagnostico) diagnostico ;;
  *) fatal "Uso: sudo bash deploy/seguranca-vps.sh [--fail2ban]" ;;
esac
