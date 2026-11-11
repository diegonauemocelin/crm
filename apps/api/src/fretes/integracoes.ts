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
  source: 'MELHOR_ENVIO' | 'CORREIOS' | 'BRASPRESS' | 'JADLOG'
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
