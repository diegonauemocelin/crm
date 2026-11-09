import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { detectImage } from './image-type'

export const IMAGE_UPLOAD_LIMIT = 1024 * 1024 // 1 MB
/** Imagens de e-mail (o proxy do servidor aceita até 2 MB por envio). */
export const EMAIL_IMAGE_LIMIT = 1.5 * 1024 * 1024

export { detectImage }

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService) {}

  async saveImage(tenantId: string, kind: string, file: Express.Multer.File | undefined, isPublic: boolean, opts: { maxBytes?: number; types?: string[] } = {}) {
    const max = opts.maxBytes ?? IMAGE_UPLOAD_LIMIT
    if (!file) throw new BadRequestException('Envie um arquivo.')
    if (file.size > max) throw new BadRequestException(`Arquivo maior que ${(max / 1024 / 1024).toLocaleString('pt-BR')} MB.`)
    const type = detectImage(file.buffer)
    const allowed = opts.types ?? ['png', 'jpg', 'webp', 'ico']
    if (!type || !allowed.includes(type.ext)) throw new BadRequestException(`Formato não suportado. Use ${allowed.map((t) => t.toUpperCase()).join(', ')}.`)

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

  /** Guarda um arquivo já conferido por quem chama (ex.: mídia do WhatsApp). Nunca público. */
  async saveBuffer(tenantId: string, kind: string, buffer: Buffer, mime: string, ext: string) {
    const id = randomUUID()
    const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin'
    const relative = join(tenantId, `${id}.${safeExt}`)
    await mkdir(resolve(env.uploadDir, tenantId), { recursive: true })
    await writeFile(resolve(env.uploadDir, relative), buffer, { mode: 0o644 })
    return this.prisma.fileAsset.create({ data: { id, tenantId, kind, mime: mime.slice(0, 120), size: buffer.length, path: relative, isPublic: false } })
  }

  /** Apaga o arquivo e o registro (quem chama confere se pode). */
  async remove(id: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id } })
    if (!asset) return
    const base = resolve(env.uploadDir)
    const full = resolve(base, asset.path)
    if (full.startsWith(base)) await rm(full, { force: true })
    await this.prisma.fileAsset.delete({ where: { id } })
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
