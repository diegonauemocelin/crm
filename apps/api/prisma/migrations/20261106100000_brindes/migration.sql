-- Controle de brindes do marketing: cadastro (estoque e valor), cota mensal por vendedor e retiradas.
-- CreateTable
CREATE TABLE "gifts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_quotas" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "giftId" UUID NOT NULL,
    "monthly" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_deliveries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "giftId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "customerCode" TEXT NOT NULL,
    "customerName" TEXT,
    "date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gifts_tenantId_name_key" ON "gifts"("tenantId", "name");

-- CreateIndex
CREATE INDEX "gift_quotas_tenantId_idx" ON "gift_quotas"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "gift_quotas_sellerId_giftId_key" ON "gift_quotas"("sellerId", "giftId");

-- CreateIndex
CREATE INDEX "gift_deliveries_tenantId_date_idx" ON "gift_deliveries"("tenantId", "date");

-- CreateIndex
CREATE INDEX "gift_deliveries_sellerId_date_idx" ON "gift_deliveries"("sellerId", "date");

-- AddForeignKey
ALTER TABLE "gift_quotas" ADD CONSTRAINT "gift_quotas_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_quotas" ADD CONSTRAINT "gift_quotas_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "gifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_deliveries" ADD CONSTRAINT "gift_deliveries_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_deliveries" ADD CONSTRAINT "gift_deliveries_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

