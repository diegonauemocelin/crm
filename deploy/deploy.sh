#!/usr/bin/env bash
# Atualiza o CRM para uma versão publicada (tag do Git).
#   sudo bash deploy/deploy.sh            -> última versão (maior tag vX.Y.Z)
#   sudo bash deploy/deploy.sh v0.2.0     -> versão específica
#
# Passos: backup -> checkout da tag -> build das imagens -> migrations -> subida -> checagem de saúde.
# Se a checagem falhar, volta automaticamente para a versão anterior.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$RAIZ"

[ -f .env ] || fatal "Arquivo .env não encontrado. Rode primeiro deploy/instalar.sh."
[ -z "$(git status --porcelain --untracked-files=no)" ] || fatal "Há arquivos alterados no servidor (git status). Não altere o código direto na VPS."

info "Buscando versões publicadas"
git fetch --tags --prune --force origin
ALVO="${1:-}"
[ -n "$ALVO" ] || ALVO="$(git tag -l 'v*' --sort=-v:refname | sed -n 1p)"
[ -n "$ALVO" ] || fatal "Nenhuma versão (tag vX.Y.Z) publicada no repositório."
git rev-parse -q --verify "refs/tags/$ALVO" >/dev/null || fatal "Versão $ALVO não existe."

ATUAL_TAG="$(env_get CRM_VERSION)"
ATUAL_REF="$(git rev-parse HEAD)"
VERSAO="${ALVO#v}"
info "Versão atual: ${ATUAL_TAG:-nenhuma}  ->  nova: $VERSAO"

if [ -n "$ATUAL_TAG" ] && dc ps --status running --services 2>/dev/null | grep -q '^db$'; then
  info "Backup de segurança antes de atualizar"
  dc run --rm --no-deps backup /usr/local/bin/backup.sh || fatal "Backup falhou. Atualização cancelada."
fi

info "Preparando a versão $VERSAO"
git -c advice.detachedHead=false checkout --quiet "$ALVO"
env_set CRM_VERSION "$VERSAO"
env_set GIT_COMMIT "$(git rev-parse --short HEAD)"
env_set BUILD_DATE "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

voltar() {
  erro "Falha na atualização. Voltando para a versão anterior (${ATUAL_TAG:-nenhuma})."
  registrar "falha" "$VERSAO"
  if [ -n "$ATUAL_TAG" ]; then
    git -c advice.detachedHead=false checkout --quiet "$ATUAL_REF"
    env_set CRM_VERSION "$ATUAL_TAG"
    dc up -d --remove-orphans
    aguardar_saude "$ATUAL_TAG" && aviso "Versão $ATUAL_TAG restaurada. Se a falha foi em migration, veja docs/DEPLOY.md (restaurar backup)."
  fi
  exit 1
}
trap voltar ERR

obter_imagens

info "Subindo o banco"
dc up -d --wait db

info "Aplicando migrations"
dc run --rm --no-deps api prisma migrate deploy

info "Subindo a aplicação"
dc up -d --remove-orphans --wait

aguardar_saude "$VERSAO"
trap - ERR

registrar "deploy" "$VERSAO"
docker image prune -f --filter "label=com.docker.compose.project=usaparts-crm" >/dev/null 2>&1 || true
ok "Versão $VERSAO no ar."
