-- AlterTable
ALTER TABLE "capture_whatsapps" ADD COLUMN     "originName" TEXT NOT NULL DEFAULT 'WhatsApp';

-- AlterTable
ALTER TABLE "service_records" ADD COLUMN     "entryChannel" TEXT;


-- Atendimentos já criados pela captura do site: o formulário/botão está na primeira linha das observações.
UPDATE "service_records" SET "entryChannel" = left(substring("notes" from '^Entrou pelo (.+?)\.(?:\n|$)'), 160)
WHERE "notes" LIKE 'Entrou pelo %' AND "entryChannel" IS NULL;
