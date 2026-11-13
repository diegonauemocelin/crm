// Cotação online nas APIs do Melhor Envio e dos Correios (contrato). Aqui só o que não depende de banco: montar o
// pedido e ler a resposta (test/fretes-integracoes.spec.ts). As chamadas de rede ficam no serviço.

export const INTEGRATIONS_KEY = 'fretes.integracoes'

/** Serviço dos Correios contratado (código do produto no contrato, ex.: 03298 PAC, 03220 SEDEX). */
export interface CorreiosProduct {
  code: string
  name: string
}

export interface IntegrationsConfig {
  melhorEnvio: {
    enabled: boolean
    /** Token gerado no painel do Melhor Envio (criptografado). */
    tokenEnc: string | null
    /** E-mail de contato que o Melhor Envio pede no User-Agent. */
    email: string
    sandbox: boolean
    /** Serviços (transportadora + modalidade) que aparecem na cotação; vazio = todos. */
    services: number[]
  }
  correios: {
    enabled: boolean
    /** Usuário do Meu Correios (CPF/CNPJ ou login) e o código de acesso à API gerado no portal (criptografado). */
    user: string
    accessCodeEnc: string | null
    /** Número do cartão de postagem do contrato. */
    postCard: string
    products: CorreiosProduct[]
  }
  jadlog?: JadlogConfig
  rodonaves?: RodonavesConfig
  dhl?: DhlConfig
  braspress: {
    enabled: boolean
    /** Usuário e senha da API, fornecidos pela Braspress (senha criptografada). */
    user: string
    passwordEnc: string | null
    /** R = rodoviário, A = aéreo. */
    modal: 'R' | 'A'
  }
}

export const DEFAULT_INTEGRATIONS: IntegrationsConfig = {
  melhorEnvio: { enabled: false, tokenEnc: null, email: '', sandbox: false, services: [] },
  correios: {
    enabled: false,
    user: '',
    accessCodeEnc: null,
    postCard: '',
    products: [
      { code: '03298', name: 'PAC' },
      { code: '03220', name: 'SEDEX' },
    ],
  },
  braspress: { enabled: false, user: '', passwordEnc: null, modal: 'R' },
  jadlog: { enabled: false, tokenEnc: null, cnpj: '', account: '', contract: '', modalities: [], delivery: 'D', cubageFactor: 0 },
  rodonaves: { enabled: false, user: '', passwordEnc: null, cnpj: '', contactName: '', contactPhone: '' },
  dhl: { enabled: false, apiKey: '', apiSecretEnc: null, accountNumber: '', sandbox: false, scope: 'AMBOS' },
}

/** Modalidade negociada com a Jadlog (código numérico do contrato e um nome para a cotação). */
export interface JadlogModality {
  code: number
  name: string
}

/** Jadlog: simulador de frete da API do embarcador (documento de integração Jadlog v2.3, ago/2025). */
export interface JadlogConfig {
  enabled: boolean
  /** Token fornecido pela Jadlog (criptografado); vai no cabeçalho Authorization. */
  tokenEnc: string | null
  /** CNPJ do tomador do serviço (vincula a tabela especial). Vazio = CNPJ da filial de origem. */
  cnpj: string
  /** Conta corrente Jadlog (6 dígitos), só para correntistas. */
  account: string
  /** Número do contrato (até 3), só quando a Jadlog fornece. */
  contract: string
  /** Modalidades negociadas (a tabela de códigos é passada pela Jadlog). */
  modalities: JadlogModality[]
  /** D = entrega no domicílio; R = retira na unidade. */
  delivery: 'D' | 'R'
  /** Fator de cubagem em kg/m³ informado pela Jadlog; 0 = usa só o peso real. */
  cubageFactor: number
}

export const DEFAULT_JADLOG: JadlogConfig = { enabled: false, tokenEnc: null, cnpj: '', account: '', contract: '', modalities: [], delivery: 'D', cubageFactor: 0 }

export const JADLOG_QUOTE_URL = 'https://www.jadlog.com.br/embarcador/api/frete/valor'

/** Peso para a Jadlog: o maior entre o real e o cubado (a API pede sempre o maior). */
export function jadlogWeight(p: PackageInput, cubageFactor: number) {
  const cubed = cubageFactor > 0 ? ((p.heightCm * p.widthCm * p.lengthCm) / 1_000_000) * cubageFactor : 0
  return Math.round(Math.max(p.weightKg, cubed) * 1000) / 1000
}

/** Corpo do simulador (POST /embarcador/api/frete/valor): um item por modalidade (a API aceita até 3). */
export function jadlogBody(c: Pick<JadlogConfig, 'account' | 'contract' | 'delivery' | 'cubageFactor'>, d: { from: string; to: string; cnpj: string }, p: PackageInput, modalities: number[]) {
  return {
    frete: modalities.slice(0, 3).map((m) => ({
      cepori: d.from.replace(/\D/g, ''),
      cepdes: d.to.replace(/\D/g, ''),
      frap: 'N',
      peso: jadlogWeight(p, c.cubageFactor),
      cnpj: d.cnpj.replace(/\D/g, ''),
      conta: c.account ? c.account : null,
      contrato: c.contract ? c.contract : null,
      modalidade: m,
      tpentrega: c.delivery,
      tpseguro: 'N',
      vldeclarado: Math.round(p.value * 100) / 100,
      vlcoleta: 0,
    })),
  }
}

/** Resposta do simulador: vltotal e prazo por item; erro no item ou geral ("erro" ou "error"). */
export function parseJadlog(body: unknown, modalities: JadlogModality[]): OnlineQuote[] {
  const b = (body ?? {}) as Record<string, unknown>
  const errOf = (e: unknown) => {
    const o = (e ?? null) as Record<string, unknown> | null
    if (!o || typeof o !== 'object') return null
    const t = [o.descricao, o.detalhe].filter((x) => typeof x === 'string' && x.trim()).join(' · ')
    return t ? t.slice(0, 200) : null
  }
  const general = errOf(b.erro) ?? errOf(b.error)
  const list = Array.isArray(b.frete) ? (b.frete as Record<string, unknown>[]) : []
  const nameOf = (code: number) => modalities.find((m) => m.code === code)?.name ?? `Modalidade ${code}`
  if (!list.length) return modalities.slice(0, 3).map((m) => ({ source: 'JADLOG' as const, serviceId: String(m.code), carrier: 'Jadlog', service: m.name, price: null, deadlineDays: null, error: general ?? 'Sem preço para este envio.' }))
  return list.map((f, i) => {
    const code = Number(f.modalidade ?? modalities[i]?.code)
    const price = money(f.vltotal)
    const days = Number(f.prazo)
    const err = errOf(f.erro) ?? (price === null ? general ?? 'Sem preço para este envio.' : null)
    return { source: 'JADLOG' as const, serviceId: String(code), carrier: 'Jadlog', service: nameOf(code), price: err ? null : price, deadlineDays: err || !Number.isFinite(days) ? null : days, error: err }
  })
}

export const BRASPRESS_URL = 'https://api.braspress.com/v1/cotacao/calcular/json'

/** Pedido de cotação da Braspress: CNPJ de quem envia e de quem recebe, CEPs, valor, peso e medidas (em metros). */
export function braspressBody(d: { senderDoc: string; recipientDoc: string; from: string; to: string; modal: 'R' | 'A' }, p: PackageInput) {
  return {
    cnpjRemetente: d.senderDoc,
    cnpjDestinatario: d.recipientDoc,
    modal: d.modal,
    tipoFrete: '1',
    cepOrigem: d.from,
    cepDestino: d.to,
    vlrMercadoria: Math.round(p.value * 100) / 100,
    peso: Math.round(p.weightKg * 1000) / 1000,
    volumes: 1,
    cubagem: [{ altura: p.heightCm / 100, largura: p.widthCm / 100, comprimento: p.lengthCm / 100, volumes: 1 }],
  }
}

/** Resposta da Braspress: totalFrete e prazo (dias). */
export function parseBraspress(body: unknown): { price: number | null; deadlineDays: number | null; error: string | null } {
  const b = (body ?? {}) as Record<string, unknown>
  const price = money(b.totalFrete)
  const days = Number(b.prazo)
  const err = typeof b.message === 'string' ? b.message : Array.isArray(b.errorList) ? b.errorList.map(String).join(' ') : null
  return { price, deadlineDays: Number.isFinite(days) ? days : null, error: price === null ? (err?.slice(0, 200) || 'Sem preço para este envio.') : null }
}

export const ME_BASE = { prod: 'https://melhorenvio.com.br', sandbox: 'https://sandbox.melhorenvio.com.br' } as const
export const CORREIOS_BASE = 'https://api.correios.com.br'

/** Medidas do envio para as APIs: caixa única (maiores medidas, cm) e peso real (kg). */
export interface PackageInput {
  weightKg: number
  heightCm: number
  widthCm: number
  lengthCm: number
  value: number
}

/** Volume único a partir das medidas da cotação (sem medidas, caixa mínima aceita pelos Correios: 2 x 11 x 16 cm). */
export function packageOf(m: { realWeight: number; volumes?: { height?: number | null; width?: number | null; length?: number | null; quantity?: number }[] }, value: number): PackageInput {
  const vols = (m.volumes ?? []).filter((v) => (v.height ?? 0) > 0 && (v.width ?? 0) > 0 && (v.length ?? 0) > 0)
  const max = (k: 'height' | 'width' | 'length', min: number) => Math.max(min, ...vols.map((v) => Number(v[k]) || 0))
  // Vários volumes iguais empilhados: soma a altura.
  const height = vols.length ? Math.max(2, vols.reduce((s, v) => s + (Number(v.height) || 0) * Math.max(1, v.quantity ?? 1), 0)) : 2
  return { weightKg: Math.max(0.01, m.realWeight), heightCm: Math.round(height), widthCm: Math.round(max('width', 11)), lengthCm: Math.round(max('length', 16)), value: Math.max(0, value) }
}

export interface OnlineQuote {
  source: 'MELHOR_ENVIO' | 'CORREIOS' | 'BRASPRESS' | 'JADLOG' | 'RODONAVES' | 'DHL'
  serviceId: string
  carrier: string
  service: string
  price: number | null
  deadlineDays: number | null
  error: string | null
}

/** Pedido de cotação do Melhor Envio (POST /api/v2/me/shipment/calculate). */
export function melhorEnvioBody(from: string, to: string, p: PackageInput, services: number[]) {
  return {
    from: { postal_code: from },
    to: { postal_code: to },
    package: { height: p.heightCm, width: p.widthCm, length: p.lengthCm, weight: Math.round(p.weightKg * 1000) / 1000 },
    options: { insurance_value: Math.round(p.value * 100) / 100, receipt: false, own_hand: false },
    ...(services.length ? { services: services.join(',') } : {}),
  }
}

const money = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v) : NaN
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Resposta do Melhor Envio: cada serviço com preço e prazo, ou o erro (ex.: "Serviço indisponível para o trecho"). */
export function parseMelhorEnvio(body: unknown): OnlineQuote[] {
  const list = Array.isArray(body) ? (body as Record<string, unknown>[]) : []
  return list.map((s) => {
    const company = (s.company as Record<string, unknown> | undefined) ?? {}
    const price = money(s.custom_price ?? s.price)
    const days = Number(s.custom_delivery_time ?? s.delivery_time)
    const err = typeof s.error === 'string' && s.error.trim() ? s.error.trim().slice(0, 200) : null
    return {
      source: 'MELHOR_ENVIO' as const,
      serviceId: String(s.id ?? ''),
      carrier: String(company.name ?? 'Transportadora').slice(0, 80),
      service: String(s.name ?? '').slice(0, 80),
      price: err ? null : price,
      deadlineDays: err || !Number.isFinite(days) ? null : days,
      error: err ?? (price === null ? 'Sem preço para este envio.' : null),
    }
  })
}

/** Lista de serviços do Melhor Envio (GET /api/v2/me/shipment/services) para escolher o que aparece. */
export function parseMelhorEnvioServices(body: unknown) {
  const list = Array.isArray(body) ? (body as Record<string, unknown>[]) : []
  return list
    .map((s) => ({ id: Number(s.id), name: String(s.name ?? ''), company: String((s.company as Record<string, unknown> | undefined)?.name ?? '') }))
    .filter((s) => Number.isFinite(s.id) && s.id > 0)
}

/** Preço dos Correios (GET /preco/v1/nacional/{produto}): pcFinal ("45,90"). */
export function parseCorreiosPrice(body: unknown): number | null {
  const b = (body ?? {}) as Record<string, unknown>
  return money(b.pcFinal ?? b.pcBase)
}

/** Prazo dos Correios (GET /prazo/v1/nacional/{produto}): prazoEntrega em dias úteis. */
export function parseCorreiosDeadline(body: unknown): number | null {
  const n = Number(((body ?? {}) as Record<string, unknown>).prazoEntrega)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Mensagem de erro dos Correios (msgs: [...] ou txErro). */
export function correiosError(body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>
  const msgs = Array.isArray(b.msgs) ? b.msgs.filter((x) => typeof x === 'string') : []
  const t = msgs.join(' ') || (typeof b.txErro === 'string' ? b.txErro : '') || (typeof b.message === 'string' ? b.message : '')
  return t.trim() ? t.trim().slice(0, 200) : null
}

/**
 * Serviço adicional "Valor Declarado" do produto (obrigatório quando vai o valor da mercadoria): 019 na linha SEDEX
 * (expressa) e 064 na linha PAC (standard).
 */
export function correiosDeclaredService(product: CorreiosProduct): string {
  return /sedex|expres|premium/i.test(product.name) || ['03220', '04014', '03204', '04162'].includes(product.code) ? '019' : '064'
}

/** Query de preço dos Correios: peso em gramas, medidas em cm, objeto tipo 2 (pacote); com valor, o Valor Declarado do produto. */
export function correiosPriceQuery(from: string, to: string, p: PackageInput, declaredService?: string | null) {
  return new URLSearchParams({
    cepOrigem: from,
    cepDestino: to,
    psObjeto: String(Math.max(1, Math.round(p.weightKg * 1000))),
    tpObjeto: '2',
    comprimento: String(p.lengthCm),
    largura: String(p.widthCm),
    altura: String(p.heightCm),
    ...(p.value > 0 && declaredService ? { vlDeclarado: p.value.toFixed(2), servicosAdicionais: declaredService } : {}),
  })
}

// ─────────── Rodonaves (RTE) ───────────
// Documentação oficial: dev.rodonaves.com.br. Cada API tem base e token próprios (mesmo usuário e senha da API, pedidos
// na filial de vínculo da Rodonaves). Cotação: POST /api/v1/gera-cotacao; cidade pelo CEP: GET /api/cities/byzipcode.

/** Rodonaves: usuário e senha da API (não o login do portal), CNPJ cadastrado na Rodonaves e o contato da cotação. */
export interface RodonavesConfig {
  enabled: boolean
  user: string
  /** Senha da API (criptografada). */
  passwordEnc: string | null
  /** CustomerTaxIdRegistration: CNPJ do cliente cadastrado na Rodonaves. Vazio = CNPJ da filial de origem. */
  cnpj: string
  contactName: string
  contactPhone: string
}

export const DEFAULT_RODONAVES: RodonavesConfig = { enabled: false, user: '', passwordEnc: null, cnpj: '', contactName: '', contactPhone: '' }

export const RODONAVES_DNE_BASE = 'https://dne-api.rte.com.br'
export const RODONAVES_QUOTE_BASE = 'https://quotation-apigateway.rte.com.br'

/** Corpo do POST {base}/token (application/x-www-form-urlencoded). */
export function rodonavesTokenForm(user: string, password: string) {
  return new URLSearchParams({ grant_type: 'password', username: user, password, auth_type: 'DEV' })
}

/** Resposta do token: access_token e a validade (expires_in em segundos; sem ela, 8 horas). */
export function parseRodonavesToken(body: unknown): { token: string; expiresInSec: number } | null {
  const b = (body ?? {}) as Record<string, unknown>
  const token = typeof b.access_token === 'string' ? b.access_token.trim() : ''
  if (!token) return null
  const exp = Number(b.expires_in)
  return { token, expiresInSec: Number.isFinite(exp) && exp > 0 ? exp : 8 * 3600 }
}

/** Cidade da Rodonaves pelo CEP: { Id, Description, IbgeCityCode }. */
export function parseRodonavesCity(body: unknown): number | null {
  const b = (body ?? {}) as Record<string, unknown>
  const id = Number(b.Id ?? b.id)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Pedido de cotação (POST /api/v1/gera-cotacao): peso em kg, medidas em cm. */
export function rodonavesBody(
  d: { from: string; to: string; originCityId: number; destCityId: number; cnpj: string; recipientDoc: string; contactName: string; contactPhone: string },
  p: PackageInput,
) {
  const weight = Math.round(p.weightKg * 1000) / 1000
  return {
    OriginZipCode: d.from.replace(/\D/g, ''),
    OriginCityId: d.originCityId,
    DestinationZipCode: d.to.replace(/\D/g, ''),
    DestinationCityId: d.destCityId,
    TotalWeight: weight,
    EletronicInvoiceValue: Math.round(p.value * 100) / 100,
    CustomerTaxIdRegistration: d.cnpj.replace(/\D/g, ''),
    ReceiverCpfcnp: d.recipientDoc.replace(/\D/g, ''),
    ContactName: d.contactName,
    ContactPhoneNumber: d.contactPhone.replace(/\D/g, ''),
    TotalPackages: 1,
    Packs: [{ AmountPackages: 1, Weight: weight, Length: p.lengthCm, Height: p.heightCm, Width: p.widthCm }],
  }
}

/**
 * Valor em texto, no formato brasileiro ou americano ("1.234,56", "1,234.56", "1234.56", "R$ 45,90"): o último separador
 * é o decimal; só pontos (mais de um) são milhar.
 */
export function decimalText(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
  if (typeof v !== 'string') return null
  let t = v.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(t)) return null
  const comma = t.lastIndexOf(',')
  const dot = t.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (comma >= 0) t = t.replace(/,/g, (_, i: number) => (i === comma ? '.' : ''))
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Mensagem de erro das APIs da Rodonaves (formatos variados: Message, message, error_description, errors). */
export function rodonavesError(body: unknown): string | null {
  if (typeof body === 'string') return body.trim() ? body.trim().slice(0, 200) : null
  const b = (body ?? {}) as Record<string, unknown>
  const pick = [b.Message, b.message, b.error_description, b.Error, b.error, b.title].find((x) => typeof x === 'string' && x.trim()) as string | undefined
  const errs = b.errors ?? b.Errors
  const list = Array.isArray(errs) ? errs.map((e) => (typeof e === 'string' ? e : String((e as Record<string, unknown>)?.Message ?? (e as Record<string, unknown>)?.message ?? ''))) : errs && typeof errs === 'object' ? Object.values(errs as Record<string, unknown>).flat().map(String) : []
  const t = [pick, ...list].filter((x) => x && x.trim()).join(' · ')
  return t ? t.slice(0, 200) : null
}

/** Resposta da cotação: FreightValue (texto), ProtocolId. A resposta não traz prazo. */
export function parseRodonaves(body: unknown): { price: number | null; protocol: string | null; error: string | null } {
  const b = (body ?? {}) as Record<string, unknown>
  const price = decimalText(b.FreightValue)
  const protocol = b.ProtocolId !== undefined && b.ProtocolId !== null ? String(b.ProtocolId) : null
  return { price, protocol, error: price === null || price <= 0 ? (rodonavesError(body) ?? 'Sem preço para este envio.') : null }
}

// ─────────── DHL Express (MyDHL API) ───────────

export type DhlScope = 'NACIONAL' | 'INTERNACIONAL' | 'AMBOS'

/** DHL Express: API Key e API Secret do MyDHL API (Basic), número da conta e onde cotar (nacional, internacional ou ambos). */
export interface DhlConfig {
  enabled: boolean
  apiKey: string
  /** API Secret (criptografado). */
  apiSecretEnc: string | null
  accountNumber: string
  /** Ambiente de teste da DHL. */
  sandbox: boolean
  scope: DhlScope
}

export const DEFAULT_DHL: DhlConfig = { enabled: false, apiKey: '', apiSecretEnc: null, accountNumber: '', sandbox: false, scope: 'AMBOS' }

export const DHL_BASE = { prod: 'https://express.api.dhl.com/mydhlapi', test: 'https://express.api.dhl.com/mydhlapi/test' } as const

export const dhlDomestic = (s: DhlScope) => s === 'NACIONAL' || s === 'AMBOS'
export const dhlInternational = (s: DhlScope) => s === 'INTERNACIONAL' || s === 'AMBOS'

/** Próximo dia útil (segunda a sexta) depois de hoje no horário de Brasília, em AAAA-MM-DD. */
export function nextBusinessDay(now: Date = new Date()): string {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const d = new Date(`${local}T12:00:00Z`)
  do d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

export interface DhlPlace {
  country: string
  postalCode: string
  city: string
}

/** Query do GET {base}/rates: peso em kg e medidas em cm (metric); isCustomsDeclarable = mercadoria com despacho aduaneiro. */
export function dhlRatesQuery(d: { account: string; origin: DhlPlace; dest: DhlPlace; customs: boolean; date: string }, p: PackageInput) {
  const zip = (pl: DhlPlace) => (pl.country.toUpperCase() === 'BR' ? pl.postalCode.replace(/\D/g, '') : pl.postalCode.trim())
  return new URLSearchParams({
    accountNumber: d.account,
    originCountryCode: d.origin.country.toUpperCase(),
    originPostalCode: zip(d.origin),
    originCityName: d.origin.city.trim(),
    destinationCountryCode: d.dest.country.toUpperCase(),
    destinationPostalCode: zip(d.dest),
    destinationCityName: d.dest.city.trim(),
    weight: String(Math.max(0.001, Math.round(p.weightKg * 1000) / 1000)),
    length: String(Math.max(1, Math.round(p.lengthCm))),
    width: String(Math.max(1, Math.round(p.widthCm))),
    height: String(Math.max(1, Math.round(p.heightCm))),
    plannedShippingDate: d.date,
    isCustomsDeclarable: d.customs ? 'true' : 'false',
    unitOfMeasurement: 'metric',
  })
}

/** Mensagem de erro da DHL: { status, title, detail, additionalDetails[] }. */
export function dhlError(body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>
  const extra = Array.isArray(b.additionalDetails) ? b.additionalDetails.map((x) => (typeof x === 'string' ? x : String((x as Record<string, unknown>)?.message ?? ''))) : []
  const t = [b.detail, b.title, b.message]
    .find((x) => typeof x === 'string' && x.trim()) as string | undefined
  const all = [t, ...extra].filter((x) => x && x.trim()).join(' · ')
  return all ? all.slice(0, 200) : null
}

/** Resposta do GET /rates: um item por produto; preço na moeda de cobrança (BILLC) quando houver. */
export function parseDhlRates(body: unknown): OnlineQuote[] {
  const b = (body ?? {}) as Record<string, unknown>
  const products = Array.isArray(b.products) ? (b.products as Record<string, unknown>[]) : []
  if (!products.length) return [{ source: 'DHL', serviceId: '', carrier: 'DHL Express', service: '', price: null, deadlineDays: null, error: dhlError(body) ?? 'A DHL não ofereceu serviço para este envio.' }]
  return products.map((s) => {
    const prices = Array.isArray(s.totalPrice) ? (s.totalPrice as Record<string, unknown>[]) : []
    const withPrice = prices.filter((x) => decimalText(x.price) !== null)
    const chosen = withPrice.find((x) => String(x.currencyType ?? '').toUpperCase() === 'BILLC') ?? withPrice[0]
    const price = chosen ? decimalText(chosen.price) : null
    const currency = chosen && typeof chosen.priceCurrency === 'string' ? chosen.priceCurrency.toUpperCase() : 'BRL'
    const name = String(s.productName ?? s.productCode ?? 'Serviço').trim().slice(0, 70)
    const cap = (s.deliveryCapabilities ?? {}) as Record<string, unknown>
    const days = Number(cap.totalTransitDays)
    const ok = price !== null && price > 0
    return {
      source: 'DHL' as const,
      serviceId: String(s.productCode ?? s.localProductCode ?? ''),
      carrier: 'DHL Express',
      service: currency !== 'BRL' ? `${name} (${currency})` : name,
      price: ok ? price : null,
      deadlineDays: ok && Number.isFinite(days) && days >= 0 ? days : null,
      error: ok ? null : 'Sem preço para este envio.',
    }
  })
}
