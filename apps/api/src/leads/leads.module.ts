import { Module } from '@nestjs/common'
import { LeadConfigService } from './lead-config.service'
import { LeadImportService } from './lead-import.service'
import { LeadSyncService } from './lead-sync.service'
import { LeadsController, UnsubscribeController } from './leads.controller'
import { LeadsService } from './leads.service'

@Module({
  controllers: [LeadsController, UnsubscribeController],
  providers: [LeadsService, LeadConfigService, LeadImportService, LeadSyncService],
  exports: [LeadSyncService, LeadsService],
})
export class LeadsModule {}
