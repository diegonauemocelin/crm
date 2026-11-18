-- CT-es importados antes do papel da empresa (TOMADOR, REMETENTE, DESTINATARIO): preenche pela raiz do CNPJ das
-- filiais, para o filtro Compra e venda (venda = a empresa é remetente; compra = só recebe ou paga).
WITH roots AS (
  SELECT DISTINCT "tenantId", left(regexp_replace(cnpj, '\D', '', 'g'), 8) AS root
  FROM "units" WHERE cnpj IS NOT NULL AND length(regexp_replace(cnpj, '\D', '', 'g')) = 14
)
UPDATE "freight_ctes" c SET "companyRoles" = array_remove(ARRAY[
  CASE WHEN length(c."tomadorDoc") = 14 AND EXISTS (SELECT 1 FROM roots r WHERE r."tenantId" = c."tenantId" AND r.root = left(c."tomadorDoc", 8)) THEN 'TOMADOR' END,
  CASE WHEN length(c."senderDoc") = 14 AND EXISTS (SELECT 1 FROM roots r WHERE r."tenantId" = c."tenantId" AND r.root = left(c."senderDoc", 8)) THEN 'REMETENTE' END,
  CASE WHEN length(c."recipientDoc") = 14 AND EXISTS (SELECT 1 FROM roots r WHERE r."tenantId" = c."tenantId" AND r.root = left(c."recipientDoc", 8)) THEN 'DESTINATARIO' END
]::TEXT[], NULL)
WHERE cardinality(c."companyRoles") = 0;
