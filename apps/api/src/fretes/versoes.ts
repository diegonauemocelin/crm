// Qual versão de cada tabela vale numa data (conciliação do CT-e). Sem banco (test/fretes-versoes.spec.ts).

export interface VersionAt {
  id: string
  tableId: string
  publishedAt: Date | null
  /** Correção: vale também desde esta data, antes da publicação. */
  ctesFrom: Date | null
}

/**
 * Por tabela, a versão publicada mais recente entre as que já valiam na data: publicada até a data, ou publicada depois
 * mas marcada para valer desde uma data anterior (correção da tabela). A correção ganha da versão que ela corrige.
 */
export function pickVersionsAt(versions: VersionAt[], date: Date): Map<string, string> {
  const best = new Map<string, VersionAt>()
  for (const v of versions) {
    if (!v.publishedAt) continue
    const from = v.ctesFrom && v.ctesFrom < v.publishedAt ? v.ctesFrom : v.publishedAt
    if (from > date) continue
    const cur = best.get(v.tableId)
    if (!cur || v.publishedAt > cur.publishedAt!) best.set(v.tableId, v)
  }
  return new Map([...best].map(([t, v]) => [t, v.id]))
}
