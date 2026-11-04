-- Captura de CT-e na SEFAZ (Distribuição DF-e).
ALTER TABLE "freight_ctes" ADD COLUMN "companyRoles" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "freight_ctes" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "freight_sefaz_configs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "unitId" UUID,
    "env" TEXT NOT NULL DEFAULT 'PRODUCAO',
    "ufCode" INTEGER NOT NULL DEFAULT 42,
    "intervalHours" INTEGER NOT NULL DEFAULT 0,
    "lookbackDays" INTEGER NOT NULL DEFAULT 7,
    "certEnc" TEXT,
    "passEnc" TEXT,
    "certSubject" TEXT,
    "certCnpj" TEXT,
    "certValidTo" TIMESTAMP(3),
    "lastNsu" TEXT NOT NULL DEFAULT '0',
    "maxNsu" TEXT,
    "nextAllowedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastMessage" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freight_sefaz_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "freight_sefaz_configs_tenantId_cnpj_key" ON "freight_sefaz_configs"("tenantId", "cnpj");

CREATE TABLE "freight_sefaz_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "configId" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "byName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RODANDO',
    "cStat" TEXT,
    "message" TEXT,
    "documents" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "duplicated" INTEGER NOT NULL DEFAULT 0,
    "cancelled" INTEGER NOT NULL DEFAULT 0,
    "skippedOld" INTEGER NOT NULL DEFAULT 0,
    "ignored" INTEGER NOT NULL DEFAULT 0,
    "startNsu" TEXT,
    "endNsu" TEXT,

    CONSTRAINT "freight_sefaz_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "freight_sefaz_runs_tenantId_startedAt_idx" ON "freight_sefaz_runs"("tenantId", "startedAt");
