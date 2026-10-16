-- Chat: responder (citar) e reagir às mensagens.
ALTER TABLE "whatsapp_messages" ADD COLUMN "quotedWaId" TEXT, ADD COLUMN "quotedText" TEXT, ADD COLUMN "reactions" JSONB;
