-- CreateTable
CREATE TABLE "site_visitors" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" TEXT NOT NULL,
    "leadId" UUID,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstTouch" JSONB,
    "lastTouch" JSONB,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "identifiedAt" TIMESTAMP(3),

    CONSTRAINT "site_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_pageviews" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "sessionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "newSession" BOOLEAN NOT NULL DEFAULT false,
    "touch" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_pageviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_receipts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "leadId" UUID,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_visitors_leadId_idx" ON "site_visitors"("leadId");

-- CreateIndex
CREATE INDEX "site_visitors_tenantId_lastSeenAt_idx" ON "site_visitors"("tenantId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "site_visitors_tenantId_clientId_key" ON "site_visitors"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "site_pageviews_visitorId_occurredAt_idx" ON "site_pageviews"("visitorId", "occurredAt");

-- CreateIndex
CREATE INDEX "site_pageviews_tenantId_occurredAt_idx" ON "site_pageviews"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "integration_receipts_tenantId_provider_receivedAt_idx" ON "integration_receipts"("tenantId", "provider", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_receipts_tenantId_provider_externalId_key" ON "integration_receipts"("tenantId", "provider", "externalId");

-- AddForeignKey
ALTER TABLE "site_visitors" ADD CONSTRAINT "site_visitors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visitors" ADD CONSTRAINT "site_visitors_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_pageviews" ADD CONSTRAINT "site_pageviews_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "site_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_receipts" ADD CONSTRAINT "integration_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regra de interesse "Visitou o site" para quem já tem as regras padrão (tenants novos recebem pelo código).
INSERT INTO "score_rules" ("id", "tenantId", "dimension", "name", "field", "operator", "value", "points", "active")
SELECT gen_random_uuid(), t."tenantId", 'INTERESSE', 'Visitou o site', 'visita', 'each', NULL, 2, true
FROM (SELECT DISTINCT "tenantId" FROM "score_rules") t
WHERE NOT EXISTS (SELECT 1 FROM "score_rules" r WHERE r."tenantId" = t."tenantId" AND r."field" = 'visita');