#!/usr/bin/env bash
# Executa um backup imediato (além do diário automático).
#   sudo bash deploy/backup-agora.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$RAIZ"
info "Gerando backup criptografado"
dc run --rm --no-deps backup /usr/local/bin/backup.sh
ls -lh "$(env_get BACKUP_DIR || echo ./backups)" | tail -5
