// Frete no Google Shopping: regras sem banco (test/merchant-frete.spec.ts). O frete de cada produto é simulado na
// Magazord (a mesma conta do carrinho) para um ou mais CEPs da capital e do interior de cada estado e enviado ao
// Merchant Center numa fonte suplementar, com uma tarifa por região (capital e interior de cada estado e o DF inteiro;
// regiões do Merchant Center definidas pelas faixas de CEP).

export const MERCHANT_KEY = 'merchant_frete'
export const CONTENT_SCOPE = 'https://www.googleapis.com/auth/content'
export const MERCHANT_API = 'https://merchantapi.googleapis.com'
export const SUPPLEMENTAL_NAME = 'CRM - Frete por estado'

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] as const
export type Uf = (typeof UFS)[number]

/** Faixas de CEP de cada estado, em prefixos (início e fim com o mesmo tamanho, como o Merchant Center pede). */
export const UF_CEP_RANGES: Record<Uf, [string, string][]> = {
  SP: [['01*', '19*']],
  RJ: [['20*', '28*']],
  ES: [['29*', '29*']],
  MG: [['30*', '39*']],
  BA: [['40*', '48*']],
  SE: [['49*', '49*']],
  PE: [['50*', '56*']],
  AL: [['57*', '57*']],
  PB: [['58*', '58*']],
  RN: [['59*', '59*']],
  CE: [['60*', '63*']],
  PI: [['64*', '64*']],
  MA: [['65*', '65*']],
  PA: [['66*', '67*'], ['680*', '688*']],
  AP: [['689*', '689*']],
  AM: [['690*', '692*'], ['694*', '698*']],
  RR: [['693*', '693*']],
  AC: [['699*', '699*']],
  DF: [['70*', '71*'], ['720*', '727*'], ['730*', '736*']],
  GO: [['728*', '729*'], ['737*', '739*'], ['74*', '75*'], ['760*', '767*']],
  RO: [['768*', '769*']],
  TO: [['77*', '77*']],
  MT: [['780*', '788*']],
  MS: [['79*', '79*']],
  PR: [['80*', '87*']],
  SC: [['88*', '89*']],
  RS: [['90*', '99*']],
}

/** CEP de referência da capital de cada estado (centro). O do interior fica em UF_INT_REF_CEP; os dois dá para trocar na tela. */
export const UF_REF_CEP: Record<Uf, string> = {
  AC: '69900062', AL: '57020000', AM: '69005000', AP: '68900073', BA: '40010000', CE: '60010000', DF: '70040010', ES: '29010001',
  GO: '74003010', MA: '65010000', MG: '30110000', MS: '79002000', MT: '78005000', PA: '66010000', PB: '58010000', PE: '50010000',
  PI: '64000020', PR: '80010000', RJ: '20010000', RN: '59010000', RO: '76801000', RR: '69301000', RS: '90010000', SC: '88010000',
  SE: '49010000', SP: '01001000', TO: '77001002',
}

/** Região antiga (um estado inteiro). Desde as regiões de capital e interior só o DF continua assim. */
export const regionId = (uf: Uf) => `crm-uf-${uf.toLowerCase()}`

// ---------- Capital e interior ----------

/**
 * Faixas de CEP da capital de cada estado (prefixos de 5 dígitos, inclusive). O resto do estado é o interior. O DF é
 * uma região só. Conferido em 13/11/2026 no ViaCEP (e no OpenCEP, espelho da mesma base, quando o ViaCEP passou a
 * recusar as consultas), com CEPs do começo, do meio e do fim da faixa e o primeiro depois dela:
 * - SP 01001-000, 03501-000 São Paulo | 06010-000 Osasco; 08010-000, 08491-030 São Paulo | 08500-010 Ferraz de Vasconcelos.
 * - RJ 20005-001, 21910-010 Rio de Janeiro | 23810-000 Itaguaí. MG 31010-030, 31998-000 Belo Horizonte | 32001-970 Contagem.
 * - ES 29033-010, 29066-010 Vitória | 29100-010 Vila Velha. BA 40010-000, 41299-010 Salvador | 42600-970 Madre de Deus.
 * - SE 49000-001, 49066-010 Aracaju | 49100-001 São Cristóvão. PE 50010-000, 51020-000, 52280-000 Recife | 53110-000 Olinda.
 * - AL 57010-000, 57050-000 Maceió | 57100-000 Rio Largo. PB 58010-000, 58050-000 João Pessoa | 58100-000 Campina Grande.
 * - RN: CORRIGIDO de 59000–59099 para 59000–59139 (59101-000, 59120-000, 59139-000 são Natal, zona norte; 59141-000
 *   Parnamirim). CE 60010-000, 60870-010 Fortaleza | 61600-010 Caucaia. PI 64000-010, 64099-000 Teresina | 64100-000 Barras.
 * - MA 65049-000, 65096-010 São Luís. PA 66010-000, 66810-000, 66929-010 Belém | 67010-000 Ananindeua.
 * - AP 68900-010, 68913-000 Macapá | 68915-000 Ferreira Gomes. AM 69004-010, 69099-000 Manaus | 69100-030 Itacoatiara.
 * - RR 69301-000, 69319-000 Boa Vista | 69340-000 Mucajaí. AC 69900-010, 69923-000 Rio Branco | 69925-000 Senador Guiomard.
 * - GO 74001-970, 74450-010, 74890-020 Goiânia | 74905-010 Aparecida de Goiânia. TO 77015-010, 77064-010 Palmas | 77300-000 Dianópolis.
 * - MT 78005-000, 78108-000 Cuiabá | 78110-000 Várzea Grande. PR 80010-000, 82900-000 Curitiba | 83005-000 São José dos Pinhais.
 * - SC 88049-000, 88095-000 Florianópolis | 88101-000 São José. RS 90010-000, 91900-000 Porto Alegre | 92010-000 Canoas.
 * - RO 76801-000, 76829-000 Porto Velho e MS 79002-000, 79118-000 Campo Grande: logo depois vêm distritos rurais do
 *   mesmo município (76835-000 São Carlos, 76840-000 Jaci Paraná; 79125-000 Anhanduí), longe da cidade: ficam no interior.
 */
export const UF_CAPITAL_RANGES: Record<Exclude<Uf, 'DF'>, [number, number][]> = {
  SP: [[1000, 5999], [8000, 8499]],
  RJ: [[20000, 23799]],
  MG: [[30000, 31999]],
  ES: [[29000, 29099]],
  BA: [[40000, 42599]],
  SE: [[49000, 49099]],
  PE: [[50000, 52999]],
  AL: [[57000, 57099]],
  PB: [[58000, 58099]],
  RN: [[59000, 59139]],
  CE: [[60000, 61599]],
  PI: [[64000, 64099]],
  MA: [[65000, 65099]],
  PA: [[66000, 66999]],
  AP: [[68900, 68914]],
  AM: [[69000, 69099]],
  RR: [[69300, 69339]],
  AC: [[69900, 69924]],
  GO: [[74000, 74899]],
  TO: [[77000, 77249]],
  MT: [[78000, 78109]],
  RO: [[76800, 76834]],
  MS: [[79000, 79124]],
  PR: [[80000, 82999]],
  SC: [[88000, 88099]],
  RS: [[90000, 91999]],
}

/**
 * CEP de referência do interior: uma rua do centro de uma cidade grande do interior (ViaCEP com logradouro e UF
 * conferidos em 13/11/2026). PR e SC usam as cidades mais longe da matriz (Londrina e Joinville), para o anúncio não
 * mostrar menos que o carrinho.
 */
export const UF_INT_REF_CEP: Record<Exclude<Uf, 'DF'>, string> = {
  SP: '13010000', // Campinas, Av. Doutor Moraes Salles
  RJ: '28010000', // Campos dos Goytacazes, Praça Santíssimo Salvador
  MG: '38400140', // Uberlândia, Praça Professor Henckmar Borges
  ES: '29300070', // Cachoeiro de Itapemirim, Rua Coronel Guardia
  BA: '44076015', // Feira de Santana, Av. Getúlio Vargas
  SE: '49500010', // Itabaiana, Rua Manoel Domingos Pereira
  PE: '55002010', // Caruaru, Rua Presidente Afonso Pena
  AL: '57300400', // Arapiraca, Rua Doutor Pedro Correia
  PB: '58400160', // Campina Grande, Praça Poeta Augusto dos Anjos
  RN: '59600080', // Mossoró, Rua Doutor Mário Negócio
  CE: '63010010', // Juazeiro do Norte, Rua São Pedro
  PI: '64200060', // Parnaíba, Rua Pará
  MA: '65900010', // Imperatriz, Rua Coronel Manoel Bandeira
  PA: '68005020', // Santarém, Rua Siqueira Campos
  AP: '68926040', // Santana, Av. Maria Izabel Pereira da Silva
  AM: '69151020', // Parintins, Rua João Melo
  RR: '69373970', // Rorainópolis, Rua Pedro Daniel Silva (agência dos Correios: o interior de RR não tem CEP de rua)
  AC: '69980970', // Cruzeiro do Sul, Rua Rego Barros (agência dos Correios: a cidade não tem CEP de rua)
  GO: '75020060', // Anápolis, Rua 10 de Março
  TO: '77803100', // Araguaína, Av. Paranaíba
  MT: '78700040', // Rondonópolis, Rua Floriano Peixoto
  RO: '76900060', // Ji-Paraná, Rua Júlio Guerra
  MS: '79802030', // Dourados, Rua Cuiabá
  PR: '86010030', // Londrina, Praça Robert Salum
  SC: '89201090', // Joinville, Rua Itajaí
  RS: '95010070', // Caxias do Sul, Rua Visconde de Mauá
}

/** Muda quando as regiões mudam: a conta precisa ser preparada de novo (as regiões são criadas no Preparar a conta). */
export const REGIONS_VERSION = 2
export const REGIONS_OUTDATED_MSG = 'Clique em Preparar a conta de novo (regiões novas: capital e interior).'

export type Zone = 'CAP' | 'INT'
/** Chave da região (e dos CEPs configurados): "SC-CAP", "SC-INT" ou "DF". */
export type RegionKey = `${Exclude<Uf, 'DF'>}-${Zone}` | 'DF'

const pad5 = (n: number) => String(n).padStart(5, '0')

/** Prefixo do Merchant Center ('01*', '680*') em intervalo de prefixos de 5 dígitos. */
export function prefixInterval(begin: string, end: string): [number, number] {
  const b = begin.replace(/\D/g, '')
  const e = end.replace(/\D/g, '')
  return [Number(b.padEnd(5, '0')), Number(e.padEnd(5, '9'))]
}

/** Intervalos do estado (prefixos de 5 dígitos), em ordem e juntos quando encostam. */
export function stateIntervals(uf: Uf): [number, number][] {
  return mergeIntervals(UF_CEP_RANGES[uf].map(([b, e]) => prefixInterval(b, e)))
}

export function mergeIntervals(list: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** Intervalos de `from` sem os de `minus`. */
export function subtractIntervals(from: [number, number][], minus: [number, number][]): [number, number][] {
  let cur = mergeIntervals(from)
  for (const [a, b] of mergeIntervals(minus)) {
    const next: [number, number][] = []
    for (const [x, y] of cur) {
      if (b < x || a > y) next.push([x, y])
      else {
        if (a > x) next.push([x, a - 1])
        if (b < y) next.push([b + 1, y])
      }
    }
    cur = next
  }
  return cur
}

/**
 * Intervalo em prefixos do Merchant Center, o mais curto possível com início e fim do mesmo tamanho
 * (ex.: 06000–07999 → 06*–07*; 08500–19999 → 085*–199*).
 */
export function toPostalCodes(list: [number, number][]): { begin: string; end: string }[] {
  return list.map(([a, b]) => {
    const s = pad5(a)
    const e = pad5(b)
    let k = 0
    while (k < 3 && s.endsWith('0'.repeat(k + 1)) && e.endsWith('9'.repeat(k + 1))) k++
    return { begin: `${s.slice(0, 5 - k)}*`, end: `${e.slice(0, 5 - k)}*` }
  })
}

export interface FreteRegion {
  key: RegionKey
  uf: Uf
  zone: Zone | null
  /** Id da região no Merchant Center. */
  id: string
  name: string
  /** Prefixos de 5 dígitos (inclusive). */
  intervals: [number, number][]
  /** CEP de referência (sem CEPs configurados). */
  refCep: string
}

export const regionIdOf = (key: RegionKey) => `crm-uf-${key.toLowerCase()}`

/** As 53 regiões: capital e interior de cada estado e o DF inteiro. */
export const REGIONS: FreteRegion[] = UFS.flatMap((uf): FreteRegion[] => {
  if (uf === 'DF') return [{ key: 'DF', uf, zone: null, id: regionIdOf('DF'), name: 'CRM DF', intervals: stateIntervals('DF'), refCep: UF_REF_CEP.DF }]
  const cap = mergeIntervals(UF_CAPITAL_RANGES[uf])
  return [
    { key: `${uf}-CAP`, uf, zone: 'CAP', id: regionIdOf(`${uf}-CAP`), name: `CRM ${uf} capital`, intervals: cap, refCep: UF_REF_CEP[uf] },
    { key: `${uf}-INT`, uf, zone: 'INT', id: regionIdOf(`${uf}-INT`), name: `CRM ${uf} interior`, intervals: subtractIntervals(stateIntervals(uf), cap), refCep: UF_INT_REF_CEP[uf] },
  ]
})
export const REGION_BY_KEY = new Map(REGIONS.map((r) => [r.key, r]))

const inIntervals = (cep: string, list: [number, number][]) => {
  const p = Number(cep.replace(/\D/g, '').slice(0, 5))
  return list.some(([a, b]) => p >= a && p <= b)
}

/** Região (capital/interior/DF) do CEP, pelas faixas; null = fora do Brasil conhecido. */
export function regionOfCep(cep: string): FreteRegion | null {
  const c = cep.replace(/\D/g, '')
  if (c.length !== 8) return null
  return REGIONS.find((r) => inIntervals(c, r.intervals)) ?? null
}

/** Chaves aceitas em "CEPs por estado": "SC" (vale para capital e interior), "SC-CAP", "SC-INT" e "DF". */
export const CEP_KEYS: string[] = UFS.flatMap((uf) => (uf === 'DF' ? [uf] : [uf, `${uf}-CAP`, `${uf}-INT`]))

/**
 * Google aceita até 100 atributos shipping por produto (especificação de dados de produto do Merchant Center:
 * "Submit up to 100 shipping attributes"). São 53 regiões, uma tarifa cada: sobra folga.
 */
export const MAX_SHIPPING_ENTRIES = 100

export interface MerchantFreteConfig {
  enabled: boolean
  /** Número da conta no Merchant Center. */
  merchantId: string
  /** E-mail Google de uma PESSOA administradora do Merchant Center: o Google não aceita conta de serviço no registro do projeto. */
  developerEmail: string
  /** Nome do serviço de entrega que aparece no Google (ex.: "Entrega"). */
  service: string
  /** Dias úteis para separar e postar o pedido (manuseio). */
  handlingMin: number
  handlingMax: number
  /** Produtos atualizados por rodada (uma por noite); cada produto leva uma simulação por CEP de cada estado. */
  batchSize: number
  /**
   * CEPs por região (vazio = o CEP de referência). Chaves "SC-CAP" (capital), "SC-INT" (interior) ou "SC" (antiga:
   * vale para as duas quando a da região não existe). Vale o frete mais alto entre os CEPs.
   */
  ceps: Partial<Record<string, string[]>>
  /**
   * De onde vem o frete: 'magazord' simula no carrinho da loja (o mesmo valor que o cliente paga; recomendado) e
   * 'crm' calcula pelas tabelas das transportadoras cadastradas em Fretes.
   */
  source: FreteSource
  /** Fonte 'crm': filial de origem (precisa ter o CEP de expedição). */
  unitId: string | null
  /** Fonte 'crm': só estas transportadoras (vazio = todas as ativas da filial). */
  carrierIds: string[]
  /** Fonte 'magazord': consultas por minuto à simulação de frete (a Magazord responde 429 quando passa do limite). */
  magazordPerMinute: number
  /** Produto sem mudança de preço/peso/CEPs é refeito só depois destes dias (a tabela da loja pode ter mudado). */
  refreshDays: number
  /** Fonte suplementar criada no Merchant Center (accounts/{id}/dataSources/{id}). */
  dataSource: string | null
  preparedAt: string | null
  /** Versão das regiões criadas no último Preparar a conta (REGIONS_VERSION); diferente = preparar de novo. */
  regionsVersion?: number | null
  lastRunAt: string | null
  lastError: string | null
  /** Resumo da última rodada (enviados, com erro, sem mudança). */
  lastSummary: string | null
  /** Rodada pausada pelo limite da Magazord: continua a partir desta hora (dentro da janela da noite). */
  resumeAt: string | null
}

export type FreteSource = 'magazord' | 'crm'

export const DEFAULT_MERCHANT_FRETE: MerchantFreteConfig = {
  enabled: false,
  merchantId: '',
  developerEmail: '',
  service: 'Entrega',
  handlingMin: 1,
  handlingMax: 2,
  batchSize: 200,
  ceps: {},
  source: 'magazord',
  unitId: null,
  carrierIds: [],
  magazordPerMinute: 40,
  refreshDays: 7,
  dataSource: null,
  preparedAt: null,
  regionsVersion: null,
  lastRunAt: null,
  lastError: null,
  lastSummary: null,
  resumeAt: null,
}

const cleanCeps = (raw: unknown) =>
  [...new Set((Array.isArray(raw) ? raw : []).map((c) => String(c).replace(/\D/g, '')).filter((c) => c.length === 8))].slice(0, 5)

/** CEPs usados para a região: os da região ("SC-CAP"), senão os do estado ("SC", antigo), senão o de referência. */
export function cepsOf(cfg: Pick<MerchantFreteConfig, 'ceps'>, key: RegionKey): string[] {
  const r = REGION_BY_KEY.get(key)!
  const own = cleanCeps(cfg.ceps[key])
  if (own.length) return own
  const legacy = r.zone ? cleanCeps(cfg.ceps[r.uf]) : []
  return legacy.length ? legacy : [r.refCep]
}

/** Regiões já preparadas no Merchant Center com as faixas atuais (capital e interior)? */
export const regionsReady = (cfg: Pick<MerchantFreteConfig, 'dataSource' | 'regionsVersion'>) => !!cfg.dataSource && cfg.regionsVersion === REGIONS_VERSION

/**
 * Confere um CEP configurado para a chave pelas faixas: "-CAP" tem de ser da capital e "-INT" do interior do estado.
 * Chave do estado ("SC", "DF"): só o estado. null = ok.
 */
export function cepKeyError(key: string, cep: string): string | null {
  const fmt = `${cep.slice(0, 5)}-${cep.slice(5)}`
  const m = /^([A-Z]{2})(?:-(CAP|INT))?$/.exec(key)
  if (!m || !CEP_KEYS.includes(key)) return `Região "${key}" inválida: use a sigla do estado, com -CAP (capital) ou -INT (interior).`
  const uf = m[1] as Uf
  const zone = m[2] as Zone | undefined
  const r = regionOfCep(cep)
  if (!r || r.uf !== uf) return `O CEP ${fmt} não fica nas faixas de CEP de ${uf}.`
  if (zone === 'CAP' && r.zone !== 'CAP') return `O CEP ${fmt} não é da capital de ${uf}: use ${uf}-INT.`
  if (zone === 'INT' && r.zone !== 'INT') return `O CEP ${fmt} é da capital de ${uf}: use ${uf}-CAP.`
  return null
}

export function cleanConfig(input: Partial<MerchantFreteConfig>, cur: MerchantFreteConfig): MerchantFreteConfig | { error: string } {
  const merchantId = String(input.merchantId ?? cur.merchantId).replace(/\D/g, '')
  const int = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v ?? d)
    return Number.isInteger(n) && n >= min && n <= max ? n : null
  }
  const handlingMin = int(input.handlingMin, cur.handlingMin, 0, 30)
  const handlingMax = int(input.handlingMax, cur.handlingMax, 0, 30)
  const batchSize = int(input.batchSize, cur.batchSize, 10, 2000)
  if (handlingMin === null || handlingMax === null || handlingMin > handlingMax) return { error: 'Prazo de manuseio: de 0 a 30 dias úteis, com o mínimo menor ou igual ao máximo.' }
  if (batchSize === null) return { error: 'Produtos por rodada: de 10 a 2.000.' }
  const magazordPerMinute = int(input.magazordPerMinute, cur.magazordPerMinute ?? DEFAULT_MERCHANT_FRETE.magazordPerMinute, 5, 120)
  if (magazordPerMinute === null) return { error: 'Consultas por minuto na Magazord: de 5 a 120.' }
  const refreshDays = int(input.refreshDays, cur.refreshDays ?? DEFAULT_MERCHANT_FRETE.refreshDays, 1, 60)
  if (refreshDays === null) return { error: 'Refazer o frete de cada produto: de 1 a 60 dias.' }
  const rawSource = input.source ?? cur.source ?? 'magazord'
  if (rawSource !== 'magazord' && rawSource !== 'crm') return { error: 'Fonte do frete inválida.' }
  const source: FreteSource = rawSource
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const rawUnit = input.unitId === undefined ? (cur.unitId ?? null) : input.unitId
  const unitId = rawUnit ? String(rawUnit).trim() : null
  if (unitId && !uuid.test(unitId)) return { error: 'Filial de origem inválida.' }
  if (source === 'crm' && !unitId) return { error: 'Escolha a filial de origem do frete calculado pelo CRM.' }
  const rawCarriers = input.carrierIds ?? cur.carrierIds ?? []
  if (!Array.isArray(rawCarriers)) return { error: 'Transportadoras inválidas.' }
  const carrierIds = [...new Set(rawCarriers.map((c) => String(c).trim()))]
  if (carrierIds.length > 50 || carrierIds.some((c) => !uuid.test(c))) return { error: 'Transportadoras inválidas.' }
  const enabled = input.enabled ?? cur.enabled
  if (enabled && !merchantId) return { error: 'Informe o número da conta do Merchant Center.' }
  const ceps: Partial<Record<string, string[]>> = {}
  // Com input.ceps, a lista nova substitui a anterior inteira (chave que sumiu da tela sai da configuração).
  const src = input.ceps ?? cur.ceps ?? {}
  for (const key of CEP_KEYS) {
    const list = cleanCeps(src[key])
    if (!list.length) continue
    // Só as chaves da região (-CAP/-INT) conferem capital/interior; a do estado vale para as duas.
    if (key.includes('-')) for (const cep of list) {
      const err = cepKeyError(key, cep)
      if (err) return { error: err }
    }
    ceps[key] = list
  }
  const service = String(input.service ?? cur.service).trim().slice(0, 60) || 'Entrega'
  const developerEmail = String(input.developerEmail ?? cur.developerEmail ?? '').trim().toLowerCase().slice(0, 120)
  if (developerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(developerEmail)) return { error: 'E-mail da pessoa administradora inválido.' }
  if (developerEmail.endsWith('.gserviceaccount.com')) return { error: 'Use o e-mail Google de uma pessoa (não o da conta de serviço): o Google não aceita conta de serviço no registro.' }
  return { ...DEFAULT_MERCHANT_FRETE, ...cur, enabled, merchantId, developerEmail, service, handlingMin, handlingMax, batchSize, ceps, source, unitId, carrierIds, magazordPerMinute, refreshDays, dataSource: merchantId === cur.merchantId ? cur.dataSource : null, preparedAt: merchantId === cur.merchantId ? cur.preparedAt : null, regionsVersion: merchantId === cur.merchantId ? (cur.regionsVersion ?? null) : null }
}

export interface UfQuote {
  /** Região (capital, interior ou DF). Sem ela (frete guardado antes das regiões novas), o estado inteiro. */
  region?: RegionKey
  uf: Uf
  /** Frete da região (o mais alto entre os CEPs, da opção mais barata de cada um); null = sem entrega para a região. */
  price: number | null
  days: number | null
}

/** Frete da região: em cada CEP vale a opção mais barata; entre os CEPs, a mais cara (o anúncio nunca mostra menos que o carrinho). */
export function ufQuote(key: RegionKey, perCep: { price: number; days: number | null }[][]): UfQuote {
  const uf = REGION_BY_KEY.get(key)!.uf
  let price: number | null = null
  let days: number | null = null
  for (const opts of perCep) {
    if (!opts.length) return { region: key, uf, price: null, days: null }
    const best = [...opts].sort((a, b) => a.price - b.price || (a.days ?? 99) - (b.days ?? 99))[0]!
    if (price === null || best.price > price) price = best.price
    if (best.days !== null && (days === null || best.days > days)) days = best.days
  }
  return { region: key, uf, price, days }
}

const micros = (v: number) => String(Math.round(v * 1_000_000))

/** Atributo shipping do produto: uma tarifa por região com entrega (capital, interior, DF), até 53 de 100 aceitas. */
export function shippingAttribute(quotes: UfQuote[], cfg: Pick<MerchantFreteConfig, 'service' | 'handlingMin' | 'handlingMax'>) {
  return quotes
    .filter((q) => q.price !== null)
    .slice(0, MAX_SHIPPING_ENTRIES)
    .map((q) => ({
      price: { amountMicros: micros(q.price!), currencyCode: 'BRL' },
      country: 'BR',
      region: q.region ? regionIdOf(q.region) : regionId(q.uf),
      service: cfg.service,
      ...(q.days !== null ? { minHandlingTime: String(cfg.handlingMin), maxHandlingTime: String(cfg.handlingMax), minTransitTime: String(q.days), maxTransitTime: String(q.days) } : {}),
    }))
}

/** Produto do Merchant Center → SKU da Magazord: pelo id da oferta (código ou SKU) ou pelo endereço da página. */
export function matchSku(offer: { offerId: string; link?: string | null }, store: { externalId: string; code: string; path: string | null; url: string | null }[]): string | null {
  const id = offer.offerId.trim().toLowerCase()
  const byId = store.find((s) => s.externalId.toLowerCase() === id || s.code.toLowerCase() === id)
  if (byId) return byId.externalId
  if (!offer.link) return null
  let path: string
  try {
    path = new URL(offer.link).pathname.replace(/\/+$/, '').toLowerCase()
  } catch {
    return null
  }
  if (!path) return null
  const byPath = store.find((s) => {
    const p = (s.path ?? (s.url ? (() => { try { return new URL(s.url).pathname } catch { return '' } })() : '')).replace(/\/+$/, '').toLowerCase()
    return !!p && p === path
  })
  return byPath?.externalId ?? null
}

// ---------- Ritmo das consultas à Magazord ----------

/** Esperas depois de cada 429 da Magazord (sem Retry-After); depois da última, desiste do produto nesta rodada. */
export const MAGAZORD_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const
/** Produtos seguidos sem resposta por causa do limite: a rodada pausa e continua mais tarde. */
export const PAUSE_AFTER_LIMITED = 3
/** Quanto a rodada pausada espera para continuar. */
export const RESUME_AFTER_MS = 30 * 60_000

export interface RateHeaders {
  retryAfter?: string | null
  remaining?: string | null
  reset?: string | null
}
export interface RateInfo {
  retryAfterMs: number | null
  remaining: number | null
  resetMs: number | null
}

/**
 * Cabeçalhos de limite: Retry-After (segundos ou data HTTP), X-RateLimit-Remaining e X-RateLimit-Reset (segundos até
 * liberar, ou o horário Unix em que libera).
 */
export function parseRate(h: RateHeaders, now = Date.now()): RateInfo {
  const n = (v: string | null | undefined) => {
    if (v === null || v === undefined || v.trim() === '') return null
    const x = Number(v.trim())
    return Number.isFinite(x) ? x : null
  }
  let retryAfterMs: number | null = null
  const ra = n(h.retryAfter)
  if (ra !== null) retryAfterMs = Math.max(0, ra * 1000)
  else if (h.retryAfter) {
    const at = Date.parse(h.retryAfter)
    if (Number.isFinite(at)) retryAfterMs = Math.max(0, at - now)
  }
  const remaining = n(h.remaining)
  const reset = n(h.reset)
  const resetMs = reset === null ? null : reset > 1e9 ? Math.max(0, reset * 1000 - now) : Math.max(0, reset * 1000)
  return { retryAfterMs, remaining: remaining === null ? null : Math.max(0, Math.floor(remaining)), resetMs }
}

/** Espera antes de tentar de novo depois de um 429 (null = desiste do produto nesta rodada). Máximo de 2 minutos. */
export function retryWait(attempt: number, rate: Pick<RateInfo, 'retryAfterMs'>): number | null {
  if (attempt >= MAGAZORD_BACKOFF_MS.length) return null
  const base = MAGAZORD_BACKOFF_MS[attempt]!
  return Math.min(120_000, rate.retryAfterMs !== null ? Math.max(rate.retryAfterMs, 1_000) : base)
}

export const gapOf = (perMinute: number) => Math.ceil(60_000 / Math.max(1, perMinute))

/**
 * Ritmo das chamadas: um intervalo mínimo entre elas (das consultas por minuto configuradas), que aumenta 50% a cada
 * 429 (até 15 s) e volta aos poucos ao normal; quando a Magazord avisa que acabou a cota, espera ela liberar.
 */
export class Pacer {
  gap: number
  private next = 0
  constructor(
    readonly base: number,
    readonly maxGap = 15_000,
  ) {
    this.gap = base
  }

  /** Quanto esperar antes da próxima chamada (e reserva a vez). */
  take(now: number) {
    const at = Math.max(now, this.next)
    this.next = at + this.gap
    return at - now
  }

  ok(rate: RateInfo, now: number) {
    this.gap = Math.max(this.base, Math.round(this.gap * 0.95))
    if (rate.remaining !== null && rate.resetMs !== null && rate.remaining < 3) this.next = Math.max(this.next, now + Math.ceil(rate.resetMs / (rate.remaining + 1)))
  }

  limited() {
    this.gap = Math.min(this.maxGap, Math.round(this.gap * 1.5))
  }
}

/**
 * Consultas por produto (um CEP de cada região: capital e interior de cada estado e o DF = 53, ou os configurados;
 * CEP repetido entre regiões é consultado uma vez) e duração estimada da rodada, em minutos.
 */
export function estimateRun(cfg: Pick<MerchantFreteConfig, 'ceps' | 'batchSize' | 'magazordPerMinute' | 'source'>, products?: number) {
  const calls = new Set(REGIONS.flatMap((r) => cepsOf(cfg, r.key))).size
  const n = products ?? cfg.batchSize
  // Envio ao Merchant Center: uma chamada por produto, espaçada em ~1,1 s.
  const sendMs = n * 1_100
  const quoteMs = cfg.source === 'crm' ? n * calls * 20 : n * calls * gapOf(cfg.magazordPerMinute)
  return { calls, products: n, minutes: Math.ceil((sendMs + quoteMs) / 60_000) }
}

// ---------- Produtos sem mudança ----------

/** Guardado em merchant_shipping_items.quotes: frete por região e a "impressão digital" do que foi usado no cálculo. */
export interface StoredQuotes {
  ufs: UfQuote[]
  fp: string
}
export function storedUfs(json: unknown): UfQuote[] {
  if (Array.isArray(json)) return json as UfQuote[]
  const o = json as Partial<StoredQuotes> | null
  return o && Array.isArray(o.ufs) ? o.ufs : []
}
export function storedFp(json: unknown): string | null {
  const o = json as Partial<StoredQuotes> | null
  return o && !Array.isArray(o) && typeof o.fp === 'string' ? o.fp : null
}

/** O que muda o frete do produto: fonte, preço, peso (CRM), CEPs, filial/transportadoras e versões das tabelas (CRM). */
export function fingerprint(x: { source: FreteSource; price: number; weight: number | null; dims?: Dims | null; ceps: Partial<Record<string, string[]>>; unitId?: string | null; carrierIds?: string[]; tables?: string }) {
  const ceps = REGIONS.map((r) => cepsOf({ ceps: x.ceps }, r.key).join(',')).join(';')
  // A versão das regiões entra na conta: regiões novas refazem e reenviam todos os produtos.
  const parts = [x.source, x.price.toFixed(2), ceps, `r${REGIONS_VERSION}`]
  if (x.source === 'crm') parts.push(x.weight === null ? '' : x.weight.toFixed(3), x.unitId ?? '', [...(x.carrierIds ?? [])].sort().join(','), x.tables ?? '')
  // Medidas só entram quando existem (produto sem medidas mantém a impressão digital de antes).
  if (x.source === 'crm' && x.dims) parts.push(`${x.dims.length}x${x.dims.width}x${x.dims.height}`)
  return parts.join('|')
}

/**
 * Precisa recalcular: nunca enviado, com erro, algo mudou (impressão digital) ou passou o prazo de refazer (a tabela
 * da loja pode ter mudado sem o CRM saber).
 */
export function isDue(item: { sentAt: Date | null; error: string | null; quotes: unknown }, fp: string, refreshDays: number, now = Date.now()) {
  if (!item.sentAt || item.error) return true
  if (storedFp(item.quotes) !== fp) return true
  return now - item.sentAt.getTime() >= refreshDays * 86_400_000
}

// ---------- Frete pelas tabelas do CRM ----------

/**
 * Peso bruto (kg) do produto na Tcar: pelo código do produto na loja (o mesmo elo do BI, store_products.code =
 * tcar_products.code) e, se não achar, pelo SKU; sem diferenciar maiúsculas. weights vem de weightIndex.
 */
export function tcarWeightFor(product: { code: string | null; externalId: string }, weights: Map<string, number | null>): number | null {
  for (const key of [product.code, product.externalId]) {
    const k = key?.trim().toLowerCase()
    if (!k) continue
    const w = weights.get(k)
    if (w !== null && w !== undefined && w > 0) return w
  }
  return null
}

/** Medidas (cm) do produto para a cubagem. */
export interface Dims {
  length: number
  width: number
  height: number
}

/**
 * Peso e medidas do produto para o frete pelas tabelas do CRM: primeiro o peso e as medidas da Magazord (copiados
 * para o catálogo), depois o peso bruto da Tcar (sem medidas). Sem nenhum dos dois: erro.
 */
export function productWeight(magazord: { weightKg: number | null; heightCm: number | null; widthCm: number | null; lengthCm: number | null } | null | undefined, tcarWeight: number | null): { weight: number; dims: Dims | null; source: 'magazord' | 'tcar' } | { error: string } {
  const w = magazord?.weightKg
  if (w !== null && w !== undefined && w > 0) {
    const { heightCm: h, widthCm: wd, lengthCm: l } = magazord!
    return { weight: w, dims: h && wd && l ? { length: l, width: wd, height: h } : null, source: 'magazord' }
  }
  if (tcarWeight !== null && tcarWeight > 0) return { weight: tcarWeight, dims: null, source: 'tcar' }
  return { error: 'Sem peso na Magazord (nem peso bruto na Tcar).' }
}

/** Índice de pesos para tcarWeightFor (monta uma vez por rodada). */
export function weightIndex(rows: { code: string; grossWeight: number | null }[]) {
  const m = new Map<string, number | null>()
  for (const r of rows) {
    const k = r.code.trim().toLowerCase()
    if (!k) continue
    const cur = m.get(k)
    if (cur === undefined || cur === null || !(cur > 0)) m.set(k, r.grossWeight)
  }
  return m
}

/** Opções que valem das tabelas do CRM (status OK com valor), só das transportadoras escolhidas (vazio = todas). */
export function crmOptions(results: { status: string; total: number | null; deadlineDays: number | null; carrierId: string }[], carrierIds: string[] = []) {
  const only = new Set(carrierIds)
  return results
    .filter((r) => r.status === 'OK' && r.total !== null && r.total >= 0 && (!only.size || only.has(r.carrierId)))
    .map((r) => ({ price: Math.round(r.total! * 100) / 100, days: r.deadlineDays }))
    .sort((a, b) => a.price - b.price || (a.days ?? 99) - (b.days ?? 99))
}

/**
 * Código que a simulação de frete da Magazord aceita: o código do produto/derivação (ex.: "044124"), não o id interno
 * (ex.: 5435) que fica em externalId — com o id ela responde 400 "verifique os parâmetros fornecidos".
 */
export function simulationSku(externalId: string, bySku: Map<string, { code: string }>): string {
  return bySku.get(externalId)?.code?.trim() || externalId
}

/** Opção de retirada (na loja, no balcão, no depósito): não é entrega e não vai como frete ao Google. */
export const isPickup = (name: string) => /retir|retirada|balc[aã]o|na loja|pick ?up/i.test(name)
