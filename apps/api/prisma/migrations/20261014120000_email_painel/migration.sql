-- AlterTable
ALTER TABLE "email_recipients" ADD COLUMN     "failedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "email_recipients_sentAt_idx" ON "email_recipients"("sentAt");


-- Envios recusados antes desta versão: data aproximada (início da campanha).
UPDATE "email_recipients" er SET "failedAt" = COALESCE(c."startedAt", c."createdAt")
FROM "email_campaigns" c WHERE c.id = er."campaignId" AND er.status = 'ERRO' AND er."failedAt" IS NULL;
