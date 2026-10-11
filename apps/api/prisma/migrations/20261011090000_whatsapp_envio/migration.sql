-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "error" TEXT,
ADD COLUMN     "sentById" UUID,
ADD COLUMN     "sentByName" TEXT,
ADD COLUMN     "status" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "signMessages" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "whatsapp_quick_replies" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_quick_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_quick_replies_tenantId_idx" ON "whatsapp_quick_replies"("tenantId");

