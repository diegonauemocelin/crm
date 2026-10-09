#!/usr/bin/env bash
# WhatsApp do CRM (Evolution API) na VPS.
#   sudo bash deploy/whatsapp.sh status                      -> situação, versão e memória livre
#   sudo bash deploy/whatsapp.sh ativar [--forcar]           -> gera as chaves, cria o banco e sobe a Evolution
#   sudo bash deploy/whatsapp.sh desativar                   -> para a Evolution (as sessões ficam guardadas)
#   sudo bash deploy/whatsapp.sh limite 5                    -> números conectados ao mesmo tempo (depois do upgrade da VPS)
#   sudo bash deploy/whatsapp.sh atualizar                   -> instala a versão estável mais nova da Evolution (só 2.x), com volta automática
#   sudo bash deploy/whatsapp.sh atualizacao-automatica ligar|desligar  -> confere toda semana (domingo, 4h)
#
# A Evolution não publica porta nenhuma: só a API do CRM fala com ela, pela rede interna do Docker.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$RAIZ"
exigir_root
[ -f .env ] || fatal "Arquivo .env não encontrado. Rode primeiro deploy/instalar.sh."

IMAGEM="evoapicloud/evolution-api"
VERSAO_PADRAO="v2.3.7"
# Memória livre mínima para ligar (Evolution + Redis com 3 números conectados usam por volta de 400-600 MB).
MEMORIA_MINIMA_MB=700
CRON="/etc/cron.d/usaparts-crm-whatsapp"

memoria_livre_mb() { awk '/MemAvailable/ { printf "%d", $2 / 1024 }' /proc/meminfo; }

versao_rodando() {
  dc exec -T evolution node -e "fetch('http://127.0.0.1:8080/').then(r=>r.json()).then(j=>console.log(j.version||'')).catch(()=>process.exit(1))" 2>/dev/null || true
}

# O que a Evolution responde (ou por que não responde), para o status e para os erros.
diagnostico() {
  dc exec -T evolution node -e "fetch('http://127.0.0.1:8080/').then(async r=>console.log('HTTP '+r.status+' '+(await r.text()).slice(0,160))).catch(e=>console.log('sem resposta ('+(e.cause&&e.cause.code||e.message)+')'))" 2>/dev/null || echo "contêiner parado"
}

aguardar_evolution() {
  local _
  for _ in $(seq 1 60); do
    if [ -n "$(versao_rodando)" ]; then return 0; fi
    sleep 3
  done
  return 1
}

# A API lê as chaves e os limites do .env ao subir: recria só o contêiner dela.
recarregar_api() {
  info "Recarregando a API do CRM"
  dc up -d --no-deps --wait api
  aguardar_saude "$(env_get CRM_VERSION)"
}

cmd_status() {
  info "WhatsApp (Evolution API)"
  if whatsapp_ativo; then ok "Ligado no .env (COMPOSE_PROFILES=$(env_get COMPOSE_PROFILES))"; else aviso "Desligado (rode: sudo bash deploy/whatsapp.sh ativar)"; fi
  echo "  Versão configurada: $(env_get EVOLUTION_VERSION || true)"
  local v; v="$(versao_rodando)"
  if [ -n "$v" ]; then ok "Evolution respondendo, versão $v"; else aviso "Evolution não está respondendo: $(diagnostico)"; fi
  echo "  Limites: $(env_get WHATSAPP_MAX_NUMBERS || true) números cadastrados (padrão 10), $(env_get WHATSAPP_MAX_CONNECTED || true) conectados ao mesmo tempo (padrão 3)"
  echo "  Memória livre na VPS: $(memoria_livre_mb) MB"
  dc ps evolution evolution-redis 2>/dev/null || true
  if [ -f "$CRON" ]; then ok "Atualização automática ligada (domingo, 4h)"; else echo "  Atualização automática: desligada"; fi
}

cmd_ativar() {
  local forcar="${1:-}"
  local livre; livre="$(memoria_livre_mb)"
  if [ "$livre" -lt "$MEMORIA_MINIMA_MB" ] && [ "$forcar" != "--forcar" ]; then
    fatal "Só ${livre} MB livres (mínimo ${MEMORIA_MINIMA_MB} MB). Ligar agora pode deixar o CRM e os outros sistemas lentos. Aumente a memória da VPS ou use --forcar por sua conta."
  fi
  info "Preparando as chaves (ficam só no .env do servidor)"
  [ -n "$(env_get EVOLUTION_API_KEY)" ] || env_set EVOLUTION_API_KEY "$(openssl rand -hex 32)"
  [ -n "$(env_get EVOLUTION_WEBHOOK_SECRET)" ] || env_set EVOLUTION_WEBHOOK_SECRET "$(openssl rand -hex 24)"
  [ -n "$(env_get EVOLUTION_VERSION)" ] || env_set EVOLUTION_VERSION "$VERSAO_PADRAO"
  [ -n "$(env_get WHATSAPP_MAX_NUMBERS)" ] || env_set WHATSAPP_MAX_NUMBERS 10
  [ -n "$(env_get WHATSAPP_MAX_CONNECTED)" ] || env_set WHATSAPP_MAX_CONNECTED 3
  chmod 600 .env
  local perfis; perfis="$(env_get COMPOSE_PROFILES)"
  if ! whatsapp_ativo; then env_set COMPOSE_PROFILES "${perfis:+$perfis,}whatsapp"; fi

  dc up -d --wait db
  garantir_banco_evolution
  info "Baixando e subindo a Evolution $(env_get EVOLUTION_VERSION)"
  dc pull --quiet evolution evolution-redis
  dc up -d evolution-redis evolution
  aguardar_evolution || fatal "A Evolution não respondeu: $(diagnostico). Veja também: docker compose logs --tail 80 evolution"
  ok "Evolution respondendo, versão $(versao_rodando)"
  recarregar_api
  registrar "whatsapp-ativado" "$(env_get EVOLUTION_VERSION)"
  ok "WhatsApp ligado. Cadastre e conecte os números no CRM: Atendimento → Números de WhatsApp."
}

cmd_desativar() {
  info "Parando a Evolution (as sessões ficam guardadas para quando ligar de novo)"
  dc stop evolution evolution-redis || true
  env_set COMPOSE_PROFILES "$(env_get COMPOSE_PROFILES | tr ',' '\n' | { grep -vx whatsapp || true; } | paste -sd, -)"
  recarregar_api
  registrar "whatsapp-desativado" "-"
  ok "WhatsApp desligado."
}

cmd_limite() {
  local n="${1:-}"
  [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le 10 ] || fatal "Informe de 1 a 10. Ex.: sudo bash deploy/whatsapp.sh limite 5"
  if [ "$n" -gt 3 ]; then
    aviso "Cada número conectado usa memória. Com $n conectados, recomendo a VPS com 4 GB ou mais (livre agora: $(memoria_livre_mb) MB)."
    [ "$n" -le 5 ] || env_set EVOLUTION_MEMORY "$((n * 150 + 200))m"
  fi
  env_set WHATSAPP_MAX_CONNECTED "$n"
  recarregar_api
  ok "Limite de números conectados ao mesmo tempo: $n."
}

# Versão estável mais nova da série 2.x no Docker Hub (sem "latest", "beta", "rc"...).
versao_mais_nova() {
  curl -fsS --max-time 20 "https://hub.docker.com/v2/namespaces/evoapicloud/repositories/evolution-api/tags?page_size=100&ordering=last_updated" \
    | grep -oE '"name": *"v2\.[0-9]+\.[0-9]+"' | grep -oE 'v2\.[0-9]+\.[0-9]+' | sort -V | tail -1
}

cmd_atualizar() {
  whatsapp_ativo || fatal "O WhatsApp não está ligado."
  local atual nova
  atual="$(env_get EVOLUTION_VERSION)"; atual="${atual:-$VERSAO_PADRAO}"
  nova="$(versao_mais_nova || true)"
  [ -n "$nova" ] || fatal "Não consegui consultar as versões no Docker Hub."
  if [ "$(printf '%s\n%s\n' "$atual" "$nova" | sort -V | tail -1)" = "$atual" ]; then
    ok "Evolution já está na versão estável mais nova ($atual)."
    return 0
  fi
  info "Atualizando a Evolution: $atual -> $nova"
  env_set EVOLUTION_VERSION "$nova"
  if dc pull --quiet evolution && dc up -d evolution && aguardar_evolution; then
    registrar "whatsapp-atualizado" "$nova"
    docker image prune -f --filter "reference=$IMAGEM" >/dev/null 2>&1 || true
    ok "Evolution $nova no ar."
  else
    erro "A versão $nova não respondeu. Voltando para $atual."
    env_set EVOLUTION_VERSION "$atual"
    dc up -d evolution
    aguardar_evolution && ok "Versão $atual restaurada." || erro "A versão $atual também não respondeu. Veja: docker compose logs --tail 80 evolution"
    registrar "whatsapp-atualizacao-falhou" "$nova"
    exit 1
  fi
}

cmd_auto() {
  case "${1:-}" in
    ligar)
      printf '%s\n' "# Atualização semanal da Evolution API (WhatsApp do CRM). Criado por deploy/whatsapp.sh." \
        "0 4 * * 0 root bash $RAIZ/deploy/whatsapp.sh atualizar >> $ESTADO/whatsapp-atualizacao.log 2>&1" > "$CRON"
      chmod 644 "$CRON"
      ok "Atualização automática ligada: domingo às 4h (log em $ESTADO/whatsapp-atualizacao.log)."
      ;;
    desligar)
      rm -f "$CRON"
      ok "Atualização automática desligada."
      ;;
    *) fatal "Use: atualizacao-automatica ligar | desligar" ;;
  esac
}

case "${1:-status}" in
  status) cmd_status ;;
  ativar) cmd_ativar "${2:-}" ;;
  desativar) cmd_desativar ;;
  limite) cmd_limite "${2:-}" ;;
  atualizar) cmd_atualizar ;;
  atualizacao-automatica) cmd_auto "${2:-}" ;;
  *) fatal "Comando desconhecido: $1 (use status, ativar, desativar, limite, atualizar ou atualizacao-automatica)" ;;
esac
