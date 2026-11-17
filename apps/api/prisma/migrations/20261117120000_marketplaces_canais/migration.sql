-- Shopee, Amazon e TikTok Shop: anúncios lidos e mudanças de preço enviadas.
-- CreateTable
CREATE TABLE "channel_listings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL DEFAULT '',
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "price" DECIMAL(12,2),
    "stock" INTEGER,
    "status" TEXT NOT NULL,
    "url" TEXT,
    "image" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_price_changes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL DEFAULT '',
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "oldPrice" DECIMAL(12,2),
    "newPrice" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_price_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_listings_tenantId_channel_sku_idx" ON "channel_listings"("tenantId", "channel", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "channel_listings_tenantId_channel_listingId_variationId_key" ON "channel_listings"("tenantId", "channel", "listingId", "variationId");

-- CreateIndex
CREATE INDEX "channel_price_changes_tenantId_channel_createdAt_idx" ON "channel_price_changes"("tenantId", "channel", "createdAt");

