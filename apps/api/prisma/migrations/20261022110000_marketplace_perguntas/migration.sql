-- CreateTable
CREATE TABLE "marketplace_questions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "marketplace" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemTitle" TEXT,
    "itemPermalink" TEXT,
    "sku" TEXT,
    "buyerId" TEXT,
    "text" TEXT NOT NULL,
    "cep" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "answer" TEXT,
    "options" JSONB,
    "error" TEXT,
    "askedAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "answeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_questions_tenantId_status_askedAt_idx" ON "marketplace_questions"("tenantId", "status", "askedAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_questions_tenantId_marketplace_questionId_key" ON "marketplace_questions"("tenantId", "marketplace", "questionId");

