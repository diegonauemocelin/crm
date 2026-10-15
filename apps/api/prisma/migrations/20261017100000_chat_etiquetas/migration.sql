-- DropIndex
DROP INDEX "whatsapp_quick_replies_tenantId_idx";

-- AlterTable
ALTER TABLE "whatsapp_quick_replies" ADD COLUMN     "userId" UUID;

-- CreateTable
CREATE TABLE "whatsapp_labels" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversation_labels" (
    "conversationId" UUID NOT NULL,
    "labelId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_conversation_labels_pkey" PRIMARY KEY ("conversationId","labelId")
);

-- CreateIndex
CREATE INDEX "whatsapp_labels_tenantId_userId_idx" ON "whatsapp_labels"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "whatsapp_conversation_labels_labelId_idx" ON "whatsapp_conversation_labels"("labelId");

-- CreateIndex
CREATE INDEX "whatsapp_quick_replies_tenantId_userId_idx" ON "whatsapp_quick_replies"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "whatsapp_conversation_labels" ADD CONSTRAINT "whatsapp_conversation_labels_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversation_labels" ADD CONSTRAINT "whatsapp_conversation_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "whatsapp_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

