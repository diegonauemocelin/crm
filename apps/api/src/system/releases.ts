import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type ChangeType = 'novo' | 'melhoria' | 'correcao' | 'seguranca' | 'infra'

export interface ReleaseEntry {
  version: string
  date: string
  title: string
  changes: { type: ChangeType; area?: string; text: string }[]
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export function compareSemver(a: string, b: string): number {
  const ma = SEMVER.exec(a)
  const mb = SEMVER.exec(b)
  if (!ma || !mb) return a.localeCompare(b)
  for (let i = 1; i <= 3; i++) {
    const diff = Number(ma[i]) - Number(mb[i])
    if (diff !== 0) return diff
  }
  // Versão sem sufixo (estável) é maior que a mesma com sufixo (pré-release).
  if (!ma[4] && mb[4]) return 1
  if (ma[4] && !mb[4]) return -1
  return (ma[4] ?? '').localeCompare(mb[4] ?? '')
}

/** releases.json é a fonte única de versão: a primeira entrada (maior versão) é a versão instalada. */
export function loadReleases(file: string): ReleaseEntry[] {
  const raw = JSON.parse(readFileSync(resolve(file), 'utf8')) as { releases: ReleaseEntry[] }
  const releases = raw.releases ?? []
  for (const r of releases) {
    if (!SEMVER.test(r.version)) throw new Error(`Versão inválida em releases.json: ${r.version}`)
    if (Number.isNaN(Date.parse(r.date))) throw new Error(`Data inválida em releases.json (${r.version}): ${r.date}`)
  }
  return [...releases].sort((a, b) => compareSemver(b.version, a.version))
}

/**
 * Novidades que o usuário ainda não viu: as versões depois da última vista (até 5), sem as mudanças técnicas (infra).
 * Usuário que nunca viu nenhuma: só a versão atual.
 */
export function unseenReleases(releases: ReleaseEntry[], seen: string | null, max = 5): ReleaseEntry[] {
  const visible = (r: ReleaseEntry) => ({ ...r, changes: r.changes.filter((c) => c.type !== 'infra') })
  const sorted = [...releases].sort((a, b) => compareSemver(b.version, a.version))
  const list = seen ? sorted.filter((r) => compareSemver(r.version, seen) > 0) : sorted.slice(0, 1)
  return list.map(visible).filter((r) => r.changes.length).slice(0, max)
}
