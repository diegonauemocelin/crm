#!/usr/bin/env bash
# Executa um backup imediato (além do diário automático).
#   sudo bash deploy/backup-agora.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$RAIZ"
info "Gerando backup criptografado"
dc run --rm --no-deps backup /usr/local/bin/backup.sh
DIR="$(env_get BACKUP_DIR)"
DIR="${DIR:-./backups}"
# Mostra os arquivos do backup que acabou de ser feito (banco, arquivos enviados e conferência), do mais novo para o mais antigo.
info "Arquivos do backup mais recente"
ls -lht "$DIR"/crm-* 2>/dev/null | head -3
