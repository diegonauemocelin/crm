-- Regra de interesse "Iniciou o checkout na loja" para quem já tem as regras padrão (tenants novos recebem pelo código).
INSERT INTO "score_rules" ("id", "tenantId", "dimension", "name", "field", "operator", "value", "points", "active")
SELECT gen_random_uuid(), t."tenantId", 'INTERESSE', 'Iniciou o checkout na loja', 'checkout', 'each', NULL, 5, true
FROM (SELECT DISTINCT "tenantId" FROM "score_rules") t
WHERE NOT EXISTS (SELECT 1 FROM "score_rules" r WHERE r."tenantId" = t."tenantId" AND r."field" = 'checkout');
