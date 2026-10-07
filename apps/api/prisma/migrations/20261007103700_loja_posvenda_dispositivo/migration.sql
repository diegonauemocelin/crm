-- CreateEnum
CREATE TYPE "FollowStatus" AS ENUM ('PENDENTE', 'CONTATADO', 'ANALISANDO', 'RESOLVIDO', 'VOLTOU_AO_VENDEDOR');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "ecommerceId" TEXT;

-- AlterTable
ALTER TABLE "service_records" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "firstActionAt" TIMESTAMP(3),
ADD COLUMN     "followNote" TEXT,
ADD COLUMN     "followStatus" "FollowStatus",
ADD COLUMN     "parentId" UUID;

-- AlterTable
ALTER TABLE "site_pageviews" ADD COLUMN     "device" TEXT;

-- AlterTable
ALTER TABLE "site_visitors" ADD COLUMN     "device" TEXT,
ADD COLUMN     "firstDevice" TEXT;

-- CreateTable
CREATE TABLE "site_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(12,2),
    "items" JSONB,
    "url" TEXT,
    "device" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecommerce_carts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "hash" TEXT,
    "status" INTEGER NOT NULL,
    "leadId" UUID,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "startedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
    "checkoutUrl" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "value" DECIMAL(12,2),
    "orderCode" TEXT,
    "contactStatus" TEXT NOT NULL DEFAULT 'PENDENTE',
    "contactNote" TEXT,
    "contactedAt" TIMESTAMP(3),
    "contactedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecommerce_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecommerce_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "leadId" UUID,
    "customerId" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "statusName" TEXT NOT NULL,
    "statusGroup" TEXT NOT NULL,
    "payment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecommerce_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_events_visitorId_occurredAt_idx" ON "site_events"("visitorId", "occurredAt");

-- CreateIndex
CREATE INDEX "site_events_tenantId_name_occurredAt_idx" ON "site_events"("tenantId", "name", "occurredAt");

-- CreateIndex
CREATE INDEX "ecommerce_carts_tenantId_status_lastActivityAt_idx" ON "ecommerce_carts"("tenantId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ecommerce_carts_leadId_idx" ON "ecommerce_carts"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ecommerce_carts_tenantId_externalId_key" ON "ecommerce_carts"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "ecommerce_orders_leadId_orderedAt_idx" ON "ecommerce_orders"("leadId", "orderedAt");

-- CreateIndex
CREATE INDEX "ecommerce_orders_tenantId_orderedAt_idx" ON "ecommerce_orders"("tenantId", "orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ecommerce_orders_tenantId_externalId_key" ON "ecommerce_orders"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "leads_tenantId_ecommerceId_idx" ON "leads"("tenantId", "ecommerceId");

-- CreateIndex
CREATE INDEX "service_records_parentId_idx" ON "service_records"("parentId");

-- CreateIndex
CREATE INDEX "service_records_tenantId_kind_followStatus_dueAt_idx" ON "service_records"("tenantId", "kind", "followStatus", "dueAt");

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "service_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_events" ADD CONSTRAINT "site_events_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "site_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecommerce_carts" ADD CONSTRAINT "ecommerce_carts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecommerce_carts" ADD CONSTRAINT "ecommerce_carts_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
