/**
 * Resumo semanal dos fretes por e-mail (funções puras, testadas em test/fretes-resumo-semanal.spec.ts): toda semana, no
 * dia e hora escolhidos, os destinatários recebem o resumo dos CT-es dos 7 dias anteriores (com e sem divergência, frete
 * cobrado a mais e a menos nas notas, vendedores e transportadoras).
 */
import type { FreightSummary } from './gerencial'

export const WEEKLY_FREIGHT_KEY = 'fretes_resumo_semanal'
export const WEEKLY_FREIGHT_LOG_KEY = 'fretes_resumo_semanal_log'
export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

export interface WeeklyFreightConfig {
  active: boolean
  /** 0 = domingo ... 6 = sábado. */
  weekday: number
  /** Hora (0 a 23, horário de Brasília) a partir da qual sai o e-mail. */
  hour: number
  emails: string[]
  /** Filial do resumo (null = todas). */
  unitId: string | null
}

export const DEFAULT_WEEKLY_FREIGHT: WeeklyFreightConfig = { active: false, weekday: 1, hour: 8, emails: [], unitId: null }

const EMAIL = /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,255}\.[a-z]{2,}$/i

export function cleanWeeklyFreight(raw: unknown): WeeklyFreightConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const int = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : d)
  const emails = (Array.isArray(r.emails) ? r.emails : typeof r.emails === 'string' ? r.emails.split(/[\s,;]+/) : [])
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => EMAIL.test(e))
  return {
    active: r.active === true,
    weekday: int(r.weekday, 0, 6, DEFAULT_WEEKLY_FREIGHT.weekday),
    hour: int(r.hour, 0, 23, DEFAULT_WEEKLY_FREIGHT.hour),
    emails: [...new Set(emails)].slice(0, 20),
    unitId: typeof r.unitId === 'string' && /^[0-9a-f-]{36}$/i.test(r.unitId) ? r.unitId : null,
  }
}

/** Data (AAAA-MM-DD), dia da semana e hora em São Paulo. */
export function spNow(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!)
  return { date: `${p.year}-${p.month}-${p.day}`, weekday, hour: Number(p.hour) }
}

/** Hora de enviar: ligado, com destinatários, no dia e a partir da hora, e ainda não enviado hoje. */
export function weeklyDue(cfg: WeeklyFreightConfig, now: Date, lastDate: string | null | undefined) {
  if (!cfg.active || !cfg.emails.length) return false
  const sp = spNow(now)
  return sp.weekday === cfg.weekday && sp.hour >= cfg.hour && lastDate !== sp.date
}

/** Período do resumo: os 7 dias anteriores ao dia do envio (AAAA-MM-DD, inclusive). */
export function weeklyPeriod(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  const day = (n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10)
  return { from: day(-7), to: day(-1) }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export const brl = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const pctTxt = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const br = (date: string) => date.split('-').reverse().join('/')

/** Assunto, texto e HTML (tabelas e estilos inline, para os clientes de e-mail) do resumo. */
export function weeklyFreightEmail(s: FreightSummary, p: { from: string; to: string; appName: string; unitName: string | null; link: string; color: string }) {
  const period = `${br(p.from)} a ${br(p.to)}`
  const scope = p.unitName ?? 'todas as filiais'
  const t = s.totals
  const n = s.nota
  const subject = `Resumo semanal de fretes (${period}) - ${p.appName}`
  const kpis: [string, string][] = [
    ['CT-es', String(t.ctes)],
    ['Cobrado nos CT-es', brl(t.cobrado)],
    ['Esperado (cotação/tabela)', brl(t.esperado)],
    ['CT-es com divergência', `${t.divergentes} (${pctTxt(t.pctDivergente)})`],
    ['CT-es sem divergência (conciliados)', String(t.conciliados)],
    ['Acima da tabela', `${brl(t.acimaTabela)} em ${t.acimaTabelaCtes} CT-e(s)`],
    ['Cobrado nas notas CIF', brl(n.nota)],
    ['Cobrado no CT-e dessas notas', brl(n.cte)],
    ['Resultado nota − CT-e', brl(n.resultado)],
    ['Notas cobradas a menos que o CT-e', `${n.menos} · ${brl(n.menosValor)}`],
    ['Notas cobradas a mais que o CT-e', `${n.mais} · ${brl(n.maisValor)}`],
    ['Crédito recuperado', brl(t.credito)],
  ]
  const sellers = s.sellers.filter((x) => x.menos > 0).slice(0, 8)
  const carriers = s.carriers.slice(0, 8)
  const th = 'style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280"'
  const td = 'style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px"'
  const tdr = 'style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;white-space:nowrap"'
  const table = (head: string[], rows: string[][]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 20px"><tr>${head.map((h, i) => `<th ${i ? th.replace('left', 'right') : th}>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td ${i ? tdr : td}>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`
  const h2 = (x: string) => `<p style="font-size:15px;font-weight:700;margin:16px 0 4px">${esc(x)}</p>`
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:8px;padding:24px">
<tr><td>
<p style="font-size:20px;font-weight:700;margin:0 0 4px">Resumo semanal de fretes</p>
<p style="font-size:13px;color:#6b7280;margin:0 0 16px">${esc(period)} · ${esc(scope)} · CT-es pela data de emissão</p>
${table(['Indicador', 'Valor'], kpis.map(([a, b]) => [a, b]))}
${h2('Vendedores que mais cobraram frete a menos na nota')}
${sellers.length ? table(['Vendedor', 'Notas a menos', 'Cobrado a menos', 'Nota − CT-e'], sellers.map((x) => [x.name, String(x.menos), brl(x.menosValor), brl(x.resultado)])) : '<p style="font-size:13px;color:#6b7280">Nenhuma nota CIF cobrada a menos que o CT-e na semana.</p>'}
${h2('Transportadoras')}
${carriers.length ? table(['Transportadora', 'CT-es', 'Cobrado', 'Acima da tabela', '% divergente'], carriers.map((x) => [x.name, String(x.ctes), brl(x.cobrado), brl(x.acimaTabela), pctTxt(x.pctDivergente)])) : '<p style="font-size:13px;color:#6b7280">Nenhum CT-e na semana.</p>'}
<p style="margin:20px 0 8px"><a href="${esc(p.link)}" style="background:${esc(p.color)};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;display:inline-block;font-weight:600">Abrir o painel de fretes</a></p>
<p style="font-size:12px;color:#9ca3af">Notas CIF: a empresa paga a transportadora e cobra o frete do cliente na nota. "A menos": a nota cobrou menos que o CT-e, além da folga da conciliação.</p>
</td></tr></table>
<p style="font-size:12px;color:#9ca3af;margin-top:12px">${esc(p.appName)}</p>
</td></tr></table></body></html>`
  const text = [`Resumo semanal de fretes - ${period} (${scope})`, '', ...kpis.map(([a, b]) => `${a}: ${b}`), '', 'Vendedores com frete a menos na nota:', ...(sellers.length ? sellers.map((x) => `- ${x.name}: ${x.menos} nota(s), ${brl(x.menosValor)}`) : ['- nenhum']), '', p.link].join('\n')
  return { subject, html, text }
}
