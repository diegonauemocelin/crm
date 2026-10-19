-- Pré-venda em negociação: prazo para chamar o cliente; e mensagem automática de WhatsApp no dia seguinte.
ALTER TABLE "service_records" ADD COLUMN "callDueAt" TIMESTAMP(3),
ADD COLUMN "calledAt" TIMESTAMP(3),
ADD COLUMN "autoMessageAt" TIMESTAMP(3),
ADD COLUMN "autoMessageStatus" TEXT;

CREATE INDEX "service_records_tenantId_kind_callDueAt_idx" ON "service_records"("tenantId", "kind", "callDueAt");

-- Pré-vendas já em negociação, repassadas nos últimos 30 dias: prazo de 24 horas a partir do repasse
-- (o histórico mais antigo, como o importado da planilha, não vira aviso).
UPDATE "service_records" SET "callDueAt" = "forwardedAt" + INTERVAL '24 hours'
WHERE "kind" = 'PRE_VENDAS' AND "deletedAt" IS NULL AND "forwarded" = true AND "saleStatus" = 'NEGOCIACAO'
  AND "forwardedAt" >= NOW() - INTERVAL '30 days';

