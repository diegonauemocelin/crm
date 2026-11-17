import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../common/decorators'
import type { AuthUser } from '../common/types'
import { MonitorService } from './monitor.service'

/** Administração › Monitoramento (só o Administrador). */
@ApiTags('Monitoramento')
@Controller('monitoramento')
export class MonitorController {
  constructor(private readonly svc: MonitorService) {}

  @Get()
  view(@CurrentUser() user: AuthUser, @Query('horas') horas?: string) {
    const h = [1, 6, 24, 72, 168].includes(Number(horas)) ? Number(horas) : 24
    return this.svc.view(user, h)
  }
}
