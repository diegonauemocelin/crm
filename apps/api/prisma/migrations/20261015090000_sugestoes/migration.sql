-- CreateTable
CREATE TABLE "suggestions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "area" TEXT,
    "imageFileId" UUID,
    "status" TEXT NOT NULL DEFAULT 'NOVA',
    "reply" TEXT,
    "repliedById" UUID,
    "repliedByName" TEXT,
    "repliedAt" TIMESTAMP(3),
    "unreadByAuthor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestions_tenantId_status_createdAt_idx" ON "suggestions"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "suggestions_userId_createdAt_idx" ON "suggestions"("userId", "createdAt");

