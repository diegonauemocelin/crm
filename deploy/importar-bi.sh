#!/usr/bin/env bash
# Traz o Usaparts BI inteiro para dentro do banco do CRM (esquema "bi"), sem alterar nada no BI e com os dois no ar.
#   sudo bash deploy/importar-bi.sh                     -> BI instalado em /opt/usaparts-bi
#   sudo bash deploy/importar-bi.sh --bi /outra/pasta
#   sudo bash deploy/importar-bi.sh --empresa <id>      -> só se o CRM tiver mais de uma empresa
#
# Passos:
#   1. backup do CRM (o de sempre, criptografado);
#   2. cópia criptografada do banco e dos arquivos do BI na pasta de backups do CRM (bi-db-*.dump.age e
#      bi-arquivos-*.tar.gz.age). Ficam guardadas: a limpeza automática dos backups só apaga os crm-*;
#   3. o banco do BI vai para um banco temporário no PostgreSQL do CRM, o esquema vira "bi" e entra no banco do CRM
#      (trocando a cópia anterior, se houver, de uma vez só); o banco temporário é apagado;
#   4. marca a empresa dona da cópia. Em até 30 minutos (ou pelo botão em Marketplaces › Conexões) o histórico do
#      Mercado Livre entra nas telas de Marketplaces; o resto aparece em Marketplaces › Histórico do BI.
# Pode rodar de novo quando quiser (ex.: antes de desligar o BI): troca a cópia pela mais nova, sem duplicar nada.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
exigir_root
cd "$RAIZ"

BI_DIR=/opt/usaparts-bi
EMPRESA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bi) BI_DIR="${2:?Informe a pasta do BI}"; shift 2 ;;
    --empresa) EMPRESA="${2:?Informe o id da empresa}"; shift 2 ;;
    *) fatal "Opção desconhecida: $1" ;;
  esac
done

[ -f .env ] || fatal "Rode no CRM instalado (não encontrei o .env em $RAIZ)."
{ [ -f "$BI_DIR/docker-compose.yml" ] && [ -f "$BI_DIR/.env" ]; } || fatal "Não encontrei o Usaparts BI em $BI_DIR (docker-compose.yml e .env). Use --bi /pasta/do/bi."
bi() { docker compose --project-directory "$BI_DIR" -f "$BI_DIR/docker-compose.yml" "$@"; }
bi ps --status running --services 2>/dev/null | grep -qx db || fatal "O banco do BI não está rodando (cd $BI_DIR && sudo docker compose up -d db). Nada foi alterado."
dc ps --status running --services 2>/dev/null | grep -qx db || fatal "O banco do CRM não está rodando. Nada foi alterado."

psql_crm() { dc exec -T db psql -U crm -v ON_ERROR_STOP=1 -qtA "$@"; }

if [ -z "$EMPRESA" ]; then
  N="$(psql_crm -d crm -c 'SELECT count(*) FROM tenants')"
  [ "$N" = "1" ] || fatal "O CRM tem $N empresas. Diga qual recebe o BI com --empresa <id> (lista: sudo docker compose exec db psql -U crm -d crm -c 'SELECT id, name FROM tenants')."
  EMPRESA="$(psql_crm -d crm -c 'SELECT id FROM tenants')"
fi
[[ "$EMPRESA" =~ ^[0-9a-f-]{36}$ ]] || fatal "Id de empresa inválido: $EMPRESA"
psql_crm -d crm -c "SELECT 1 FROM tenants WHERE id = '$EMPRESA'" | grep -qx 1 || fatal "A empresa $EMPRESA não existe no CRM."

CHAVE="$(env_get BACKUP_AGE_RECIPIENT)"
[[ "$CHAVE" == age1* ]] || fatal "BACKUP_AGE_RECIPIENT não está no .env do CRM (é a chave pública dos backups)."
DESTINO="$(env_get BACKUP_DIR)"
DESTINO="${DESTINO:-./backups}"
[[ "$DESTINO" == /* ]] || DESTINO="$RAIZ/${DESTINO#./}"
mkdir -p "$DESTINO"
STAMP="$(date +%Y%m%d-%H%M%S)"
VERSAO_BI="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$BI_DIR/package.json" 2>/dev/null || true)"
[[ "$VERSAO_BI" =~ ^[0-9.]*$ ]] || VERSAO_BI=""
# Nada sem criptografia vai para o disco: a cópia passa direto pelo age do container de backup.
cifrar() { dc run --rm -T --no-deps --entrypoint age backup -r "$CHAVE"; }
TMPDB=bi_importacao

info "1/4 Backup do CRM antes de mexer"
dc run --rm --no-deps backup /usr/local/bin/backup.sh || fatal "O backup do CRM falhou. Nada foi alterado."

info "2/4 Cópia criptografada do BI em $DESTINO"
umask 077
bi exec -T db pg_dump -U usaparts -d usaparts_bi -Fc --no-owner --no-acl | cifrar > "$DESTINO/bi-db-$STAMP.dump.age"
[ -s "$DESTINO/bi-db-$STAMP.dump.age" ] || fatal "A cópia do banco do BI ficou vazia. Nada foi alterado no CRM."
ok "Banco do BI: bi-db-$STAMP.dump.age"
if bi ps --status running --services 2>/dev/null | grep -qx app; then
  if bi exec -T app tar -C /app/storage -cz uploads | cifrar > "$DESTINO/bi-arquivos-$STAMP.tar.gz.age"; then
    ok "Planilhas e logos enviadas ao BI: bi-arquivos-$STAMP.tar.gz.age"
  else
    rm -f "$DESTINO/bi-arquivos-$STAMP.tar.gz.age"
    aviso "Não consegui copiar os arquivos enviados ao BI (planilhas e logo). O banco foi copiado; rode de novo com o BI no ar para levar os arquivos."
  fi
else
  aviso "O sistema do BI está parado: copiei só o banco (os arquivos enviados ficam no volume usaparts-bi_uploads)."
fi

info "3/4 Banco do BI para dentro do CRM (esquema bi)"
psql_crm -d crm -c "DROP DATABASE IF EXISTS $TMPDB" -c "CREATE DATABASE $TMPDB"
limpar() { psql_crm -d crm -c "DROP DATABASE IF EXISTS $TMPDB" >/dev/null 2>&1 || true; }
trap limpar EXIT
bi exec -T db pg_dump -U usaparts -d usaparts_bi -Fc --no-owner --no-acl | dc exec -T db pg_restore -U crm -d "$TMPDB" --no-owner --no-acl --exit-on-error
psql_crm -d "$TMPDB" \
  -c "ALTER SCHEMA public RENAME TO bi_novo" \
  -c "CREATE TABLE bi_novo._crm_importacao (tenant_id uuid NOT NULL, importado_em timestamptz NOT NULL DEFAULT now(), versao_bi text)" \
  -c "INSERT INTO bi_novo._crm_importacao (tenant_id, versao_bi) VALUES ('$EMPRESA', NULLIF('$VERSAO_BI', ''))"
psql_crm -d crm -c "DROP SCHEMA IF EXISTS bi_novo CASCADE"
dc exec -T db pg_dump -U crm -d "$TMPDB" -Fc -n bi_novo --no-owner --no-acl | dc exec -T db pg_restore -U crm -d crm --no-owner --no-acl --exit-on-error
# Troca de uma vez: quem estiver olhando o histórico vê a cópia antiga ou a nova, nunca pela metade.
psql_crm -d crm -1 -c "DROP SCHEMA IF EXISTS bi CASCADE" -c "ALTER SCHEMA bi_novo RENAME TO bi"
TABELAS="$(psql_crm -d crm -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'bi'")"
ok "Esquema bi no banco do CRM: $TABELAS tabelas"

info "4/4 Conferência"
contar() { psql_crm -d crm -c "SELECT count(*) FROM bi.\"$1\"" 2>/dev/null || echo "?"; }
echo "  Leads das planilhas: $(contar Lead)"
echo "  Investimentos: $(contar AdSpend)"
echo "  Mercado Livre: $(contar MlCampaign) campanhas, $(contar MlCampaignDaily) dias de Product Ads, $(contar MlDisplayDaily) dias de Display"
echo "  Google Ads: $(contar GadsCampaignDaily) dias de campanhas"
echo
ok "Pronto. O BI continua no ar, sem nenhuma alteração."
echo "  O histórico do Mercado Livre entra em Marketplaces em até 30 minutos (ou em Marketplaces › Conexões › 'Trazer o Mercado Livre do BI de novo')."
echo "  Leads, investimentos, Google Ads e as demais tabelas: Marketplaces › Histórico do BI (perfil com a permissão 'Histórico do Usaparts BI')."
echo "  Guarde as cópias bi-*-$STAMP.age: abrem com a mesma chave privada dos backups do CRM."
registrar "importar-bi" "$STAMP"
