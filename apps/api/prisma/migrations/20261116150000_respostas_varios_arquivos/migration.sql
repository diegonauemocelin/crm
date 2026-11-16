-- Respostas rápidas com vários arquivos (até 3): o arquivo único passa para a lista.
ALTER TABLE "whatsapp_quick_replies" ADD COLUMN "files" JSONB NOT NULL DEFAULT '[]';

UPDATE "whatsapp_quick_replies"
SET "files" = jsonb_build_array(jsonb_build_object('fileId', "fileId", 'fileName', COALESCE("fileName", 'arquivo'))),
    "fileId" = NULL,
    "fileName" = NULL
WHERE "fileId" IS NOT NULL;
