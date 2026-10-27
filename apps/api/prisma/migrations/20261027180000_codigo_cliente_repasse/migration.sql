-- Código e vendedor do cliente na base de leads; cliente da carteira do vendedor não abre pré-venda pelo WhatsApp.
ALTER TABLE "leads" ADD COLUMN "customerCode" TEXT;
ALTER TABLE "leads" ADD COLUMN "clientSellerId" UUID;
ALTER TABLE "leads" ADD COLUMN "walletOnly" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "leads_tenantId_customerCode_idx" ON "leads"("tenantId", "customerCode");

-- Mensagem automática depois do repasse ao vendedor.
ALTER TABLE "service_records" ADD COLUMN "forwardMessageAt" TIMESTAMP(3);
ALTER TABLE "service_records" ADD COLUMN "forwardMessageStatus" TEXT;

-- Pré-vendas que já têm código do cliente: o código (e o vendedor) da mais recente vai para o lead.
UPDATE "leads" l
   SET "customerCode" = r."customerCode",
       "clientSellerId" = COALESCE(r."sellerId", l."clientSellerId")
  FROM (
    SELECT DISTINCT ON ("leadId") "leadId", "customerCode", "sellerId"
      FROM "service_records"
     WHERE "leadId" IS NOT NULL AND "deletedAt" IS NULL AND "kind" = 'PRE_VENDAS' AND COALESCE(TRIM("customerCode"), '') <> ''
     ORDER BY "leadId", "leadAt" DESC
  ) r
 WHERE l.id = r."leadId";
