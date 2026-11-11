-- Planejamento dos marketplaces: pedidos do Mercado Livre, qualidade dos anúncios, análises SWOT, metas e tarefas,
-- e o histórico diário de preço dos concorrentes.
-- CreateTable
CREATE TABLE "marketplace_order_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'mercadolivre',
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL DEFAULT '',
    "title" TEXT,
    "sellerSku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "saleFee" DECIMAL(14,2),
    "listingTypeId" TEXT,
    "status" TEXT,
    "dateCreated" TIMESTAMP(3) NOT NULL,
    "dateClosed" TIMESTAMP(3),
    "shippingId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_item_quality" (
    "tenantId" UUID NOT NULL,
    "itemId" TEXT NOT NULL,
    "score" INTEGER,
    "level" TEXT,
    "levelWording" TEXT,
    "pending" JSONB,
    "experienceValue" INTEGER,
    "experienceColor" TEXT,
    "experienceText" TEXT,
    "problems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_item_quality_pkey" PRIMARY KEY ("tenantId","itemId")
);

-- CreateTable
CREATE TABLE "marketplace_swot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'mercadolivre',
    "summary" JSONB NOT NULL,
    "findings" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_swot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_goals" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'mercadolivre',
    "month" CHAR(7) NOT NULL,
    "revenueTarget" DECIMAL(14,2),
    "marginPctTarget" DECIMAL(8,2),
    "acosTarget" DECIMAL(8,2),
    "notes" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_goal_tasks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "assigneeId" UUID,
    "assigneeName" TEXT,
    "dueDate" DATE,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_goal_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_competitor_price_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "competitorId" UUID NOT NULL,
    "itemId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ml_competitor_price_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_order_lines_tenantId_dateCreated_idx" ON "marketplace_order_lines"("tenantId", "dateCreated");

-- CreateIndex
CREATE INDEX "marketplace_order_lines_tenantId_itemId_idx" ON "marketplace_order_lines"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_order_lines_tenantId_orderId_itemId_variationId_key" ON "marketplace_order_lines"("tenantId", "orderId", "itemId", "variationId");

-- CreateIndex
CREATE INDEX "marketplace_swot_tenantId_createdAt_idx" ON "marketplace_swot"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_goals_tenantId_channel_month_key" ON "marketplace_goals"("tenantId", "channel", "month");

-- CreateIndex
CREATE INDEX "marketplace_goal_tasks_tenantId_goalId_idx" ON "marketplace_goal_tasks"("tenantId", "goalId");

-- CreateIndex
CREATE INDEX "ml_competitor_price_days_tenantId_itemId_idx" ON "ml_competitor_price_days"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ml_competitor_price_days_competitorId_itemId_date_key" ON "ml_competitor_price_days"("competitorId", "itemId", "date");

-- AddForeignKey
ALTER TABLE "marketplace_goal_tasks" ADD CONSTRAINT "marketplace_goal_tasks_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "marketplace_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

