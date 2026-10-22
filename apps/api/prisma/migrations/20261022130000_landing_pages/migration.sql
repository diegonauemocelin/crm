-- CreateTable
CREATE TABLE "landing_pages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "theme" JSONB NOT NULL,
    "blocks" JSONB NOT NULL,
    "blocksB" JSONB,
    "abSplit" INTEGER NOT NULL DEFAULT 50,
    "abActive" BOOLEAN NOT NULL DEFAULT false,
    "seo" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'A',
    "type" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "device" TEXT,
    "leadId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "landing_pages_tenantId_slug_key" ON "landing_pages"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "landing_events_pageId_occurredAt_idx" ON "landing_events"("pageId", "occurredAt");

-- CreateIndex
CREATE INDEX "landing_events_tenantId_occurredAt_idx" ON "landing_events"("tenantId", "occurredAt");

-- AddForeignKey
ALTER TABLE "landing_events" ADD CONSTRAINT "landing_events_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "landing_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
