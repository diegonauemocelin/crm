#!/usr/bin/env node
/**
 * Teste de carga: simula a equipe usando as telas mais pesadas ao mesmo tempo e mede o tempo de resposta.
 *
 *   CRM_URL=http://localhost:5173 CRM_EMAIL=... CRM_SENHA=... CRM_CODIGO=123456 node scripts/teste-carga.mjs [usuarios] [rodadas]
 *
 * - Sem dependências. Só leitura: não cria nem altera nada no sistema.
 * - CRM_CODIGO é o código do 2FA (digite na hora; se a conta não tiver 2FA, deixe vazio).
 * - O sistema limita cada usuário logado a 300 requisições por minuto (e a Visão geral a 30). Como o teste usa uma só conta, o padrão
 *   (8 usuários x 3 rodadas x 7 telas = 168 requisições) fica dentro do limite. Na vida real cada pessoa tem a própria conta.
 * - Em produção, rode fora do horário de pico e acompanhe a memória na VPS com: docker stats --no-stream
 */

const BASE = (process.env.CRM_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const USERS = Number(process.argv[2] ?? 8)
const ROUNDS = Number(process.argv[3] ?? 3)

const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
const daysAgo = (n) => new Date(Date.now() - 3 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10)

const SCREENS = [
  ['Início (sessão)', 'GET', '/api/auth/me'],
  ['Base de leads', 'GET', '/api/leads?page=1&pageSize=50'],
  ['Busca de leads', 'GET', '/api/leads?page=1&pageSize=50&search=silva'],
  ['Dashboard Pré-Vendas (90 dias)', 'GET', `/api/atendimentos/dashboard?kind=PRE_VENDAS&from=${daysAgo(89)}&to=${today}`],
  ['Visão geral (30 dias)', 'GET', `/api/relatorios/visao-geral?from=${daysAgo(29)}&to=${today}`],
  ['Relatório: vendas por vendedor', 'POST', '/api/relatorios/executar', { config: { source: 'atendimentos', dimensions: ['vendedor'], metrics: ['atendimentos', 'vendas', 'valor_vendido'], period: { preset: '90' }, chart: 'tabela', limit: 20 } }],
  ['Carrinhos abandonados', 'GET', '/api/loja/carrinhos?view=abandonados&page=1&pageSize=30'],
]

const jar = new Map()
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
function keep(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const i = pair.indexOf('=')
    jar.set(pair.slice(0, i), pair.slice(i + 1))
  }
}
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Cookie: cookieHeader(), ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': jar.get('crm_csrf') ?? '' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  keep(res)
  return res
}

async function login() {
  const { CRM_EMAIL: email, CRM_SENHA: password, CRM_CODIGO: code } = process.env
  if (!email || !password) throw new Error('Informe CRM_EMAIL e CRM_SENHA (e CRM_CODIGO, se a conta tiver 2FA).')
  await call('GET', '/api/system/version')
  const r1 = await call('POST', '/api/auth/login', { email, password })
  if (!r1.ok) throw new Error(`Login recusado (${r1.status}).`)
  const status = (await r1.json()).status
  if (status === 'mfa_required') {
    if (!code) throw new Error('A conta tem 2FA: informe o código em CRM_CODIGO.')
    const r2 = await call('POST', '/api/auth/2fa/verify', { code })
    if (!r2.ok) throw new Error(`Código 2FA recusado (${r2.status}).`)
  }
}

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] ?? 0

async function main() {
  console.log(`Teste de carga em ${BASE}: ${USERS} usuário(s) x ${ROUNDS} rodada(s) x ${SCREENS.length} telas`)
  await login()
  const times = new Map(SCREENS.map(([name]) => [name, []]))
  const errors = new Map()
  const started = Date.now()
  await Promise.all(
    Array.from({ length: USERS }, async (_, u) => {
      // Cada "usuário" começa numa tela diferente, como uma equipe de verdade.
      for (let r = 0; r < ROUNDS; r++) {
        for (let s = 0; s < SCREENS.length; s++) {
          const [name, method, path, body] = SCREENS[(s + u) % SCREENS.length]
          const t0 = performance.now()
          try {
            const res = await call(method, path, body)
            await res.arrayBuffer()
            if (!res.ok) errors.set(`${name}: HTTP ${res.status}`, (errors.get(`${name}: HTTP ${res.status}`) ?? 0) + 1)
          } catch (err) {
            errors.set(`${name}: ${err.message}`, (errors.get(`${name}: ${err.message}`) ?? 0) + 1)
          }
          times.get(name).push(performance.now() - t0)
        }
      }
    }),
  )
  const total = USERS * ROUNDS * SCREENS.length
  const secs = (Date.now() - started) / 1000
  console.log(`\n${total} requisições em ${secs.toFixed(1)} s (${(total / secs).toFixed(1)} por segundo)\n`)
  console.log('Tela'.padEnd(34) + 'mediana'.padStart(10) + 'p95'.padStart(10) + 'máximo'.padStart(10))
  for (const [name, list] of times) {
    const sorted = [...list].sort((a, b) => a - b)
    const ms = (v) => `${Math.round(v)} ms`.padStart(10)
    console.log(name.padEnd(34) + ms(pct(sorted, 50)) + ms(pct(sorted, 95)) + ms(sorted.at(-1) ?? 0))
  }
  if (errors.size) {
    console.log('\nErros:')
    for (const [k, v] of errors) console.log(`  ${v}x ${k}`)
    process.exitCode = 1
  } else {
    console.log('\nSem erros.')
  }
}

main().catch((err) => {
  console.error(`Falhou: ${err.message}`)
  process.exit(1)
})
