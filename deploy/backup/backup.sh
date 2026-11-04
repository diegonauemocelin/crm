#!/bin/sh
# Gera um backup criptografado do banco e dos arquivos enviados (logos, fotos).
# A criptografia usa a CHAVE PÚBLICA age (BACKUP_AGE_RECIPIENT): quem tem acesso ao servidor
# não consegue abrir os backups. A chave privada fica guardada fora da VPS.
set -eu

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT não definido}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
# Cada atualização também faz um backup: guarda no máximo estas cópias (as mais recentes), além do limite de dias.
KEEP="${BACKUP_KEEP:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST=/backups
TMP="$DEST/.parcial-$STAMP"

umask 077
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

echo "[backup] $(date -Iseconds) iniciando"
# Compressão 1: bem mais rápida que a 9 e o arquivo fica só um pouco maior.
pg_dump --format=custom --compress=1 --no-owner | age -r "$BACKUP_AGE_RECIPIENT" -o "$TMP/crm-db-$STAMP.dump.age"
# Atualização (BACKUP_SO_BANCO=1): os arquivos enviados só entram se não houver cópia deles das últimas 24 h.
recente="$(find "$DEST" -maxdepth 1 -type f -name 'crm-uploads-*' -mmin -1440 2>/dev/null | head -1)"
if [ "${BACKUP_SO_BANCO:-0}" = "1" ] && [ -n "$recente" ]; then
  echo "[backup] arquivos enviados: já copiados nas últimas 24 h ($(basename "$recente")), só o banco agora"
elif [ -d /data/uploads ]; then
  # Falha nos arquivos não invalida o backup do banco, que é o mais importante.
  # Planilhas de importação em andamento ficam de fora: são temporárias, só a API pode lê-las e são apagadas ao terminar.
  # Sem gzip: fotos, áudios, vídeos e PDFs já vêm comprimidos (comprimir de novo só gasta tempo).
  tar -C /data --exclude=importacoes -c uploads | age -r "$BACKUP_AGE_RECIPIENT" -o "$TMP/crm-uploads-$STAMP.tar.age" \
    || { echo "[backup] AVISO: falha ao copiar os arquivos enviados" >&2; rm -f "$TMP/crm-uploads-$STAMP.tar.age"; }
fi

( cd "$TMP" && sha256sum ./*.age > "crm-$STAMP.sha256" )
mv "$TMP"/* "$DEST"/
echo "[backup] $(date -Iseconds) concluído: $(ls -1 "$DEST" | grep -c "$STAMP") arquivo(s) em $DEST"

# Retenção: apaga apenas arquivos de backup deste sistema mais antigos que N dias.
find "$DEST" -maxdepth 1 -type f \( -name 'crm-*.age' -o -name 'crm-*.sha256' \) -mtime "+$RETENTION" -print -delete
# Limite de cópias: apaga os conjuntos (banco e conferência) além das KEEP mais recentes. A cópia dos arquivos enviados
# do conjunto só sai se não for uma das 2 mais recentes (as atualizações podem guardar só o banco).
manter="$(ls -1t "$DEST"/crm-uploads-*.age 2>/dev/null | head -2)"
ls -1t "$DEST"/crm-*.sha256 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r f; do
  s="$(basename "$f" .sha256)"
  s="${s#crm-}"
  echo "[backup] apagando cópia antiga $s"
  rm -f -- "$DEST/crm-db-$s.dump.age" "$f"
  for u in "$DEST/crm-uploads-$s.tar.gz.age" "$DEST/crm-uploads-$s.tar.age"; do
    if [ -f "$u" ] && ! echo "$manter" | grep -qxF "$u"; then rm -f -- "$u"; fi
  done
done
# A limpeza não decide o resultado: o backup já foi gravado acima.
exit 0
