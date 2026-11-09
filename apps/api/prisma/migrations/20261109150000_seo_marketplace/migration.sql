-- SEO Marketplace: alterações de descrição e título dos anúncios do Mercado Livre.
-- CreateTable
CREATE TABLE "ml_seo_changes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemTitle" TEXT,
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

    CONSTRAINT "ml_seo_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ml_seo_changes_tenantId_status_createdAt_idx" ON "ml_seo_changes"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ml_seo_changes_tenantId_itemId_idx" ON "ml_seo_changes"("tenantId", "itemId");
