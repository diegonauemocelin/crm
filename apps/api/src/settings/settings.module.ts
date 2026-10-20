import { Global, Module } from '@nestjs/common'
import { MailService } from './mail.service'
import { RenomearService } from './renomear.service'
import { SettingsController } from './settings.controller'
import { SettingsService } from './settings.service'

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, MailService, RenomearService],
  exports: [SettingsService, MailService],
})
export class SettingsModule {}
