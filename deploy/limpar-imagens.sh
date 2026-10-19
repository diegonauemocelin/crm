#!/usr/bin/env bash
# Apaga as imagens de versões antigas do CRM (api, web e backup) que ocupam o disco da VPS.
#   sudo bash deploy/limpar-imagens.sh                 -> mantém a versão em uso (CRM_VERSION do .env)
#   sudo bash deploy/limpar-imagens.sh 0.59.2 0.59.1   -> mantém as versões informadas
#
# Cada atualização baixa imagens novas; sem limpeza, dezenas de versões enchem o disco e o banco cai
# ("No space left on device"). Imagem em uso por um container nunca é apagada (o Docker recusa).

set -uo pipefail
source "$(dirname "$0")/lib.sh"
cd "$RAIZ"

PREFIXO="$(env_get CRM_IMAGE_PREFIX)"
[ -n "$PREFIXO" ] || { aviso "CRM_IMAGE_PREFIX não definido no .env: imagens montadas localmente, nada a limpar."; exit 0; }

MANTER=("$@")
[ ${#MANTER[@]} -gt 0 ] || MANTER=("$(env_get CRM_VERSION)")

antes="$(df -Pm "$RAIZ" | awk 'NR==2 {print $4}')"
apagadas=0
while read -r imagem; do
  [ -n "$imagem" ] || continue
  tag="${imagem##*:}"
  manter=0
  for m in "${MANTER[@]}"; do [ -n "$m" ] && [ "$tag" = "${m#v}" ] && manter=1; done
  [ "$manter" = 1 ] && continue
  if docker rmi "$imagem" >/dev/null 2>&1; then apagadas=$((apagadas + 1)); fi
done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^${PREFIXO}-(api|web|backup):")

docker image prune -f >/dev/null 2>&1 || true
depois="$(df -Pm "$RAIZ" | awk 'NR==2 {print $4}')"
ok "Imagens antigas do CRM apagadas: $apagadas. Espaço livre: ${antes} MB -> ${depois} MB."
