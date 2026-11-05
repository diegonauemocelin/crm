import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import { decrypt, encrypt } from '../common/crypto'
import type { AuthUser } from '../common/types'
import { SettingsService } from '../settings/settings.service'
import { assertCan } from './acesso'
import {
  BRASPRESS_URL,
  braspressBody,
  parseBraspress,
  CORREIOS_BASE,
  correiosError,
  correiosPriceQuery,
  DEFAULT_INTEGRATIONS,
  INTEGRATIONS_KEY,
  type IntegrationsConfig,
  ME_BASE,
  melhorEnvioBody,
  type OnlineQuote,
  type PackageInput,
  parseCorreiosDeadline,
  parseCorreiosPrice,
  parseMelhorEnvio,
  parseMelhorEnvioServices,
} from './integracoes'

export interface IntegrationsInput {
  melhorEnvio?: { enabled?: boolean; token?: string | null; email?: string; sandbox?: boolean; services?: number[] }
  correios?: { enabled?: boolean; user?: string; accessCode?: string | null; postCard?: string; products?: { code: string; name: string }[] }
  braspress?: { enabled?: boolean; user?: string; password?: string | null; modal?: 'R' | 'A' }
}

const TIMEOUT_MS = 10_000

/** Cotação online pelas APIs do Melhor Envio e dos Correios (contrato), junto com as tabelas na cotação. */
@Injectable()
export class IntegracoesService {
  private readonly logger = new Logger(IntegracoesService.name)
  /** Token dos Correios por empresa (vale algumas horas; pedimos outro quando vence). */
  private readonly correiosTokens = new Map<string, { token: string; until: number }>()

  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private config(tenantId: string) {
    return this.settings.get<IntegrationsConfig>(tenantId, INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS)
  }

  /** Configuração para a tela: as chaves nunca voltam, só se estão cadastradas. */
  async view(user: AuthUser) {
    assertCan(user, 'fretes_transportadoras', 'view')
    const c = await this.config(user.tenantId)
    return {
      melhorEnvio: { enabled: c.melhorEnvio.enabled, hasToken: !!c.melhorEnvio.tokenEnc, email: c.melhorEnvio.email, sandbox: c.melhorEnvio.sandbox, services: c.melhorEnvio.services },
      correios: { enabled: c.correios.enabled, user: c.correios.user, hasAccessCode: !!c.correios.accessCodeEnc, postCard: c.correios.postCard, products: c.correios.products },
      braspress: { enabled: c.braspress?.enabled ?? false, user: c.braspress?.user ?? '', hasPassword: !!c.braspress?.passwordEnc, modal: c.braspress?.modal ?? 'R' },
    }
  }

  async save(user: AuthUser, d: IntegrationsInput, ctx: RequestCtx) {
    assertCan(user, 'fretes_transportadoras', 'edit')
    const c = await this.config(user.tenantId)
    const me = { ...c.melhorEnvio }
    if (d.melhorEnvio) {
      const m = d.melhorEnvio
      if (m.token !== undefined) me.tokenEnc = m.token && m.token.trim() ? encrypt(m.token.trim()) : null
      if (m.email !== undefined) me.email = m.email.trim().slice(0, 120)
      if (m.sandbox !== undefined) me.sandbox = m.sandbox
      if (m.services !== undefined) me.services = [...new Set(m.services.filter((x) => Number.isInteger(x) && x > 0))].slice(0, 100)
      if (m.enabled !== undefined) me.enabled = m.enabled
      if (me.enabled && (!me.tokenEnc || !/^\S+@\S+\.\S+$/.test(me.email))) throw new BadRequestException('Para ligar o Melhor Envio, informe o token e o e-mail de contato da conta.')
    }
    const co = { ...c.correios }
    if (d.correios) {
      const k = d.correios
      if (k.user !== undefined) co.user = k.user.trim().slice(0, 60)
      if (k.accessCode !== undefined) co.accessCodeEnc = k.accessCode && k.accessCode.trim() ? encrypt(k.accessCode.trim()) : null
      if (k.postCard !== undefined) co.postCard = k.postCard.replace(/\D/g, '').slice(0, 20)
      if (k.products !== undefined) co.products = k.products.map((p) => ({ code: p.code.replace(/\D/g, '').slice(0, 10), name: p.name.trim().slice(0, 40) })).filter((p) => p.code && p.name).slice(0, 10)
      if (k.enabled !== undefined) co.enabled = k.enabled
      if (co.enabled && (!co.user || !co.accessCodeEnc || !co.postCard || !co.products.length)) throw new BadRequestException('Para ligar os Correios, informe o usuário, o código de acesso à API, o cartão de postagem e ao menos um serviço do contrato.')
    }
    const br = { ...(c.braspress ?? DEFAULT_INTEGRATIONS.braspress) }
    if (d.braspress) {
      const b = d.braspress
      if (b.user !== undefined) br.user = b.user.trim().slice(0, 60)
      if (b.password !== undefined) br.passwordEnc = b.password && b.password.trim() ? encrypt(b.password.trim()) : null
      if (b.modal !== undefined) br.modal = b.modal === 'A' ? 'A' : 'R'
      if (b.enabled !== undefined) br.enabled = b.enabled
      if (br.enabled && (!br.user || !br.passwordEnc)) throw new BadRequestException('Para ligar a Braspress, informe o usuário e a senha da API (fornecidos pela Braspress).')
    }
    await this.settings.set(user.tenantId, INTEGRATIONS_KEY, { melhorEnvio: me, correios: co, braspress: br })
    if (co.user !== c.correios.user || co.accessCodeEnc !== c.correios.accessCodeEnc || co.postCard !== c.correios.postCard) this.correiosTokens.delete(user.tenantId)
    await this.audit.byUser(user, ctx, 'frete.integracoes.alteradas', 'settings', INTEGRATIONS_KEY, {
      melhorEnvio: { ligado: me.enabled, token: d.melhorEnvio?.token !== undefined ? 'alterado' : undefined, servicos: me.services.length },
      correios: { ligado: co.enabled, usuario: co.user, codigoAcesso: d.correios?.accessCode !== undefined ? 'alterado' : undefined, cartao: co.postCard, servicos: co.products.map((p) => p.code) },
      braspress: { ligado: br.enabled, usuario: br.user, senha: d.braspress?.password !== undefined ? 'alterada' : undefined, modal: br.modal },
    })
    return this.view(user)
  }

  private meHeaders(token: string, email: string) {
    return { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': `CRM fretes (${email})` }
  }

  /** Serviços do Melhor Envio (transportadora e modalidade) para escolher quais aparecem na cotação. */
  async melhorEnvioServices(user: AuthUser) {
    assertCan(user, 'fretes_transportadoras', 'view')
    const c = await this.config(user.tenantId)
    if (!c.melhorEnvio.tokenEnc) throw new BadRequestException('Cadastre o token do Melhor Envio primeiro.')
    const base = c.melhorEnvio.sandbox ? ME_BASE.sandbox : ME_BASE.prod
    const res = await fetch(`${base}/api/v2/me/shipment/services`, { headers: this.meHeaders(decrypt(c.melhorEnvio.tokenEnc), c.melhorEnvio.email || 'contato@example.com'), signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((e: unknown) => {
      throw new BadRequestException(`Melhor Envio não respondeu: ${(e as Error).message}`)
    })
    if (!res.ok) throw new BadRequestException(res.status === 401 ? 'Melhor Envio recusou o token (gere outro no painel do Melhor Envio).' : `Melhor Envio respondeu HTTP ${res.status}.`)
    return parseMelhorEnvioServices(await res.json())
  }

  private async melhorEnvio(c: IntegrationsConfig['melhorEnvio'], from: string, to: string, p: PackageInput): Promise<OnlineQuote[]> {
    const base = c.sandbox ? ME_BASE.sandbox : ME_BASE.prod
    const res = await fetch(`${base}/api/v2/me/shipment/calculate`, { method: 'POST', headers: this.meHeaders(decrypt(c.tokenEnc!), c.email), body: JSON.stringify(melhorEnvioBody(from, to, p, c.services)), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(res.status === 401 ? 'token recusado (gere outro no painel do Melhor Envio)' : `HTTP ${res.status}`)
    const all = parseMelhorEnvio(await res.json())
    return c.services.length ? all.filter((q) => c.services.includes(Number(q.serviceId))) : all
  }

  private async correiosToken(tenantId: string, c: IntegrationsConfig['correios']) {
    const hit = this.correiosTokens.get(tenantId)
    if (hit && hit.until > Date.now() + 60_000) return hit.token
    const basic = Buffer.from(`${c.user}:${decrypt(c.accessCodeEnc!)}`).toString('base64')
    const res = await fetch(`${CORREIOS_BASE}/token/v1/autentica/cartaopostagem`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ numero: c.postCard }), signal: AbortSignal.timeout(TIMEOUT_MS) })
    const body = (await res.json().catch(() => null)) as { token?: string; expiraEm?: string } | null
    if (!res.ok || !body?.token) throw new Error(res.status === 401 ? 'usuário ou código de acesso à API recusado' : (correiosError(body) ?? `HTTP ${res.status} ao autenticar`))
    const until = body.expiraEm ? Date.parse(body.expiraEm) : NaN
    this.correiosTokens.set(tenantId, { token: body.token, until: Number.isFinite(until) ? until : Date.now() + 3_600_000 })
    return body.token
  }

  private async correios(tenantId: string, c: IntegrationsConfig['correios'], from: string, to: string, p: PackageInput): Promise<OnlineQuote[]> {
    const token = await this.correiosToken(tenantId, c)
    const h = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    return Promise.all(
      c.products.map(async (prod): Promise<OnlineQuote> => {
        const base: OnlineQuote = { source: 'CORREIOS', serviceId: prod.code, carrier: 'Correios', service: prod.name, price: null, deadlineDays: null, error: null }
        try {
          const [pr, dl] = await Promise.all([
            fetch(`${CORREIOS_BASE}/preco/v1/nacional/${prod.code}?${correiosPriceQuery(from, to, p)}`, { headers: h, signal: AbortSignal.timeout(TIMEOUT_MS) }),
            fetch(`${CORREIOS_BASE}/prazo/v1/nacional/${prod.code}?${new URLSearchParams({ cepOrigem: from, cepDestino: to })}`, { headers: h, signal: AbortSignal.timeout(TIMEOUT_MS) }),
          ])
          const pb = await pr.json().catch(() => null)
          const db = await dl.json().catch(() => null)
          const price = pr.ok ? parseCorreiosPrice(pb) : null
          return { ...base, price, deadlineDays: dl.ok ? parseCorreiosDeadline(db) : null, error: price === null ? (correiosError(pb) ?? `HTTP ${pr.status}`) : null }
        } catch (e) {
          return { ...base, error: (e as Error).message.slice(0, 200) }
        }
      }),
    )
  }

  private async braspress(c: IntegrationsConfig['braspress'], d: { from: string; to: string; senderDoc: string | null; recipientDoc: string | null }, p: PackageInput): Promise<OnlineQuote[]> {
    const base: OnlineQuote = { source: 'BRASPRESS', serviceId: c.modal, carrier: 'Braspress', service: c.modal === 'A' ? 'Aéreo' : 'Rodoviário', price: null, deadlineDays: null, error: null }
    if (!d.senderDoc) return [{ ...base, error: 'Cadastre o CNPJ da filial de origem (Fretes › Filiais) para cotar na Braspress.' }]
    if (!d.recipientDoc) return [{ ...base, error: 'Informe o CPF/CNPJ do destinatário para cotar na Braspress.' }]
    const basic = Buffer.from(`${c.user}:${decrypt(c.passwordEnc!)}`).toString('base64')
    const res = await fetch(BRASPRESS_URL, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(braspressBody({ senderDoc: d.senderDoc, recipientDoc: d.recipientDoc, from: d.from, to: d.to, modal: c.modal }, p)), signal: AbortSignal.timeout(TIMEOUT_MS) })
    const body = await res.json().catch(() => null)
    if (res.status === 401) return [{ ...base, error: 'Braspress recusou o usuário ou a senha da API.' }]
    const r = parseBraspress(body)
    return [{ ...base, price: res.ok ? r.price : null, deadlineDays: r.deadlineDays, error: res.ok ? r.error : (r.error ?? `HTTP ${res.status}`) }]
  }

  /** Cotação online nas integrações ligadas; falha de uma não derruba a outra nem a cotação das tabelas. */
  async quote(tenantId: string, from: string, to: string, p: PackageInput, docs: { senderDoc: string | null; recipientDoc: string | null } = { senderDoc: null, recipientDoc: null }): Promise<OnlineQuote[]> {
    const c = await this.config(tenantId)
    const jobs: Promise<OnlineQuote[]>[] = []
    if (c.braspress?.enabled && c.braspress.passwordEnc) {
      jobs.push(
        this.braspress(c.braspress, { from, to, ...docs }, p).catch((e: unknown) => [{ source: 'BRASPRESS' as const, serviceId: '', carrier: 'Braspress', service: '', price: null, deadlineDays: null, error: `Braspress: ${(e as Error).message}`.slice(0, 200) }]),
      )
    }
    if (c.melhorEnvio.enabled && c.melhorEnvio.tokenEnc) {
      jobs.push(
        this.melhorEnvio(c.melhorEnvio, from, to, p).catch((e: unknown) => {
          this.logger.warn(`Melhor Envio: ${(e as Error).message}`)
          return [{ source: 'MELHOR_ENVIO' as const, serviceId: '', carrier: 'Melhor Envio', service: '', price: null, deadlineDays: null, error: `Melhor Envio: ${(e as Error).message}`.slice(0, 200) }]
        }),
      )
    }
    if (c.correios.enabled && c.correios.accessCodeEnc) {
      jobs.push(
        this.correios(tenantId, c.correios, from, to, p).catch((e: unknown) => {
          this.logger.warn(`Correios: ${(e as Error).message}`)
          return [{ source: 'CORREIOS' as const, serviceId: '', carrier: 'Correios', service: '', price: null, deadlineDays: null, error: `Correios: ${(e as Error).message}`.slice(0, 200) }]
        }),
      )
    }
    return (await Promise.all(jobs)).flat()
  }
}
