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
  DEFAULT_JADLOG,
  JADLOG_QUOTE_URL,
  jadlogBody,
  parseJadlog,
  parseBraspress,
  CORREIOS_BASE,
  correiosError,
  correiosDeclaredService,
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
  DEFAULT_DHL,
  DEFAULT_RODONAVES,
  DHL_BASE,
  type DhlPlace,
  dhlDomestic,
  dhlError,
  dhlInternational,
  dhlRatesQuery,
  nextBusinessDay,
  parseDhlRates,
  parseRodonaves,
  parseRodonavesCity,
  parseRodonavesToken,
  RODONAVES_DNE_BASE,
  RODONAVES_QUOTE_BASE,
  rodonavesBody,
  rodonavesError,
  rodonavesTokenForm,
  type DhlConfig,
  type DhlScope,
  type RodonavesConfig,
} from './integracoes'

export interface IntegrationsInput {
  melhorEnvio?: { enabled?: boolean; token?: string | null; email?: string; sandbox?: boolean; services?: number[] }
  correios?: { enabled?: boolean; user?: string; accessCode?: string | null; postCard?: string; products?: { code: string; name: string }[] }
  braspress?: { enabled?: boolean; user?: string; password?: string | null; modal?: 'R' | 'A' }
  jadlog?: { enabled?: boolean; token?: string | null; cnpj?: string; account?: string; contract?: string; modalities?: { code: number; name: string }[]; delivery?: 'D' | 'R'; cubageFactor?: number }
  rodonaves?: { enabled?: boolean; user?: string; password?: string | null; cnpj?: string; contactName?: string; contactPhone?: string }
  dhl?: { enabled?: boolean; apiKey?: string; apiSecret?: string | null; accountNumber?: string; sandbox?: boolean; scope?: DhlScope }
}

/** Cidades de origem e destino (a DHL pede o nome da cidade). */
export interface QuotePlaces {
  originCity: string | null
  destCity: string | null
}

const TIMEOUT_MS = 10_000

/** Cotação online pelas APIs do Melhor Envio e dos Correios (contrato), junto com as tabelas na cotação. */
@Injectable()
export class IntegracoesService {
  private readonly logger = new Logger(IntegracoesService.name)
  /** Token dos Correios por empresa (vale algumas horas; pedimos outro quando vence). */
  private readonly correiosTokens = new Map<string, { token: string; until: number }>()
  /** Tokens da Rodonaves por empresa e API (cada API tem o seu; valem cerca de 8 horas). */
  private readonly rodonavesTokens = new Map<string, { token: string; until: number }>()
  /** Id da cidade na Rodonaves por CEP (não muda; evita uma consulta por cotação). */
  private readonly rodonavesCities = new Map<string, number>()

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
      jadlog: (({ tokenEnc, ...rest }) => ({ ...rest, hasToken: !!tokenEnc }))({ ...DEFAULT_JADLOG, ...(c.jadlog ?? {}) }),
      rodonaves: (({ passwordEnc, ...rest }) => ({ ...rest, hasPassword: !!passwordEnc }))({ ...DEFAULT_RODONAVES, ...(c.rodonaves ?? {}) }),
      dhl: (({ apiSecretEnc, ...rest }) => ({ ...rest, hasSecret: !!apiSecretEnc }))({ ...DEFAULT_DHL, ...(c.dhl ?? {}) }),
    }
  }

  /** A cotação internacional (DHL Express) está ligada? Para a tela de cotação (sem expor a configuração). */
  async internationalEnabled(tenantId: string) {
    const c = await this.config(tenantId)
    const d = { ...DEFAULT_DHL, ...(c.dhl ?? {}) }
    return d.enabled && !!d.apiSecretEnc && dhlInternational(d.scope)
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
    const jl = { ...DEFAULT_JADLOG, ...(c.jadlog ?? {}) }
    if (d.jadlog) {
      const j = d.jadlog
      if (j.token !== undefined) jl.tokenEnc = j.token && j.token.trim() ? encrypt(j.token.trim()) : null
      if (j.cnpj !== undefined) jl.cnpj = j.cnpj.replace(/\D/g, '').slice(0, 14)
      if (j.account !== undefined) jl.account = j.account.replace(/\D/g, '').slice(0, 6)
      if (j.contract !== undefined) jl.contract = j.contract.replace(/\D/g, '').slice(0, 3)
      if (j.modalities !== undefined) jl.modalities = j.modalities.map((m) => ({ code: Math.trunc(Number(m.code)), name: String(m.name ?? '').trim().slice(0, 40) })).filter((m) => Number.isInteger(m.code) && m.code >= 0 && m.name).slice(0, 3)
      if (j.delivery !== undefined) jl.delivery = j.delivery === 'R' ? 'R' : 'D'
      if (j.cubageFactor !== undefined) jl.cubageFactor = Number.isFinite(j.cubageFactor) && j.cubageFactor > 0 ? Math.min(1000, j.cubageFactor) : 0
      if (j.enabled !== undefined) jl.enabled = j.enabled
      if (jl.cnpj && jl.cnpj.length !== 14) throw new BadRequestException('CNPJ do tomador da Jadlog inválido (14 dígitos).')
      if (jl.enabled && (!jl.tokenEnc || !jl.modalities.length)) throw new BadRequestException('Para ligar a Jadlog, informe o token da API e ao menos uma modalidade do contrato (fornecidos pela Jadlog).')
    }
    const prevRt = { ...DEFAULT_RODONAVES, ...(c.rodonaves ?? {}) }
    const rt = { ...prevRt }
    if (d.rodonaves) {
      const r = d.rodonaves
      if (r.user !== undefined) rt.user = r.user.trim().slice(0, 80)
      if (r.password !== undefined) rt.passwordEnc = r.password && r.password.trim() ? encrypt(r.password.trim()) : null
      if (r.cnpj !== undefined) rt.cnpj = r.cnpj.replace(/\D/g, '').slice(0, 14)
      if (r.contactName !== undefined) rt.contactName = r.contactName.trim().slice(0, 80)
      if (r.contactPhone !== undefined) rt.contactPhone = r.contactPhone.replace(/\D/g, '').slice(0, 13)
      if (r.enabled !== undefined) rt.enabled = r.enabled
      if (rt.cnpj && rt.cnpj.length !== 14 && rt.cnpj.length !== 11) throw new BadRequestException('CPF/CNPJ do cliente na Rodonaves inválido (11 ou 14 dígitos).')
      if (rt.enabled && (!rt.user || !rt.passwordEnc || !rt.contactName || rt.contactPhone.length < 10)) throw new BadRequestException('Para ligar a Rodonaves, informe o usuário e a senha da API, o nome e o telefone (com DDD) do contato da cotação.')
    }
    const prevDhl = { ...DEFAULT_DHL, ...(c.dhl ?? {}) }
    const dh = { ...prevDhl }
    if (d.dhl) {
      const x = d.dhl
      if (x.apiKey !== undefined) dh.apiKey = x.apiKey.trim().slice(0, 120)
      if (x.apiSecret !== undefined) dh.apiSecretEnc = x.apiSecret && x.apiSecret.trim() ? encrypt(x.apiSecret.trim()) : null
      if (x.accountNumber !== undefined) dh.accountNumber = x.accountNumber.replace(/\D/g, '').slice(0, 12)
      if (x.sandbox !== undefined) dh.sandbox = x.sandbox
      if (x.scope !== undefined) dh.scope = x.scope === 'NACIONAL' || x.scope === 'INTERNACIONAL' ? x.scope : 'AMBOS'
      if (x.enabled !== undefined) dh.enabled = x.enabled
      if (dh.enabled && (!dh.apiKey || !dh.apiSecretEnc || !dh.accountNumber)) throw new BadRequestException('Para ligar a DHL Express, informe a API Key, a API Secret e o número da conta DHL.')
    }
    await this.settings.set(user.tenantId, INTEGRATIONS_KEY, { melhorEnvio: me, correios: co, braspress: br, jadlog: jl, rodonaves: rt, dhl: dh })
    if (rt.user !== prevRt.user || rt.passwordEnc !== prevRt.passwordEnc) for (const k of [...this.rodonavesTokens.keys()]) if (k.startsWith(`${user.tenantId}|`)) this.rodonavesTokens.delete(k)
    if (co.user !== c.correios.user || co.accessCodeEnc !== c.correios.accessCodeEnc || co.postCard !== c.correios.postCard) this.correiosTokens.delete(user.tenantId)
    await this.audit.byUser(user, ctx, 'frete.integracoes.alteradas', 'settings', INTEGRATIONS_KEY, {
      melhorEnvio: { ligado: me.enabled, token: d.melhorEnvio?.token !== undefined ? 'alterado' : undefined, servicos: me.services.length },
      correios: { ligado: co.enabled, usuario: co.user, codigoAcesso: d.correios?.accessCode !== undefined ? 'alterado' : undefined, cartao: co.postCard, servicos: co.products.map((p) => p.code) },
      braspress: { ligado: br.enabled, usuario: br.user, senha: d.braspress?.password !== undefined ? 'alterada' : undefined, modal: br.modal },
      jadlog: { ligado: jl.enabled, token: d.jadlog?.token !== undefined ? 'alterado' : undefined, cnpj: jl.cnpj, conta: jl.account, contrato: jl.contract, modalidades: jl.modalities.map((m) => m.code), entrega: jl.delivery, cubagem: jl.cubageFactor },
      rodonaves: { ligado: rt.enabled, usuario: rt.user, senha: d.rodonaves?.password !== undefined ? 'alterada' : undefined, cnpj: rt.cnpj, contato: rt.contactName },
      dhl: { ligado: dh.enabled, apiKey: dh.apiKey, apiSecret: d.dhl?.apiSecret !== undefined ? 'alterada' : undefined, conta: dh.accountNumber, teste: dh.sandbox, abrangencia: dh.scope },
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
          const priceOf = (declared: string | null) => fetch(`${CORREIOS_BASE}/preco/v1/nacional/${prod.code}?${correiosPriceQuery(from, to, p, declared)}`, { headers: h, signal: AbortSignal.timeout(TIMEOUT_MS) })
          const [first, dl] = await Promise.all([
            priceOf(correiosDeclaredService(prod)),
            fetch(`${CORREIOS_BASE}/prazo/v1/nacional/${prod.code}?${new URLSearchParams({ cepOrigem: from, cepDestino: to })}`, { headers: h, signal: AbortSignal.timeout(TIMEOUT_MS) }),
          ])
          let pr = first
          let pb = await pr.json().catch(() => null)
          let noDeclared = false
          // O contrato não aceita o Valor Declarado deste produto: cota sem ele (o preço vem sem o seguro).
          if (!pr.ok && p.value > 0 && /valor declarado|servi[cç]o adicional/i.test(correiosError(pb) ?? '')) {
            pr = await priceOf(null)
            pb = await pr.json().catch(() => null)
            noDeclared = pr.ok
          }
          const db = await dl.json().catch(() => null)
          const price = pr.ok ? parseCorreiosPrice(pb) : null
          return { ...base, service: noDeclared ? `${prod.name} (sem valor declarado)` : prod.name, price, deadlineDays: dl.ok ? parseCorreiosDeadline(db) : null, error: price === null ? (correiosError(pb) ?? `HTTP ${pr.status}`) : null }
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

  private async jadlog(c: NonNullable<IntegrationsConfig['jadlog']>, d: { from: string; to: string; senderDoc: string | null }, p: PackageInput): Promise<OnlineQuote[]> {
    const fail = (error: string) => c.modalities.map((m) => ({ source: 'JADLOG' as const, serviceId: String(m.code), carrier: 'Jadlog', service: m.name, price: null, deadlineDays: null, error }))
    const cnpj = c.cnpj || d.senderDoc
    if (!cnpj) return fail('Informe o CNPJ do tomador na integração da Jadlog ou cadastre o CNPJ da filial de origem.')
    const res = await fetch(JADLOG_QUOTE_URL, {
      method: 'POST',
      headers: { Authorization: decrypt(c.tokenEnc!), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(jadlogBody(c, { from: d.from, to: d.to, cnpj }, p, c.modalities.map((m) => m.code))),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await res.json().catch(() => null)
    if (res.status === 401 || res.status === 403) return fail('A Jadlog recusou o token da API.')
    if (!res.ok && !body) return fail(`HTTP ${res.status}`)
    return parseJadlog(body, c.modalities)
  }

  /** Token de uma API da Rodonaves (cada base tem o seu), guardado até perto de vencer. */
  private async rodonavesToken(tenantId: string, c: RodonavesConfig, base: string, fresh = false) {
    const key = `${tenantId}|${base}`
    const hit = this.rodonavesTokens.get(key)
    if (!fresh && hit && hit.until > Date.now() + 60_000) return hit.token
    const res = await fetch(`${base}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: rodonavesTokenForm(c.user, decrypt(c.passwordEnc!)).toString(), signal: AbortSignal.timeout(TIMEOUT_MS) })
    const body = await res.json().catch(() => null)
    const t = res.ok ? parseRodonavesToken(body) : null
    if (!t) throw new Error(res.status === 400 || res.status === 401 ? 'usuário ou senha da API recusados (peça o acesso à API na filial de vínculo da Rodonaves)' : (rodonavesError(body) ?? `HTTP ${res.status} ao autenticar`))
    this.rodonavesTokens.set(key, { token: t.token, until: Date.now() + t.expiresInSec * 1000 })
    return t.token
  }

  /** Chamada autenticada à Rodonaves; token recusado (venceu antes da hora): pede outro e tenta uma vez mais. */
  private async rodonavesFetch(tenantId: string, c: RodonavesConfig, base: string, path: string, init: RequestInit = {}) {
    const call = async (fresh: boolean) => {
      const token = await this.rodonavesToken(tenantId, c, base, fresh)
      return fetch(`${base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    }
    const res = await call(false)
    return res.status === 401 ? call(true) : res
  }

  private async rodonavesCity(tenantId: string, c: RodonavesConfig, cep: string) {
    const hit = this.rodonavesCities.get(cep)
    if (hit) return hit
    const res = await this.rodonavesFetch(tenantId, c, RODONAVES_DNE_BASE, `/api/cities/byzipcode?${new URLSearchParams({ zipCode: cep })}`)
    const body = await res.json().catch(() => null)
    if (res.status === 403) throw new Error('o usuário da API não tem acesso à consulta de CEP (peça o recurso "CEP" na filial de vínculo)')
    const id = res.ok ? parseRodonavesCity(body) : null
    if (!id) throw new Error(`CEP ${cep} não encontrado na Rodonaves${res.ok ? '' : ` (HTTP ${res.status})`}`)
    if (this.rodonavesCities.size > 5000) this.rodonavesCities.clear()
    this.rodonavesCities.set(cep, id)
    return id
  }

  private async rodonaves(tenantId: string, c: RodonavesConfig, d: { from: string; to: string; senderDoc: string | null; recipientDoc: string | null }, p: PackageInput): Promise<OnlineQuote[]> {
    const base: OnlineQuote = { source: 'RODONAVES', serviceId: 'RODONAVES', carrier: 'Rodonaves', service: 'Rodoviário', price: null, deadlineDays: null, error: null }
    const cnpj = c.cnpj || d.senderDoc
    if (!cnpj) return [{ ...base, error: 'Informe o CNPJ do cliente na integração da Rodonaves ou cadastre o CNPJ da filial de origem.' }]
    if (!d.recipientDoc) return [{ ...base, error: 'Informe o CPF/CNPJ do destinatário para cotar na Rodonaves.' }]
    const from = d.from.replace(/\D/g, '')
    const to = d.to.replace(/\D/g, '')
    const [originCityId, destCityId] = await Promise.all([this.rodonavesCity(tenantId, c, from), this.rodonavesCity(tenantId, c, to)])
    const res = await this.rodonavesFetch(tenantId, c, RODONAVES_QUOTE_BASE, '/api/v1/gera-cotacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rodonavesBody({ from, to, originCityId, destCityId, cnpj, recipientDoc: d.recipientDoc, contactName: c.contactName, contactPhone: c.contactPhone }, p)),
    })
    const body = await res.json().catch(() => null)
    if (res.status === 401 || res.status === 403) return [{ ...base, error: 'A Rodonaves recusou o acesso à cotação (confira o usuário da API e o recurso "cotação" na filial de vínculo).' }]
    const r = parseRodonaves(body)
    return [{ ...base, serviceId: r.protocol ?? base.serviceId, price: res.ok && !r.error ? r.price : null, error: res.ok ? r.error : (rodonavesError(body) ?? `HTTP ${res.status}`) }]
  }

  private async dhlRates(c: DhlConfig, origin: DhlPlace, dest: DhlPlace, customs: boolean, p: PackageInput): Promise<OnlineQuote[]> {
    const basic = Buffer.from(`${c.apiKey}:${decrypt(c.apiSecretEnc!)}`).toString('base64')
    const q = dhlRatesQuery({ account: c.accountNumber, origin, dest, customs, date: nextBusinessDay() }, p)
    const res = await fetch(`${c.sandbox ? DHL_BASE.test : DHL_BASE.prod}/rates?${q}`, { headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const body = await res.json().catch(() => null)
    const fail = (error: string): OnlineQuote[] => [{ source: 'DHL', serviceId: '', carrier: 'DHL Express', service: '', price: null, deadlineDays: null, error }]
    if (res.status === 401 || res.status === 403) return fail('A DHL recusou a API Key ou a API Secret (confira também o ambiente de teste).')
    if (!res.ok) return fail(dhlError(body) ?? `HTTP ${res.status}`)
    const list = parseDhlRates(body)
    // Na cotação nacional os valores entram na comparação em reais: preço em outra moeda não entra.
    return customs ? list : list.map((q) => (q.price !== null && /\([A-Z]{3}\)$/.test(q.service) ? { ...q, price: null, deadlineDays: null, error: 'A DHL respondeu em outra moeda; não entra na comparação em reais.' } : q))
  }

  /** Cotação internacional na DHL Express (fora da cotação normal, que é só para CEPs do Brasil). */
  async dhlInternationalQuote(tenantId: string, origin: DhlPlace, dest: DhlPlace, p: PackageInput): Promise<OnlineQuote[]> {
    const c = await this.config(tenantId)
    const d = { ...DEFAULT_DHL, ...(c.dhl ?? {}) }
    if (!d.enabled || !d.apiSecretEnc) throw new BadRequestException('A DHL Express não está ligada (Fretes › Filiais › Cotação online).')
    if (!dhlInternational(d.scope)) throw new BadRequestException('A DHL Express está configurada só para envios nacionais. Para cotar envios internacionais, mude a abrangência em Fretes › Filiais › Cotação online.')
    return this.dhlRates(d, origin, dest, true, p).catch((e: unknown) => [{ source: 'DHL' as const, serviceId: '', carrier: 'DHL Express', service: '', price: null, deadlineDays: null, error: `DHL Express: ${(e as Error).message}`.slice(0, 200) }])
  }

  /** Só os Correios (contrato), para a resposta automática de frete no Mercado Livre. Erro quando não está configurado. */
  async correiosQuote(tenantId: string, from: string, to: string, p: PackageInput): Promise<OnlineQuote[]> {
    const c = await this.config(tenantId)
    if (!c.correios.enabled || !c.correios.accessCodeEnc) throw new Error('A cotação dos Correios não está ligada (Fretes › Filiais › Cotação online).')
    return this.correios(tenantId, c.correios, from, to, p)
  }

  /** Cotação online nas integrações ligadas; falha de uma não derruba a outra nem a cotação das tabelas. */
  async quote(
    tenantId: string,
    from: string,
    to: string,
    p: PackageInput,
    docs: { senderDoc: string | null; recipientDoc: string | null } = { senderDoc: null, recipientDoc: null },
    places: QuotePlaces = { originCity: null, destCity: null },
  ): Promise<OnlineQuote[]> {
    const c = await this.config(tenantId)
    const jobs: Promise<OnlineQuote[]>[] = []
    if (c.rodonaves?.enabled && c.rodonaves.passwordEnc) {
      const rt = { ...DEFAULT_RODONAVES, ...c.rodonaves }
      jobs.push(
        this.rodonaves(tenantId, rt, { from, to, ...docs }, p).catch((e: unknown) => [{ source: 'RODONAVES' as const, serviceId: '', carrier: 'Rodonaves', service: '', price: null, deadlineDays: null, error: `Rodonaves: ${(e as Error).message}`.slice(0, 200) }]),
      )
    }
    if (c.dhl?.enabled && c.dhl.apiSecretEnc && dhlDomestic(c.dhl.scope)) {
      const dh = { ...DEFAULT_DHL, ...c.dhl }
      const fail = (error: string) => [{ source: 'DHL' as const, serviceId: '', carrier: 'DHL Express', service: '', price: null, deadlineDays: null, error }]
      jobs.push(
        !places.originCity || !places.destCity
          ? Promise.resolve(fail('A DHL precisa da cidade de origem e de destino (cadastre a cidade da filial).'))
          : this.dhlRates(dh, { country: 'BR', postalCode: from, city: places.originCity }, { country: 'BR', postalCode: to, city: places.destCity }, false, p).catch((e: unknown) => fail(`DHL Express: ${(e as Error).message}`.slice(0, 200))),
      )
    }
    if (c.braspress?.enabled && c.braspress.passwordEnc) {
      jobs.push(
        this.braspress(c.braspress, { from, to, ...docs }, p).catch((e: unknown) => [{ source: 'BRASPRESS' as const, serviceId: '', carrier: 'Braspress', service: '', price: null, deadlineDays: null, error: `Braspress: ${(e as Error).message}`.slice(0, 200) }]),
      )
    }
    if (c.jadlog?.enabled && c.jadlog.tokenEnc && c.jadlog.modalities.length) {
      jobs.push(
        this.jadlog(c.jadlog, { from, to, senderDoc: docs.senderDoc }, p).catch((e: unknown) => [{ source: 'JADLOG' as const, serviceId: '', carrier: 'Jadlog', service: '', price: null, deadlineDays: null, error: `Jadlog: ${(e as Error).message}`.slice(0, 200) }]),
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
