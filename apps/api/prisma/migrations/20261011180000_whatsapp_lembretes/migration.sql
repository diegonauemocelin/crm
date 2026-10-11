-- CreateTable
CREATE TABLE "whatsapp_reminders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userName" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "doneAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_reminders_userId_doneAt_dueAt_idx" ON "whatsapp_reminders"("userId", "doneAt", "dueAt");

-- CreateIndex
CREATE INDEX "whatsapp_reminders_conversationId_idx" ON "whatsapp_reminders"("conversationId");

-- AddForeignKey
ALTER TABLE "whatsapp_reminders" ADD CONSTRAINT "whatsapp_reminders_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

