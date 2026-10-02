import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../common/decorators'
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
}
