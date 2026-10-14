-- Perfil "Gestor comercial": acompanha todos os vendedores (atendimentos, leads e conversas do WhatsApp, inclusive
-- monitorando as conversas sem marcar como lidas). Criado uma vez por empresa; o administrador pode ajustar depois.
INSERT INTO "roles" ("id", "tenantId", "name", "description", "isSystem", "require2fa", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t.id, 'Gestor comercial',
  'Acompanha todos os vendedores: atendimentos, leads, dashboards e as conversas do WhatsApp (monitoramento).',
  false, true, true, now(), now()
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."tenantId" = t.id AND lower(r."name") = 'gestor comercial');

-- Permissões: [módulo, ver, criar, editar, excluir, exportar]; escopo sempre "todos".
INSERT INTO "role_permissions" ("id", "roleId", "module", "canView", "canCreate", "canEdit", "canDelete", "canExport", "scope")
SELECT gen_random_uuid(), r.id, p.module, p.v, p.c, p.e, false, p.x, 'ALL'
FROM "roles" r
CROSS JOIN (VALUES
  ('dashboard',       true,  false, false, false),
  ('leads',           true,  true,  true,  true),
  ('carrinhos',       true,  false, true,  true),
  ('pre_vendas',      true,  true,  true,  true),
  ('pos_vendas',      true,  true,  true,  true),
  ('cadastros',       true,  false, false, false),
  ('chat',            true,  true,  true,  false),
  ('monitoramento',   true,  false, false, false),
  ('whatsapp',        true,  false, false, false),
  ('email_marketing', true,  false, false, false),
  ('automacoes',      true,  false, false, false),
  ('catalogo',        true,  false, false, true),
  ('relatorios',      true,  true,  true,  true),
  ('google_ads',      true,  false, false, false)
) AS p(module, v, c, e, x)
WHERE r."name" = 'Gestor comercial' AND r."isSystem" = false
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."roleId" = r.id AND rp."module" = p.module);
