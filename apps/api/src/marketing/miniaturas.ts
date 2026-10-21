/**
 * Miniaturas das publicações: o Instagram bloqueia mostrar as imagens dele em outro site (Cross-Origin-Resource-Policy),
 * então o servidor do CRM busca a imagem e entrega para a tela. Só endereços https da CDN da Meta, só imagem, até 2 MB,
 * com cache curto em memória (os links da Meta vencem em alguns dias).
 */
import { metaThumb } from './sync'

const MAX_BYTES = 2 * 1024 * 1024
const TTL_MS = 6 * 3_600_000
const MAX_ITEMS = 400
const cache = new Map<string, { at: number; type: string; body: Buffer }>()

export class ThumbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function fetchThumb(url: string, fetcher: typeof fetch = fetch) {
  const safe = metaThumb(url)
  if (!safe) throw new ThumbError('Endereço de imagem não permitido.', 400)
  const hit = cache.get(safe)
  if (hit && Date.now() - hit.at < TTL_MS) return hit
  let res: Response
  try {
    res = await fetcher(safe, { signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { Accept: 'image/*' } })
  } catch {
    throw new ThumbError('A Meta não respondeu.', 502)
  }
  // Link vencido (a Meta troca a cada poucos dias): a próxima sincronização traz um novo.
  if (!res.ok) throw new ThumbError('Imagem indisponível.', 404)
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!/^image\/(jpeg|png|webp|gif|heic|avif)$/.test(type)) throw new ThumbError('Não é uma imagem.', 415)
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new ThumbError('Imagem grande demais.', 413)
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > MAX_BYTES) throw new ThumbError('Imagem grande demais.', 413)
  const item = { at: Date.now(), type, body }
  if (cache.size >= MAX_ITEMS) cache.delete(cache.keys().next().value!)
  cache.set(safe, item)
  return item
}
