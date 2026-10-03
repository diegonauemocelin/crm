-- Unidades (matriz e filiais), escopo "somente da unidade" e FPS como tipo de peça.

-- AlterEnum
ALTER TYPE "PermissionScope" ADD VALUE 'UNIT';

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" CHAR(2),
    "isHeadquarters" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "units_tenantId_name_key" ON "units"("tenantId", "name");
ALTER TABLE "units" ADD CONSTRAINT "units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unidades da USA Parts
INSERT INTO "units" ("id", "tenantId", "name", "city", "state", "isHeadquarters", "updatedAt")
SELECT gen_random_uuid(), t."id", u.name, u.city, u.state, u.hq, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES
  ('Matriz Maravilha', 'Maravilha', 'SC', true),
  ('Filial Cascavel', 'Cascavel', 'PR', false),
  ('Filial Itajaí', 'Itajaí', 'SC', false),
  ('Filial Cachoeirinha', 'Cachoeirinha', 'RS', false)
) AS u(name, city, state, hq)
WHERE t."slug" = 'default'
ON CONFLICT DO NOTHING;

-- Novas colunas
ALTER TABLE "users" ADD COLUMN "unitId" UUID;
ALTER TABLE "sellers" ADD COLUMN "unitId" UUID;
ALTER TABLE "service_records" ADD COLUMN "unitId" UUID;

-- Unidade digitada à mão no vendedor (texto livre da versão anterior): vira um cadastro de unidade.
INSERT INTO "units" ("id", "tenantId", "name", "updatedAt")
SELECT gen_random_uuid(), s."tenantId", trim(s."unit"), CURRENT_TIMESTAMP
FROM "sellers" s
WHERE s."unit" IS NOT NULL AND trim(s."unit") <> ''
GROUP BY s."tenantId", trim(s."unit")
ON CONFLICT DO NOTHING;

UPDATE "sellers" s SET "unitId" = u."id"
FROM "units" u
WHERE u."tenantId" = s."tenantId" AND s."unit" IS NOT NULL AND u."name" = trim(s."unit");

ALTER TABLE "sellers" DROP COLUMN "unit";

CREATE INDEX "service_records_unitId_idx" ON "service_records"("unitId");
ALTER TABLE "users" ADD CONSTRAINT "users_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FPS é tipo de peça (produto), não marca de máquina.
INSERT INTO "lookup_items" ("id", "tenantId", "type", "name")
SELECT gen_random_uuid(), b."tenantId", 'TIPO_PECA', 'FPS'
FROM "lookup_items" b
WHERE b."type" = 'MARCA' AND lower(b."name") = 'fps'
ON CONFLICT DO NOTHING;

INSERT INTO "lookup_items" ("id", "tenantId", "type", "name")
SELECT gen_random_uuid(), t."id", 'TIPO_PECA', 'FPS'
FROM "tenants" t
WHERE EXISTS (SELECT 1 FROM "lookup_items" l WHERE l."tenantId" = t."id")
ON CONFLICT DO NOTHING;

UPDATE "service_records" r
SET "brandIds" = array_remove(r."brandIds", b."id"),
    "partTypeIds" = CASE WHEN p."id" = ANY(r."partTypeIds") THEN r."partTypeIds" ELSE array_append(r."partTypeIds", p."id") END
FROM "lookup_items" b
JOIN "lookup_items" p ON p."tenantId" = b."tenantId" AND p."type" = 'TIPO_PECA' AND p."name" = 'FPS'
WHERE b."type" = 'MARCA' AND lower(b."name") = 'fps'
  AND r."tenantId" = b."tenantId" AND b."id" = ANY(r."brandIds");

UPDATE "lookup_items" SET "active" = false WHERE "type" = 'MARCA' AND lower("name") = 'fps';
