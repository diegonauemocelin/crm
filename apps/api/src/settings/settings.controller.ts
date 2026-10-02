import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import { AuditService } from '../audit/audit.service'
import { encrypt } from '../common/crypto'
import { CurrentUser, Public, ReqContext, type RequestCtx, RequirePermission } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { FilesService, IMAGE_UPLOAD_LIMIT } from '../files/files.service'
import { TenantService } from '../prisma/prisma.module'
import { MailService } from './mail.service'
import { type BrandingSettings, publicBranding, SettingsService, type SmtpSecurity, type SmtpSettings } from './settings.service'

const HEX = /^#[0-9a-fA-F]{6}$/

class BrandingDto {
  @ApiProperty() @IsString() @MaxLength(60) appName!: string
  @ApiProperty() @IsString() @MaxLength(30) shortName!: string
  @ApiProperty() @Matches(HEX, { message: 'Cor inválida. Use o formato #RRGGBB.' }) primaryColor!: string
  @ApiProperty() @Matches(HEX, { message: 'Cor inválida. Use o formato #RRGGBB.' }) sidebarColor!: string
  @ApiProperty() @IsString() @MaxLength(80) loginTitle!: string
  @ApiProperty() @IsString() @MaxLength(160) loginSubtitle!: string
  @ApiProperty({ enum: ['MODERN', 'CLASSIC'] }) @IsIn(['MODERN', 'CLASSIC']) defaultLayout!: 'MODERN' | 'CLASSIC'
  @ApiProperty() @IsBoolean() allowLayoutChoice!: boolean
  @ApiProperty() @ValidateIf((o: BrandingDto) => o.supportEmail !== '') @IsEmail() supportEmail!: string
}

class SmtpDto {
  @ApiProperty() @IsString() @MaxLength(200) @Matches(/^[a-zA-Z0-9.-]+$/, { message: 'Servidor inválido.' }) host!: string
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port!: number
  @ApiProperty({ enum: ['ssl', 'starttls', 'none'] }) @IsIn(['ssl', 'starttls', 'none']) security!: SmtpSecurity
  @ApiProperty() @IsString() @MaxLength(200) username!: string
  @ApiProperty({ required: false, description: 'Deixe vazio para manter a senha atual' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string
  @ApiProperty() @IsString() @MaxLength(100) fromName!: string
  @ApiProperty() @IsEmail({}, { message: 'E-mail do remetente inválido.' }) fromEmail!: string
  @ApiProperty() @ValidateIf((o: SmtpDto) => o.replyTo !== '') @IsEmail() replyTo!: string
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(100000) maxPerMinute!: number
}

class TestEmailDto extends SmtpDto {
  @ApiProperty() @IsEmail({}, { message: 'Destinatário inválido.' }) to!: string
}

const IMAGE_SLOTS = { logo: 'logoFileId', 'logo-dark': 'logoDarkFileId', favicon: 'faviconFileId' } as const

function smtpView(s: SmtpSettings) {
  const { passwordEnc, ...rest } = s
  return { ...rest, hasPassword: !!passwordEnc }
}

@ApiTags('Configurações')
@Controller()
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly tenants: TenantService,
  ) {}

  /** Identidade visual usada na tela de login, antes de existir sessão. */
  @Public()
  @Get('public/branding')
  async publicBranding() {
    return publicBranding(await this.settings.branding(await this.tenants.defaultId()))
  }

  @Get('settings/branding')
  @RequirePermission('configuracoes', 'view')
  async getBranding(@CurrentUser() user: AuthUser) {
    return publicBranding(await this.settings.branding(user.tenantId))
  }

  @Put('settings/branding')
  @RequirePermission('configuracoes', 'edit')
  async putBranding(@CurrentUser() user: AuthUser, @Body() dto: BrandingDto, @ReqContext() ctx: RequestCtx) {
    const current = await this.settings.branding(user.tenantId)
    const next: BrandingSettings = { ...current, ...dto }
    await this.settings.set(user.tenantId, 'branding', next)
    await this.audit.byUser(user, ctx, 'settings.branding_updated', 'settings', 'branding', { ...dto })
    return publicBranding(next)
  }

  @Post('settings/branding/:slot')
  @RequirePermission('configuracoes', 'edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_UPLOAD_LIMIT } }))
  async uploadImage(
    @CurrentUser() user: AuthUser,
    @Param('slot') slot: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @ReqContext() ctx: RequestCtx,
  ) {
    const field = IMAGE_SLOTS[slot as keyof typeof IMAGE_SLOTS]
    if (!field) throw new BadRequestException('Tipo de imagem inválido.')
    const asset = await this.files.saveImage(user.tenantId, `branding-${slot}`, file, true)
    const next = { ...(await this.settings.branding(user.tenantId)), [field]: asset.id }
    await this.settings.set(user.tenantId, 'branding', next)
    await this.audit.byUser(user, ctx, 'settings.branding_image_updated', 'settings', 'branding', { slot, fileId: asset.id })
    return publicBranding(next)
  }

  @Post('settings/branding/:slot/remove')
  @HttpCode(200)
  @RequirePermission('configuracoes', 'edit')
  async removeImage(@CurrentUser() user: AuthUser, @Param('slot') slot: string, @ReqContext() ctx: RequestCtx) {
    const field = IMAGE_SLOTS[slot as keyof typeof IMAGE_SLOTS]
    if (!field) throw new BadRequestException('Tipo de imagem inválido.')
    const next = { ...(await this.settings.branding(user.tenantId)), [field]: null }
    await this.settings.set(user.tenantId, 'branding', next)
    await this.audit.byUser(user, ctx, 'settings.branding_image_removed', 'settings', 'branding', { slot })
    return publicBranding(next)
  }

  @Get('settings/smtp')
  @RequirePermission('configuracoes', 'view')
  async getSmtp(@CurrentUser() user: AuthUser) {
    return smtpView(await this.settings.smtp(user.tenantId))
  }

  @Put('settings/smtp')
  @RequirePermission('configuracoes', 'edit')
  async putSmtp(@CurrentUser() user: AuthUser, @Body() dto: SmtpDto, @ReqContext() ctx: RequestCtx) {
    const current = await this.settings.smtp(user.tenantId)
    const { password, ...rest } = dto
    const next: SmtpSettings = { ...current, ...rest, passwordEnc: password ? encrypt(password) : current.passwordEnc }
    await this.settings.set(user.tenantId, 'smtp', next)
    await this.audit.byUser(user, ctx, 'settings.smtp_updated', 'settings', 'smtp', {
      host: dto.host,
      port: dto.port,
      security: dto.security,
      username: dto.username,
      fromEmail: dto.fromEmail,
      senhaAlterada: !!password,
    })
    return smtpView(next)
  }

  /** Testa com os dados do formulário (ainda não salvos). Sem senha nova, usa a já gravada. */
  @Post('settings/smtp/test-connection')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('configuracoes', 'edit')
  async testConnection(@CurrentUser() user: AuthUser, @Body() dto: SmtpDto) {
    const { config, password } = await this.merge(user.tenantId, dto)
    try {
      await this.mail.verify(config, password)
      return { ok: true, message: 'Conexão e autenticação realizadas com sucesso.' }
    } catch (err) {
      return { ok: false, message: describeSmtpError(err) }
    }
  }

  @Post('settings/smtp/test-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermission('configuracoes', 'edit')
  async testEmail(@CurrentUser() user: AuthUser, @Body() dto: TestEmailDto, @ReqContext() ctx: RequestCtx) {
    const { config, password } = await this.merge(user.tenantId, dto)
    const branding = await this.settings.branding(user.tenantId)
    try {
      await this.mail.sendWith(
        config,
        {
          to: dto.to,
          subject: `Teste de envio - ${branding.appName}`,
          text: 'Este é um e-mail de teste. Se você recebeu, o servidor de envio está configurado corretamente.',
          html: this.mail.simpleTemplate(branding, {
            title: 'Teste de envio',
            greeting: `Olá, ${user.name}.`,
            body: 'Este é um e-mail de teste. Se você recebeu, o servidor de envio está configurado corretamente.',
          }),
        },
        password,
      )
      await this.audit.byUser(user, ctx, 'settings.smtp_test_sent', 'settings', 'smtp', { to: dto.to })
      return { ok: true, message: `E-mail de teste enviado para ${dto.to}.` }
    } catch (err) {
      return { ok: false, message: describeSmtpError(err) }
    }
  }

  private async merge(tenantId: string, dto: SmtpDto) {
    const current = await this.settings.smtp(tenantId)
    const { password, ...rest } = dto
    return { config: { ...current, ...rest } as SmtpSettings, password: password || undefined }
  }
}

/** Traduz os erros mais comuns do SMTP para algo que o administrador consiga resolver. */
export function describeSmtpError(err: unknown): string {
  const e = err as { code?: string; message?: string; response?: string }
  const hint = smtpHint(e?.code)
  if (hint && e.response) return `${hint} Resposta do servidor: ${e.response}`
  return hint ?? (err instanceof Error ? err.message : 'Falha desconhecida ao falar com o servidor de e-mail.')
}

function smtpHint(code: string | undefined): string | null {
  switch (code) {
    case 'EAUTH':
      return 'Usuário ou senha do e-mail recusados pelo servidor.'
    case 'ECONNECTION':
    case 'ECONNREFUSED':
      return 'Não foi possível conectar. Confira servidor, porta e tipo de segurança.'
    case 'ETIMEDOUT':
      return 'O servidor não respondeu a tempo. Confira a porta e se ela está liberada.'
    case 'ESOCKET':
      return 'Falha na conexão segura. Tente trocar entre SSL (porta 465) e STARTTLS (porta 587).'
    case 'EENVELOPE':
      return 'Remetente ou destinatário recusado pelo servidor.'
    default:
      return null
  }
}
