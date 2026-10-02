import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'

export const IMAGE_UPLOAD_LIMIT = 1024 * 1024 // 1 MB

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
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

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService) {}

  async saveImage(tenantId: string, kind: string, file: Express.Multer.File | undefined, isPublic: boolean) {
    if (!file) throw new BadRequestException('Envie um arquivo.')
    if (file.size > IMAGE_UPLOAD_LIMIT) throw new BadRequestException('Arquivo maior que 1 MB.')
    const type = detectImage(file.buffer)
    if (!type) throw new BadRequestException('Formato não suportado. Use PNG, JPG, WEBP ou ICO.')

    const id = randomUUID()
    const relative = join(tenantId, `${id}.${type.ext}`)
    const dir = resolve(env.uploadDir, tenantId)
    await mkdir(dir, { recursive: true })
    // 0644: o container de backup (outro usuário) precisa ler os arquivos. Eles não são servidos diretamente pelo disco.
    await writeFile(resolve(env.uploadDir, relative), file.buffer, { mode: 0o644 })

    return this.prisma.fileAsset.create({
      data: { id, tenantId, kind, mime: type.mime, size: file.size, path: relative, isPublic },
    })
  }

  async read(id: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id } })
    if (!asset) throw new NotFoundException()
    const base = resolve(env.uploadDir)
    const full = resolve(base, asset.path)
    if (!full.startsWith(base)) throw new NotFoundException()
    return { asset, content: await readFile(full) }
  }
}
