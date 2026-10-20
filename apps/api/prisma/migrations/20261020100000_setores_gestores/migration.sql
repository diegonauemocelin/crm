-- Chat: setores de atendimento da empresa (antes dentro de cada número) e gestores de cada pessoa.
ALTER TABLE "users" ADD COLUMN "managerIds" UUID[] DEFAULT ARRAY[]::UUID[];

CREATE TABLE "whatsapp_sectors" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "numberIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "userIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "managerIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "visibility" TEXT NOT NULL DEFAULT 'PROPRIAS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_sectors_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "whatsapp_sectors_tenantId_idx" ON "whatsapp_sectors"("tenantId");

-- Setores que existiam dentro dos números viram setores da empresa, com o mesmo id (as conversas na fila continuam
-- no setor certo). O mesmo nome em dois números vira dois setores ("Vendas (Matriz)").
INSERT INTO "whatsapp_sectors" ("id", "tenantId", "name", "numberIds", "userIds", "updatedAt")
SELECT (s->>'id')::uuid, n."tenantId",
       CASE WHEN COUNT(*) OVER (PARTITION BY n."tenantId", lower(s->>'name')) > 1 THEN (s->>'name') || ' (' || n."name" || ')' ELSE s->>'name' END,
       ARRAY[n."id"],
       COALESCE(ARRAY(SELECT jsonb_array_elements_text(s->'userIds')::uuid), ARRAY[]::uuid[]),
       CURRENT_TIMESTAMP
FROM "whatsapp_numbers" n, jsonb_array_elements(n."sectors") s
WHERE n."deletedAt" IS NULL AND jsonb_typeof(n."sectors") = 'array' AND (s->>'id') ~ '^[0-9a-fA-F-]{36}$' AND coalesce(s->>'name', '') <> ''
ON CONFLICT ("id") DO NOTHING;
