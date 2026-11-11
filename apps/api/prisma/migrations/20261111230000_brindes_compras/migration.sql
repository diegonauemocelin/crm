-- Compras de brindes (custos e despesas)
CREATE TABLE "gift_purchases" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "giftId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "document" TEXT,
    "supplier" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "addedToStock" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_purchases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gift_purchases_tenantId_date_idx" ON "gift_purchases"("tenantId", "date");

ALTER TABLE "gift_purchases" ADD CONSTRAINT "gift_purchases_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
