-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('ATIVO', 'CONCLUIDO', 'SAIU', 'ERRO');

-- DropIndex
DROP INDEX "email_recipients_campaignId_leadId_key";

-- AlterTable
ALTER TABLE "email_campaigns" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CAMPANHA';

-- AlterTable
ALTER TABLE "email_recipients" ADD COLUMN     "runId" UUID;

-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "trigger" JSONB NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "reentry" TEXT NOT NULL DEFAULT 'nunca',
    "exitOnPurchase" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "automationId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'ATIVO',
    "stepId" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "context" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "exitReason" TEXT,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_logs" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "automationId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "stepId" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automations_tenantId_active_idx" ON "automations"("tenantId", "active");

-- CreateIndex
CREATE INDEX "automation_runs_status_nextRunAt_idx" ON "automation_runs"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "automation_runs_automationId_leadId_idx" ON "automation_runs"("automationId", "leadId");

-- CreateIndex
CREATE INDEX "automation_runs_automationId_status_idx" ON "automation_runs"("automationId", "status");

-- CreateIndex
CREATE INDEX "automation_runs_leadId_idx" ON "automation_runs"("leadId");

-- CreateIndex
CREATE INDEX "automation_logs_runId_createdAt_idx" ON "automation_logs"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "automation_logs_automationId_createdAt_idx" ON "automation_logs"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "email_campaigns_tenantId_kind_idx" ON "email_campaigns"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "email_recipients_runId_idx" ON "email_recipients"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "email_recipients_campaignId_leadId_runId_key" ON "email_recipients"("campaignId", "leadId", "runId");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

