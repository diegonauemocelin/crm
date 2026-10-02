-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('PRE_VENDAS', 'POS_VENDAS');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('SIM', 'NAO', 'PENDENTE');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('SIM', 'NAO', 'NEGOCIACAO');

-- CreateEnum
CREATE TYPE "LookupType" AS ENUM ('ORIGEM', 'TIPO_CLIENTE', 'MARCA', 'TIPO_PECA', 'MOTIVO_PERDA');

-- CreateTable
CREATE TABLE "sellers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "userId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "LookupType" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lookup_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_records" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "leadAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "customerCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "sellerId" UUID,
    "originId" UUID,
    "customerTypeId" UUID,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "state" CHAR(2),
    "city" TEXT,
    "brandIds" UUID[],
    "partTypeIds" UUID[],
    "forwarded" BOOLEAN NOT NULL DEFAULT false,
    "forwardedAt" TIMESTAMP(3),
    "returnStatus" "ReturnStatus",
    "returnedAt" TIMESTAMP(3),
    "saleStatus" "SaleStatus" NOT NULL DEFAULT 'NEGOCIACAO',
    "lostReasonId" UUID,
    "invoiceNumber" TEXT,
    "saleValue" DECIMAL(12,2),
    "notes" TEXT,
    "externalKey" TEXT,
    "importBatch" TEXT,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "service_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_record_history" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "userId" UUID,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_record_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sellers_userId_key" ON "sellers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_tenantId_name_key" ON "sellers"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_items_tenantId_type_name_key" ON "lookup_items"("tenantId", "type", "name");

-- CreateIndex
CREATE INDEX "service_records_tenantId_kind_leadAt_idx" ON "service_records"("tenantId", "kind", "leadAt");

-- CreateIndex
CREATE INDEX "service_records_sellerId_idx" ON "service_records"("sellerId");

-- CreateIndex
CREATE INDEX "service_records_phone_idx" ON "service_records"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "service_records_tenantId_externalKey_key" ON "service_records"("tenantId", "externalKey");

-- CreateIndex
CREATE INDEX "service_record_history_recordId_createdAt_idx" ON "service_record_history"("recordId", "createdAt");

-- AddForeignKey
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lookup_items" ADD CONSTRAINT "lookup_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_originId_fkey" FOREIGN KEY ("originId") REFERENCES "lookup_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_customerTypeId_fkey" FOREIGN KEY ("customerTypeId") REFERENCES "lookup_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_lostReasonId_fkey" FOREIGN KEY ("lostReasonId") REFERENCES "lookup_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_record_history" ADD CONSTRAINT "service_record_history_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "service_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
