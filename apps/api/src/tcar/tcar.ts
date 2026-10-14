/**
 * Integração com a Tcar (ERP) pelo PingAlive: o servidor da Tcar (atrás do firewall da empresa) chama o CRM de
 * tempos em tempos; o CRM responde com consultas de produtos ("actions") e recebe o resultado ("report").
 * O CRM só pede leituras de produtos: nada é alterado na Tcar. O custo contábil nunca é copiado.
 */

export interface TcarSettings {
  enabled: boolean
  /** Resumo (sha256) da chave que o servidor da Tcar envia no x-api-key; a chave em si só aparece ao gerar. */
  keyHash: string | null
  /** Empresa e filial do servidor da Tcar (preenchidas no primeiro contato); contatos de outra empresa são recusados. */
  companyId: number | null
  branchId: number | null
  /** Filiais com estoque e preço na consulta (vazio = só a filial do servidor). */
  branchIds: number[]
  /** Nome do campo do "utilizado em" na resposta da Tcar, quando ela passar a enviar (ex.: epctb_utilizadoem). */
  usedInField: string
  /** Cópia completa (preço e estoque) a cada N horas e produtos alterados a cada N minutos. */
  fullEveryHours: number
  incrementalMinutes: number
}

export const DEFAULT_TCAR: TcarSettings = { enabled: false, keyHash: null, companyId: null, branchId: null, branchIds: [], usedInField: '', fullEveryHours: 6, incrementalMinutes: 10 }

export const PAGE_SIZE = 200
export const MAX_ACTIONS_PER_PING = 4
/** Consultas de uma peça pedidas pela tela (estoque na hora): vão na frente e em maior número. */
export const MAX_LIVE_PER_PING = 20
/** Peças da busca atualizadas sozinhas e o intervalo mínimo entre duas atualizações da mesma peça. */
export const AUTO_REFRESH_TOP = 10
export const AUTO_REFRESH_MIN_AGE_MS = 2 * 60_000
/** Sem contato da Tcar há mais que isso: a busca não pede atualização (mostra a última cópia). */
export const OFFLINE_AFTER_MS = 2 * 60_000
/** Ação enviada sem resposta depois disso volta para a fila (até 3 tentativas). */
export const ACTION_TIMEOUT_MS = 10 * 60_000

export interface Branch {
  id: number
  name: string
  available: number | null
  price: number | null
  resalePrice: number | null
}

export interface TcarProductData {
  code: string
  name: string
  ean: string | null
  factoryCode: string | null
  integrationCode: string | null
  refs: string[]
  brand: string | null
  groupName: string | null
  subgroupName: string | null
  application: string | null
  usedIn: string | null
  unit: string | null
  stock: number | null
  price: number | null
  resalePrice: number | null
  branches: Branch[]
  searchText: string
}

const str = (v: unknown, max = 200) => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/[\u0000-\u001f]/g, ' ').trim()
  return s ? s.slice(0, max) : null
}
const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null
}
const money = (v: unknown) => {
  const n = num(v)
  return n === null ? null : Math.round(n * 100) / 100
}

/** Texto para a busca: sem acentos, minúsculo. */
export function fold(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Produto da Tcar (chaves em minúsculo, como as colunas do banco dela) para o CRM. Custo nunca entra. */
export function productFrom(row: Record<string, unknown>, usedInField = ''): TcarProductData | null {
  const code = str(row.epctb_codigo, 60)
  const name = str(row.epctb_nome, 300)
  if (!code || !name) return null
  const refs = [1, 2, 3, 4, 5].flatMap((i) => [str(row[`epctb_codigoref${i}`], 60), str(row[`epctb_codigoimp${i}`], 60)]).filter((x): x is string => !!x)
  const field = usedInField.trim().toLowerCase()
  const usedIn = field && /^[a-z0-9_]{2,60}$/.test(field) ? str(row[field], 2000) : null
  const branches: Branch[] = Array.isArray(row.filiais)
    ? (row.filiais as Record<string, unknown>[]).slice(0, 50).map((f) => ({ id: Number(f.fll_codigo) || 0, name: str(f.fll_nome, 80) ?? `Filial ${f.fll_codigo}`, available: num(f.estoque_disponivel), price: money(f.preco), resalePrice: money(f.preco_revenda) }))
    : []
  const p: Omit<TcarProductData, 'searchText'> = {
    code,
    name,
    ean: str(row.epctb_ean, 30),
    factoryCode: str(row.epctb_codigofabrica, 60),
    integrationCode: str(row.epctb_codigointegracao, 60),
    refs: [...new Set(refs)],
    brand: str(row.marca_descricao, 80),
    groupName: str(row.grupo_descricao, 80),
    subgroupName: str(row.subgrupo_descricao, 80),
    application: str(row.aplicacao_descricao, 120) ?? str(row.epapl_id, 40),
    usedIn,
    unit: str(row.epctb_unidade, 10),
    stock: num(row.epcte_estoquedisponivel),
    price: money(row.epprc_preco),
    resalePrice: money(row.epprc_precorevenda),
    branches,
  }
  const searchText = fold([p.code, p.name, p.ean, p.factoryCode, p.integrationCode, ...p.refs, p.brand, p.groupName, p.subgroupName, p.application, p.usedIn].filter(Boolean).join(' '))
  return { ...p, searchText }
}

/** Linhas de produto de qualquer formato de resposta da Tcar (lista paginada, detalhe com "data" ou objeto direto). */
export function rowsOf(body: unknown): { rows: Record<string, unknown>[]; total: number | null } {
  if (!body || typeof body !== 'object') return { rows: [], total: null }
  const b = body as Record<string, unknown>
  const pag = b.pagination as { total?: unknown } | undefined
  const total = pag && Number.isFinite(Number(pag.total)) ? Number(pag.total) : null
  if (Array.isArray(b.data)) return { rows: b.data as Record<string, unknown>[], total }
  if (b.data && typeof b.data === 'object') return rowsOf(b.data)
  if ('epctb_codigo' in b) return { rows: [b], total: 1 }
  return { rows: [], total }
}

/** Data e hora no horário de Brasília, no formato aceito pelo "alterado_desde" da Tcar. */
export function tcarDate(d: Date) {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
}

/** Consulta de produtos que o CRM pede à Tcar (sempre GET em /produtos). */
export function productQuery(o: { offset?: number; since?: Date | null; branchIds: number[] }) {
  const q: Record<string, string | number> = { limit: PAGE_SIZE, offset: o.offset ?? 0, incluir_referencias: 'S' }
  if (o.since) q.alterado_desde = tcarDate(o.since)
  if (o.branchIds.length) {
    q.include = 'filiais'
    q.branch_ids = o.branchIds.join(',')
  }
  return { cmd: '/produtos', verb: 'GET' as const, query_params: q }
}

/** Uma só peça (botão "Atualizar estoque agora"). */
export function detailQuery(code: string, branchIds: number[]) {
  return { cmd: `/produtos/${encodeURIComponent(code)}`, verb: 'GET' as const, query_params: branchIds.length ? { include: 'filiais', branch_ids: branchIds.join(',') } : {} }
}

/** Só leituras de produtos podem sair do CRM para a Tcar. */
export function allowedAction(cmd: string, verb: string) {
  return verb === 'GET' && /^\/produtos(\/[^/?#]+)?$/.test(cmd)
}

export type Due = 'full' | 'incremental' | null

/** O que pedir agora: cópia completa (nunca feita ou vencida), produtos alterados, ou nada. */
export function nextSync(now: Date, st: { lastFullAt?: string | null; lastIncrementalAt?: string | null; fullRunning?: boolean }, s: Pick<TcarSettings, 'fullEveryHours' | 'incrementalMinutes'>): Due {
  if (st.fullRunning) return null
  const age = (iso?: string | null) => (iso ? now.getTime() - Date.parse(iso) : Number.POSITIVE_INFINITY)
  if (age(st.lastFullAt) >= Math.max(1, s.fullEveryHours) * 3_600_000) return 'full'
  if (age(st.lastIncrementalAt) >= Math.max(2, s.incrementalMinutes) * 60_000) return 'incremental'
  return null
}
