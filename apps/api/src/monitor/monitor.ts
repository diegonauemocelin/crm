/**
 * Monitoramento (funções puras): CPU pelo tempo das CPUs entre duas leituras, contadores de pedidos da API, gráficos
 * agrupados por intervalo e a situação de cada número de WhatsApp.
 */

export interface CpuTimes {
  idle: number
  total: number
}

/** Soma dos tempos de todas as CPUs (os.cpus()). */
export function cpuTimes(cpus: { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[]): CpuTimes {
  let idle = 0
  let total = 0
  for (const c of cpus) {
    idle += c.times.idle
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
  }
  return { idle, total }
}

/** CPU usada (%) entre duas leituras. */
export function cpuPercent(prev: CpuTimes, cur: CpuTimes) {
  const total = cur.total - prev.total
  if (total <= 0) return 0
  return Math.round(Math.min(100, Math.max(0, (1 - (cur.idle - prev.idle) / total) * 100)) * 10) / 10
}

/** Contador de pedidos da API do minuto (zera a cada amostra). */
export class RequestCounter {
  requests = 0
  errors = 0
  totalMs = 0
  add(ms: number, status: number) {
    this.requests++
    this.totalMs += ms
    if (status >= 500) this.errors++
  }
  take() {
    const r = { requests: this.requests, errors: this.errors, avgMs: this.requests ? Math.round(this.totalMs / this.requests) : 0 }
    this.requests = 0
    this.errors = 0
    this.totalMs = 0
    return r
  }
}

export interface Sample {
  at: Date
  cpuPct: number
  memPct: number
  diskPct: number | null
  dbMs: number
  requests: number
  errors: number
  avgMs: number
  apiMemMb: number
}

/** Agrupa as amostras em intervalos (minutos) para os gráficos: médias de uso e somas de pedidos e erros. */
export function bucket(samples: Sample[], minutes: number) {
  const size = minutes * 60_000
  const by = new Map<number, Sample[]>()
  for (const s of samples) {
    const k = Math.floor(s.at.getTime() / size) * size
    const list = by.get(k)
    if (list) list.push(s)
    else by.set(k, [s])
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0)
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, xs]) => ({
      at: new Date(k).toISOString(),
      cpu: avg(xs.map((x) => x.cpuPct)),
      mem: avg(xs.map((x) => x.memPct)),
      disk: xs.some((x) => x.diskPct !== null) ? avg(xs.filter((x) => x.diskPct !== null).map((x) => x.diskPct!)) : null,
      dbMs: avg(xs.map((x) => x.dbMs)),
      apiMemMb: avg(xs.map((x) => x.apiMemMb)),
      requests: xs.reduce((a, x) => a + x.requests, 0),
      errors: xs.reduce((a, x) => a + x.errors, 0),
      avgMs: avg(xs.filter((x) => x.requests).map((x) => x.avgMs)),
    }))
}

export type Level = 'ok' | 'atencao' | 'problema'

/** Situação de um número de WhatsApp para o painel (e para o aviso aos administradores). */
export function numberLevel(n: { status: string; statusReason: string | null; lastInboundAt: Date | null }, now: number, businessOpen: boolean): { level: Level; why: string } {
  if (n.status !== 'CONECTADO') return { level: 'problema', why: n.statusReason ? `Desconectado: ${n.statusReason}` : 'Desconectado' }
  if (n.statusReason) return { level: 'problema', why: n.statusReason }
  const since = n.lastInboundAt ? now - n.lastInboundAt.getTime() : null
  if (businessOpen && (since === null || since > 3 * 3_600_000)) return { level: 'atencao', why: since === null ? 'Ainda não recebeu nenhuma mensagem' : 'Sem receber mensagens há mais de 3 horas no horário de atendimento' }
  return { level: 'ok', why: 'Recebendo mensagens' }
}

/** Nível pelo uso (%): até 75 ok, até 90 atenção, acima problema. */
export function usageLevel(pct: number | null): Level {
  if (pct === null) return 'ok'
  return pct > 90 ? 'problema' : pct > 75 ? 'atencao' : 'ok'
}
