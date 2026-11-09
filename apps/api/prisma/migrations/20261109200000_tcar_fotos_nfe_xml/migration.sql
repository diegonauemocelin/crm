-- Tcar: peso e fotos dos produtos e resultado das consultas (orçamento/pré-nota). Fretes: NF-e de saída importadas por
-- XML (pedidos de frete e confronto com o CT-e), histórico das importações, volumes do CT-e e dados da Tcar na cotação.
ALTER TABLE "tcar_products" ADD COLUMN "grossWeight" DECIMAL(12,3);
ALTER TABLE "tcar_products" ADD COLUMN "netWeight" DECIMAL(12,3);
ALTER TABLE "tcar_products" ADD COLUMN "photos" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "tcar_products" ADD COLUMN "photosAt" TIMESTAMP(3);

ALTER TABLE "tcar_actions" ADD COLUMN "result" JSONB;
ALTER TABLE "tcar_actions" ADD COLUMN "refId" UUID;
CREATE INDEX "tcar_actions_tenantId_kind_status_idx" ON "tcar_actions"("tenantId", "kind", "status");

ALTER TABLE "freight_quotes" ADD COLUMN "erpData" JSONB;

ALTER TABLE "freight_ctes" ADD COLUMN "volumes" INTEGER;

CREATE TABLE "freight_nfes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" CHAR(44) NOT NULL,
    "number" INTEGER NOT NULL,
    "series" TEXT,
    "issuedAt" TIMESTAMP(3),
    "emitCnpj" CHAR(14),
    "unitId" UUID,
    "value" DECIMAL(14,2),
    "freightValue" DECIMAL(14,2),
    "freightMode" TEXT,
    "carrierCnpj" CHAR(14),
    "carrierId" UUID,
    "volumes" INTEGER,
    "grossWeight" DECIMAL(12,3),
    "netWeight" DECIMAL(12,3),
    "destCnpj" CHAR(14),
    "destZip" CHAR(8),
    "destCity" TEXT,
    "destUf" CHAR(2),
    "destIbge" CHAR(7),
    "shipmentId" UUID,
    "status" TEXT NOT NULL DEFAULT 'PEDIDO',
    "importId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freight_nfes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "freight_nfes_tenantId_key_key" ON "freight_nfes"("tenantId", "key");
CREATE INDEX "freight_nfes_tenantId_status_idx" ON "freight_nfes"("tenantId", "status");

CREATE TABLE "freight_nfe_imports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fileNames" TEXT NOT NULL,
    "counts" JSONB NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "createdById" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_nfe_imports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "freight_nfe_imports_tenantId_createdAt_idx" ON "freight_nfe_imports"("tenantId", "createdAt");
