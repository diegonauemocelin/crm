import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { RequestCtx } from '../common/decorators'
import type { AuthUser } from '../common/types'
import type { Prisma } from '../generated/prisma/client'
import { toXlsx } from '../marketing/arquivos'
import { PrismaService } from '../prisma/prisma.service'
import { ChatService } from '../whatsapp/chat.service'
import { analyze, type Msg, SESSION_GAP_MS } from '../whatsapp/metricas'
import {
  aceita,
  chaveLinha,
  chavesDoPeriodo,
  type Comparacao,
  COMPARACOES,
  consultaSql,
  contagemSql,
  csv,
  DIM_BY_ID,
  DIM_IDS,
  DIMENSOES,
  type DimId,
  escopoDe,
  escopoFonte,
  type FonteDef,
  FONTE_BY_ID,
  FONTES,
  type FonteId,
  type Filtros,
  HIERARQUIAS,
  janelaComparacao,
  juntar,
  lerFiltros,
  lerLista,
  limites,
  type Linha,
  MEDIDA_BY_ID,
  type MedidaDef,
  MEDIDAS,
  ordenar,
  paginasPermitidas,
  type Perms,
  podeFonte,
  registrosSql,
  rotulo,
  TEMPO,
  VAZIO,
  validarPeriodo,
  variacao,
  whereSql,
} from './modelo'
import { agregarWhatsapp, type ConversaInfo } from './whatsapp'

export interface ConsultaQuery {
  de: string
  ate: string
  medidas: string
  dims?: string
  filtros?: string
  comparar?: string
  limite?: number
}

export interface RegistrosQuery {
  de: string
  ate: string
  medida: string
  filtros?: string
  pagina?: number
  tamanho?: number
}

const MAX_EXPORT = 20_000
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']

type Valores = Record<string, number | null>

/**
 * Análises (BI nativo): consultas agregadas sobre os fatos do BI, com as permissões e o escopo do CRM.
 * Cada fonte exige o "ver" do seu módulo (atendimentos = Pré-Vendas, leads = Base de leads, WhatsApp = Chat) e
 * aplica o escopo dele (próprios, unidade ou todos), como as telas do CRM.
 */
@Injectable()
export class AnalisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly chat: ChatService,
  ) {}

  private perms(user: AuthUser): Perms {
    return { isSystem: user.role.isSystem, permissions: user.permissions }
  }

  /** O que a pessoa pode usar: páginas, fontes (ver, exportar, escopo), medidas, dimensões e hierarquias. */
  modelo(user: AuthUser) {
    const p = this.perms(user)
    const paginas = paginasPermitidas(p)
    if (!paginas.length) throw new ForbiddenException('Seu perfil não tem acesso às Análises.')
    const fontes = FONTES.map((f) => ({ id: f.id, nome: f.nome, ver: podeFonte(p, f.id), exportar: podeFonte(p, f.id, 'export'), escopo: escopoFonte(p, f.id), registros: !!f.sql, abrir: f.abrir ?? null, dims: DIM_IDS.filter((d) => aceita(f, d)) }))
    return {
      paginas,
      fontes,
      medidas: MEDIDAS.filter((m) => podeFonte(p, m.fonte)).map(({ id, nome, fonte, formato, descricao, menorMelhor }) => ({ id, nome, fonte, formato, descricao, menorMelhor: !!menorMelhor, registros: !!FONTE_BY_ID.get(fonte)!.sql })),
      dimensoes: DIMENSOES.map(({ id, nome }) => ({ id, nome })),
      hierarquias: HIERARQUIAS,
    }
  }

  /** Listas dos filtros. Vendedores e filiais seguem o escopo de Pré-Vendas (próprios: só o vendedor da pessoa). */
  async opcoes(user: AuthUser) {
    const p = this.perms(user)
    if (!paginasPermitidas(p).length) throw new ForbiddenException('Seu perfil não tem acesso às Análises.')
    const t = user.tenantId
    const escopo = escopoFonte(p, podeFonte(p, 'atendimentos') ? 'atendimentos' : podeFonte(p, 'leads') ? 'leads' : 'whatsapp')
    const sellerWhere: Prisma.SellerWhereInput = { tenantId: t, ...(escopo === 'OWN' ? { userId: user.id } : escopo === 'UNIT' ? { unitId: user.unitId ?? '00000000-0000-0000-0000-000000000000' } : {}) }
    const [filiais, vendedores, origens, motivos] = await Promise.all([
      this.prisma.unit.findMany({ where: { tenantId: t, ...(escopo === 'UNIT' ? { id: user.unitId ?? '00000000-0000-0000-0000-000000000000' } : {}) }, select: { id: true, name: true, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.seller.findMany({ where: sellerWhere, select: { id: true, name: true, active: true, unitId: true }, orderBy: { name: 'asc' } }),
      this.prisma.lookupItem.findMany({ where: { tenantId: t, type: 'ORIGEM' }, select: { id: true, name: true, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.lookupItem.findMany({ where: { tenantId: t, type: 'MOTIVO_PERDA' }, select: { id: true, name: true, active: true }, orderBy: { name: 'asc' } }),
    ])
    const item = (x: { id: string; name: string; active: boolean }) => ({ id: x.id, nome: x.name, ativo: x.active })
    return { filiais: filiais.map(item), vendedores: vendedores.map((v) => ({ ...item(v), filial: v.unitId })), origens: origens.map(item), motivos: motivos.map(item), ufs: UFS }
  }

  // ---------- Consulta agregada ----------

  async consulta(user: AuthUser, q: ConsultaQuery) {
    const p = this.perms(user)
    const periodo = validarPeriodo(q.de, q.ate)
    if ('erro' in periodo) throw new BadRequestException(periodo.erro)
    const ms = lerLista<string>(q.medidas, new Set(MEDIDA_BY_ID.keys()), 16)
    if ('erro' in ms) throw new BadRequestException(`Medidas: ${ms.erro}`)
    if (!ms.itens.length) throw new BadRequestException('Escolha ao menos uma medida.')
    const ds = lerLista<DimId>(q.dims, new Set(DIM_IDS), 3)
    if ('erro' in ds) throw new BadRequestException(`Dimensões: ${ds.erro}`)
    const fl = lerFiltros(q.filtros)
    if ('erro' in fl) throw new BadRequestException(fl.erro)
    if (q.comparar && !(COMPARACOES as readonly string[]).includes(q.comparar)) throw new BadRequestException('Comparação inválida.')
    const comparar = (q.comparar || null) as Comparacao | null
    const dims = ds.itens
    const filtros = fl.filtros
    const medidas = ms.itens.map((id) => MEDIDA_BY_ID.get(id)!)
    const tempo = dims.length > 0 && TEMPO.includes(dims[0]!)
    const limite = Math.min(tempo ? 1200 : 500, Math.max(1, q.limite ?? (tempo ? 1200 : 100)))

    // Fontes: sem permissão ou sem a dimensão/filtro pedido, as medidas dela ficam vazias (e a tela avisa).
    const semAcesso: FonteId[] = []
    const naoAplica: { fonte: FonteId; dims: DimId[] }[] = []
    const porFonte = new Map<FonteDef, MedidaDef[]>()
    for (const m of medidas) {
      const f = FONTE_BY_ID.get(m.fonte)!
      if (!podeFonte(p, f.id)) {
        if (!semAcesso.includes(f.id)) semAcesso.push(f.id)
        continue
      }
      const fora = [...new Set([...dims, ...(Object.keys(filtros) as DimId[])])].filter((d) => !aceita(f, d))
      if (fora.length) {
        if (!naoAplica.some((x) => x.fonte === f.id)) naoAplica.push({ fonte: f.id, dims: fora })
        continue
      }
      porFonte.set(f, [...(porFonte.get(f) ?? []), m])
    }

    const ids = medidas.map((m) => m.id)
    const calculadas = new Set([...porFonte.values()].flat())
    /** Valor de um recorte sem registros: zero nas contagens e valores, vazio nas taxas, tempos e fontes fora. */
    const vazio = (m: MedidaDef) => (calculadas.has(m) && (m.formato === 'inteiro' || m.formato === 'moeda') ? 0 : null)
    const rodar =async (de: string, ate: string, lim: number) => {
      const { inicio, fim } = limites(de, ate)
      const partes = await Promise.all([...porFonte].map(([f, lista]) => this.fonte(user, f, lista, { inicio, fim, dims, filtros, limite: lim })))
      const linhas = juntar(partes, ids)
      // Recorte que só uma fonte tem (ex.: dia com conversa no WhatsApp e sem pré-venda): a outra conta zero.
      for (const l of linhas) for (const m of medidas) if (l.valores[m.id] === null) l.valores[m.id] = vazio(m)
      // Totais sempre têm uma linha (mesmo com todas as fontes de fora).
      if (!dims.length && !linhas.length) linhas.push({ chaves: [], valores: Object.fromEntries(medidas.map((m) => [m.id, null])) })
      return linhas
    }
    let linhas = await rodar(periodo.de, periodo.ate, limite + 1)
    const temMais = !tempo && linhas.length > limite
    linhas = ordenar(linhas, dims, ids.find((id) => [...porFonte.values()].some((l) => l.some((m) => m.id === id))))
    if (temMais) linhas = linhas.slice(0, limite)

    // Tempo num nível só: os meses/dias sem registro aparecem zerados (contagens e valores) ou vazios (taxas e tempos).
    if (tempo && dims.length === 1) {
      const tem = new Map(linhas.map((l) => [l.chaves[0]!, l]))
      linhas = chavesDoPeriodo(dims[0]!, periodo.de, periodo.ate, filtros).map((k) => tem.get(k) ?? { chaves: [k], valores: Object.fromEntries(medidas.map((m) => [m.id, vazio(m)])) })
    }

    // Comparação: totais e recortes que não são de tempo (cada linha com o seu valor no outro período).
    let janela: { tipo: Comparacao; de: string; ate: string } | null = null
    let anteriores: Map<string, Valores> | null = null
    if (comparar && !tempo) {
      const w = janelaComparacao(periodo.de, periodo.ate, comparar)
      janela = { tipo: comparar, ...w }
      const antes = await rodar(w.de, w.ate, 2000)
      anteriores = new Map(antes.map((l) => [chaveLinha(l.chaves), l.valores]))
    }

    const nomes = await this.nomes(user.tenantId, dims, linhas)
    return {
      periodo,
      comparacao: janela,
      dims,
      medidas: ids,
      linhas: linhas.map((l) => {
        const antes = anteriores?.get(chaveLinha(l.chaves)) ?? null
        const anterior = (m: MedidaDef) => (antes ? (antes[m.id] ?? null) : vazio(m))
        return {
          chaves: l.chaves,
          rotulos: l.chaves.map((k, i) => rotulo(dims[i]!, k, nomes.get(dims[i]!))),
          valores: l.valores,
          ...(anteriores ? { comparacao: Object.fromEntries(medidas.map((m) => [m.id, { anterior: anterior(m), ...variacao(l.valores[m.id] ?? null, anterior(m)) }])) } : {}),
        }
      }),
      temMais,
      avisos: { semAcesso, naoAplica },
      geradoEm: new Date().toISOString(),
    }
  }

  /** Uma fonte: SQL agregado (atendimentos, leads) ou cálculo do WhatsApp. */
  private async fonte(user: AuthUser, f: FonteDef, medidas: MedidaDef[], o: { inicio: Date; fim: Date; dims: DimId[]; filtros: Filtros; limite: number }): Promise<Linha[]> {
    if (f.id === 'whatsapp') return this.whatsapp(user, medidas, o)
    const s = f.sql!
    const escopo = escopoDe(escopoFonte(this.perms(user), f.id), user)
    const where = whereSql(s, { tenantId: user.tenantId, inicio: o.inicio, fim: o.fim, escopo, filtros: o.filtros })
    const rows = await this.ler<Record<string, unknown>>(consultaSql(s, medidas, o.dims, where, o.limite))
    return rows.map((r) => ({
      chaves: o.dims.map((_, i) => (r[`k${i}`] === null || r[`k${i}`] === undefined ? VAZIO : String(r[`k${i}`]))),
      valores: Object.fromEntries(medidas.map((m) => [m.id, r[m.id] === null || r[m.id] === undefined ? null : Number(r[m.id])])),
    }))
  }

  /** Consulta só de leitura, com tempo máximo (uma análise pesada não trava o banco). */
  private ler<T>(sql: Prisma.Sql): Promise<T[]> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '30s'`)
        return tx.$queryRaw<T[]>(sql)
      },
      { timeout: 40_000, maxWait: 10_000 },
    )
  }

  /** WhatsApp: atendimentos das conversas que a pessoa vê no chat (escopo do Chat), sem grupos. */
  private async whatsapp(user: AuthUser, medidas: MedidaDef[], o: { inicio: Date; fim: Date; dims: DimId[]; filtros: Filtros }): Promise<Linha[]> {
    const desde = new Date(o.inicio.getTime() - SESSION_GAP_MS)
    const scope = await this.chat.where(user)
    const convs = await this.prisma.whatsappConversation.findMany({
      where: { AND: [scope, { category: { not: 'GRUPO' } }, { lastMessageAt: { gte: desde } }, o.filtros.vendedor && !o.filtros.vendedor.includes(VAZIO) ? { assignedSellerId: { in: o.filtros.vendedor.filter((v) => v !== VAZIO) } } : {}] },
      select: { id: true, numberId: true, assignedSellerId: true },
    })
    const numeros = new Map((await this.prisma.whatsappNumber.findMany({ where: { tenantId: user.tenantId }, select: { id: true, unitId: true } })).map((x) => [x.id, x.unitId]))
    const info = new Map<string, ConversaInfo>(convs.map((c) => [c.id, { filial: numeros.get(c.numberId) ?? null, vendedor: c.assignedSellerId }]))
    // Um dia antes do início: a primeira mensagem do período pode continuar um atendimento aberto antes dele.
    const msgs: Msg[] = []
    const ids = convs.map((c) => c.id)
    for (let i = 0; i < ids.length; i += 2000) {
      msgs.push(
        ...(await this.prisma.whatsappMessage.findMany({
          where: { conversationId: { in: ids.slice(i, i + 2000) }, internal: false, sentAt: { gte: desde, lt: o.fim } },
          orderBy: [{ conversationId: 'asc' }, { sentAt: 'asc' }, { createdAt: 'asc' }],
          select: { conversationId: true, fromMe: true, sentAt: true, sentById: true, type: true },
        })),
      )
    }
    const hours = (await this.chat.rules(user.tenantId)).businessHours
    const { sessions, turns } = analyze(msgs, hours)
    // A função confere todos os filtros (tempo, filial, vendedor) em cada atendimento.
    return agregarWhatsapp({ sessions, turns, info, inicio: o.inicio, fim: o.fim, dims: o.dims, filtros: o.filtros, medidas: medidas.map((m) => m.id) })
  }

  /** Nomes de filiais, vendedores, origens e motivos que aparecem nas linhas (da empresa). */
  private async nomes(tenantId: string, dims: DimId[], linhas: Linha[]) {
    const out = new Map<DimId, Map<string, string>>()
    await Promise.all(
      dims.map(async (d, i) => {
        const tipo = DIM_BY_ID.get(d)!.rotulo
        const ids = [...new Set(linhas.map((l) => l.chaves[i]!).filter((k) => k !== VAZIO))]
        if (!ids.length) return
        let rows: { id: string; name: string }[] = []
        if (tipo === 'filial') rows = await this.prisma.unit.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } })
        else if (tipo === 'vendedor') rows = await this.prisma.seller.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } })
        else if (tipo === 'origem' || tipo === 'motivo') rows = await this.prisma.lookupItem.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } })
        else return
        out.set(d, new Map(rows.map((r) => [r.id, r.name])))
      }),
    )
    return out
  }

  // ---------- Ver registros ----------

  private pedidoRegistros(user: AuthUser, q: RegistrosQuery, acao: 'view' | 'export') {
    const p = this.perms(user)
    const periodo = validarPeriodo(q.de, q.ate)
    if ('erro' in periodo) throw new BadRequestException(periodo.erro)
    const m = MEDIDA_BY_ID.get(q.medida)
    if (!m) throw new BadRequestException('Medida desconhecida.')
    const f = FONTE_BY_ID.get(m.fonte)!
    if (!f.sql) throw new BadRequestException(`"${m.nome}" não tem registros para abrir aqui: veja no painel do ${f.nome}.`)
    if (!podeFonte(p, f.id)) throw new ForbiddenException(`Seu perfil não tem acesso a ${f.nome}.`)
    if (acao === 'export' && !podeFonte(p, f.id, 'export')) throw new ForbiddenException(`Seu perfil não pode exportar ${f.nome}.`)
    const fl = lerFiltros(q.filtros)
    if ('erro' in fl) throw new BadRequestException(fl.erro)
    const fora = (Object.keys(fl.filtros) as DimId[]).filter((d) => !aceita(f, d))
    if (fora.length) throw new BadRequestException(`O filtro ${fora.map((d) => DIM_BY_ID.get(d)!.nome).join(', ')} não se aplica a ${f.nome}.`)
    const { inicio, fim } = limites(periodo.de, periodo.ate)
    const escopo = escopoDe(escopoFonte(p, f.id), user)
    const where = whereSql(f.sql, { tenantId: user.tenantId, inicio, fim, escopo, filtros: fl.filtros, condicao: m.condicao })
    return { m, f, s: f.sql, where, periodo, filtros: fl.filtros }
  }

  async registros(user: AuthUser, q: RegistrosQuery) {
    const { m, f, s, where } = this.pedidoRegistros(user, q, 'view')
    const tamanho = Math.min(200, Math.max(1, q.tamanho ?? 50))
    const pagina = Math.max(1, q.pagina ?? 1)
    const [linhas, total] = await Promise.all([this.ler<Record<string, unknown>>(registrosSql(s, where, tamanho, (pagina - 1) * tamanho)), this.ler<{ total: number }>(contagemSql(s, where))])
    return {
      medida: { id: m.id, nome: m.nome },
      fonte: f.id,
      abrir: f.abrir ?? null,
      colunas: s.registros.colunas.map(({ id, nome, tipo, pessoal }) => ({ id, nome, tipo, pessoal: !!pessoal })),
      linhas,
      total: total[0]?.total ?? 0,
      pagina,
      tamanho,
      podeExportar: podeFonte(this.perms(user), f.id, 'export'),
    }
  }

  /** Planilha dos registros (Excel ou CSV), sem dados pessoais do cliente (mesma regra da API de BI). */
  async exportar(user: AuthUser, q: RegistrosQuery, formato: 'xlsx' | 'csv', ctx: RequestCtx) {
    const { m, f, s, where, periodo, filtros } = this.pedidoRegistros(user, q, 'export')
    const linhas = await this.ler<Record<string, unknown>>(registrosSql(s, where, MAX_EXPORT, 0))
    const colunas = s.registros.colunas.filter((c) => !c.pessoal)
    const header = colunas.map((c) => c.nome)
    const rows = linhas.map((r) => colunas.map((c) => (r[c.id] === null || r[c.id] === undefined ? null : c.tipo === 'moeda' || c.tipo === 'decimal' ? Number(r[c.id]) : String(r[c.id]))))
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      userEmail: user.email,
      action: 'analises.exportar',
      entity: 'analises',
      entityId: null,
      ...ctx,
      data: { medida: m.id, fonte: f.id, de: periodo.de, ate: periodo.ate, filtros, linhas: rows.length, formato },
    })
    const base = `analises-${m.id}-${periodo.de}-a-${periodo.ate}`
    if (formato === 'csv') return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', content: Buffer.from(csv(header, rows), 'utf8') }
    const nota = rows.length >= MAX_EXPORT ? `Mostrando as ${MAX_EXPORT} linhas mais novas. Diminua o período para ver o resto.` : undefined
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: Buffer.from(toXlsx([{ name: m.nome, header, rows, ...(nota ? { note: nota } : {}) }], `Análises: ${m.nome}`)),
    }
  }
}
