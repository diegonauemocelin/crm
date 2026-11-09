-- Frete no Google Shopping: produtos do Merchant Center e o frete por estado enviado.
-- CreateTable
CREATE TABLE "merchant_shipping_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "offerId" TEXT NOT NULL,
    "contentLanguage" TEXT NOT NULL,
    "feedLabel" TEXT NOT NULL,
    "title" TEXT,
    "sku" TEXT,
    "quotes" JSONB,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_shipping_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_shipping_items_tenantId_sentAt_idx" ON "merchant_shipping_items"("tenantId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_shipping_items_tenantId_offerId_contentLanguage_fe_key" ON "merchant_shipping_items"("tenantId", "offerId", "contentLanguage", "feedLabel");

