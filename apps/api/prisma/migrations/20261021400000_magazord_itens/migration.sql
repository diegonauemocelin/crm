-- AlterTable
ALTER TABLE "ecommerce_orders" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "itemsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ecommerce_order_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "quantity" INTEGER NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ecommerce_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ecommerce_order_items_orderId_idx" ON "ecommerce_order_items"("orderId");

-- CreateIndex
CREATE INDEX "ecommerce_order_items_tenantId_idx" ON "ecommerce_order_items"("tenantId");

-- AddForeignKey
ALTER TABLE "ecommerce_order_items" ADD CONSTRAINT "ecommerce_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ecommerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
