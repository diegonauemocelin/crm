#!/usr/bin/env bash
# Funções compartilhadas pelos scripts de implantação.

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ESTADO="$RAIZ/.deploy"
mkdir -p "$ESTADO" 2>/dev/null || true

cor() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { cor "1;34" "==> $*"; }
ok() { cor "1;32" "  ✔ $*"; }
aviso() { cor "1;33" "  ! $*"; }
erro() { cor "1;31" "  ✖ $*" >&2; }
fatal() { erro "$*"; exit 1; }

exigir_root() { [ "$(id -u)" -eq 0 ] || fatal "Rode como root (sudo)."; }

dc() { docker compose --project-directory "$RAIZ" -f "$RAIZ/docker-compose.yml" "$@"; }

# Variável ausente devolve vazio (e sucesso): com "set -o pipefail", um grep sem resultado encerraria o script em silêncio.
env_get() { { grep -E "^$1=" "$RAIZ/.env" 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }

# Grava/atualiza uma variável no .env sem mexer nas demais.
env_set() {
  local chave="$1" valor="$2" arquivo="$RAIZ/.env"
  if grep -qE "^${chave}=" "$arquivo"; then
    sed -i "s|^${chave}=.*|${chave}=${valor}|" "$arquivo"
  else
    printf '%s=%s\n' "$chave" "$valor" >> "$arquivo"
  fi
}

prefixo_imagens() { local p; p="$(env_get CRM_IMAGE_PREFIX)"; echo "${p:-usaparts-crm}"; }

# Com CRM_IMAGE_PREFIX apontando para um registro (ghcr.io/...), baixa as imagens já construídas pelo GitHub Actions:
# a VPS não compila nada (evita picos de memória que afetariam os outros sistemas do servidor).
# Sem o prefixo, constrói localmente.
obter_imagens() {
  if [[ "$(prefixo_imagens)" == */* ]]; then
    info "Baixando imagens prontas ($(prefixo_imagens)-*:$(env_get CRM_VERSION))"
    # return (e não exit) para o deploy acionar a volta automática à versão anterior.
    dc pull --quiet api web backup db || {
      erro "Não foi possível baixar as imagens. A versão foi publicada (aba Actions do GitHub)? O pacote está público ou foi feito 'docker login ghcr.io'?"
      return 1
    }
  else
    info "Construindo imagens localmente"
    dc build --pull
  fi
}

porta_http() { local p; p="$(env_get CRM_HTTP_PORT)"; echo "${p:-8180}"; }

# Espera a API responder saudável com a versão esperada (ou qualquer versão se vazio).
aguardar_saude() {
  local esperado="${1:-}" tentativas=60 corpo
  for _ in $(seq 1 "$tentativas"); do
    if corpo="$(curl -fsS --max-time 3 "http://127.0.0.1:$(porta_http)/api/health" 2>/dev/null)"; then
      if [ -z "$esperado" ] || echo "$corpo" | grep -q "\"version\":\"$esperado\""; then
        ok "Sistema saudável: $corpo"
        return 0
      fi
    fi
    sleep 2
  done
  erro "A API não respondeu saudável em $((tentativas * 2))s."
  return 1
}

# WhatsApp ligado no .env (COMPOSE_PROFILES contém "whatsapp")?
whatsapp_ativo() { [[ ",$(env_get COMPOSE_PROFILES)," == *",whatsapp,"* ]]; }

# Banco próprio da Evolution, no mesmo PostgreSQL do CRM (criado uma vez).
garantir_banco_evolution() {
  if ! dc exec -T db psql -U crm -d crm -tAc "SELECT 1 FROM pg_database WHERE datname = 'evolution'" | grep -q 1; then
    info "Criando o banco da Evolution"
    dc exec -T db psql -U crm -d crm -c "CREATE DATABASE evolution" >/dev/null
  fi
}

registrar() { printf '%s\t%s\t%s\n' "$(date -Iseconds)" "$1" "$2" >> "$ESTADO/historico.log"; }
