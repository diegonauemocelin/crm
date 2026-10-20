// Confere se todas as versões do releases.json têm tag no GitHub e mostra os comandos para criar as que faltam,
// cada uma no último commit da main com aquela versão (o código de todas já está na main; a tag só marca a versão).
// Uso (na pasta do projeto): node scripts/versoes.mjs
import { execFileSync } from 'node:child_process'
import { releases } from './notas-versao.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const lines = (s) => s.split('\n').filter(Boolean)

git('fetch', '--quiet', 'origin', 'main')
const remotas = new Set(lines(git('ls-remote', '--tags', '--refs', 'origin')).map((l) => l.replace(/^.*refs\/tags\//, '')))
const faltam = releases().map((r) => `v${r.version}`).filter((t) => !remotas.has(t))
if (!faltam.length) {
  console.log(`Todas as ${releases().length} versões têm tag no GitHub.`)
  process.exit(0)
}

// Versão de cada commit da main (do mais antigo ao mais novo): muda só nos commits que mexem no package.json.
const versaoEm = (sha) => {
  try {
    return JSON.parse(git('show', `${sha}:package.json`)).version ?? null
  } catch {
    return null
  }
}
const mexeu = new Set(lines(git('log', '--first-parent', '--format=%H', 'origin/main', '--', 'package.json')))
const ultimo = new Map()
let versao = null
for (const sha of lines(git('rev-list', '--first-parent', '--reverse', 'origin/main'))) {
  if (versao === null || mexeu.has(sha)) versao = versaoEm(sha)
  if (versao) ultimo.set(`v${versao}`, sha)
}

const semCommit = faltam.filter((t) => !ultimo.has(t))
const marcar = faltam.filter((t) => ultimo.has(t)).reverse()
console.log(`Faltam ${faltam.length} versões no GitHub. No terminal (PowerShell), na pasta do projeto, um comando por vez:\n`)
console.log('git fetch origin')
for (const t of marcar) console.log(`git tag ${t} ${ultimo.get(t)}`)
// Todas num envio só: o GitHub não dispara a publicação (imagens) para mais de 3 tags enviadas de uma vez.
if (marcar.length) console.log(`git push origin ${marcar.join(' ')}`)
console.log('\nDepois, no GitHub: Actions › "Documentar versões antigas" › Run workflow (cria as notas de cada versão).')
if (semCommit.length) console.log(`\nSem commit com essa versão na main (confira à mão): ${semCommit.join(' ')}`)
