-- Números de WhatsApp que cada perfil pode monitorar (vazio = todos, como antes).
ALTER TABLE "roles" ADD COLUMN "monitorNumberIds" UUID[] DEFAULT ARRAY[]::UUID[];
