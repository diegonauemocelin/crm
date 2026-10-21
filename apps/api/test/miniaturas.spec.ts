import { describe, expect, it } from 'vitest'
import { fetchThumb } from '../src/marketing/miniaturas'

const img = (type = 'image/jpeg', status = 200) => new Response(new Uint8Array([1, 2, 3]), { status, headers: { 'content-type': type } })

describe('Miniaturas pelo CRM', () => {
  it('só CDN da Meta, só imagem, com cache', async () => {
    let calls = 0
    const f = (async () => (calls++, img())) as unknown as typeof fetch
    const url = 'https://scontent.cdninstagram.com/v/a.jpg?x=1'
    expect((await fetchThumb(url, f)).type).toBe('image/jpeg')
    await fetchThumb(url, f)
    expect(calls).toBe(1)
    await expect(fetchThumb('https://evil.example.com/a.jpg', f)).rejects.toMatchObject({ status: 400 })
    await expect(fetchThumb('https://scontent.cdninstagram.com/v/b.html', (async () => img('text/html')) as unknown as typeof fetch)).rejects.toMatchObject({ status: 415 })
    await expect(fetchThumb('https://scontent.cdninstagram.com/v/c.jpg', (async () => img('image/jpeg', 403)) as unknown as typeof fetch)).rejects.toMatchObject({ status: 404 })
  })
})
