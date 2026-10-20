// Cria no GitHub a Release (só as notas do releases.json) das versões que já têm tag e ainda não têm Release.
// Roda no GitHub Actions ("Documentar versões antigas"). Não gera imagens nem muda qual é a versão mais nova.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { notas, releases } from './notas-versao.mjs'

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const tags = new Set(run('git', ['tag', '-l', 'v*']).split('\n').filter(Boolean))
const feitas = new Set(JSON.parse(run('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName'])).map((r) => r.tagName))
const dir = mkdtempSync(join(tmpdir(), 'notas-'))
let criadas = 0
// Da mais antiga para a mais nova.
for (const r of [...releases()].reverse()) {
  const tag = `v${r.version}`
  if (!tags.has(tag) || feitas.has(tag)) continue
  const arquivo = join(dir, `${tag}.md`)
  writeFileSync(arquivo, notas(r))
  run('gh', ['release', 'create', tag, '--title', tag, '--notes-file', arquivo, '--verify-tag', '--latest=false'])
  console.log(`Release ${tag} criada.`)
  criadas++
}
console.log(`${criadas} Release(s) criada(s).`)
const semTag = releases().map((r) => `v${r.version}`).filter((t) => !tags.has(t))
if (semTag.length) console.log(`Versões ainda sem tag (rode "node scripts/versoes.mjs" no computador e siga os comandos): ${semTag.join(' ')}`)
