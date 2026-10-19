-- Nome da empresa: "USA Parts" passa a ser "Usaparts" (empresa, identidade visual, remetente e rodapé dos e-mails).
UPDATE "tenants" SET "name" = REPLACE("name", 'USA Parts', 'Usaparts') WHERE "name" LIKE '%USA Parts%';
UPDATE "tenant_settings" SET "value" = REPLACE("value"::text, 'USA Parts', 'Usaparts')::jsonb
WHERE "key" IN ('branding', 'smtp', 'email_marketing') AND "value"::text LIKE '%USA Parts%';
