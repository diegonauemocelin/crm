import { Global, Module } from '@nestjs/common'
import { MailService } from './mail.service'
import { SettingsController } from './settings.controller'
import { SettingsService } from './settings.service'

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, MailService],
  exports: [SettingsService, MailService],
})
export class SettingsModule {}
