-- Análises (BI nativo): leads por período.
CREATE INDEX "leads_tenantId_createdAt_idx" ON "leads"("tenantId", "createdAt");
