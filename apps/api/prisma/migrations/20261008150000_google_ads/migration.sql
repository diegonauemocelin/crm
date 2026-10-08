-- CreateTable
CREATE TABLE "google_ads_conversions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "leadId" UUID,
    "kind" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(12,2),
    "clickIds" JSONB,
    "campaign" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "error" TEXT,
    "requestId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "google_ads_conversions_tenantId_status_idx" ON "google_ads_conversions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "google_ads_conversions_recordId_idx" ON "google_ads_conversions"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_conversions_tenantId_transactionId_key" ON "google_ads_conversions"("tenantId", "transactionId");

-- AddForeignKey
ALTER TABLE "google_ads_conversions" ADD CONSTRAINT "google_ads_conversions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

