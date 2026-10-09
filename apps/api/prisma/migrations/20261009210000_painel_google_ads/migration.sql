-- AlterTable
ALTER TABLE "service_records" ADD COLUMN     "adsTerm" TEXT;

-- CreateTable
CREATE TABLE "google_ads_campaign_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "conversions" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_campaign_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_ads_keyword_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "conversions" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_keyword_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "google_ads_campaign_days_tenantId_date_idx" ON "google_ads_campaign_days"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_campaign_days_tenantId_date_campaignId_key" ON "google_ads_campaign_days"("tenantId", "date", "campaignId");

-- CreateIndex
CREATE INDEX "google_ads_keyword_days_tenantId_date_idx" ON "google_ads_keyword_days"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_keyword_days_tenantId_date_adGroupId_criterionId_key" ON "google_ads_keyword_days"("tenantId", "date", "adGroupId", "criterionId");


-- Preenche a palavra-chave dos atendimentos já existentes (a conferência automática refaz todos).
UPDATE "service_records" SET "adsCheckedAt" = NULL WHERE "adsVia" = 'ANUNCIO';
