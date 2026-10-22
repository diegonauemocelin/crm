-- CreateTable
CREATE TABLE "marketplace_campaigns" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "marketplace" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "strategy" TEXT,
    "budget" DECIMAL(14,2),
    "roasTarget" DECIMAL(10,2),
    "acosTarget" DECIMAL(10,2),
    "startDate" DATE,
    "endDate" DATE,
    "extra" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_ads" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "marketplace" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "campaignId" TEXT,
    "externalId" TEXT,
    "type" TEXT,
    "title" TEXT,
    "thumbnail" TEXT,
    "status" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_ad_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "marketplace" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "directRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "indirectRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "directUnits" INTEGER NOT NULL DEFAULT 0,
    "indirectUnits" INTEGER NOT NULL DEFAULT 0,
    "items" INTEGER NOT NULL DEFAULT 0,
    "organicUnits" INTEGER NOT NULL DEFAULT 0,
    "organicRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "addToCart" INTEGER NOT NULL DEFAULT 0,
    "checkouts" INTEGER NOT NULL DEFAULT 0,
    "eventRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'api',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_ad_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_campaigns_tenantId_marketplace_product_campaign_key" ON "marketplace_campaigns"("tenantId", "marketplace", "product", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_ads_tenantId_marketplace_adId_key" ON "marketplace_ads"("tenantId", "marketplace", "adId");

-- CreateIndex
CREATE INDEX "marketplace_ad_days_tenantId_marketplace_product_level_date_idx" ON "marketplace_ad_days"("tenantId", "marketplace", "product", "level", "date");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_ad_days_tenantId_marketplace_product_level_enti_key" ON "marketplace_ad_days"("tenantId", "marketplace", "product", "level", "entityId", "date");

