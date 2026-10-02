import 'reflect-metadata'
import './common/types'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import { json } from 'express'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { env } from './config/env'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false })
  app.useLogger(app.get(Logger))

  // A API fica atrás de dois proxies (Nginx do servidor + Nginx do container). Confia só em redes privadas,
  // então o IP do cliente vem do X-Forwarded-For sem permitir que o próprio cliente o falsifique.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal')
  app.disable('x-powered-by')
  // A importação de planilha recebe o CSV no corpo: limite maior só nessa rota (o Nginx também limita a 2 MB).
  app.use('/api/atendimentos/importar', json({ limit: '2mb' }))
  app.useBodyParser('json', { limit: '1mb' })
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false })

  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }))
  app.use(cookieParser())
  app.setGlobalPrefix('api')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
    }),
  )
  app.enableShutdownHooks()

  if (!env.isProd || process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('CRM - API')
      .setDescription('API REST do CRM. Autenticação por cookie de sessão + header X-CSRF-Token em métodos de escrita.')
      .setVersion(process.env.npm_package_version ?? 'dev')
      .addCookieAuth('crm_at')
      .build()
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config))
  }

  await app.listen(env.port, '0.0.0.0')
}

void bootstrap()
