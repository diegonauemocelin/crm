import { describe, expect, it } from 'vitest'
import { mapLimit } from '../src/fretes/limite'

describe('cálculo das tabelas com limite de simultâneas', () => {
  it('mantém a ordem e nunca passa do limite', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, n * 3))
      running--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30, 0, 60])
    expect(peak).toBe(3)
    expect(await mapLimit([], 3, async (n: number) => n)).toEqual([])
  })
})
