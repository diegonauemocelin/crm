import { describe, expect, it } from 'vitest'
import { unseenReleases } from '../src/system/releases'

const r = (version: string, types: ('novo' | 'infra')[]) => ({ version, date: '2026-11-16', title: version, changes: types.map((type) => ({ type, text: type })) })

describe('aviso de novidades', () => {
  const list = [r('3.0.43', ['novo', 'infra']), r('3.0.42', ['infra']), r('3.0.41', ['novo']), r('3.0.40', ['novo'])]
  it('mostra as versões depois da última vista, sem as técnicas', () => {
    expect(unseenReleases(list, '3.0.40').map((x) => x.version)).toEqual(['3.0.43', '3.0.41'])
    expect(unseenReleases(list, '3.0.40')[0]!.changes.map((c) => c.type)).toEqual(['novo'])
  })
  it('já viu a atual: nada; nunca viu: só a atual', () => {
    expect(unseenReleases(list, '3.0.43')).toEqual([])
    expect(unseenReleases(list, null).map((x) => x.version)).toEqual(['3.0.43'])
  })
})
