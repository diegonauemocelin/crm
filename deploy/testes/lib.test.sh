#!/usr/bin/env bash
# Testes das funções dos scripts de implantação, no mesmo modo estrito em que eles rodam (set -euo pipefail).
# Regressão coberta: numa instalação nova o .env ainda não tem CRM_VERSION, e o env_get encerrava o script em silêncio.
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -r "$(dirname "$0")/.." "$TMP/deploy"
source "$TMP/deploy/lib.sh"

falha() { echo "FALHOU: $*" >&2; exit 1; }

[ "$(env_get CRM_VERSION)" = "" ] || falha "sem .env deveria devolver vazio"

echo "CRM_DOMAIN=crm.exemplo.com.br" > "$RAIZ/.env"
V="$(env_get CRM_VERSION)"
[ "$V" = "" ] || falha "variável ausente deveria devolver vazio"

env_set CRM_VERSION 0.1.2
[ "$(env_get CRM_VERSION)" = "0.1.2" ] || falha "env_set não gravou"
env_set CRM_VERSION 0.1.3
[ "$(env_get CRM_VERSION)" = "0.1.3" ] || falha "env_set não atualizou"
[ "$(grep -c '^CRM_VERSION=' "$RAIZ/.env")" = "1" ] || falha "env_set duplicou a variável"
[ "$(env_get CRM_DOMAIN)" = "crm.exemplo.com.br" ] || falha "env_set alterou outra variável"

[ "$(porta_http)" = "8180" ] || falha "porta padrão deveria ser 8180"
[ "$(prefixo_imagens)" = "usaparts-crm" ] || falha "prefixo padrão incorreto"
env_set CRM_IMAGE_PREFIX ghcr.io/dono/crm
[ "$(prefixo_imagens)" = "ghcr.io/dono/crm" ] || falha "prefixo do .env não lido"

echo "lib.sh: todos os testes passaram"
