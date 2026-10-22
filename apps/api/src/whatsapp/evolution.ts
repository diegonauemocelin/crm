/**
 * Cliente da Evolution API (v2), que fica só na rede interna do Docker. O CRM é o único que fala com ela,
 * pela chave do .env (EVOLUTION_API_KEY). Nada aqui sai para a internet.
 */

export type EvolutionState = 'open' | 'connecting' | 'close'
export type NumberStatus = 'CONECTADO' | 'CONECTANDO' | 'DESCONECTADO'

/** Eventos que a Evolution manda para o CRM em cada instância. */
export const WEBHOOK_EVENTS = ['CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_EDITED', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'CALL']

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

export interface EvolutionConfig {
  url: string
  apiKey: string
}

export function statusOf(state: string | null | undefined): NumberStatus {
  return state === 'open' ? 'CONECTADO' : state === 'connecting' ? 'CONECTANDO' : 'DESCONECTADO'
}

/** Número do WhatsApp que conectou, a partir do "ownerJid" (5549999990000@s.whatsapp.net). */
export function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== 'string') return null
  const m = /^(\d{10,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid)
  return m ? `+${m[1]}` : null
}

/** QR Code devolvido pela Evolution: só aceita imagem PNG em base64 (vai direto para um <img>). */
export function cleanQr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 200_000 ? v : null
}

/** "Connection Closed": a sessão do número caiu dentro do serviço de WhatsApp (o estado ainda pode dizer "conectado"). */
export function isConnectionClosed(message: string) {
  return /connection closed|connection lost|not connected|socket.*clos/i.test(message)
}

export const CONNECTION_CLOSED_MESSAGE =
  'O WhatsApp deste número perdeu a conexão com o servidor (Connection Closed). O CRM tentou reconectar sozinho e não conseguiu: em Configurações › Números de WhatsApp, clique em Conectar neste número, leia o QR Code de novo e reenvie.'

/** Motivo gravado no número quando a sessão morre por dentro da Evolution (ela ainda diz "conectado"). */
export const SESSION_DEAD_REASON = 'A sessão caiu no serviço de WhatsApp (Connection Closed). Clique em Conectar e leia o QR Code.'

/** Resposta da conferência de números: tem WhatsApp e o identificador que o WhatsApp usa (ex.: celular antigo sem o 9). */
export interface NumberCheck {
  number: string
  exists: boolean
  jid: string | null
}

export function parseNumberChecks(data: unknown): NumberCheck[] {
  const raw = data as { response?: unknown } | null
  const list = Array.isArray(data) ? data : Array.isArray(raw?.response) ? raw.response : []
  return list.flatMap((x): NumberCheck[] => {
    if (!x || typeof x !== 'object') return []
    const r = x as Record<string, unknown>
    const jid = typeof r.jid === 'string' && /^\d{8,15}@s\.whatsapp\.net$/.test(r.jid) ? r.jid : null
    const number = typeof r.number === 'string' ? r.number.replace(/\D/g, '') : (jid?.split('@')[0] ?? '')
    return [{ number, exists: r.exists === true, jid }]
  })
}

export class EvolutionClient {
  constructor(
    private readonly cfg: EvolutionConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Espera entre reiniciar a conexão do número e tentar o envio de novo. */
    private readonly retryDelayMs = 5_000,
  ) {}

  /** Avisado quando um envio falha duas vezes com "Connection Closed" (a sessão do número morreu). */
  onSessionDead: ((instanceName: string) => void) | null = null

  /** Reinicia a conexão do número no serviço de WhatsApp (sem pedir QR Code se a sessão ainda vale). */
  restart(instanceName: string) {
    return this.call('POST', `/instance/restart/${encodeURIComponent(instanceName)}`, undefined, 20_000)
  }

  /**
   * Envio com uma segunda chance: se a sessão caiu ("Connection Closed"), reinicia a conexão do número, espera
   * alguns segundos e tenta de novo uma vez. Caindo de novo, devolve a explicação do que fazer.
   */
  private async send<T>(instanceName: string, path: string, body: unknown, timeoutMs: number, method = 'POST'): Promise<T> {
    try {
      return await this.call<T>(method, path, body, timeoutMs)
    } catch (err) {
      if (!(err instanceof EvolutionError) || !isConnectionClosed(err.message)) throw err
      await this.restart(instanceName).catch(() => undefined)
      await new Promise((r) => setTimeout(r, this.retryDelayMs))
      try {
        return await this.call<T>(method, path, body, timeoutMs)
      } catch (again) {
        if (again instanceof EvolutionError && isConnectionClosed(again.message)) {
          this.onSessionDead?.(instanceName)
          throw new EvolutionError(CONNECTION_CLOSED_MESSAGE, again.status)
        }
        throw again
      }
    }
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.cfg.url}${path}`, {
        method,
        headers: { apikey: this.cfg.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      })
    } catch {
      throw new EvolutionError('O serviço de WhatsApp não respondeu. Ele está ativo no servidor (deploy/whatsapp.sh status)?', null)
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      const raw = data?.response ?? data?.message ?? data?.error
      const msg = Array.isArray((raw as { message?: unknown })?.message) ? ((raw as { message: unknown[] }).message.join('; ')) : typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
      throw new EvolutionError(`O serviço de WhatsApp recusou (${res.status}): ${String(msg).slice(0, 200)}`, res.status)
    }
    return data as T
  }

  /** Versão e saúde do serviço. */
  async health() {
    const r = await this.call<{ version?: string; message?: string }>('GET', '/', undefined, 5_000)
    return { version: typeof r?.version === 'string' ? r.version : null }
  }

  /** Cria a instância já com o endereço de eventos do CRM (com o segredo no caminho). */
  createInstance(instanceName: string, webhookUrl: string) {
    return this.call('POST', '/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: false,
      // Não guarda conversas na Evolution: o CRM é quem guarda (e aplica as regras de LGPD).
      rejectCall: false,
      // Grupos chegam e ficam na aba Grupos do chat (sem lead nem pré-venda).
      groupsIgnore: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      webhook: { url: webhookUrl, byEvents: false, base64: false, events: WEBHOOK_EVENTS },
    })
  }

  /** Pede o QR Code (inicia a conexão). */
  async connect(instanceName: string) {
    const r = await this.call<{ base64?: string; code?: string; pairingCode?: string | null; instance?: { state?: string } }>('GET', `/instance/connect/${encodeURIComponent(instanceName)}`)
    return { qr: cleanQr(r?.base64), state: r?.instance?.state ?? null }
  }

  async state(instanceName: string): Promise<EvolutionState | null> {
    const r = await this.call<{ instance?: { state?: string } }>('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`, undefined, 8_000)
    const s = r?.instance?.state
    return s === 'open' || s === 'connecting' || s === 'close' ? s : null
  }

  /** Número e nome do perfil que conectou. */
  async info(instanceName: string) {
    const r = await this.call<{ ownerJid?: string; profileName?: string }[]>('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`, undefined, 8_000)
    const i = Array.isArray(r) ? r[0] : null
    return { phone: phoneFromJid(i?.ownerJid), profileName: typeof i?.profileName === 'string' ? i.profileName.slice(0, 120) : null }
  }

  /** Desconecta o aparelho (para voltar, precisa ler o QR Code de novo). */
  async logout(instanceName: string) {
    await this.call('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`).catch((err: unknown) => {
      // Já desconectada: tudo certo.
      if (!(err instanceof EvolutionError && (err.status === 400 || err.status === 404))) throw err
    })
  }

  /**
   * A Evolution 2.3.x pode dizer "open" com a sessão já morta por dentro: só um pedido que usa a conexão revela.
   * Confere o próprio número do aparelho. true = viva, false = Connection Closed, null = não deu para saber.
   */
  async alive(instanceName: string, phone: string | null): Promise<boolean | null> {
    const digits = phone?.replace(/\D/g, '') ?? ''
    if (digits.length < 10) return null
    try {
      await this.checkNumbers(instanceName, [digits])
      return true
    } catch (err) {
      return err instanceof EvolutionError && isConnectionClosed(err.message) ? false : null
    }
  }

  /** Atualiza o endereço e os eventos de uma instância já criada (ex.: depois de uma atualização do CRM). */
  setWebhook(instanceName: string, webhookUrl: string) {
    return this.call('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: WEBHOOK_EVENTS },
    })
  }

  /** Ajustes da instância (as já criadas recebem de novo depois de uma atualização do CRM: ex. passar a receber grupos). */
  setSettings(instanceName: string) {
    return this.call('POST', `/settings/set/${encodeURIComponent(instanceName)}`, {
      rejectCall: false,
      groupsIgnore: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    })
  }

  /** Nome (assunto) de um grupo. */
  async groupSubject(instanceName: string, groupJid: string) {
    const r = await this.call<{ subject?: unknown }>('GET', `/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`, undefined, 8_000)
    return typeof r?.subject === 'string' && r.subject.trim() ? r.subject.trim().slice(0, 120) : null
  }

  /** Baixa a mídia de uma mensagem (a Evolution não guarda as mensagens: vai a mensagem inteira). */
  async media(instanceName: string, raw: { key: unknown; message: unknown }) {
    const r = await this.call<{ base64?: string; mimetype?: string }>('POST', `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, { message: raw, convertToMp4: false }, 180_000)
    return typeof r?.base64 === 'string' ? { base64: r.base64, mime: typeof r.mimetype === 'string' ? r.mimetype : null } : null
  }

  /** Resposta dos envios: id da mensagem no WhatsApp e o contato como o WhatsApp registrou. */
  private sent(r: { key?: { id?: unknown; remoteJid?: unknown }; messageTimestamp?: unknown } | null) {
    const id = typeof r?.key?.id === 'string' ? r.key.id : null
    if (!id) throw new EvolutionError('O serviço de WhatsApp não confirmou o envio.', null)
    const ts = Number(r?.messageTimestamp)
    return { waId: id, remoteJid: typeof r?.key?.remoteJid === 'string' ? r.key.remoteJid : null, at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date() }
  }

  /** Contatos que o WhatsApp do número conhece (agenda sincronizada e quem já conversou). */
  async contacts(instanceName: string) {
    // A resposta pode ser a lista solta ou um objeto com a lista dentro (varia com a versão): quem lê é contactsFromWhatsapp.
    return this.call<unknown>('POST', `/chat/findContacts/${encodeURIComponent(instanceName)}`, { where: {} }, 60_000)
  }

  /** Confere se os telefones (só dígitos, com o código do país) têm WhatsApp. */
  async checkNumbers(instanceName: string, numbers: string[]) {
    return parseNumberChecks(await this.call<unknown>('POST', `/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, { numbers }, 20_000))
  }

  /** Texto; com quoted, sai como resposta (citação) a uma mensagem da conversa. */
  async sendText(instanceName: string, number: string, text: string, quoted?: { waId: string; fromMe: boolean; remoteJid: string; text: string }) {
    const q = quoted ? { quoted: { key: { id: quoted.waId, fromMe: quoted.fromMe, remoteJid: quoted.remoteJid }, message: { conversation: quoted.text } } } : {}
    return this.sent(await this.send(instanceName, `/message/sendText/${encodeURIComponent(instanceName)}`, { number, text, ...q }, 30_000))
  }

  /** Corrige o texto de uma mensagem enviada (o WhatsApp aceita até 15 minutos depois do envio). */
  async editText(instanceName: string, key: { id: string; remoteJid: string }, text: string) {
    const number = key.remoteJid.endsWith('@s.whatsapp.net') ? key.remoteJid.split('@')[0]! : key.remoteJid
    await this.send(instanceName, `/chat/updateMessage/${encodeURIComponent(instanceName)}`, { number, key: { id: key.id, remoteJid: key.remoteJid, fromMe: true }, text }, 20_000)
  }

  /** Apaga para todos uma mensagem enviada pela empresa. */
  async deleteForEveryone(instanceName: string, key: { id: string; remoteJid: string }) {
    await this.send(instanceName, `/chat/deleteMessageForEveryone/${encodeURIComponent(instanceName)}`, { id: key.id, remoteJid: key.remoteJid, fromMe: true }, 20_000, 'DELETE')
  }

  /** Reação (emoji) a uma mensagem; emoji vazio tira a reação. */
  async sendReaction(instanceName: string, key: { id: string; fromMe: boolean; remoteJid: string }, reaction: string) {
    await this.send(instanceName, `/message/sendReaction/${encodeURIComponent(instanceName)}`, { key, reaction }, 20_000)
  }

  /** Cartão de contato (vCard): no WhatsApp aparece com os botões "Conversar" e "Adicionar". */
  async sendContact(instanceName: string, number: string, c: { fullName: string; wuid: string; phoneNumber: string }) {
    return this.sent(await this.send(instanceName, `/message/sendContact/${encodeURIComponent(instanceName)}`, { number, contact: [{ fullName: c.fullName, wuid: c.wuid, phoneNumber: c.phoneNumber }] }, 30_000))
  }

  async sendMedia(instanceName: string, number: string, m: { mediatype: 'image' | 'video' | 'document'; mimetype: string; base64: string; fileName: string; caption?: string }) {
    return this.sent(
      await this.send(instanceName, `/message/sendMedia/${encodeURIComponent(instanceName)}`, { number, mediatype: m.mediatype, mimetype: m.mimetype, media: m.base64, fileName: m.fileName, caption: m.caption ?? '' }, 300_000),
    )
  }

  /** Figurinha (a Evolution converte a imagem para WEBP, o formato de figurinha do WhatsApp). */
  async sendSticker(instanceName: string, number: string, base64: string) {
    return this.sent(await this.send(instanceName, `/message/sendSticker/${encodeURIComponent(instanceName)}`, { number, sticker: base64 }, 60_000))
  }

  /** Áudio de voz (a Evolution converte para o formato do WhatsApp). */
  async sendAudio(instanceName: string, number: string, base64: string) {
    return this.sent(await this.send(instanceName, `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, { number, audio: base64 }, 90_000))
  }

  async deleteInstance(instanceName: string) {
    await this.call('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`).catch((err: unknown) => {
      if (!(err instanceof EvolutionError && err.status === 404)) throw err
    })
  }
}
