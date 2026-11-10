-- Fidelidade (Marketing › Fidelidade): clientes do programa, extrato de pontos, pedidos, prêmios, resgates, avaliações e códigos de acesso.
-- CreateTable
CREATE TABLE "loyalty_members" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "levelKey" TEXT,
    "levelAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentAt" TIMESTAMP(3),
    "optOutAt" TIMESTAMP(3),
    "tokenEpoch" INTEGER NOT NULL DEFAULT 0,
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_entries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "orderId" UUID,
    "orderCode" TEXT,
    "redemptionId" UUID,
    "reason" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "userId" UUID,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "inviteDueAt" TIMESTAMP(3),
    "inviteStatus" TEXT,
    "emailStatus" TEXT,
    "whatsappStatus" TEXT,
    "invitedAt" TIMESTAMP(3),

    CONSTRAINT "loyalty_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_rewards" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "pointsCost" INTEGER NOT NULL DEFAULT 0,
    "giftId" UUID,
    "discountType" TEXT,
    "value" DECIMAL(12,2),
    "stock" INTEGER,
    "perCustomer" INTEGER,
    "minLevel" TEXT,
    "validityDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_redemptions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "rewardId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "rewardName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "discountType" TEXT,
    "value" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedOrderCode" TEXT,
    "usedById" UUID,
    "usedByName" TEXT,
    "giftDeliveryId" UUID,
    "source" TEXT NOT NULL DEFAULT 'PAGINA',
    "createdById" UUID,
    "createdByName" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_reviews" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderCode" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "nps" INTEGER NOT NULL,
    "comment" TEXT,
    "aspects" JSONB,
    "detractor" BOOLEAN NOT NULL DEFAULT false,
    "followUpStatus" TEXT,
    "followUpNote" TEXT,
    "treatedAt" TIMESTAMP(3),
    "treatedById" UUID,
    "treatedByName" TEXT,
    "bonusPoints" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_access_codes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "channel" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_members_leadId_key" ON "loyalty_members"("leadId");

-- CreateIndex
CREATE INDEX "loyalty_members_tenantId_levelKey_idx" ON "loyalty_members"("tenantId", "levelKey");

-- CreateIndex
CREATE INDEX "loyalty_members_tenantId_balance_idx" ON "loyalty_members"("tenantId", "balance");

-- CreateIndex
CREATE INDEX "loyalty_entries_tenantId_leadId_createdAt_idx" ON "loyalty_entries"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_entries_tenantId_kind_createdAt_idx" ON "loyalty_entries"("tenantId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_entries_tenantId_expiresAt_idx" ON "loyalty_entries"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_entries_tenantId_dedupeKey_key" ON "loyalty_entries"("tenantId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_orders_orderId_key" ON "loyalty_orders"("orderId");

-- CreateIndex
CREATE INDEX "loyalty_orders_tenantId_inviteStatus_inviteDueAt_idx" ON "loyalty_orders"("tenantId", "inviteStatus", "inviteDueAt");

-- CreateIndex
CREATE INDEX "loyalty_orders_tenantId_reversedAt_idx" ON "loyalty_orders"("tenantId", "reversedAt");

-- CreateIndex
CREATE INDEX "loyalty_orders_leadId_idx" ON "loyalty_orders"("leadId");

-- CreateIndex
CREATE INDEX "loyalty_rewards_tenantId_active_idx" ON "loyalty_rewards"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_redemptions_code_key" ON "loyalty_redemptions"("code");

-- CreateIndex
CREATE INDEX "loyalty_redemptions_tenantId_status_createdAt_idx" ON "loyalty_redemptions"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_redemptions_leadId_createdAt_idx" ON "loyalty_redemptions"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_reviews_orderId_key" ON "loyalty_reviews"("orderId");

-- CreateIndex
CREATE INDEX "loyalty_reviews_tenantId_createdAt_idx" ON "loyalty_reviews"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_reviews_tenantId_detractor_followUpStatus_idx" ON "loyalty_reviews"("tenantId", "detractor", "followUpStatus");

-- CreateIndex
CREATE INDEX "loyalty_reviews_leadId_idx" ON "loyalty_reviews"("leadId");

-- CreateIndex
CREATE INDEX "loyalty_access_codes_leadId_createdAt_idx" ON "loyalty_access_codes"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_access_codes_tenantId_createdAt_idx" ON "loyalty_access_codes"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "loyalty_members" ADD CONSTRAINT "loyalty_members_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_orders" ADD CONSTRAINT "loyalty_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ecommerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "gifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "loyalty_rewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_reviews" ADD CONSTRAINT "loyalty_reviews_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_reviews" ADD CONSTRAINT "loyalty_reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ecommerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_access_codes" ADD CONSTRAINT "loyalty_access_codes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

