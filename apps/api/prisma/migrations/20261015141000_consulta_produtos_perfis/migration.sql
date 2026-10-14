-- Consulta de produtos da Tcar (só leitura, sem dados pessoais e sem custo) para quem atende:
-- perfis que já veem Pré-Vendas, Pós-Vendas ou o Chat WhatsApp.
INSERT INTO "role_permissions" ("id", "roleId", "module", "canView", "canCreate", "canEdit", "canDelete", "canExport", "scope")
SELECT gen_random_uuid(), r.id, 'consulta_produtos', true, false, false, false, false, 'ALL'
FROM "roles" r
WHERE r."isSystem" = false
  AND EXISTS (SELECT 1 FROM "role_permissions" p WHERE p."roleId" = r.id AND p."canView" AND p."module" IN ('pre_vendas', 'pos_vendas', 'chat'))
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" p WHERE p."roleId" = r.id AND p."module" = 'consulta_produtos');
