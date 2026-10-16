-- Atendimento dividido: atendente padrão do número (recebe os clientes novos) e participantes da conversa.
ALTER TABLE "whatsapp_numbers" ADD COLUMN "defaultUserId" UUID;
ALTER TABLE "whatsapp_conversations" ADD COLUMN "helperUserIds" UUID[] DEFAULT ARRAY[]::UUID[];
