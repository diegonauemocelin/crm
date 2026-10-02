#!/usr/bin/env bash
# Restaura um backup do banco (e, se houver, dos arquivos enviados).
#   sudo bash deploy/restaurar.sh backups/crm-db-20261002-030000.dump.age /caminho/chave-privada-age.txt
#
# A chave PRIVADA age não fica no servidor: copie temporariamente para a VPS e apague após o uso.
# Para testar a restauração sem afetar produção, use --teste: restaura num banco separado "crm_teste_restauracao",
# confere as tabelas e apaga o banco de teste ao final.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$RAIZ"

TESTE=0
if [ "${1:-}" = "--teste" ]; then TESTE=1; shift; fi
ARQUIVO="${1:?Informe o arquivo .dump.age}"
CHAVE="${2:?Informe o arquivo da chave privada age}"
[ -f "$ARQUIVO" ] || fatal "Arquivo $ARQUIVO não encontrado."
[ -f "$CHAVE" ] || fatal "Chave $CHAVE não encontrada."

DIR="$(dirname "$ARQUIVO")"
STAMP="$(basename "$ARQUIVO" | sed -E 's/^crm-db-([0-9-]+)\.dump\.age$/\1/')"
if [ -f "$DIR/crm-$STAMP.sha256" ]; then
  info "Conferindo integridade (sha256)"
  (cd "$DIR" && grep "crm-db-$STAMP" "crm-$STAMP.sha256" | sha256sum -c -) || fatal "Checksum não confere. Arquivo corrompido."
fi

BANCO=crm
if [ "$TESTE" -eq 1 ]; then
  BANCO=crm_teste_restauracao
  info "Modo teste: restaurando no banco separado $BANCO"
  dc exec -T db psql -U crm -d crm -c "DROP DATABASE IF EXISTS $BANCO" -c "CREATE DATABASE $BANCO"
else
  aviso "Isto SUBSTITUI todos os dados atuais do CRM pelos do backup $STAMP."
  read -r -p "Digite RESTAURAR para confirmar: " RESP
  [ "$RESP" = "RESTAURAR" ] || fatal "Cancelado."
  info "Backup de segurança do estado atual antes de restaurar"
  dc run --rm --no-deps backup /usr/local/bin/backup.sh
  info "Parando a API"
  dc stop api web
fi

info "Restaurando"
docker run --rm -i -v "$(realpath "$CHAVE")":/chave:ro alpine:3 sh -c "apk add --no-cache age >/dev/null && age -d -i /chave" < "$ARQUIVO" \
  | dc exec -T db pg_restore -U crm -d "$BANCO" --clean --if-exists --no-owner --exit-on-error

if [ "$TESTE" -eq 1 ]; then
  info "Conferindo dados restaurados"
  dc exec -T db psql -U crm -d "$BANCO" -c "SELECT (SELECT count(*) FROM users) AS usuarios, (SELECT count(*) FROM roles) AS perfis, (SELECT count(*) FROM audit_logs) AS auditoria, (SELECT max(version) FROM system_releases) AS versao"
  dc exec -T db psql -U crm -d crm -c "DROP DATABASE $BANCO"
  ok "Teste de restauração concluído com sucesso. Banco de teste removido."
  exit 0
fi

UPLOADS="$DIR/crm-uploads-$STAMP.tar.gz.age"
if [ -f "$UPLOADS" ]; then
  info "Restaurando arquivos enviados"
  docker run --rm -i -v "$(realpath "$CHAVE")":/chave:ro alpine:3 sh -c "apk add --no-cache age >/dev/null && age -d -i /chave" < "$UPLOADS" \
    | docker run --rm -i -v usaparts-crm_uploads:/data/uploads alpine:3 sh -c "rm -rf /data/uploads/* && tar -C /data -xz && chown -R 1000:1000 /data/uploads"
fi

dc up -d --wait
aguardar_saude
ok "Restauração concluída."
aviso "Apague a chave privada desta VPS: shred -u $CHAVE"
