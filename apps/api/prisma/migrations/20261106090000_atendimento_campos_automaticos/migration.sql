-- Campos da pré-venda que vieram preenchidos (formulário, botão de WhatsApp, chat ou automação).
ALTER TABLE "service_records" ADD COLUMN "autoFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Atendimentos já criados automaticamente: os campos com valor que ninguém alterou depois.
UPDATE "service_records" r
SET "autoFields" = ARRAY(
  SELECT f FROM (VALUES
    ('leadAt', true),
    ('name', r."name" IS NOT NULL AND r."name" <> ''),
    ('customerCode', r."customerCode" IS NOT NULL AND r."customerCode" <> ''),
    ('phone', r."phone" IS NOT NULL),
    ('email', r."email" IS NOT NULL),
    ('state', r."state" IS NOT NULL),
    ('city', r."city" IS NOT NULL AND r."city" <> ''),
    ('sellerId', r."sellerId" IS NOT NULL),
    ('unitId', r."unitId" IS NOT NULL),
    ('originId', r."originId" IS NOT NULL),
    ('customerTypeId', r."customerTypeId" IS NOT NULL),
    ('brandIds', cardinality(r."brandIds") > 0),
    ('partTypeIds', cardinality(r."partTypeIds") > 0),
    ('notes', r."notes" IS NOT NULL AND r."notes" <> '')
  ) AS c(f, filled)
  WHERE c.filled
    AND NOT EXISTS (
      SELECT 1 FROM "service_record_history" h
      WHERE h."recordId" = r."id" AND h."action" = 'alterado' AND h."changes" ? c.f
    )
)
WHERE r."kind" = 'PRE_VENDAS'
  AND r."parentId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "service_record_history" h
    WHERE h."recordId" = r."id" AND h."action" = 'criado automaticamente'
  );
