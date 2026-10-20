-- Resposta rápida com arquivo (catálogo em PDF, tabela, foto): o texto vira a legenda.
ALTER TABLE "whatsapp_quick_replies" ADD COLUMN "fileId" UUID;
ALTER TABLE "whatsapp_quick_replies" ADD COLUMN "fileName" TEXT;
