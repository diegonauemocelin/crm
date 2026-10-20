-- Nome da empresa nos textos salvos: "USA Parts" (e variações: "USA PARTS", "Usa Parts", "USA-Parts") passa a "Usaparts".
-- Campanhas já enviadas, conversas, histórico e auditoria não mudam (são registro do que aconteceu).
-- Endereços como usaparts.com.br não mudam (o padrão exige espaço ou hífen entre USA e Parts).
CREATE FUNCTION pg_temp.usaparts(t text) RETURNS text AS $$
  SELECT regexp_replace(regexp_replace(t, 'USA[[:space:]-]+PARTS', 'USAPARTS', 'g'), '\mUSA[[:space:]-]+Parts\M', 'Usaparts', 'gi')
$$ LANGUAGE sql IMMUTABLE;

UPDATE "tenants" SET "name" = pg_temp.usaparts("name") WHERE "name" ~* 'USA[[:space:]-]+PARTS';
UPDATE "tenant_settings" SET "value" = pg_temp.usaparts("value"::text)::jsonb WHERE "value"::text ~* 'USA[[:space:]-]+PARTS';
UPDATE "units" SET "name" = pg_temp.usaparts("name") WHERE "name" ~* 'USA[[:space:]-]+PARTS';
UPDATE "lookup_items" SET "name" = pg_temp.usaparts("name") WHERE "name" ~* 'USA[[:space:]-]+PARTS';

UPDATE "capture_forms" SET
  "name" = pg_temp.usaparts("name"), "submitLabel" = pg_temp.usaparts("submitLabel"), "successMessage" = pg_temp.usaparts("successMessage"),
  "consentText" = pg_temp.usaparts("consentText"), "originName" = pg_temp.usaparts("originName"),
  "fields" = pg_temp.usaparts("fields"::text)::jsonb, "design" = pg_temp.usaparts("design"::text)::jsonb
WHERE concat_ws(' ', "name", "submitLabel", "successMessage", "consentText", "originName", "fields"::text, "design"::text) ~* 'USA[[:space:]-]+PARTS';

UPDATE "capture_popups" SET
  "name" = pg_temp.usaparts("name"), "title" = pg_temp.usaparts("title"), "text" = pg_temp.usaparts("text"), "design" = pg_temp.usaparts("design"::text)::jsonb
WHERE concat_ws(' ', "name", "title", "text", "design"::text) ~* 'USA[[:space:]-]+PARTS';

UPDATE "capture_whatsapps" SET
  "name" = pg_temp.usaparts("name"), "buttonText" = pg_temp.usaparts("buttonText"), "title" = pg_temp.usaparts("title"),
  "subtitle" = pg_temp.usaparts("subtitle"), "message" = pg_temp.usaparts("message"), "originName" = pg_temp.usaparts("originName")
WHERE concat_ws(' ', "name", "buttonText", "title", "subtitle", "message", "originName") ~* 'USA[[:space:]-]+PARTS';

UPDATE "email_campaigns" SET
  "name" = pg_temp.usaparts("name"), "subject" = pg_temp.usaparts("subject"), "preheader" = pg_temp.usaparts("preheader"),
  "fromName" = pg_temp.usaparts("fromName"), "blocks" = pg_temp.usaparts("blocks"::text)::jsonb
WHERE "status" NOT IN ('ENVIADA', 'ENVIANDO')
  AND concat_ws(' ', "name", "subject", "preheader", "fromName", "blocks"::text) ~* 'USA[[:space:]-]+PARTS';

UPDATE "email_segments" SET "name" = pg_temp.usaparts("name") WHERE "name" ~* 'USA[[:space:]-]+PARTS';

UPDATE "automations" SET
  "name" = pg_temp.usaparts("name"), "description" = pg_temp.usaparts("description"),
  "trigger" = pg_temp.usaparts("trigger"::text)::jsonb, "steps" = pg_temp.usaparts("steps"::text)::jsonb
WHERE concat_ws(' ', "name", "description", "trigger"::text, "steps"::text) ~* 'USA[[:space:]-]+PARTS';

UPDATE "whatsapp_quick_replies" SET "title" = pg_temp.usaparts("title"), "text" = pg_temp.usaparts("text")
WHERE concat_ws(' ', "title", "text") ~* 'USA[[:space:]-]+PARTS';
UPDATE "whatsapp_numbers" SET "name" = pg_temp.usaparts("name") WHERE "name" ~* 'USA[[:space:]-]+PARTS';
UPDATE "whatsapp_labels" SET "name" = pg_temp.usaparts("name") WHERE "name" ~* 'USA[[:space:]-]+PARTS';
UPDATE "saved_reports" SET "name" = pg_temp.usaparts("name"), "description" = pg_temp.usaparts("description")
WHERE concat_ws(' ', "name", "description") ~* 'USA[[:space:]-]+PARTS';
UPDATE "custom_field_defs" SET "label" = pg_temp.usaparts("label") WHERE "label" ~* 'USA[[:space:]-]+PARTS';
