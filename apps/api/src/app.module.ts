import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'
import { AtendimentoModule } from './atendimento/atendimento.module'
import { AuditModule } from './audit/audit.module'
import { AuthGuard } from './auth/auth.guard'
import { AuthModule } from './auth/auth.module'
import { CapturaModule } from './captura/captura.module'
import { CsrfMiddleware } from './common/csrf.middleware'
import { EmailModule } from './email/email.module'
import { AutomacoesModule } from './automacoes/automacoes.module'
import { env } from './config/env'
import { FilesModule } from './files/files.module'
import { LeadsModule } from './leads/leads.module'
import { PrismaModule } from './prisma/prisma.module'
import { RastreamentoModule } from './rastreamento/rastreamento.module'
import { RolesController } from './roles/roles.controller'
import { RolesService } from './roles/roles.service'
import { SettingsModule } from './settings/settings.module'
import { SystemController } from './system/system.controller'
import { SystemService } from './system/system.service'
import { UsersController } from './users/users.controller'
import { UsersService } from './users/users.service'

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.isProd ? 'info' : 'debug',
        transport: env.isProd ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
        // Cookies e cabeçalhos de autenticação nunca vão para o log.
        redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
        // Health e as páginas vistas do site (milhares por dia) não poluem o log.
        autoLogging: { ignore: (req) => req.url === '/api/health' || !!req.url?.startsWith('/api/public/rastreamento/') || !!req.url?.startsWith('/api/public/captura/config') || !!req.url?.startsWith('/api/public/e/') },
      },
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditModule,
    FilesModule,
    SettingsModule,
    AuthModule,
    LeadsModule,
    AtendimentoModule,
    RastreamentoModule,
    CapturaModule,
    EmailModule,
    AutomacoesModule,
  ],
  controllers: [UsersController, RolesController, SystemController],
  providers: [
    UsersService,
    RolesService,
    SystemService,
    // Ordem importa: primeiro o limite de requisições, depois sessão + permissão.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CsrfMiddleware).forRoutes('*')
  }
}
