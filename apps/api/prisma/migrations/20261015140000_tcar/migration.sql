-- CreateTable
CREATE TABLE "tcar_products" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ean" TEXT,
    "factoryCode" TEXT,
    "integrationCode" TEXT,
    "refs" TEXT[],
    "brand" TEXT,
    "groupName" TEXT,
    "subgroupName" TEXT,
    "application" TEXT,
    "usedIn" TEXT,
    "unit" TEXT,
    "stock" DECIMAL(14,3),
    "price" DECIMAL(12,2),
    "resalePrice" DECIMAL(12,2),
    "branches" JSONB NOT NULL DEFAULT '[]',
    "searchText" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "stockAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tcar_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tcar_actions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "cmd" TEXT NOT NULL,
    "query" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3),
    "offset" INTEGER NOT NULL DEFAULT 0,
    "resultCode" INTEGER,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tcar_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tcar_products_tenantId_factoryCode_idx" ON "tcar_products"("tenantId", "factoryCode");

-- CreateIndex
CREATE INDEX "tcar_products_tenantId_integrationCode_idx" ON "tcar_products"("tenantId", "integrationCode");

-- CreateIndex
CREATE UNIQUE INDEX "tcar_products_tenantId_code_key" ON "tcar_products"("tenantId", "code");

-- CreateIndex
CREATE INDEX "tcar_actions_tenantId_status_createdAt_idx" ON "tcar_actions"("tenantId", "status", "createdAt");

