import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { IsString, MaxLength } from 'class-validator'
import type { Request, Response } from 'express'
import { CurrentUser, Public } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { TenantService } from '../prisma/prisma.module'
import { SettingsService } from '../settings/settings.service'
import { PushService } from './push.service'

class SubscribeDto {
  @ApiProperty() @IsString() @MaxLength(1000) endpoint!: string
  @ApiProperty() @IsString() @MaxLength(200) p256dh!: string
  @ApiProperty() @IsString() @MaxLength(100) auth!: string
}

class UnsubscribeDto {
  @ApiProperty() @IsString() @MaxLength(1000) endpoint!: string
}

/** Ícone que acompanha o sistema, quando a empresa ainda não enviou o dela. */
const FALLBACK_ICON = '/app-icon.png'

/** App no celular (PWA): nome e ícone para instalar na tela inicial e as notificações. */
@ApiTags('App no celular')
@Controller('app')
export class AppMovelController {
  constructor(
    private readonly settings: SettingsService,
    private readonly tenants: TenantService,
    private readonly push: PushService,
  ) {}

  /** Manifesto do app: nome, cor e ícone da empresa (Configurações › Marca). Abre direto no chat do celular. */
  @Public()
  @Get('manifest.webmanifest')
  async manifest(@Res() res: Response) {
    const b = await this.settings.branding(await this.tenants.defaultId())
    const iconId = b.appIconFileId ?? null
    const icon = iconId ? `/api/files/public/${iconId}` : FALLBACK_ICON
    const type = iconId ? undefined : 'image/png'
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.send(
      JSON.stringify({
        id: '/app',
        name: b.shortName || b.appName,
        short_name: (b.shortName || b.appName).slice(0, 12),
        description: 'Conversas e painéis no celular',
        lang: 'pt-BR',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: b.brandColor || b.primaryColor,
        icons: [
          { src: icon, sizes: '192x192', ...(type ? { type } : {}), purpose: 'any' },
          { src: icon, sizes: '512x512', ...(type ? { type } : {}), purpose: 'any' },
          { src: icon, sizes: '512x512', ...(type ? { type } : {}), purpose: 'maskable' },
        ],
      }),
    )
  }

  /** Ícone da tela inicial do iPhone (o Safari não lê o manifesto). */
  @Public()
  @Get('icone.png')
  async icon(@Res() res: Response) {
    const b = await this.settings.branding(await this.tenants.defaultId())
    res.setHeader('Cache-Control', 'no-cache')
    res.redirect(302, b.appIconFileId ? `/api/files/public/${b.appIconFileId}` : FALLBACK_ICON)
  }

  @Get('push/chave')
  async key(@CurrentUser() user: AuthUser) {
    return { publicKey: await this.push.publicKey(user.tenantId) }
  }

  @Post('push/inscricao')
  @HttpCode(200)
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto, @Req() req: Request) {
    return this.push.subscribe(user, dto, req.headers['user-agent'])
  }

  @Post('push/cancelar')
  @HttpCode(200)
  unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: UnsubscribeDto) {
    return this.push.unsubscribe(user, dto.endpoint)
  }

  /** Manda uma notificação de teste para os aparelhos de quem pediu. */
  @Post('push/teste')
  @HttpCode(200)
  async test(@CurrentUser() user: AuthUser) {
    const sent = await this.push.notify(user.tenantId, [user.id], { title: 'Notificações ligadas', body: 'É assim que as mensagens novas vão aparecer.', url: '/app', tag: 'teste' })
    return { sent }
  }
}
