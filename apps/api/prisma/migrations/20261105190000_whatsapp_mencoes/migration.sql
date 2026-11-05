-- Menções em grupos do WhatsApp: quem escreveu (telefone/@lid) e quem foi mencionado.
ALTER TABLE "whatsapp_messages" ADD COLUMN "senders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "whatsapp_messages" ADD COLUMN "mentions" JSONB;
