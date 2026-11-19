/**
 * Conferência de frete (funções puras, testadas em test/fretes-conferencia.spec.ts): por pedido, o frete cobrado na
 * nota, o cobrado no CT-e e o esperado pela tabela de frete do CRM; o sistema aponta as diferenças e quem confere
 * registra a causa.
 */

/** Causas que quem confere escolhe (a lista é fixa para dar para somar no relatório). */
export const AUDIT_CAUSES = {
  VENDEDOR_COBROU_MENOS: 'Vendedor cobrou menos frete na nota',
  FRETE_NAO_DESTACADO: 'Frete não destacado na nota (CIF sem valor)',
  TRANSPORTADORA_ACIMA: 'Transportadora cobrou acima da tabela',
  TAXA_EXTRA: 'Taxa extra no CT-e (TDE, TRT, agendamento, reentrega...)',
  PESO_DIVERGENTE: 'Peso ou cubagem diferente da nota',
  TABELA_DESATUALIZADA: 'Tabela de frete desatualizada no CRM',
  CAMPANHA: 'Campanha de frete ou frete grátis combinado',
  OUTRO: 'Outro (ver observação)',
} as const
export type AuditCause = keyof typeof AUDIT_CAUSES
export const AUDIT_STATUSES = ['OK', 'DIVERGENTE'] as const
export type AuditStatus = (typeof AUDIT_STATUSES)[number]

export interface AuditValues {
  /** Modalidade do frete na NF-e (0 = CIF, por conta do emitente). */
  freightMode: string | null
  /** Frete destacado na nota. */
  nfeFreight: number | null
  /** Soma dos CT-es não cancelados do pedido. */
  cteTotal: number | null
  /** Esperado pela tabela de frete do CRM (soma do esperado dos CT-es conferidos). */
  tableExpected: number | null
  /** Cotado no pedido. */
  quoted: number | null
}

const r2 = (v: number) => Math.round(v * 100) / 100
const brl = (v: number) => `R$ ${Math.abs(v).toFixed(2).replace('.', ',')}`

/**
 * Diferenças que o sistema vê no pedido (o que quem confere precisa olhar). A folga é a mesma da conciliação.
 * - nota CIF abaixo do CT-e ou da tabela: o vendedor cobrou menos do cliente do que a empresa paga ou devia pagar;
 * - CT-e acima da tabela: a transportadora cobrou mais que a tabela.
 */
export function auditHints(v: AuditValues, tolerance: number) {
  const hints: { kind: 'NOTA_MENOR_CTE' | 'NOTA_MENOR_TABELA' | 'CTE_ACIMA_TABELA' | 'SEM_CTE' | 'SEM_TABELA' | 'SEM_NOTA'; text: string; diff: number | null }[] = []
  const cif = v.freightMode === '0'
  const nota = v.nfeFreight ?? 0
  if (v.freightMode === null) hints.push({ kind: 'SEM_NOTA', text: 'XML da NF-e não importado', diff: null })
  if (v.cteTotal === null) hints.push({ kind: 'SEM_CTE', text: 'Sem CT-e', diff: null })
  else if (v.tableExpected === null) hints.push({ kind: 'SEM_TABELA', text: 'CT-e sem valor da tabela para comparar', diff: null })
  if (cif && v.cteTotal !== null && v.cteTotal > 0 && nota - v.cteTotal < -tolerance) {
    const d = r2(nota - v.cteTotal)
    hints.push({ kind: 'NOTA_MENOR_CTE', text: `Nota ${brl(d)} abaixo do CT-e`, diff: d })
  }
  if (cif && v.tableExpected !== null && v.tableExpected > 0 && nota - v.tableExpected < -tolerance) {
    const d = r2(nota - v.tableExpected)
    hints.push({ kind: 'NOTA_MENOR_TABELA', text: `Nota ${brl(d)} abaixo da tabela`, diff: d })
  }
  if (v.cteTotal !== null && v.tableExpected !== null && v.cteTotal - v.tableExpected > tolerance) {
    const d = r2(v.cteTotal - v.tableExpected)
    hints.push({ kind: 'CTE_ACIMA_TABELA', text: `CT-e ${brl(d)} acima da tabela`, diff: d })
  }
  return hints
}

/** Tem diferença de valor para conferir (ignora só os avisos de falta de dado). */
export function hasDifference(hints: ReturnType<typeof auditHints>) {
  return hints.some((h) => h.diff !== null)
}

/** Causa sugerida para a primeira diferença (quem confere pode trocar). */
export function suggestedCause(v: AuditValues, hints: ReturnType<typeof auditHints>): AuditCause | null {
  if (hints.some((h) => h.kind === 'CTE_ACIMA_TABELA')) return 'TRANSPORTADORA_ACIMA'
  if (hints.some((h) => h.kind === 'NOTA_MENOR_CTE' || h.kind === 'NOTA_MENOR_TABELA')) return v.freightMode === '0' && !v.nfeFreight ? 'FRETE_NAO_DESTACADO' : 'VENDEDOR_COBROU_MENOS'
  return null
}
