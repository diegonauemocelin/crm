-- Análise das perdas com IA (Claude)
CREATE TABLE "loss_ai_reports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "cycleKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GERANDO',
    "error" TEXT,
    "model" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "omitted" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "createdById" UUID,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "loss_ai_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loss_ai_reports_tenantId_createdAt_idx" ON "loss_ai_reports"("tenantId", "createdAt");
CREATE INDEX "loss_ai_reports_tenantId_cycleKey_idx" ON "loss_ai_reports"("tenantId", "cycleKey");
