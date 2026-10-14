-- AlterTable
ALTER TABLE "site_pageviews" ADD COLUMN     "path" TEXT;

-- AlterTable
ALTER TABLE "store_products" ADD COLUMN     "path" TEXT;

-- CreateIndex
CREATE INDEX "site_pageviews_tenantId_path_idx" ON "site_pageviews"("tenantId", "path");

-- CreateIndex
CREATE INDEX "store_products_tenantId_path_idx" ON "store_products"("tenantId", "path");


-- Caminho das páginas já vistas e dos produtos já copiados (mesma regra de pagePath em src/rastreamento/origem.ts).
UPDATE "site_pageviews" SET "path" = left(NULLIF(lower(rtrim(regexp_replace(regexp_replace("url", '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]*', ''), '[?#].*$', ''), '/')), ''), 500) WHERE "path" IS NULL;
UPDATE "store_products" SET "path" = left(NULLIF(lower(rtrim(regexp_replace(regexp_replace("url", '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]*', ''), '[?#].*$', ''), '/')), ''), 500) WHERE "path" IS NULL AND "url" IS NOT NULL;
