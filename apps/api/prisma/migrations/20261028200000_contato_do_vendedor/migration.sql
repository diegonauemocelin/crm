-- Mensagem que pergunta ao cliente se o vendedor já entrou em contato (30 minutos depois do repasse): quando foi tentada e o resultado.
ALTER TABLE "service_records" ADD COLUMN "contactCheckAt" TIMESTAMP(3);
ALTER TABLE "service_records" ADD COLUMN "contactCheckStatus" TEXT;

-- A mensagem depois do repasse passa a sair na hora em que o Pré-Vendas marca "Repassou ao vendedor" (decisão de 28/10/2026).
UPDATE "tenant_settings"
SET "value" = jsonb_set("value"::jsonb, '{forwardMessage,delayMinutes}', '0'::jsonb)
WHERE "key" = 'atendimento' AND ("value"::jsonb) ? 'forwardMessage';
