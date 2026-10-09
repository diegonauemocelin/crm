import { Module } from '@nestjs/common'
import { LeadCaptureService } from './lead-capture.service'
import { LeadConfigService } from './lead-config.service'
import { LeadImportService } from './lead-import.service'
import { LeadSyncService } from './lead-sync.service'
import { LeadsController, UnsubscribeController } from './leads.controller'
import { LeadsService } from './leads.service'
import { OrigemAdsService } from './origem-ads.service'

@Module({
  controllers: [LeadsController, UnsubscribeController],
  providers: [LeadsService, LeadConfigService, LeadImportService, LeadSyncService, LeadCaptureService, OrigemAdsService],
  exports: [LeadSyncService, LeadsService, LeadConfigService, LeadCaptureService, OrigemAdsService],
})
export class LeadsModule {}
