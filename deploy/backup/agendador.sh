#!/bin/sh
# Roda o backup uma vez por dia no horário BACKUP_HOUR (fuso America/Sao_Paulo), sem depender do cron do servidor.
set -eu
HOUR="${BACKUP_HOUR:-3}"
echo "[agendador] backup diário às ${HOUR}h"

while true; do
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) ${HOUR}:00:00" +%s 2>/dev/null || date -D '%Y-%m-%d %H:%M:%S' -d "$(date +%Y-%m-%d) ${HOUR}:00:00" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  /usr/local/bin/backup.sh || echo "[agendador] ERRO: backup falhou em $(date -Iseconds)" >&2
done
