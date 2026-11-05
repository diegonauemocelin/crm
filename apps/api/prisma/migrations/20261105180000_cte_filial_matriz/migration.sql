-- CT-es que caíram numa filial com o mesmo CNPJ da matriz (ex.: E-commerce faturado pela Matriz) passam para a matriz:
-- a carga sai de lá e as tabelas de frete são as dela.
UPDATE "freight_ctes" c
SET "unitId" = hq."id"
FROM "units" u, "units" hq
WHERE c."unitId" = u."id"
  AND hq."tenantId" = u."tenantId"
  AND hq."isHeadquarters" = true
  AND hq."id" <> u."id"
  AND u."isHeadquarters" = false
  AND u."cnpj" IS NOT NULL
  AND u."cnpj" = hq."cnpj";
