-- Aviso "pré-venda aguardando atendimento": só as novas contam. As já mexidas por uma pessoa, ou com mais de um dia,
-- ficam marcadas como atendidas (o histórico não vira aviso).
UPDATE "service_records" SET "firstActionAt" = "updatedAt"
WHERE "kind" = 'PRE_VENDAS' AND "firstActionAt" IS NULL
  AND ("updatedById" IS NOT NULL OR "createdById" IS NOT NULL OR "forwarded" = true OR "saleStatus" <> 'NEGOCIACAO' OR "createdAt" < now() - interval '1 day');
