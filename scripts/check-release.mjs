// Confere se a versão está coerente em todos os lugares antes de publicar.
// Uso: node scripts/check-release.mjs [vX.Y.Z]   (no CI, o argumento é a tag sendo publicada)
import { readFileSync } from 'node:fs'

const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
const releases = read('releases.json').releases
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const TYPES = new Set(['novo', 'melhoria', 'correcao', 'seguranca', 'infra'])
const erros = []

if (!releases?.length) erros.push('releases.json sem versões.')
const atual = releases?.[0]?.version
const vistos = new Set()
for (const r of releases ?? []) {
  if (!SEMVER.test(r.version)) erros.push(`Versão inválida: ${r.version}`)
  if (vistos.has(r.version)) erros.push(`Versão repetida: ${r.version}`)
  vistos.add(r.version)
  if (Number.isNaN(Date.parse(r.date))) erros.push(`${r.version}: data inválida (${r.date})`)
  if (!r.title) erros.push(`${r.version}: sem título`)
  if (!r.changes?.length) erros.push(`${r.version}: sem itens de mudança`)
  for (const c of r.changes ?? []) if (!TYPES.has(c.type)) erros.push(`${r.version}: tipo de mudança inválido "${c.type}"`)
}

for (const f of ['package.json', 'apps/api/package.json', 'apps/web/package.json']) {
  const v = read(f).version
  if (v !== atual) erros.push(`${f} está em ${v}, mas releases.json indica ${atual} como versão atual.`)
}

const tag = process.argv[2]
if (tag && tag.replace(/^v/, '') !== atual) erros.push(`A tag ${tag} não corresponde à versão atual ${atual} do releases.json.`)

if (erros.length) {
  console.error('Problemas de versão:\n - ' + erros.join('\n - '))
  process.exit(1)
}
console.log(`Versão ${atual} coerente em releases.json e package.json.`)
