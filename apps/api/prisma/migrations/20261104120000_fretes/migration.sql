-- Módulo de fretes: transportadoras, tabelas versionadas, regras, importações e cotações; dados fiscais das unidades e acesso a mais de uma unidade.
-- AlterTable
ALTER TABLE "units" ADD COLUMN     "address" TEXT,
ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "zip" CHAR(8);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "extraUnitIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- CreateTable
CREATE TABLE "freight_carriers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "legalName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quoteName" TEXT,
    "zip" CHAR(8),
    "address" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "phone" TEXT,
    "email" TEXT,
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "modes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unitIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "useReceiverAsRecipient" BOOLEAN NOT NULL DEFAULT false,
    "externalCodes" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freight_carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_tables" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quoteName" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'COMPRA_VENDA',
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "modal" TEXT NOT NULL DEFAULT 'RODOVIARIO',
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "unitIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "goodsTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personType" TEXT NOT NULL DEFAULT 'AMBOS',
    "usage" TEXT NOT NULL DEFAULT 'COTACAO_CONCILIACAO',
    "weightMin" DECIMAL(12,3),
    "weightMax" DECIMAL(12,3),
    "valueMin" DECIMAL(14,2),
    "valueMax" DECIMAL(14,2),
    "loadType" TEXT NOT NULL DEFAULT 'FRACIONADA',
    "dispatchDays" INTEGER,
    "serviceCode" TEXT,
    "partner" TEXT,
    "notes" TEXT,
    "publishedVersionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freight_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_table_versions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "components" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "rulesCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdByName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "publishedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freight_table_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_rules" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "line" INTEGER NOT NULL DEFAULT 0,
    "cepStart" INTEGER,
    "cepEnd" INTEGER,
    "uf" CHAR(2),
    "city" TEXT,
    "cityKey" TEXT,
    "weightMin" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "weightMax" DECIMAL(12,3),
    "deadlineDays" INTEGER,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "values" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,

    CONSTRAINT "freight_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_imports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "versionId" UUID,
    "fileId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ANALISE',
    "sheet" INTEGER NOT NULL DEFAULT 0,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "mapping" JSONB,
    "readLines" INTEGER NOT NULL DEFAULT 0,
    "importedLines" INTEGER NOT NULL DEFAULT 0,
    "rejectedLines" INTEGER NOT NULL DEFAULT 0,
    "rulesCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "createdById" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "freight_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_quotes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" SERIAL NOT NULL,
    "unitId" UUID NOT NULL,
    "reference" TEXT,
    "customerName" TEXT,
    "customerDoc" TEXT,
    "personType" TEXT NOT NULL DEFAULT 'PJ',
    "originZip" CHAR(8) NOT NULL,
    "destZip" CHAR(8) NOT NULL,
    "destCity" TEXT,
    "destUf" CHAR(2),
    "cargoValue" DECIMAL(14,2) NOT NULL,
    "realWeight" DECIMAL(12,3) NOT NULL,
    "cubicMeters" DECIMAL(12,6) NOT NULL,
    "volumes" JSONB NOT NULL DEFAULT '[]',
    "quoteDate" DATE NOT NULL,
    "input" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "bestTotal" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'CALCULADA',
    "selectedTableId" UUID,
    "selectedVersionId" UUID,
    "selectedCarrierId" UUID,
    "selectedTotal" DECIMAL(14,2),
    "selectedAt" TIMESTAMP(3),
    "selectedByName" TEXT,
    "selectionNote" TEXT,
    "expiredAllowedReason" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_ceps" (
    "cep" CHAR(8) NOT NULL,
    "city" TEXT,
    "uf" CHAR(2),
    "district" TEXT,
    "street" TEXT,
    "found" BOOLEAN NOT NULL DEFAULT true,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_ceps_pkey" PRIMARY KEY ("cep")
);

-- CreateIndex
CREATE INDEX "freight_carriers_tenantId_active_idx" ON "freight_carriers"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "freight_carriers_tenantId_cnpj_key" ON "freight_carriers"("tenantId", "cnpj");

-- CreateIndex
CREATE INDEX "freight_tables_tenantId_status_idx" ON "freight_tables"("tenantId", "status");

-- CreateIndex
CREATE INDEX "freight_tables_carrierId_idx" ON "freight_tables"("carrierId");

-- CreateIndex
CREATE UNIQUE INDEX "freight_table_versions_tableId_number_key" ON "freight_table_versions"("tableId", "number");

-- CreateIndex
CREATE INDEX "freight_rules_versionId_cepStart_cepEnd_idx" ON "freight_rules"("versionId", "cepStart", "cepEnd");

-- CreateIndex
CREATE INDEX "freight_rules_versionId_uf_cityKey_idx" ON "freight_rules"("versionId", "uf", "cityKey");

-- CreateIndex
CREATE INDEX "freight_imports_tableId_createdAt_idx" ON "freight_imports"("tableId", "createdAt");

-- CreateIndex
CREATE INDEX "freight_quotes_tenantId_unitId_createdAt_idx" ON "freight_quotes"("tenantId", "unitId", "createdAt");

-- CreateIndex
CREATE INDEX "freight_quotes_tenantId_createdAt_idx" ON "freight_quotes"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "freight_quotes_tenantId_code_key" ON "freight_quotes"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "freight_tables" ADD CONSTRAINT "freight_tables_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "freight_carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freight_table_versions" ADD CONSTRAINT "freight_table_versions_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "freight_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freight_rules" ADD CONSTRAINT "freight_rules_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "freight_table_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freight_imports" ADD CONSTRAINT "freight_imports_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "freight_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

