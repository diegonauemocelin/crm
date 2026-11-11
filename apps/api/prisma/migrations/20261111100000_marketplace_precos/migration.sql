-- Preços e promoções do Mercado Livre: custo por SKU, dados de preço dos anúncios, alterações enviadas/agendadas e
-- impostos das NF-e de venda do Mercado Envios.
-- CreateTable
CREATE TABLE "marketplace_costs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "percent" DECIMAL(6,2),
    "updatedById" UUID,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_price_items" (
    "tenantId" UUID NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT,
    "sellerSku" TEXT,
    "status" TEXT,
    "categoryId" TEXT,
    "listingTypeId" TEXT,
    "condition" TEXT,
    "shippingMode" TEXT,
    "logisticType" TEXT,
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "mandatoryFreeShipping" BOOLEAN NOT NULL DEFAULT false,
    "availableQuantity" INTEGER,
    "price" DECIMAL(14,2),
    "salePrice" DECIMAL(14,2),
    "promoType" TEXT,
    "promoId" TEXT,
    "saleFee" DECIMAL(14,2),
    "saleFeePct" DECIMAL(6,2),
    "saleFeeFixed" DECIMAL(14,2),
    "otherListingTypeId" TEXT,
    "otherFee" DECIMAL(14,2),
    "otherFeePct" DECIMAL(6,2),
    "shippingCost" DECIMAL(14,2),
    "shippingNote" TEXT,
    "hasVariations" BOOLEAN NOT NULL DEFAULT false,
    "sales30" INTEGER,
    "sales60" INTEGER,
    "lastSaleAt" TIMESTAMP(3),
    "readError" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_price_items_pkey" PRIMARY KEY ("tenantId","itemId")
);

-- CreateTable
CREATE TABLE "marketplace_price_changes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "batchId" UUID,
    "itemId" TEXT,
    "itemTitle" TEXT,
    "kind" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "mlRef" TEXT,
    "marginBefore" DECIMAL(14,2),
    "marginAfter" DECIMAL(14,2),
    "marginPctAfter" DECIMAL(8,2),
    "lowMarginAck" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "scheduledAt" TIMESTAMP(3),
    "error" TEXT,
    "undoOfId" UUID,
    "createdById" UUID,
    "createdByName" TEXT,
    "sentAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_price_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_nfe_taxes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" CHAR(44) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "carrierName" TEXT,
    "carrierCnpj" CHAR(14),
    "productsValue" DECIMAL(14,2) NOT NULL,
    "taxValue" DECIMAL(14,2) NOT NULL,
    "items" JSONB NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_nfe_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_costs_tenantId_sku_key" ON "marketplace_costs"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "marketplace_price_items_tenantId_status_idx" ON "marketplace_price_items"("tenantId", "status");

-- CreateIndex
CREATE INDEX "marketplace_price_changes_tenantId_status_scheduledAt_idx" ON "marketplace_price_changes"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "marketplace_price_changes_tenantId_createdAt_idx" ON "marketplace_price_changes"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "marketplace_price_changes_tenantId_itemId_idx" ON "marketplace_price_changes"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "marketplace_nfe_taxes_tenantId_issuedAt_idx" ON "marketplace_nfe_taxes"("tenantId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_nfe_taxes_tenantId_key_key" ON "marketplace_nfe_taxes"("tenantId", "key");

