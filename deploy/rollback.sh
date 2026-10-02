#!/usr/bin/env bash
# Volta o CRM para uma versão anterior já instalada.
#   sudo bash deploy/rollback.sh           -> versão instalada antes da atual
#   sudo bash deploy/rollback.sh v0.1.0    -> versão específica
#
# Atenção: o rollback troca o código, mas não desfaz migrations do banco. Se a versão nova alterou
# a estrutura do banco de forma incompatível, restaure o backup feito antes do deploy (deploy/restaurar.sh).

set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$RAIZ"

ATUAL="$(env_get CRM_VERSION)"
if [ -n "${1:-}" ]; then
  ALVO="${1#v}"
else
  ALVO="$(awk -F'\t' '$2=="deploy"{print $3}' "$ESTADO/historico.log" 2>/dev/null | grep -vx "$ATUAL" | tail -1)"
fi
[ -n "$ALVO" ] || fatal "Não há versão anterior registrada. Informe a versão: deploy/rollback.sh v0.1.0"
git rev-parse -q --verify "refs/tags/v$ALVO" >/dev/null || fatal "Versão v$ALVO não encontrada."

info "Voltando de $ATUAL para $ALVO"
git -c advice.detachedHead=false checkout --quiet "v$ALVO"
env_set CRM_VERSION "$ALVO"
env_set GIT_COMMIT "$(git rev-parse --short HEAD)"

# Reaproveita as imagens já construídas daquela versão; só reconstrói se tiverem sido removidas.
if ! docker image inspect "usaparts-crm-api:$ALVO" >/dev/null 2>&1; then
  info "Imagens da versão $ALVO não encontradas. Construindo."
  dc build
fi
dc up -d --remove-orphans --wait
aguardar_saude "$ALVO"
registrar "rollback" "$ALVO"
ok "Rollback concluído. Versão $ALVO no ar."
