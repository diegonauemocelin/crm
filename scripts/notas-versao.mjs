// Notas de uma versão (Markdown) a partir do releases.json: é o texto da Release no GitHub.
// Uso: node scripts/notas-versao.mjs [vX.Y.Z] > notas.md   (sem versão: a mais nova)
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const NOMES = { novo: 'Novo', melhoria: 'Melhoria', correcao: 'Correção', seguranca: 'Segurança', infra: 'Infraestrutura' }

export const releases = () => JSON.parse(readFileSync(new URL('../releases.json', import.meta.url), 'utf8')).releases

export function notas(r) {
  const areas = [...new Set(r.changes.map((c) => c.area || 'Geral'))]
  let md = `## ${r.title}\n\nPublicada em ${r.date}.\n`
  for (const a of areas) {
    md += `\n### ${a}\n`
    for (const c of r.changes.filter((c) => (c.area || 'Geral') === a)) md += `- **${NOMES[c.type] || c.type}:** ${c.text}\n`
  }
  return md
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const v = process.argv[2]?.replace(/^v/, '')
  const r = v ? releases().find((x) => x.version === v) : releases()[0]
  if (!r) {
    console.error(`A versão ${v} não está no releases.json.`)
    process.exit(1)
  }
  process.stdout.write(notas(r))
}
