-- Concorrentes do Mercado Livre: lojas informadas pelo link e os anúncios delas com os códigos de referência.
CREATE TABLE "ml_competitors" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "input" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "nickname" TEXT,
    "officialStoreId" TEXT,
    "permalink" TEXT,
    "activeItems" INTEGER,
    "itemsRead" INTEGER NOT NULL DEFAULT 0,
    "itemsWithCode" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ml_competitors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ml_competitors_tenantId_sellerId_key" ON "ml_competitors"("tenantId", "sellerId");

CREATE TABLE "ml_competitor_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "competitorId" UUID NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT,
    "permalink" TEXT,
    "price" DECIMAL(14,2),
    "previousPrice" DECIMAL(14,2),
    "priceChangedAt" TIMESTAMP(3),
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "syncedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ml_competitor_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ml_competitor_items_competitorId_itemId_key" ON "ml_competitor_items"("competitorId", "itemId");
CREATE INDEX "ml_competitor_items_tenantId_idx" ON "ml_competitor_items"("tenantId");
ALTER TABLE "ml_competitor_items" ADD CONSTRAINT "ml_competitor_items_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "ml_competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
