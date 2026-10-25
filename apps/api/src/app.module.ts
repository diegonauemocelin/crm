import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'
import { AtendimentoModule } from './atendimento/atendimento.module'
import { AuditModule } from './audit/audit.module'
import { AuthGuard } from './auth/auth.guard'
import { AuthModule } from './auth/auth.module'
import { CapturaModule } from './captura/captura.module'
import { LandingModule } from './landing/landing.module'
import { SeoModule } from './seo/seo.module'
import { PostagensModule } from './postagens/postagens.module'
import { CsrfMiddleware } from './common/csrf.middleware'
import { EmailModule } from './email/email.module'
import { UserThrottlerGuard } from './common/throttle.guard'
import { AutomacoesModule } from './automacoes/automacoes.module'
import { RelatoriosModule } from './relatorios/relatorios.module'
import { CatalogoModule } from './catalogo/catalogo.module'
import { GoogleAdsModule } from './googleads/googleads.module'
import { SugestoesModule } from './sugestoes/sugestoes.module'
import { MarketingModule } from './marketing/marketing.module'
import { MarketplacesModule } from './marketplaces/marketplaces.module'
import { AssistenteModule } from './assistente/assistente.module'
import { TcarModule } from './tcar/tcar.module'
import { WhatsappModule } from './whatsapp/whatsapp.module'
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
        // Chaves de integração (Tcar, Evolution) também nunca vão para o log.
        redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'req.headers["x-api-key"]', 'req.headers.apikey', 'req.headers["x-tcar-session"]', 'res.headers["set-cookie"]'],
        // Health e as páginas vistas do site (milhares por dia) não poluem o log.
        autoLogging: { ignore: (req) => req.url === '/api/health' || !!req.url?.startsWith('/api/public/rastreamento/') || !!req.url?.startsWith('/api/public/captura/config') || !!req.url?.startsWith('/api/public/e/') || req.url === '/api/webhooks/tcar/ping' },
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
    LandingModule,
    SeoModule,
    PostagensModule,
    EmailModule,
    AutomacoesModule,
    RelatoriosModule,
    CatalogoModule,
    GoogleAdsModule,
    WhatsappModule,
    SugestoesModule,
    MarketingModule,
    MarketplacesModule,
    AssistenteModule,
    TcarModule,
  ],
  controllers: [UsersController, RolesController, SystemController],
  providers: [
    UsersService,
    RolesService,
    SystemService,
    // Ordem importa: primeiro o limite de requisições (por usuário logado ou por IP), depois sessão + permissão.
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CsrfMiddleware).forRoutes('*')
  }
}
