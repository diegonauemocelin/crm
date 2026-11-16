import { Controller, Get, HttpCode, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { CurrentUser, Public } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { SystemService } from './system.service'

@ApiTags('Sistema')
@Controller()
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Public()
  @SkipThrottle()
  @Get('health')
  health() {
    return this.system.health()
  }

  /** Hora do servidor: a tela do 2FA compara com o relógio do computador (códigos dependem dos dois estarem certos). */
  @Public()
  @SkipThrottle()
  @Get('system/time')
  time() {
    return { now: Date.now() }
  }

  /** Versão exibida no rodapé de todas as telas, inclusive a de login. */
  @Public()
  @Get('system/version')
  version() {
    return this.system.version()
  }

  /** Histórico completo de atualizações (tela "Atualizações"). Qualquer usuário logado pode ver. */
  @Get('system/releases')
  releases() {
    return this.system.history()
  }

  /** Novidades da última atualização que o usuário ainda não viu (aviso que aparece uma vez). */
  @Get('system/novidades')
  whatsNew(@CurrentUser() user: AuthUser) {
    return this.system.whatsNew(user.id)
  }

  @Post('system/novidades/visto')
  @HttpCode(200)
  markSeen(@CurrentUser() user: AuthUser) {
    return this.system.markSeen(user.id)
  }
}
