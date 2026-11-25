-- Gasto de Product Ads por anúncio (últimos 30 e 60 dias) para o custo de publicidade em Preços e promoções.
CREATE TABLE "marketplace_ad_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "marketplace" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "cost30" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "units30" INTEGER NOT NULL DEFAULT 0,
    "revenue30" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost60" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "units60" INTEGER NOT NULL DEFAULT 0,
    "revenue60" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_ad_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketplace_ad_items_tenantId_marketplace_itemId_key" ON "marketplace_ad_items"("tenantId", "marketplace", "itemId");
