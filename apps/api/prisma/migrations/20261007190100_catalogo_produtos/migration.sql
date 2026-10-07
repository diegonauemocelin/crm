-- CreateTable
CREATE TABLE "store_products" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "price" DECIMAL(12,2),
    "priceFrom" DECIMAL(12,2),
    "stock" INTEGER,
    "image" TEXT,
    "url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_products_tenantId_active_name_idx" ON "store_products"("tenantId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "store_products_tenantId_externalId_key" ON "store_products"("tenantId", "externalId");

-- AddForeignKey
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
