-- Número de WhatsApp de atendimento (chat) ou só de monitoramento (direção).
ALTER TABLE "whatsapp_numbers" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'ATENDIMENTO';
