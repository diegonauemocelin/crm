-- CreateTable
CREATE TABLE "capture_forms" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "submitLabel" TEXT NOT NULL DEFAULT 'Enviar',
    "successMessage" TEXT NOT NULL DEFAULT 'Recebemos seus dados. Em breve entraremos em contato.',
    "afterSubmit" TEXT NOT NULL DEFAULT 'mensagem',
    "redirectUrl" TEXT,
    "consentText" TEXT,
    "originName" TEXT NOT NULL DEFAULT 'Site - LP',
    "ownerId" UUID,
    "tags" TEXT[],
    "createRecord" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture_popups" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "formId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT,
    "imageUrl" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'delay',
    "delaySec" INTEGER NOT NULL DEFAULT 10,
    "scrollPct" INTEGER NOT NULL DEFAULT 50,
    "include" TEXT[],
    "exclude" TEXT[],
    "device" TEXT NOT NULL DEFAULT 'todos',
    "frequencyDays" INTEGER NOT NULL DEFAULT 7,
    "color" TEXT NOT NULL DEFAULT '#1d4ed8',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_popups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture_submissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "formId" UUID,
    "popupId" UUID,
    "leadId" UUID,
    "recordId" UUID,
    "data" JSONB NOT NULL,
    "pageUrl" TEXT,
    "touch" JSONB,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capture_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capture_forms_tenantId_idx" ON "capture_forms"("tenantId");

-- CreateIndex
CREATE INDEX "capture_popups_tenantId_idx" ON "capture_popups"("tenantId");

-- CreateIndex
CREATE INDEX "capture_submissions_tenantId_createdAt_idx" ON "capture_submissions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "capture_submissions_formId_createdAt_idx" ON "capture_submissions"("formId", "createdAt");

-- CreateIndex
CREATE INDEX "capture_submissions_leadId_idx" ON "capture_submissions"("leadId");

-- AddForeignKey
ALTER TABLE "capture_forms" ADD CONSTRAINT "capture_forms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_popups" ADD CONSTRAINT "capture_popups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_popups" ADD CONSTRAINT "capture_popups_formId_fkey" FOREIGN KEY ("formId") REFERENCES "capture_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_submissions" ADD CONSTRAINT "capture_submissions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "capture_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_submissions" ADD CONSTRAINT "capture_submissions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
