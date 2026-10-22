-- DropTable
DROP TABLE "marketplace_questions";

-- CreateTable
CREATE TABLE "assist_questions" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'mercadolivre',
    "mlQuestionId" TEXT NOT NULL,
    "mlItemId" TEXT,
    "mlStatus" TEXT,
    "customerId" TEXT,
    "customerNickname" TEXT,
    "customerName" TEXT,
    "customerLookupAt" TIMESTAMP(3),
    "text" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'nova',
    "processingState" TEXT NOT NULL DEFAULT 'ocioso',
    "processingStartedAt" TIMESTAMP(3),
    "pendingReason" TEXT,
    "pendingSince" TIMESTAMP(3),
    "brand" TEXT,
    "model" TEXT,
    "partCode" TEXT,
    "purchaseIntent" BOOLEAN NOT NULL DEFAULT false,
    "relevance" INTEGER NOT NULL DEFAULT 0,
    "assignedToId" UUID,
    "assignedToName" TEXT,
    "confidence" DOUBLE PRECISION,
    "answeredAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "externalAnsweredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assist_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assist_attempts" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "questionId" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'resposta',
    "authorId" UUID,
    "authorName" TEXT,
    "basedOnId" INTEGER,
    "text" TEXT NOT NULL,
    "ai" JSONB,
    "confidence" DOUBLE PRECISION,
    "sendStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendRequestedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "mlResponse" JSONB,
    "mlAnswerRef" TEXT,
    "error" TEXT,
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" UUID,
    "reviewedByName" TEXT,
    "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "assist_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assist_attempt_knowledge" (
    "attemptId" INTEGER NOT NULL,
    "knowledgeId" INTEGER NOT NULL,
    "knowledgeVersion" INTEGER NOT NULL,

    CONSTRAINT "assist_attempt_knowledge_pkey" PRIMARY KEY ("attemptId","knowledgeId")
);

-- CreateTable
CREATE TABLE "assist_notes" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "userId" UUID,
    "userName" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assist_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assist_events" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "questionId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "userId" UUID,
    "userName" TEXT,
    "note" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assist_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assist_knowledge" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "partCode" TEXT,
    "product" TEXT,
    "application" TEXT,
    "question" TEXT,
    "answer" TEXT NOT NULL,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'em_revisao',
    "version" INTEGER NOT NULL DEFAULT 1,
    "originQuestionId" INTEGER,
    "originImportId" INTEGER,
    "createdById" UUID,
    "createdByName" TEXT,
    "updatedById" UUID,
    "updatedByName" TEXT,
    "approvedById" UUID,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,
    "matchKey" TEXT,
    "autoLearned" BOOLEAN NOT NULL DEFAULT false,
    "mlItemId" TEXT,
    "learnedFrom" TEXT,

    CONSTRAINT "assist_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assist_knowledge_versions" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "knowledgeId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeType" TEXT NOT NULL,
    "changedById" UUID,
    "changedByName" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assist_knowledge_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assist_imports" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "userId" UUID,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'previa',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "ignored" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "headerErrors" JSONB,
    "report" JSONB,

    CONSTRAINT "assist_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assist_import_rows" (
    "id" SERIAL NOT NULL,
    "importId" INTEGER NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "existingId" INTEGER,
    "existing" JSONB,
    "errors" JSONB,
    "warnings" JSONB,
    "decision" TEXT NOT NULL DEFAULT 'pendente',
    "result" TEXT,

    CONSTRAINT "assist_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assist_items" (
    "tenantId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "sellerId" TEXT,
    "officialStoreId" TEXT,
    "title" TEXT,
    "permalink" TEXT,
    "price" DECIMAL(14,2),
    "currency" TEXT,
    "availableQuantity" INTEGER,
    "status" TEXT,
    "sellerSku" TEXT,
    "partNumber" TEXT,
    "brand" TEXT,
    "description" TEXT,
    "attributes" JSONB,
    "mlLastUpdated" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assist_items_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "assist_applications" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "partCode" TEXT NOT NULL,
    "productName" TEXT,
    "partBrand" TEXT,
    "machineBrand" TEXT,
    "machineModel" TEXT,
    "system" TEXT,
    "application" TEXT,
    "mlItemId" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'pendente',
    "knowledgeId" INTEGER,
    "source" TEXT,
    "validatedById" UUID,
    "validatedByName" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchKey" TEXT NOT NULL,

    CONSTRAINT "assist_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assist_sales" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "mlOrderId" TEXT NOT NULL,
    "mlItemId" TEXT NOT NULL,
    "itemTitle" TEXT,
    "questionId" INTEGER NOT NULL,
    "buyerId" TEXT NOT NULL,
    "orderStatus" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "currency" TEXT,
    "matchType" TEXT NOT NULL,
    "hoursAfterQuestion" DOUBLE PRECISION,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidBefore" BOOLEAN NOT NULL DEFAULT false,
    "paymentStatus" TEXT,

    CONSTRAINT "assist_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assist_questions_tenantId_status_idx" ON "assist_questions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "assist_questions_tenantId_receivedAt_idx" ON "assist_questions"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "assist_questions_tenantId_customerId_idx" ON "assist_questions"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "assist_questions_tenantId_mlQuestionId_key" ON "assist_questions"("tenantId", "mlQuestionId");

-- CreateIndex
CREATE INDEX "assist_attempts_tenantId_questionId_idx" ON "assist_attempts"("tenantId", "questionId");

-- CreateIndex
CREATE INDEX "assist_attempts_tenantId_sendStatus_idx" ON "assist_attempts"("tenantId", "sendStatus");

-- CreateIndex
CREATE INDEX "assist_attempt_knowledge_knowledgeId_idx" ON "assist_attempt_knowledge"("knowledgeId");

-- CreateIndex
CREATE INDEX "assist_notes_tenantId_entity_entityId_idx" ON "assist_notes"("tenantId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "assist_events_questionId_idx" ON "assist_events"("questionId");

-- CreateIndex
CREATE INDEX "assist_events_tenantId_type_createdAt_idx" ON "assist_events"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "assist_knowledge_tenantId_status_idx" ON "assist_knowledge"("tenantId", "status");

-- CreateIndex
CREATE INDEX "assist_knowledge_tenantId_matchKey_idx" ON "assist_knowledge"("tenantId", "matchKey");

-- CreateIndex
CREATE INDEX "assist_knowledge_tenantId_partCode_idx" ON "assist_knowledge"("tenantId", "partCode");

-- CreateIndex
CREATE INDEX "assist_knowledge_versions_knowledgeId_idx" ON "assist_knowledge_versions"("knowledgeId");

-- CreateIndex
CREATE INDEX "assist_imports_tenantId_createdAt_idx" ON "assist_imports"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "assist_import_rows_importId_idx" ON "assist_import_rows"("importId");

-- CreateIndex
CREATE INDEX "assist_items_tenantId_status_idx" ON "assist_items"("tenantId", "status");

-- CreateIndex
CREATE INDEX "assist_applications_tenantId_partCode_idx" ON "assist_applications"("tenantId", "partCode");

-- CreateIndex
CREATE INDEX "assist_applications_tenantId_machineModel_idx" ON "assist_applications"("tenantId", "machineModel");

-- CreateIndex
CREATE UNIQUE INDEX "assist_applications_tenantId_matchKey_key" ON "assist_applications"("tenantId", "matchKey");

-- CreateIndex
CREATE INDEX "assist_sales_tenantId_questionId_idx" ON "assist_sales"("tenantId", "questionId");

-- CreateIndex
CREATE INDEX "assist_sales_tenantId_orderDate_idx" ON "assist_sales"("tenantId", "orderDate");

-- CreateIndex
CREATE UNIQUE INDEX "assist_sales_tenantId_mlOrderId_mlItemId_key" ON "assist_sales"("tenantId", "mlOrderId", "mlItemId");

