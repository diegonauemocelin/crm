-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'CLIENTE';

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contactKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_tenantId_contactKey_key" ON "whatsapp_contacts"("tenantId", "contactKey");

