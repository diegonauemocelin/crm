#!/usr/bin/env bash
# Deixa na VPS só o CRM: verifica, desliga e (depois) apaga os sistemas antigos e os bancos deles.
#   sudo bash deploy/enxugar-servidor.sh               -> verificar (só lê; não muda nada)
#   sudo bash deploy/enxugar-servidor.sh desligar      -> backup criptografado + para e desativa (dá para voltar)
#   sudo bash deploy/enxugar-servidor.sh apagar        -> remove de vez o que foi desligado (pede confirmação)
# Opções: --bi /opt/usaparts-bi  --painel /opt/usaparts-assistente
#
# Sistemas antigos conhecidos:
#   - Usaparts BI (marketing.usaparts.com.br): docker compose em /opt/usaparts-bi, com banco PostgreSQL próprio.
#     O CRM busca o Mercado Livre Ads direto no Mercado Livre: não depende mais do BI.
#   - Painel do assistente (painel.usaparts.com.br): serviço usaparts.service em /opt/usaparts-assistente, banco
#     SQLite. Só é desligado depois de importado no CRM (deploy/importar-painel.sh) E de o CRM assumir o atendimento
#     (Marketplaces › Assistente › Integração); antes disso, as perguntas do Mercado Livre ficariam sem resposta.
# O resto que não é do CRM (outros containers, serviços e bancos instalados direto no servidor) só é listado.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
exigir_root
cd "$RAIZ"

MODO="verificar"
BI_DIR=/opt/usaparts-bi
PAINEL_DIR=/opt/usaparts-assistente
PAINEL_SERVICO=usaparts.service
DOMINIOS_ANTIGOS="painel.usaparts.com.br marketing.usaparts.com.br"
while [ $# -gt 0 ]; do
  case "$1" in
    verificar | desligar | apagar) MODO="$1"; shift ;;
    --bi) BI_DIR="${2:?Informe a pasta do BI}"; shift 2 ;;
    --painel) PAINEL_DIR="${2:?Informe a pasta do painel}"; shift 2 ;;
    *) fatal "Opção desconhecida: $1 (use verificar, desligar ou apagar)" ;;
  esac
done

[ -f .env ] || fatal "Rode no CRM instalado (não encontrei o .env em $RAIZ)."
ESTADO_ENXUGAR="$ESTADO/enxugar"
mkdir -p "$ESTADO_ENXUGAR"
bi() { docker compose --project-directory "$BI_DIR" -f "$BI_DIR/docker-compose.yml" "$@"; }
tem_bi() { [ -f "$BI_DIR/docker-compose.yml" ]; }
tem_painel() { [ -d "$PAINEL_DIR" ] || systemctl list-unit-files "$PAINEL_SERVICO" --no-legend 2>/dev/null | grep -q .; }
psql_crm() { dc exec -T db psql -U crm -d crm -v ON_ERROR_STOP=1 -qtA -c "$1" 2>/dev/null; }

# Painel pronto para sair: dados importados no CRM e o CRM atendendo (em alguma empresa).
painel_pronto() {
  local importado ativo
  importado="$(psql_crm "SELECT count(*) FROM tenant_settings WHERE key = 'assist_painel' AND value ? 'importedAt'" || echo 0)"
  ativo="$(psql_crm "SELECT count(*) FROM tenant_settings WHERE key = 'assist_integration' AND (value->>'active')::boolean" || echo 0)"
  [ "${importado:-0}" -gt 0 ] && [ "${ativo:-0}" -gt 0 ]
}
situacao_painel() {
  local importado ativo
  importado="$(psql_crm "SELECT count(*) FROM tenant_settings WHERE key = 'assist_painel' AND value ? 'importedAt'" || echo 0)"
  ativo="$(psql_crm "SELECT count(*) FROM tenant_settings WHERE key = 'assist_integration' AND (value->>'active')::boolean" || echo 0)"
  if [ "${importado:-0}" -eq 0 ]; then echo "dados do painel ainda NÃO importados no CRM (rode: sudo bash deploy/importar-painel.sh)"
  elif [ "${ativo:-0}" -eq 0 ]; then echo "importado, mas o CRM ainda NÃO assumiu o atendimento (Marketplaces › Assistente › Integração › Assumir o atendimento)"
  else echo "pronto para desligar (importado e o CRM atendendo)"; fi
}

# Sites do Nginx dos sistemas antigos (pelo server_name).
vhosts_antigos() {
  local f d
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -e "$f" ] || continue
    for d in $DOMINIOS_ANTIGOS; do
      if grep -qE "server_name[^;]*\b${d//./\\.}\b" "$f" 2>/dev/null; then echo "$f"; break; fi
    done
  done | sort -u
}

verificar() {
  info "Memória e disco agora"
  free -h | sed 's/^/  /'
  df -h / | sed 's/^/  /'

  info "CRM"
  echo "  Versão no ar: $(curl -fsS --max-time 5 "http://127.0.0.1:$(porta_http)/api/health" 2>/dev/null || echo 'não respondeu')"
  dc ps --format '  {{.Service}}: {{.Status}}' 2>/dev/null || true

  info "Usaparts BI ($BI_DIR)"
  if tem_bi; then
    bi ps --format '  {{.Service}}: {{.Status}}' 2>/dev/null || echo "  (containers parados)"
    docker system df -v 2>/dev/null | grep -E "usaparts-bi" | sed 's/^/  volume: /' | head -5 || true
    echo "  O CRM não depende do BI (o Mercado Livre Ads vem direto do Mercado Livre): pode desligar."
  else
    ok "Não encontrado (já removido ou em outra pasta: --bi)."
  fi

  info "Painel do assistente ($PAINEL_DIR, $PAINEL_SERVICO)"
  if tem_painel; then
    echo "  Serviço: $(systemctl is-active "$PAINEL_SERVICO" 2>/dev/null || echo 'inexistente') / $(systemctl is-enabled "$PAINEL_SERVICO" 2>/dev/null || echo '-')"
    [ -d "$PAINEL_DIR" ] && echo "  Pasta: $(du -sh "$PAINEL_DIR" 2>/dev/null | cut -f1)"
    echo "  Situação: $(situacao_painel)"
  else
    ok "Não encontrado (já removido ou em outra pasta: --painel)."
  fi

  info "Sites do Nginx dos sistemas antigos ($DOMINIOS_ANTIGOS)"
  local v
  v="$(vhosts_antigos)"
  if [ -n "$v" ]; then echo "$v" | sed 's/^/  /'; else ok "Nenhum ativo."; fi

  info "Tarefas agendadas (cron) dos sistemas antigos"
  { crontab -l 2>/dev/null; cat /etc/cron.d/* 2>/dev/null; } | grep -E "usaparts-assistente|usaparts-bi|/opt/backups/usaparts" | sed 's/^/  /' || ok "Nenhuma."

  info "Outros containers (fora do CRM e do BI)"
  docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Label "com.docker.compose.project"}}' 2>/dev/null \
    | awk -F'\t' -v crm="$(basename "$RAIZ")" -v bi="$(basename "$BI_DIR")" '$4 != crm && $4 != bi && $4 != "usaparts-crm" {printf "  %s (%s): %s%s\n", $1, $2, $3, ($4 ? " · projeto " $4 : "")}' \
    | grep . || ok "Nenhum."

  info "Serviços próprios do servidor (fora do sistema operacional)"
  systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' \
    | grep -vE '^(systemd-|dbus|ssh|sshd|cron|rsyslog|nginx|docker|containerd|snapd|polkit|udisks|unattended|getty|serial-getty|networkd|multipathd|ModemManager|accounts-daemon|irqbalance|chrony|ntp|fail2ban|ufw|qemu-guest|user@|packagekit|atd|wpa_supplicant|NetworkManager|thermald|lvm2|upower|rtkit|avahi|cups|postfix|exim)' \
    | sed 's/^/  /' || true

  info "Bancos de dados instalados direto no servidor (fora do Docker)"
  local achou=0 s
  for s in postgresql mysql mariadb mongod redis-server; do
    if systemctl list-unit-files "$s.service" --no-legend 2>/dev/null | grep -q .; then
      echo "  $s: $(systemctl is-active "$s" 2>/dev/null)"
      achou=1
    fi
  done
  [ "$achou" = 1 ] || ok "Nenhum (o banco do CRM roda no container db)."

  info "Uso de memória por container"
  docker stats --no-stream --format '  {{.Name}}: {{.MemUsage}}' 2>/dev/null || true
  echo
  echo "Para desligar os sistemas antigos (com backup, dá para voltar):  sudo bash deploy/enxugar-servidor.sh desligar"
  echo "O que aparece em \"Outros containers\", \"Serviços próprios\" ou \"Bancos fora do Docker\" não é tocado por este script."
}

# Tarefas do cron de um sistema antigo: pausar (comenta, dá para voltar) e remover (no apagar).
pausar_cron() {
  local dir="$1"
  if crontab -l 2>/dev/null | grep -v '^#' | grep -qF "$dir"; then
    crontab -l | awk -v d="$dir" 'index($0, d) && $0 !~ /^#/ { print "#enxugar# " $0; next } { print }' | crontab -
    ok "Tarefa do cron pausada ($dir)."
  fi
}
remover_cron() {
  local dir="$1"
  if crontab -l 2>/dev/null | grep -qF "$dir"; then
    crontab -l | { grep -vF "$dir" || true; } | crontab -
    ok "Tarefa do cron removida ($dir)."
  fi
  grep -lF "$dir" /etc/cron.d/* 2>/dev/null | xargs -r rm -f
}

CHAVE=""
DESTINO=""
cifrar() { dc run --rm -T --no-deps --entrypoint age backup -r "$CHAVE"; }
preparar_backup() {
  CHAVE="$(env_get BACKUP_AGE_RECIPIENT)"
  [[ "$CHAVE" == age1* ]] || fatal "BACKUP_AGE_RECIPIENT não está no .env do CRM (é a chave pública dos backups)."
  DESTINO="$(env_get BACKUP_DIR)"
  DESTINO="${DESTINO:-./backups}"
  [[ "$DESTINO" == /* ]] || DESTINO="$RAIZ/${DESTINO#./}"
  mkdir -p "$DESTINO"
  umask 077
}

desligar_nginx() {
  local v f guarda="$ESTADO_ENXUGAR/nginx"
  v="$(vhosts_antigos)"
  [ -n "$v" ] || return 0
  mkdir -p "$guarda"
  while read -r f; do
    [ -n "$f" ] || continue
    # O link em sites-enabled sai; o arquivo de configuração original fica guardado para voltar.
    cp -aL "$f" "$guarda/$(basename "$f")"
    if [ -L "$f" ]; then rm -f "$f"; else mv "$f" "$guarda/$(basename "$f").original"; fi
    ok "Site do Nginx desativado: $f (cópia em $guarda)"
  done <<<"$v"
  if nginx -t 2>/dev/null; then systemctl reload nginx && ok "Nginx recarregado."
  else
    erro "A configuração do Nginx ficou inválida: voltando os sites."
    for f in "$guarda"/*; do
      case "$f" in *.original) mv "$f" "/etc/nginx/sites-enabled/$(basename "${f%.original}")" ;; *) ln -sf "/etc/nginx/sites-available/$(basename "$f")" "/etc/nginx/sites-enabled/$(basename "$f")" 2>/dev/null || cp "$f" "/etc/nginx/sites-enabled/" ;; esac
    done
    nginx -t && systemctl reload nginx
    fatal "Nada mais foi alterado no Nginx. Me mande a saída de: sudo nginx -t"
  fi
}

desligar() {
  preparar_backup
  local STAMP
  STAMP="$(date +%Y%m%d-%H%M%S)"
  info "1/4 Backup do CRM antes de mexer"
  dc run --rm --no-deps backup /usr/local/bin/backup.sh || fatal "O backup do CRM falhou. Nada foi alterado."

  if tem_bi; then
    info "2/4 Usaparts BI: cópia criptografada e desligamento"
    bi up -d db >/dev/null 2>&1 || true
    sleep 5
    if bi exec -T db pg_dump -U usaparts -d usaparts_bi -Fc --no-owner --no-acl | cifrar > "$DESTINO/bi-db-$STAMP.dump.age" && [ -s "$DESTINO/bi-db-$STAMP.dump.age" ]; then
      ok "Banco do BI: $DESTINO/bi-db-$STAMP.dump.age"
    else
      rm -f "$DESTINO/bi-db-$STAMP.dump.age"
      fatal "Não consegui copiar o banco do BI. O BI continua como estava. Me mande: cd $BI_DIR && sudo docker compose ps"
    fi
    tar -C "$BI_DIR" -cz . 2>/dev/null | cifrar > "$DESTINO/bi-pasta-$STAMP.tar.gz.age" || aviso "Não consegui copiar a pasta do BI (o banco foi copiado)."
    bi stop >/dev/null
    # Não sobe sozinho quando o servidor reiniciar.
    docker update --restart=no $(bi ps -aq) >/dev/null 2>&1 || true
    pausar_cron "$BI_DIR"
    touch "$ESTADO_ENXUGAR/bi-desligado"
    ok "BI parado (containers e banco continuam no servidor até o passo apagar)."
  else
    info "2/4 Usaparts BI: não encontrado, nada a fazer."
  fi

  if tem_painel; then
    info "3/4 Painel do assistente"
    if painel_pronto; then
      [ -d "$PAINEL_DIR" ] && tar -C "$PAINEL_DIR" -cz . 2>/dev/null | cifrar > "$DESTINO/painel-pasta-$STAMP.tar.gz.age" && ok "Pasta do painel (dados e .env): $DESTINO/painel-pasta-$STAMP.tar.gz.age"
      systemctl disable --now "$PAINEL_SERVICO" >/dev/null 2>&1 || true
      pausar_cron "$PAINEL_DIR"
      touch "$ESTADO_ENXUGAR/painel-desligado"
      ok "Painel parado e desativado (arquivos continuam em $PAINEL_DIR até o passo apagar)."
    else
      aviso "Painel NÃO desligado: $(situacao_painel)."
      aviso "Ele continua respondendo as perguntas do Mercado Livre. Depois de importar e assumir, rode de novo: sudo bash deploy/enxugar-servidor.sh desligar"
    fi
  else
    info "3/4 Painel: não encontrado, nada a fazer."
  fi

  info "4/4 Sites antigos no Nginx"
  if [ -f "$ESTADO_ENXUGAR/painel-desligado" ] || ! tem_painel; then
    desligar_nginx
  else
    # Com o painel ainda no ar, desativa só o site do BI.
    DOMINIOS_ANTIGOS="marketing.usaparts.com.br" desligar_nginx
  fi
  echo
  free -h | sed 's/^/  /'
  ok "Pronto. O CRM continua no ar. Para voltar um sistema: veja docs/DEPLOY.md (seção Enxugar o servidor)."
  echo "  Quando tiver conferido que nada faz falta (sugestão: uma semana), apague de vez: sudo bash deploy/enxugar-servidor.sh apagar"
  registrar "enxugar-desligar" "$STAMP"
}

apagar() {
  local alvo=()
  [ -f "$ESTADO_ENXUGAR/bi-desligado" ] && tem_bi && alvo+=("BI: containers, banco PostgreSQL (volumes), imagens, a pasta $BI_DIR (com os backups próprios dele) e a tarefa do cron")
  [ -f "$ESTADO_ENXUGAR/painel-desligado" ] && tem_painel && alvo+=("Painel: serviço $PAINEL_SERVICO, a pasta $PAINEL_DIR (banco SQLite), o backup próprio dele em /opt/backups/usaparts e a tarefa do cron")
  [ ${#alvo[@]} -gt 0 ] || fatal "Nada para apagar: rode antes 'sudo bash deploy/enxugar-servidor.sh desligar' (o apagar só remove o que já foi desligado, com backup)."
  info "Vai ser apagado de vez (as cópias criptografadas ficam na pasta de backups do CRM):"
  printf '  - %s\n' "${alvo[@]}"
  ls -1 "$(env_get BACKUP_DIR 2>/dev/null || echo "$RAIZ/backups")" 2>/dev/null | grep -E '^(bi|painel)-' | sed 's/^/  cópia: /' || true
  printf '\nDigite APAGAR para confirmar: '
  local resposta
  read -r resposta </dev/tty
  [ "$resposta" = "APAGAR" ] || fatal "Cancelado. Nada foi apagado."

  if [ -f "$ESTADO_ENXUGAR/bi-desligado" ] && tem_bi; then
    local imagens
    imagens="$(bi images -q 2>/dev/null | sort -u || true)"
    bi down -v --remove-orphans >/dev/null 2>&1 || true
    [ -n "$imagens" ] && docker rmi $imagens >/dev/null 2>&1 || true
    rm -rf "$BI_DIR"
    remover_cron "$BI_DIR"
    rm -f "$ESTADO_ENXUGAR/bi-desligado"
    ok "BI apagado (containers, banco, imagens, pasta e cron)."
  fi
  if [ -f "$ESTADO_ENXUGAR/painel-desligado" ] && tem_painel; then
    systemctl disable --now "$PAINEL_SERVICO" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/$PAINEL_SERVICO"
    systemctl daemon-reload
    rm -rf "$PAINEL_DIR" /opt/backups/usaparts
    remover_cron "$PAINEL_DIR"
    id usaparts >/dev/null 2>&1 && userdel usaparts 2>/dev/null || true
    rm -f "$ESTADO_ENXUGAR/painel-desligado"
    ok "Painel apagado (serviço, pasta, banco, backup próprio e cron)."
  fi
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f >/dev/null 2>&1 || true
  echo
  df -h / | sed 's/^/  /'
  free -h | sed 's/^/  /'
  ok "Pronto: no servidor fica só o CRM (e o que a verificação listou como fora destes sistemas)."
  echo "  Certificados SSL dos domínios antigos (opcional): sudo certbot delete --cert-name painel.usaparts.com.br"
  registrar "enxugar-apagar" "$(date +%Y%m%d-%H%M%S)"
}

case "$MODO" in
  verificar) verificar ;;
  desligar) desligar ;;
  apagar) apagar ;;
esac
