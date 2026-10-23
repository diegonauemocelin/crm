#!/usr/bin/env bash
# Traz o painel antigo (painel.usaparts.com.br, Usaparts Assistente) para dentro do CRM, sem alterar nada no painel.
#   sudo bash deploy/importar-painel.sh                         -> painel instalado em /opt/usaparts-assistente
#   sudo bash deploy/importar-painel.sh --painel /outra/pasta
#   sudo bash deploy/importar-painel.sh --empresa <id>          -> só se o CRM tiver mais de uma empresa
#
# Passos:
#   1. backup do CRM (o de sempre, criptografado);
#   2. cópia criptografada da pasta de dados e do .env do painel na pasta de backups do CRM
#      (painel-dados-*.tar.gz.age). Fica guardada: a limpeza automática dos backups só apaga os crm-*;
#   3. cópia consistente do banco SQLite (o painel continua no ar) e importação para Marketplaces › Assistente:
#      perguntas, respostas, base de conhecimento, aplicações, anúncios, vendas, configurações e chaves de IA. As chaves
#      e o acesso ao Mercado Livre saem do .env do painel pela entrada padrão do importador, nunca em arquivo;
#   4. conferência.
# O CRM NÃO responde nada sozinho depois da importação: o painel segue respondendo até alguém clicar em
# "Assumir o atendimento" em Marketplaces › Assistente › Integração. Pode rodar de novo quantas vezes quiser antes
# disso (troca os dados pelos mais novos, sem duplicar). Depois de assumir, o importador se recusa a rodar.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
exigir_root
cd "$RAIZ"

PAINEL_DIR=/opt/usaparts-assistente
EMPRESA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --painel) PAINEL_DIR="${2:?Informe a pasta do painel}"; shift 2 ;;
    --empresa) EMPRESA="${2:?Informe o id da empresa}"; shift 2 ;;
    *) fatal "Opção desconhecida: $1" ;;
  esac
done

[ -f .env ] || fatal "Rode no CRM instalado (não encontrei o .env em $RAIZ)."
[ -f "$PAINEL_DIR/.env" ] || fatal "Não encontrei o painel em $PAINEL_DIR (.env). Use --painel /pasta/do/painel."
command -v python3 >/dev/null || fatal "Preciso do python3 para ler o .env do painel."
# Mesma regra do painel (server/config.js): DATA_DIR relativo à pasta do painel, padrão ./data.
DATA_DIR="$(python3 - "$PAINEL_DIR" <<'PY'
import os, sys
root = sys.argv[1]
val = ''
for line in open(os.path.join(root, '.env'), encoding='utf-8'):
    line = line.strip()
    if line.startswith('DATA_DIR='):
        val = line.split('=', 1)[1].strip().strip('"').strip("'")
print(os.path.normpath(os.path.join(root, val or './data')))
PY
)"
DB="$DATA_DIR/usaparts.db"
[ -f "$DB" ] || fatal "Não encontrei o banco do painel em $DB."
dc ps --status running --services 2>/dev/null | grep -qx db || fatal "O banco do CRM não está rodando. Nada foi alterado."

psql_crm() { dc exec -T db psql -U crm -v ON_ERROR_STOP=1 -qtA "$@"; }
if [ -z "$EMPRESA" ]; then
  N="$(psql_crm -d crm -c 'SELECT count(*) FROM tenants')"
  [ "$N" = "1" ] || fatal "O CRM tem $N empresas. Diga qual recebe o painel com --empresa <id> (lista: sudo docker compose exec db psql -U crm -d crm -c 'SELECT id, name FROM tenants')."
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
cifrar() { dc run --rm -T --no-deps --entrypoint age backup -r "$CHAVE"; }

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info "1/4 Backup do CRM antes de mexer"
dc run --rm --no-deps backup /usr/local/bin/backup.sh || fatal "O backup do CRM falhou. Nada foi alterado."

info "2/4 Cópia criptografada do painel em $DESTINO"
tar -C "$PAINEL_DIR" -cz .env "$(realpath --relative-to="$PAINEL_DIR" "$DATA_DIR")" | cifrar > "$DESTINO/painel-dados-$STAMP.tar.gz.age"
[ -s "$DESTINO/painel-dados-$STAMP.tar.gz.age" ] || fatal "A cópia do painel ficou vazia. Nada foi alterado no CRM."
ok "Dados e .env do painel: painel-dados-$STAMP.tar.gz.age"

info "3/4 Banco do painel para dentro do CRM"
# Cópia consistente com o painel no ar (o SQLite trava só o necessário); o importador lê a cópia, nunca o original.
if command -v sqlite3 >/dev/null; then
  sqlite3 "$DB" ".backup '$TMP/painel.db'"
  sqlite3 "$TMP/painel.db" "PRAGMA journal_mode=DELETE;" >/dev/null
else
  node -e "const{DatabaseSync}=require('node:sqlite');new DatabaseSync(process.argv[1],{readOnly:true}).exec(\"VACUUM INTO '\"+process.argv[2]+\"'\")" "$DB" "$TMP/painel.db"
fi
chmod 644 "$TMP/painel.db"
chmod 711 "$TMP"
VERSAO="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$PAINEL_DIR/package.json" 2>/dev/null || true)"
# Segredos do .env do painel em JSON, direto na entrada do importador.
python3 - "$PAINEL_DIR/.env" "$VERSAO" <<'PY' | dc run --rm -T --no-deps -v "$TMP/painel.db:/painel/painel.db:ro" api node dist/assistente/importar-painel.js /painel/painel.db "$EMPRESA" > "$TMP/resumo.json"
import json, sys
env = {}
for line in open(sys.argv[1], encoding='utf-8'):
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    k, v = line.split('=', 1)
    k = k.strip()
    if k.startswith('export '):
        k = k[7:].strip()
    v = v.strip()
    # Como o Node lê o .env do painel: valor entre aspas fica como está; sem aspas, o " #" começa um comentário.
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        v = v[1:-1]
    else:
        v = v.split(' #', 1)[0].strip()
    env[k] = v
print(json.dumps({
    'encryptionKey': env.get('APP_ENCRYPTION_KEY', ''),
    'mlClientId': env.get('ML_CLIENT_ID', ''),
    'mlClientSecret': env.get('ML_CLIENT_SECRET', ''),
    'anthropicKey': env.get('ANTHROPIC_API_KEY', ''),
    'geminiKey': env.get('GEMINI_API_KEY', ''),
    'version': sys.argv[2],
}))
PY
ok "Importação concluída"

info "4/4 Conferência"
cat "$TMP/resumo.json"
echo
ok "Pronto. O painel continua no ar e respondendo, sem nenhuma alteração."
echo "  Confira em Marketplaces › Assistente. Para o CRM passar a responder: Marketplaces › Assistente › Integração ›"
echo "  'Assumir o atendimento' (veja docs/DEPLOY.md, seção do assistente) e depois pare o painel:"
echo "    sudo systemctl disable --now usaparts.service"
echo "  Guarde a cópia painel-dados-$STAMP.tar.gz.age: abre com a mesma chave privada dos backups do CRM."
registrar "importar-painel" "$STAMP"
