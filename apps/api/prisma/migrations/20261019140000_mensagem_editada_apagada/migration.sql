-- Chat: mensagens editadas e apagadas para todos.
ALTER TABLE "whatsapp_messages" ADD COLUMN "editedAt" TIMESTAMP(3),
ADD COLUMN "deletedAt" TIMESTAMP(3);
