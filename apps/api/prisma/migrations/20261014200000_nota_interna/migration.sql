-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "noteUnread" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false;


-- Gestor comercial também escreve nota interna (ação Criar de "Monitorar conversas").
UPDATE "role_permissions" rp SET "canCreate" = true
FROM "roles" r WHERE r.id = rp."roleId" AND r."name" = 'Gestor comercial' AND r."isSystem" = false AND rp."module" = 'monitoramento';
