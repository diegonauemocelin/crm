-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "createRecords" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "numberId" UUID NOT NULL,
    "jid" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "leadId" UUID,
    "recordId" UUID,
    "assignedSellerId" UUID,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "unread" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastPreview" TEXT,
    "lastFromMe" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "waId" TEXT NOT NULL,
    "fromMe" BOOLEAN NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "fileId" UUID,
    "fileName" TEXT,
    "mime" TEXT,
    "mediaStatus" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_conversations_tenantId_lastMessageAt_idx" ON "whatsapp_conversations"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_leadId_idx" ON "whatsapp_conversations"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_conversations_numberId_jid_key" ON "whatsapp_conversations"("numberId", "jid");

-- CreateIndex
CREATE INDEX "whatsapp_messages_conversationId_sentAt_idx" ON "whatsapp_messages"("conversationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_conversationId_waId_key" ON "whatsapp_messages"("conversationId", "waId");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

