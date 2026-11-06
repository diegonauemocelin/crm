-- Identificador escondido (@lid) do contato na conversa do telefone: respostas que chegam só por ele caem na conversa certa.
ALTER TABLE "whatsapp_conversations" ADD COLUMN "lid" TEXT;
CREATE INDEX "whatsapp_conversations_numberId_lid_idx" ON "whatsapp_conversations"("numberId", "lid");

-- Conversas escondidas (@lid) já abertas por respostas a mensagens de uma conversa do telefone: juntam nela.
CREATE TEMP TABLE "_lid_merge" AS
SELECT DISTINCT ON (h."id") h."id" AS hidden, t."id" AS target, h."jid" AS lid
FROM "whatsapp_conversations" h
JOIN "whatsapp_messages" m ON m."conversationId" = h."id" AND m."fromMe" = false AND m."quotedWaId" IS NOT NULL
JOIN "whatsapp_messages" q ON q."waId" = m."quotedWaId"
JOIN "whatsapp_conversations" t ON t."id" = q."conversationId" AND t."numberId" = h."numberId" AND t."jid" LIKE '%@s.whatsapp.net'
WHERE h."jid" LIKE '%@lid' AND h."phone" IS NULL
ORDER BY h."id", m."sentAt" DESC;

UPDATE "whatsapp_conversations" t SET "lid" = x.lid FROM "_lid_merge" x WHERE t."id" = x.target;

UPDATE "whatsapp_messages" m SET "conversationId" = x.target
FROM "_lid_merge" x
WHERE m."conversationId" = x.hidden
  AND NOT EXISTS (SELECT 1 FROM "whatsapp_messages" d WHERE d."conversationId" = x.target AND d."waId" = m."waId");

UPDATE "whatsapp_reminders" r SET "conversationId" = x.target FROM "_lid_merge" x WHERE r."conversationId" = x.hidden;

UPDATE "whatsapp_conversations" t
SET "unread" = t."unread" + h."unread",
    "lastInboundAt" = GREATEST(t."lastInboundAt", h."lastInboundAt"),
    "lastMessageAt" = GREATEST(t."lastMessageAt", h."lastMessageAt"),
    "lastPreview" = CASE WHEN h."lastMessageAt" > COALESCE(t."lastMessageAt", 'epoch') THEN h."lastPreview" ELSE t."lastPreview" END,
    "lastFromMe" = CASE WHEN h."lastMessageAt" > COALESCE(t."lastMessageAt", 'epoch') THEN h."lastFromMe" ELSE t."lastFromMe" END,
    "status" = CASE WHEN h."lastMessageAt" > COALESCE(t."lastMessageAt", 'epoch') AND h."status" = 'ABERTA' THEN 'ABERTA' ELSE t."status" END
FROM "_lid_merge" x JOIN "whatsapp_conversations" h ON h."id" = x.hidden
WHERE t."id" = x.target;

DELETE FROM "whatsapp_conversations" c USING "_lid_merge" x WHERE c."id" = x.hidden;
DROP TABLE "_lid_merge";
