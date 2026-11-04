import { Global, Module } from '@nestjs/common'
import { TvAccessController, TvController } from './tv.controller'
import { TvService } from './tv.service'

/** Links de painel para a TV (painel de coletas e Dashboard executivo). */
@Global()
@Module({ controllers: [TvController, TvAccessController], providers: [TvService], exports: [TvService] })
export class TvModule {}
