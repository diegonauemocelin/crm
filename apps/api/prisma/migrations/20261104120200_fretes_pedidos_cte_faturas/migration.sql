-- Fretes: pedidos expedidos, CT-es com conciliação e faturas das transportadoras.
-- CreateTable
CREATE TABLE "freight_shipments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" SERIAL NOT NULL,
    "unitId" UUID NOT NULL,
    "orderNumber" TEXT,
    "invoiceNumber" TEXT,
    "invoiceKey" CHAR(44),
    "customerName" TEXT,
    "customerDoc" TEXT,
    "personType" TEXT NOT NULL DEFAULT 'PJ',
    "destZip" CHAR(8),
    "destCity" TEXT,
    "destUf" CHAR(2),
    "cargoValue" DECIMAL(14,2),
    "weight" DECIMAL(12,3),
    "volumesCount" INTEGER,
    "carrierId" UUID,
    "quoteId" UUID,
    "expected" JSONB,
    "expectedTotal" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO_COTACAO',
    "collectedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "expectedDeliveryAt" DATE,
    "deliveredAt" TIMESTAMP(3),
    "trackingCode" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freight_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_shipment_events" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_ctes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" CHAR(44) NOT NULL,
    "number" TEXT,
    "series" TEXT,
    "issuedAt" TIMESTAMP(3),
    "emitCnpj" TEXT,
    "emitName" TEXT,
    "carrierId" UUID,
    "unitId" UUID,
    "tomadorDoc" TEXT,
    "senderDoc" TEXT,
    "recipientDoc" TEXT,
    "recipientName" TEXT,
    "ufIni" CHAR(2),
    "ufFim" CHAR(2),
    "cityIni" TEXT,
    "cityFim" TEXT,
    "destZip" CHAR(8),
    "cfop" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "cargoValue" DECIMAL(14,2),
    "weight" DECIMAL(12,3),
    "components" JSONB NOT NULL DEFAULT '[]',
    "icms" JSONB,
    "nfeKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fiscalStatus" TEXT NOT NULL DEFAULT 'NAO_VERIFICADO',
    "protocol" TEXT,
    "protocolStatus" TEXT,
    "shipmentId" UUID,
    "fileId" UUID,
    "importedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recStatus" TEXT NOT NULL DEFAULT 'PENDENTE',
    "recTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recSource" TEXT,
    "expectedTotal" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "recDetail" JSONB,
    "recAt" TIMESTAMP(3),
    "decision" TEXT,
    "approvedValue" DECIMAL(14,2),
    "decisionNote" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "contestStatus" TEXT,
    "creditValue" DECIMAL(14,2),
    "contestNote" TEXT,
    "invoiceId" UUID,

    CONSTRAINT "freight_ctes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_invoices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "unitId" UUID,
    "number" TEXT NOT NULL,
    "issuedAt" DATE,
    "dueAt" DATE NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "paidAt" DATE,
    "paidValue" DECIMAL(14,2),
    "paymentNote" TEXT,
    "notes" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freight_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "freight_shipments_tenantId_unitId_createdAt_idx" ON "freight_shipments"("tenantId", "unitId", "createdAt");

-- CreateIndex
CREATE INDEX "freight_shipments_tenantId_invoiceKey_idx" ON "freight_shipments"("tenantId", "invoiceKey");

-- CreateIndex
CREATE INDEX "freight_shipments_tenantId_invoiceNumber_idx" ON "freight_shipments"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "freight_shipments_tenantId_code_key" ON "freight_shipments"("tenantId", "code");

-- CreateIndex
CREATE INDEX "freight_shipment_events_shipmentId_createdAt_idx" ON "freight_shipment_events"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "freight_ctes_tenantId_issuedAt_idx" ON "freight_ctes"("tenantId", "issuedAt");

-- CreateIndex
CREATE INDEX "freight_ctes_tenantId_recStatus_idx" ON "freight_ctes"("tenantId", "recStatus");

-- CreateIndex
CREATE INDEX "freight_ctes_tenantId_carrierId_idx" ON "freight_ctes"("tenantId", "carrierId");

-- CreateIndex
CREATE UNIQUE INDEX "freight_ctes_tenantId_key_key" ON "freight_ctes"("tenantId", "key");

-- CreateIndex
CREATE INDEX "freight_invoices_tenantId_dueAt_idx" ON "freight_invoices"("tenantId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "freight_invoices_tenantId_carrierId_number_key" ON "freight_invoices"("tenantId", "carrierId", "number");

-- AddForeignKey
ALTER TABLE "freight_shipment_events" ADD CONSTRAINT "freight_shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "freight_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

