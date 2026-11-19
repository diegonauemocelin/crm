/**
 * Correção do Baileys dentro da Evolution (roda a cada vez que o contêiner sobe, antes da Evolution).
 *
 * O problema: desde o fim de setembro de 2026 o WhatsApp manda avisos de Status ("<status>") que o Baileys
 * 7.0.0-rc.9 (da Evolution v2.3.7) não confirma. Uns 50 minutos depois o WhatsApp fecha a conexão ("stream errored
 * out", ack class="status"); na volta manda o mesmo aviso, sem confirmação de novo, e o número fica "conectado" mas
 * sem receber mensagens. Reiniciar não resolve; só um QR Code novo, e por pouco tempo.
 * Relatos: evolution-foundation/evolution-api#2778 e WhiskeySockets/Baileys#2858.
 *
 * O que faz (só se ainda não tiver sido feito, e só se achar o trecho esperado):
 * 1. confirma (ack) os avisos de Status, como o WhatsApp espera (a Evolution não usa Status: readStatus=false);
 * 2. na fila de mensagens que chegaram com o aparelho desconectado, um erro numa delas não trava as demais.
 * Se a Evolution for atualizada e o trecho mudar, não mexe em nada e só avisa no log.
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const candidates = [
  '/evolution/node_modules/baileys/lib/Socket/messages-recv.js',
  path.join(process.cwd(), 'node_modules/baileys/lib/Socket/messages-recv.js'),
]
const file = candidates.find((f) => fs.existsSync(f))
const log = (msg) => console.log(`[crm-patch] ${msg}`)

if (!file) {
  log('Baileys não encontrado; nada alterado.')
  process.exit(0)
}

let src = fs.readFileSync(file, 'utf8')
let changed = false

// 1. Confirma os avisos de Status.
if (src.includes("'CB:status'")) log('Confirmação dos avisos de Status: já presente.')
else {
  const anchor = "    ws.on('CB:notification', async (node) => {"
  if (!src.includes(anchor)) log('Confirmação dos avisos de Status: trecho esperado não encontrado (outra versão do Baileys); nada alterado.')
  else {
    const fix =
      "    // [crm-patch] Confirma os avisos de Status (sem isso o WhatsApp fecha a conexão e o número para de receber).\n" +
      "    ws.on('CB:status', (node) => {\n" +
      "        sendMessageAck(node).catch(error => onUnexpectedError(error, 'acking status stanza'));\n" +
      '    });\n'
    src = src.replace(anchor, fix + anchor)
    changed = true
    log('Confirmação dos avisos de Status: aplicada.')
  }
}

// 2. Fila das mensagens recebidas com o aparelho desconectado: um erro não trava o resto.
const offline = '                    await nodeProcessor(node);\n'
if (src.includes('[crm-patch] fila')) log('Fila de mensagens pendentes: já protegida.')
else if (!src.includes(offline)) log('Fila de mensagens pendentes: trecho esperado não encontrado; nada alterado.')
else {
  src = src.replace(
    offline,
    '                    // [crm-patch] fila: um erro numa mensagem não trava as seguintes.\n' +
      '                    try {\n' +
      '                        await nodeProcessor(node);\n' +
      '                    }\n' +
      '                    catch (error) {\n' +
      "                        onUnexpectedError(error, 'processing offline node');\n" +
      '                    }\n',
  )
  changed = true
  log('Fila de mensagens pendentes: protegida.')
}

if (changed) fs.writeFileSync(file, src)
