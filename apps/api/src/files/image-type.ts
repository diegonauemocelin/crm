// Tipo de imagem pelos bytes iniciais (sem Nest: usado também pelos testes).

export const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a' },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'image/x-icon', ext: 'ico', test: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 },
]

/**
 * O tipo é detectado pelos bytes do arquivo, não pela extensão nem pelo Content-Type enviado.
 * SVG não é aceito: pode carregar script e virar XSS.
 */
export function detectImage(buffer: Buffer) {
  return SIGNATURES.find((s) => s.test(buffer)) ?? null
}

