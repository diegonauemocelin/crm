-- O botão de WhatsApp único (configuração "captura") vira o primeiro botão da lista nova.
INSERT INTO "capture_whatsapps" (
  "id", "tenantId", "name", "phone", "buttonText", "title", "subtitle", "askEmail", "message", "position", "color",
  "include", "exclude", "device", "ownerId", "customerTypeId", "brandIds", "tags", "createRecord", "active", "sortOrder", "updatedAt"
)
SELECT
  gen_random_uuid(), s."tenantId", 'Botão principal', w->>'phone',
  coalesce(w->>'buttonText', 'Fale no WhatsApp'), coalesce(w->>'title', 'Fale com a gente'), coalesce(w->>'subtitle', ''),
  coalesce((w->>'askEmail')::boolean, false), coalesce(w->>'message', 'Olá! Meu nome é {nome}. Vim pelo site e gostaria de atendimento.'),
  coalesce(w->>'position', 'direita'), coalesce(w->>'color', '#25D366'),
  ARRAY(SELECT jsonb_array_elements_text(coalesce(w->'include', '[]'::jsonb))),
  ARRAY(SELECT jsonb_array_elements_text(coalesce(w->'exclude', '[]'::jsonb))),
  coalesce(w->>'device', 'todos'),
  nullif(w->>'ownerId', '')::uuid,
  nullif(w->>'customerTypeId', '')::uuid,
  ARRAY(SELECT jsonb_array_elements_text(coalesce(w->'brandIds', '[]'::jsonb)))::uuid[],
  ARRAY(SELECT jsonb_array_elements_text(coalesce(w->'tags', '[]'::jsonb))),
  coalesce((w->>'createRecord')::boolean, true), coalesce((w->>'enabled')::boolean, false), 0, now()
FROM "tenant_settings" s
CROSS JOIN LATERAL (SELECT s."value"->'whatsapp' AS w) x
WHERE s."key" = 'captura' AND coalesce(w->>'phone', '') <> ''
  AND NOT EXISTS (SELECT 1 FROM "capture_whatsapps" c WHERE c."tenantId" = s."tenantId");
