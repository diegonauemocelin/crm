ALTER TABLE "service_records" ADD COLUMN "resultAt" TIMESTAMP(3);
ALTER TABLE "service_records" ADD COLUMN "reactivationStep" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "service_records" ADD COLUMN "reactivationAt" TIMESTAMP(3);
ALTER TABLE "service_records" ADD COLUMN "reactivationStatus" TEXT;

-- Quando a venda ou a perda foi marcada: a última alteração do campo no histórico; sem ela, o fechamento ou a última alteração.
UPDATE "service_records" r SET "resultAt" = COALESCE(
  (SELECT MAX(h."createdAt") FROM "service_record_history" h WHERE h."recordId" = r."id" AND (h."changes"::jsonb) ? 'saleStatus'),
  r."closedAt",
  r."updatedAt"
) WHERE r."saleStatus" <> 'NEGOCIACAO';

CREATE INDEX "service_records_tenantId_kind_saleStatus_resultAt_idx" ON "service_records"("tenantId", "kind", "saleStatus", "resultAt");
