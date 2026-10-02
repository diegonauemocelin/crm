// Teste de fumaça das proteções de segurança contra um ambiente no ar (local ou produção).
// Não cria usuários nem altera dados: só verifica respostas que não exigem login.
//
//   node scripts/teste-fumaca.mjs https://crm.usaparts.com.br
//   node scripts/teste-fumaca.mjs http://localhost:5173

const BASE = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '')
const resultados = []
const check = (nome, ok, extra) => resultados.push(`${ok ? 'OK    ' : 'FALHOU'} ${nome}${!ok && extra ? ` -> ${extra}` : ''}`)

async function req(path, init = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...init })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* não é JSON */
  }
  return { res, json, text }
}

const health = await req('/api/health')
check('API saudável', health.res.ok && health.json?.db === 'ok', health.text.slice(0, 120))

const version = await req('/api/system/version')
check(`versão publicada (${version.json?.version ?? '?'})`, version.res.ok && !!version.json?.version)

const csrf = version.res.headers.getSetCookie().find((c) => c.startsWith('crm_csrf='))
check('cookie CSRF com SameSite=Strict', !!csrf && /SameSite=Strict/i.test(csrf), csrf)
if (BASE.startsWith('https://')) check('cookie CSRF marcado como Secure', !!csrf && /Secure/i.test(csrf), csrf)

const home = await req('/')
const h = home.res.headers
check('CSP no frontend', /default-src 'self'/.test(h.get('content-security-policy') ?? ''), h.get('content-security-policy'))
check("CSP sem 'unsafe-eval' e sem script inline", !/unsafe-eval|script-src[^;]*unsafe-inline/.test(h.get('content-security-policy') ?? ''))
check('X-Frame-Options', !!h.get('x-frame-options'), h.get('x-frame-options'))
check('X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff')
check('Referrer-Policy', !!h.get('referrer-policy'))
if (BASE.startsWith('https://')) {
  check('HSTS', /max-age=\d+/.test(h.get('strict-transport-security') ?? ''), h.get('strict-transport-security'))
  const http = await fetch(BASE.replace('https://', 'http://'), { redirect: 'manual' }).catch(() => null)
  check('HTTP redireciona para HTTPS', !!http && [301, 302, 308].includes(http.status) && (http.headers.get('location') ?? '').startsWith('https://'))
}
check('sem cabeçalho X-Powered-By', !h.get('x-powered-by') && !health.res.headers.get('x-powered-by'))

const users = await req('/api/users')
check('rota protegida sem sessão retorna 401', users.res.status === 401, users.res.status)
const audit = await req('/api/audit')
check('auditoria sem sessão retorna 401', audit.res.status === 401, audit.res.status)

const noCsrf = await req('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'x@x.com', password: 'x' }),
})
check('POST sem token CSRF é recusado (403)', noCsrf.res.status === 403, noCsrf.res.status)

const evil = await req('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.example', Cookie: 'crm_csrf=abc', 'X-CSRF-Token': 'abc' },
  body: JSON.stringify({ email: 'x@x.com', password: 'x' }),
})
check('POST de outra origem é recusado (403)', evil.res.status === 403, evil.res.status)

const traversal = await req('/api/files/public/..%2F..%2Fetc%2Fpasswd')
check('path traversal em arquivos recusado', traversal.res.status === 400 || traversal.res.status === 404, traversal.res.status)

console.log(resultados.join('\n'))
const falhas = resultados.filter((r) => r.startsWith('FALHOU')).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações OK`)
process.exit(falhas ? 1 : 0)
