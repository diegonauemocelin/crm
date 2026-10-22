-- CreateTable
CREATE TABLE "whatsapp_stickers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_stickers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_stickers_tenantId_userId_createdAt_idx" ON "whatsapp_stickers"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_stickers_userId_hash_key" ON "whatsapp_stickers"("userId", "hash");

