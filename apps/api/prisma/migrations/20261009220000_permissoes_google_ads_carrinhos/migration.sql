-- Permissões próprias para o painel do Google Ads e para carrinhos/checkout.
-- Cada perfil começa com o mesmo acesso de antes: Google Ads copia "Dashboards e relatórios"; carrinhos copia "Base de leads".
INSERT INTO "role_permissions" ("id", "roleId", "module", "canView", "canCreate", "canEdit", "canDelete", "canExport", "scope")
SELECT gen_random_uuid(), "roleId", 'google_ads', "canView", false, "canEdit", false, "canExport", 'ALL'
FROM "role_permissions" WHERE "module" = 'relatorios'
ON CONFLICT ("roleId", "module") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "module", "canView", "canCreate", "canEdit", "canDelete", "canExport", "scope")
SELECT gen_random_uuid(), "roleId", 'carrinhos', "canView", false, "canEdit", false, "canExport", 'ALL'
FROM "role_permissions" WHERE "module" = 'leads'
ON CONFLICT ("roleId", "module") DO NOTHING;
