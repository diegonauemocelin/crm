-- Poupança de frete dos vendedores: usos e ajustes do saldo (o saldo das notas é calculado das NF-es e CT-es).
CREATE TABLE "freight_wallet_moves" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "campaignId" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_wallet_moves_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "freight_wallet_moves_tenantId_campaignId_seller_idx" ON "freight_wallet_moves"("tenantId", "campaignId", "seller");
