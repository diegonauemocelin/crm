-- Agenda de contatos separada por número de WhatsApp: scope = id do número; vazio = vale para todos (agenda geral).
DROP INDEX "whatsapp_contacts_tenantId_contactKey_key";
ALTER TABLE "whatsapp_contacts" ADD COLUMN "scope" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "whatsapp_contacts_tenantId_scope_contactKey_key" ON "whatsapp_contacts"("tenantId", "scope", "contactKey");

-- Empresa com um número só: a agenda que já existe passa a ser a desse número.
UPDATE "whatsapp_contacts" c SET "scope" = n.id::text
FROM (
  SELECT "tenantId", MIN(id::text) AS id FROM "whatsapp_numbers" WHERE "deletedAt" IS NULL GROUP BY "tenantId" HAVING COUNT(*) = 1
) n
WHERE c."tenantId" = n."tenantId" AND c."scope" = '';
