-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "lastInboundAt" TIMESTAMP(3);


-- Última mensagem de cada cliente (para o tempo de "aguardando retorno").
UPDATE "whatsapp_conversations" c SET "lastInboundAt" = m.t
FROM (SELECT "conversationId", max("sentAt") AS t FROM "whatsapp_messages" WHERE NOT "fromMe" AND NOT "internal" GROUP BY "conversationId") m
WHERE m."conversationId" = c."id";

-- Conversas já respondidas pela regra antiga, com o cliente parado há mais de 1 dia, não voltam a contar o tempo:
-- seguem fora dos avisos até o cliente escrever de novo. As do último dia passam a contar até o atendente marcar.
UPDATE "whatsapp_conversations" SET "noReplyNeeded" = true
WHERE "lastFromMe" = true AND "noReplyNeeded" = false AND ("lastInboundAt" IS NULL OR "lastInboundAt" < now() - interval '1 day');
