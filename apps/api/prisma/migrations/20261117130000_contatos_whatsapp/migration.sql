-- Contatos do WhatsApp de cada número (nomes dos eventos de contatos), guardados no CRM.
CREATE TABLE "whatsapp_wa_contacts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "numberId" UUID NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_wa_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_wa_contacts_numberId_jid_key" ON "whatsapp_wa_contacts"("numberId", "jid");
CREATE INDEX "whatsapp_wa_contacts_tenantId_idx" ON "whatsapp_wa_contacts"("tenantId");
