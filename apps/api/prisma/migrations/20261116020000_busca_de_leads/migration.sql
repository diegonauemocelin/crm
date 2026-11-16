-- Busca de leads (prospecção de empresas)
CREATE TABLE "prospect_searches" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "criteria" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GERANDO',
    "error" TEXT,
    "centerLat" DOUBLE PRECISION,
    "centerLon" DOUBLE PRECISION,
    "centerLabel" TEXT,
    "found" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "webSearches" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "prospect_searches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prospects" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "searchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "segment" TEXT,
    "city" TEXT,
    "uf" TEXT,
    "address" TEXT,
    "site" TEXT,
    "instagram" TEXT,
    "phones" JSONB NOT NULL DEFAULT '[]',
    "emails" JSONB NOT NULL DEFAULT '[]',
    "score" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "distanceKm" DOUBLE PRECISION,
    "cnpjStatus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOVO',
    "leadId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prospect_blocks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prospect_searches_tenantId_createdAt_idx" ON "prospect_searches"("tenantId", "createdAt");
CREATE INDEX "prospects_searchId_idx" ON "prospects"("searchId");
CREATE INDEX "prospects_tenantId_status_idx" ON "prospects"("tenantId", "status");
CREATE UNIQUE INDEX "prospect_blocks_tenantId_key_key" ON "prospect_blocks"("tenantId", "key");

ALTER TABLE "prospects" ADD CONSTRAINT "prospects_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "prospect_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
