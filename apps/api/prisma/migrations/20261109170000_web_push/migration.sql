-- Marketing › Web Push: inscritos da loja virtual, campanhas e envios (entregas e cliques).

-- CreateEnum
CREATE TYPE "WebPushStatus" AS ENUM ('RASCUNHO', 'AGENDADO', 'ENVIANDO', 'ENVIADO', 'CANCELADO', 'ERRO');

-- CreateTable
CREATE TABLE "web_push_subscribers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "visitorId" TEXT,
    "leadId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_push_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_push_campaigns" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "buttonLabel" TEXT,
    "iconFileId" UUID,
    "imageFileId" UUID,
    "status" "WebPushStatus" NOT NULL DEFAULT 'RASCUNHO',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "targets" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_push_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_push_deliveries" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "subscriberId" UUID NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shownAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),

    CONSTRAINT "web_push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscribers_endpoint_key" ON "web_push_subscribers"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscribers_tenantId_active_idx" ON "web_push_subscribers"("tenantId", "active");

-- CreateIndex
CREATE INDEX "web_push_subscribers_leadId_idx" ON "web_push_subscribers"("leadId");

-- CreateIndex
CREATE INDEX "web_push_campaigns_tenantId_status_idx" ON "web_push_campaigns"("tenantId", "status");

-- CreateIndex
CREATE INDEX "web_push_campaigns_status_scheduledAt_idx" ON "web_push_campaigns"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "web_push_deliveries_subscriberId_idx" ON "web_push_deliveries"("subscriberId");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_deliveries_campaignId_subscriberId_key" ON "web_push_deliveries"("campaignId", "subscriberId");

-- AddForeignKey
ALTER TABLE "web_push_deliveries" ADD CONSTRAINT "web_push_deliveries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "web_push_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_deliveries" ADD CONSTRAINT "web_push_deliveries_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "web_push_subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

