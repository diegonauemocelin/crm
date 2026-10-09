-- AlterTable
ALTER TABLE "service_records" ADD COLUMN     "entryPage" TEXT;


-- Preenche a página de entrada dos atendimentos já existentes (a conferência automática refaz todos).
UPDATE "service_records" SET "adsCheckedAt" = NULL;
