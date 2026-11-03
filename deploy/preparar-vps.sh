#!/usr/bin/env bash
# Prepara uma VPS NOVA (Ubuntu) para receber o CRM: atualiza o sistema, instala o que o CRM usa e liga a segurança.
# É autossuficiente (não precisa do CRM instalado). Mais simples: mande e rode a partir da VPS ATUAL do CRM, que já tem
# o repositório (assim o IP dela entra sozinho na lista que o fail2ban nunca bloqueia):
#
#   cd /opt/usaparts-crm && sudo git fetch origin main && sudo git show origin/main:deploy/preparar-vps.sh > /root/preparar-vps.sh
#   scp /root/preparar-vps.sh root@IP-DA-VPS-NOVA:/root/
#   ssh -t root@IP-DA-VPS-NOVA "bash /root/preparar-vps.sh"
#
#   Opção: --permitir 1.2.3.4  (outro IP que o fail2ban nunca bloqueia; pode repetir). Rodar de novo não estraga nada.
#
# O que faz:
#   1. atualiza todos os pacotes; fuso de Brasília; swap de 2 GB se não houver;
#   2. instala Docker (com limite nos logs), Nginx, Certbot, git, rsync e age;
#   3. atualizações automáticas de segurança (sem reiniciar sozinha);
#   4. firewall (ufw): só SSH, 80 e 443 abertos;
#   5. fail2ban no SSH (bane por 1 h quem errar a senha 5 vezes em 10 min; o seu IP e os de --permitir ficam de fora).
# NÃO desliga o login do SSH por senha (a migração do CRM usa). Depois da migração, veja o aviso no fim.

set -euo pipefail

cor() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { cor "1;34" "==> $*"; }
ok() { cor "1;32" "  ✔ $*"; }
aviso() { cor "1;33" "  ! $*"; }
fatal() { cor "1;31" "  ✖ $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fatal "Rode como root (sudo)."
[ -r /etc/os-release ] && . /etc/os-release
[ "${ID:-}" = "ubuntu" ] || [ "${ID:-}" = "debian" ] || fatal "Feito para Ubuntu/Debian (esta é ${PRETTY_NAME:-desconhecida})."

PERMITIR=()
while [ $# -gt 0 ]; do
  case "$1" in
    --permitir) PERMITIR+=("${2:?Informe o IP depois de --permitir}"); shift 2 ;;
    *) fatal "Opção desconhecida: $1" ;;
  esac
done

export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
SSH_PORTA="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
SSH_PORTA="${SSH_PORTA:-22}"
MEU_IP="${SSH_CLIENT:-${SSH_CONNECTION:-}}"
MEU_IP="${MEU_IP%% *}"
[ -n "$MEU_IP" ] || MEU_IP="$(who -m 2>/dev/null | sed -nE 's/.*\(([0-9a-fA-F:.]+)\).*/\1/p')"

info "1/5 Atualizando o sistema (${PRETTY_NAME:-})"
apt-get update -qq
"${APT[@]}" full-upgrade >/dev/null
"${APT[@]}" install ca-certificates curl git rsync nginx certbot python3-certbot-nginx age ufw fail2ban unattended-upgrades >/dev/null
"${APT[@]}" autoremove >/dev/null || true
timedatectl set-timezone America/Sao_Paulo 2>/dev/null || true
ok "Pacotes atualizados · fuso: $(date +%Z)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/90-swap.conf
  ok "Swap de 2 GB criado"
else
  ok "Swap já existe ($(swapon --show --noheadings --bytes | awk '{s+=$3} END {printf "%d MB", s/1048576}'))"
fi

info "2/5 Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
docker compose version >/dev/null || fatal "Docker Compose não ficou disponível."
if [ ! -f /etc/docker/daemon.json ]; then
  # Logs dos containers com limite (sem isso, um container falante enche o disco).
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "5" },\n  "live-restore": true\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null 2>&1
ok "$(docker --version | cut -d, -f1) · $(docker compose version --short)"
systemctl enable --now nginx >/dev/null 2>&1
ok "Nginx $(nginx -v 2>&1 | sed 's#.*/##') · Certbot $(certbot --version 2>&1 | awk '{print $2}')"

info "3/5 Atualizações automáticas de segurança"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52usaparts-crm <<'EOF'
// Criado por deploy/preparar-vps.sh do CRM: só correções de segurança, sem reiniciar a VPS sozinha.
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
ok "Ligadas (sem reinício automático)"

info "4/5 Firewall (ufw): SSH na porta $SSH_PORTA, 80 e 443"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "$SSH_PORTA/tcp" comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | head -1)"
echo "    O CRM publica só em 127.0.0.1 (o Docker não abre nada para fora); o Nginx atende 80 e 443."

info "5/5 fail2ban no SSH"
IGNORAR="127.0.0.1/8 ::1 ${MEU_IP:-} ${PERMITIR[*]:-}"
# Sem /var/log/auth.log (Debian sem rsyslog), o fail2ban lê o journal do systemd.
BACKEND=auto
if [ ! -f /var/log/auth.log ]; then "${APT[@]}" install python3-systemd >/dev/null && BACKEND=systemd; fi
cat > /etc/fail2ban/jail.d/usaparts-ssh.conf <<EOF
# Criado por deploy/preparar-vps.sh do CRM. Depois da migração, rode também: sudo bash deploy/seguranca-vps.sh --fail2ban
[DEFAULT]
ignoreip = $IGNORAR
bantime = 1h
findtime = 10m
maxretry = 5
backend = $BACKEND

[sshd]
enabled = true
port = $SSH_PORTA
EOF
fail2ban-client -t >/dev/null || fatal "Configuração do fail2ban inválida (apague /etc/fail2ban/jail.d/usaparts-ssh.conf)."
systemctl enable --now fail2ban >/dev/null 2>&1
systemctl restart fail2ban
ok "Ativo · nunca bloqueia: $IGNORAR"

echo
TOTAL_MB="$(free -m | awk '/^Mem:/ {print $2}')"
DISCO="$(df -h / | awk 'NR==2 {print $4}')"
ok "VPS pronta: ${TOTAL_MB} MB de memória, ${DISCO} livres no disco."
if [ -f /var/run/reboot-required ]; then aviso "A atualização pede reinício: rode 'reboot' agora (antes da migração), espere 1 minuto e entre de novo."; fi
echo "  Próximo passo: na VPS antiga, sudo bash /root/migrar.sh root@$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo IP-DESTA-VPS)"
echo "  Depois da migração: cd /opt/usaparts-crm && sudo bash deploy/seguranca-vps.sh --fail2ban (inclui o login do CRM)"
echo "  e troque o SSH para entrar só com chave (passwordauthentication no), com cuidado para não ficar trancado para fora."
