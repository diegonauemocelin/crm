-- AlterTable
ALTER TABLE "capture_forms" ALTER COLUMN "brandIds" SET DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "capture_popups" ALTER COLUMN "brandIds" SET DEFAULT ARRAY[]::UUID[];

-- Registros criados antes do padrão: lista vazia em vez de nulo.
UPDATE "capture_forms" SET "brandIds" = '{}' WHERE "brandIds" IS NULL;
UPDATE "capture_popups" SET "brandIds" = '{}' WHERE "brandIds" IS NULL;
