import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { Public } from '../common/decorators'
import { FilesService } from './files.service'

@ApiTags('Arquivos')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Logo e favicon abrem sem login para aparecer na tela de entrada. Os demais exigem sessão do mesmo tenant. */
  @Public()
  @Get('public/:id')
  async public(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { asset, content } = await this.files.read(id)
    if (!asset.isPublic) throw new NotFoundException()
    this.send(res, asset.mime, content, 'public, max-age=86400')
  }

  @Get(':id')
  async private(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response) {
    const { asset, content } = await this.files.read(id)
    if (asset.tenantId !== req.user?.tenantId) throw new NotFoundException()
    this.send(res, asset.mime, content, 'private, max-age=3600')
  }

  private send(res: Response, mime: string, content: Buffer, cache: string) {
    res.setHeader('Content-Type', mime)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('Cache-Control', cache)
    res.send(content)
  }
}
