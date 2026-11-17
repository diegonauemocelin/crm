-- Análise de mercado: retrato do Mercado Livre e a leitura da IA.
CREATE TABLE "market_analyses" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GERANDO',
    "error" TEXT,
    "snapshot" JSONB,
    "reading" JSONB,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "market_analyses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "market_analyses_tenantId_createdAt_idx" ON "market_analyses"("tenantId", "createdAt");
