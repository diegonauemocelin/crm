-- Validação do e-mail dos leads (formato e domínio).
ALTER TABLE "leads" ADD COLUMN "emailCheckedFor" TEXT;
ALTER TABLE "leads" ADD COLUMN "emailInvalidAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "emailInvalidReason" TEXT;
