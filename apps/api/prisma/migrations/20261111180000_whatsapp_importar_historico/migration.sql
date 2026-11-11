-- Importar mensagens do aparelho: por número, o histórico que o WhatsApp manda ao ler o QR Code entra no CRM pelo
-- período escolhido (2, 7, 15 ou 30 dias), com o andamento da importação guardado no número.
-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "importHistory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "importHistoryDays" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "historyStatus" TEXT,
ADD COLUMN     "historyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "historyStartedAt" TIMESTAMP(3),
ADD COLUMN     "historyUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "historyFinishedAt" TIMESTAMP(3);
