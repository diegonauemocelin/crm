
-- CreateTable
CREATE TABLE "google_ads_detail_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "conversions" DECIMAL(12,2) NOT NULL,
    "conversionValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impressionShare" DECIMAL(6,4),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_detail_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_ads_search_term_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "conversions" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_search_term_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_ad_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "parentId" TEXT,
    "objective" TEXT,
    "date" DATE NOT NULL,
    "spend" DECIMAL(14,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "reach" INTEGER,
    "clicks" INTEGER NOT NULL,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "conversions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "videoViews" INTEGER,
    "creative" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkt_ad_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_ad_breakdown_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "spend" DECIMAL(14,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkt_ad_breakdown_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_social_profile_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "followers" INTEGER,
    "reach" INTEGER,
    "impressions" INTEGER,
    "profileViews" INTEGER,
    "websiteClicks" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkt_social_profile_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_social_posts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "format" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "permalink" TEXT,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "reach" INTEGER,
    "impressions" INTEGER,
    "videoViews" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkt_social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_seo_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DECIMAL(8,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkt_seo_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_editorial_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "theme" TEXT,
    "ownerId" UUID,
    "plannedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "postUrl" TEXT,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mkt_editorial_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "google_ads_detail_days_tenantId_dimension_date_idx" ON "google_ads_detail_days"("tenantId", "dimension", "date");

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_detail_days_tenantId_date_campaignId_dimension_k_key" ON "google_ads_detail_days"("tenantId", "date", "campaignId", "dimension", "key");

-- CreateIndex
CREATE INDEX "google_ads_search_term_days_tenantId_date_idx" ON "google_ads_search_term_days"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_search_term_days_tenantId_date_adGroupId_term_key" ON "google_ads_search_term_days"("tenantId", "date", "adGroupId", "term");

-- CreateIndex
CREATE INDEX "mkt_ad_days_tenantId_platform_level_date_idx" ON "mkt_ad_days"("tenantId", "platform", "level", "date");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_ad_days_tenantId_platform_level_entityId_date_key" ON "mkt_ad_days"("tenantId", "platform", "level", "entityId", "date");

-- CreateIndex
CREATE INDEX "mkt_ad_breakdown_days_tenantId_platform_dimension_date_idx" ON "mkt_ad_breakdown_days"("tenantId", "platform", "dimension", "date");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_ad_breakdown_days_tenantId_platform_date_campaignId_dim_key" ON "mkt_ad_breakdown_days"("tenantId", "platform", "date", "campaignId", "dimension", "key");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_social_profile_days_tenantId_network_profileId_date_key" ON "mkt_social_profile_days"("tenantId", "network", "profileId", "date");

-- CreateIndex
CREATE INDEX "mkt_social_posts_tenantId_publishedAt_idx" ON "mkt_social_posts"("tenantId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_social_posts_tenantId_network_postId_key" ON "mkt_social_posts"("tenantId", "network", "postId");

-- CreateIndex
CREATE INDEX "mkt_seo_days_tenantId_kind_date_idx" ON "mkt_seo_days"("tenantId", "kind", "date");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_seo_days_tenantId_date_kind_key_key" ON "mkt_seo_days"("tenantId", "date", "kind", "key");

-- CreateIndex
CREATE INDEX "mkt_editorial_items_tenantId_plannedAt_idx" ON "mkt_editorial_items"("tenantId", "plannedAt");

