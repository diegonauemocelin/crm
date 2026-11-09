-- Power BI: chaves de acesso às tabelas de BI (só o resumo sha256 da chave fica guardado).
CREATE TABLE "bi_keys" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByName" TEXT,

    CONSTRAINT "bi_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bi_keys_keyHash_key" ON "bi_keys"("keyHash");
CREATE INDEX "bi_keys_tenantId_createdAt_idx" ON "bi_keys"("tenantId", "createdAt");
