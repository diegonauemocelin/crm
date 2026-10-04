-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('LEAD', 'QUALIFICADO', 'OPORTUNIDADE', 'CLIENTE');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "ScoreDimension" AS ENUM ('PERFIL', 'INTERESSE');

-- AlterTable
ALTER TABLE "service_records" ADD COLUMN     "leadId" UUID;

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "jobTitle" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "state" CHAR(2),
    "city" TEXT,
    "stage" "LeadStage" NOT NULL DEFAULT 'LEAD',
    "ownerId" UUID,
    "unitId" UUID,
    "originId" UUID,
    "tags" TEXT[],
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "emailOptIn" BOOLEAN NOT NULL DEFAULT false,
    "emailOptOutAt" TIMESTAMP(3),
    "firstConversionAt" TIMESTAMP(3),
    "lastConversionAt" TIMESTAMP(3),
    "firstConversion" JSONB,
    "lastConversion" JSONB,
    "lastOpportunityAt" TIMESTAMP(3),
    "lastSaleAt" TIMESTAMP(3),
    "lastSaleValue" DECIMAL(12,2),
    "scoreProfile" INTEGER NOT NULL DEFAULT 0,
    "scoreInterest" INTEGER NOT NULL DEFAULT 0,
    "scoreGrade" CHAR(1),
    "scoreUpdatedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "importBatch" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_consents" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_defs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_rules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "dimension" "ScoreDimension" NOT NULL,
    "name" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" JSONB,
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_imports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENVIADO',
    "headers" TEXT[],
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "options" JSONB,
    "report" JSONB,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "lead_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_tenantId_phone_idx" ON "leads"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "leads_tenantId_stage_idx" ON "leads"("tenantId", "stage");

-- CreateIndex
CREATE INDEX "leads_tenantId_scoreGrade_idx" ON "leads"("tenantId", "scoreGrade");

-- CreateIndex
CREATE INDEX "leads_ownerId_idx" ON "leads"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenantId_email_key" ON "leads"("tenantId", "email");

-- CreateIndex
CREATE INDEX "lead_events_leadId_occurredAt_idx" ON "lead_events"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "lead_events_tenantId_type_occurredAt_idx" ON "lead_events"("tenantId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "lead_consents_leadId_purpose_createdAt_idx" ON "lead_consents"("leadId", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_defs_tenantId_key_key" ON "custom_field_defs"("tenantId", "key");

-- CreateIndex
CREATE INDEX "score_rules_tenantId_dimension_idx" ON "score_rules"("tenantId", "dimension");

-- CreateIndex
CREATE INDEX "lead_imports_tenantId_createdAt_idx" ON "lead_imports"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "service_records_leadId_idx" ON "service_records"("leadId");

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_originId_fkey" FOREIGN KEY ("originId") REFERENCES "lookup_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_consents" ADD CONSTRAINT "lead_consents_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_defs" ADD CONSTRAINT "custom_field_defs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_rules" ADD CONSTRAINT "score_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Responsável padrão dos leads importados do RD Station (equipe de Pré-Vendas).
INSERT INTO "sellers" ("id", "tenantId", "name", "email", "updatedAt")
SELECT gen_random_uuid(), t."id", 'Pré-Vendas', 'comercial@usaparts.com.br', CURRENT_TIMESTAMP
FROM "tenants" t
WHERE t."slug" = 'default'
  AND NOT EXISTS (SELECT 1 FROM "sellers" s WHERE s."tenantId" = t."id" AND lower(s."email") = 'comercial@usaparts.com.br')
ON CONFLICT DO NOTHING;