-- AlterTable
ALTER TABLE "capture_submissions" ADD COLUMN     "whatsappId" UUID;

-- CreateTable
CREATE TABLE "capture_whatsapps" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "buttonText" TEXT NOT NULL DEFAULT 'Fale no WhatsApp',
    "title" TEXT NOT NULL DEFAULT 'Fale com a gente',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "askEmail" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL,
    "position" TEXT NOT NULL DEFAULT 'direita',
    "color" TEXT NOT NULL DEFAULT '#25D366',
    "include" TEXT[],
    "exclude" TEXT[],
    "device" TEXT NOT NULL DEFAULT 'todos',
    "ownerId" UUID,
    "customerTypeId" UUID,
    "brandIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "tags" TEXT[],
    "createRecord" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_whatsapps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capture_whatsapps_tenantId_idx" ON "capture_whatsapps"("tenantId");

-- AddForeignKey
ALTER TABLE "capture_whatsapps" ADD CONSTRAINT "capture_whatsapps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
