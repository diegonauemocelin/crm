-- CreateTable
CREATE TABLE "prospect_campaigns" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "searchId" UUID NOT NULL,
    "numberId" UUID NOT NULL,
    "messages" TEXT[],
    "gapMin" INTEGER NOT NULL DEFAULT 2,
    "gapMax" INTEGER NOT NULL DEFAULT 10,
    "dailyMax" INTEGER NOT NULL DEFAULT 30,
    "optOut" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'RODANDO',
    "error" TEXT,
    "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "prospect_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_sends" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "prospectId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FILA',
    "text" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "conversationId" UUID,
    "repliedAt" TIMESTAMP(3),
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prospect_campaigns_tenantId_status_idx" ON "prospect_campaigns"("tenantId", "status");

-- CreateIndex
CREATE INDEX "prospect_campaigns_searchId_idx" ON "prospect_campaigns"("searchId");

-- CreateIndex
CREATE INDEX "prospect_sends_campaignId_status_idx" ON "prospect_sends"("campaignId", "status");

-- CreateIndex
CREATE INDEX "prospect_sends_tenantId_status_sentAt_idx" ON "prospect_sends"("tenantId", "status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_sends_campaignId_prospectId_key" ON "prospect_sends"("campaignId", "prospectId");

-- AddForeignKey
ALTER TABLE "prospect_campaigns" ADD CONSTRAINT "prospect_campaigns_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "prospect_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_sends" ADD CONSTRAINT "prospect_sends_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "prospect_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_sends" ADD CONSTRAINT "prospect_sends_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

