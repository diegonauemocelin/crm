import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { ChatService } from './chat.service'
import { INLINE_MIME } from './mensagens'

class ListDto {
  @IsOptional() @IsUUID() numero?: string
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() naoLidas?: boolean
  @IsOptional() @IsString() @MaxLength(100) busca?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) pagina?: number
}

class ThreadDto {
  @IsOptional() @IsISO8601() antes?: string
}

/** Chat WhatsApp: conversas visíveis para o usuário (permissão "Chat WhatsApp", com escopo). */
@ApiTags('WhatsApp')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversas')
  list(@CurrentUser() user: AuthUser, @Query() q: ListDto) {
    return this.chat.conversations(user, { numberId: q.numero, unread: q.naoLidas, search: q.busca, page: q.pagina })
  }

  @Get('conversas/:id')
  thread(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ThreadDto) {
    return this.chat.conversation(user, id, q.antes)
  }

  /** Mídia: imagens, áudios, vídeos e PDF abrem na tela; o resto vai como download (nunca é executado no navegador). */
  @Get('midias/:id')
  async media(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const m = await this.chat.media(user, id)
    const inline = INLINE_MIME.has(m.mime)
    res.setHeader('Content-Type', inline ? m.mime : 'application/octet-stream')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    const name = (m.fileName ?? 'arquivo').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(m.content)
  }
}
