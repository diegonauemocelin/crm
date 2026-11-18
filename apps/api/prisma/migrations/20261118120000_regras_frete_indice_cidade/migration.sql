-- Regras de frete pela cidade: a cotação busca pela cidade da versão e a tela de cidades atendidas pela cidade e UF.
-- Sem estes índices o banco lia a tabela de regras inteira (minutos por cotação).
CREATE INDEX IF NOT EXISTS "freight_rules_versionId_cityKey_idx" ON "freight_rules"("versionId", "cityKey");
CREATE INDEX IF NOT EXISTS "freight_rules_cityKey_uf_idx" ON "freight_rules"("cityKey", "uf");
