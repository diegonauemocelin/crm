-- CreateTable
CREATE TABLE "seo_products" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productCode" TEXT NOT NULL,
    "derivationCode" TEXT NOT NULL,
    "derivations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attributes" JSONB NOT NULL,
    "ean" TEXT,
    "image" TEXT,
    "pageId" INTEGER,
    "fields" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "issues" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_changes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "seoProductId" UUID NOT NULL,
    "before" JSONB NOT NULL,
    "proposed" JSONB NOT NULL,
    "sendFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'SUGERIDA',
    "source" TEXT NOT NULL DEFAULT 'ia',
    "error" TEXT,
    "createdById" UUID,
    "createdByName" TEXT,
    "sentByName" TEXT,
    "sentAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seo_products_tenantId_score_idx" ON "seo_products"("tenantId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "seo_products_tenantId_productCode_key" ON "seo_products"("tenantId", "productCode");

-- CreateIndex
CREATE INDEX "seo_changes_tenantId_status_createdAt_idx" ON "seo_changes"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "seo_changes_seoProductId_idx" ON "seo_changes"("seoProductId");

-- AddForeignKey
ALTER TABLE "seo_changes" ADD CONSTRAINT "seo_changes_seoProductId_fkey" FOREIGN KEY ("seoProductId") REFERENCES "seo_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

