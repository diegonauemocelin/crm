-- AlterTable
ALTER TABLE "mkt_social_posts" ADD COLUMN     "extra" JSONB,
ADD COLUMN     "profileId" TEXT;

-- AlterTable
ALTER TABLE "mkt_social_profile_days" ADD COLUMN     "accountsEngaged" INTEGER,
ADD COLUMN     "follows" INTEGER,
ADD COLUMN     "interactions" INTEGER,
ADD COLUMN     "linkTaps" INTEGER,
ADD COLUMN     "unfollows" INTEGER,
ADD COLUMN     "views" INTEGER;

-- CreateTable
CREATE TABLE "mkt_competitor_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT,
    "followers" INTEGER NOT NULL,
    "mediaCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkt_competitor_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_competitor_posts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "format" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "permalink" TEXT,
    "likes" INTEGER,
    "comments" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkt_competitor_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_competitor_notes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "storiesSeen" INTEGER,
    "adsActive" BOOLEAN,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mkt_competitor_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mkt_competitor_days_tenantId_username_date_key" ON "mkt_competitor_days"("tenantId", "username", "date");

-- CreateIndex
CREATE INDEX "mkt_competitor_posts_tenantId_username_publishedAt_idx" ON "mkt_competitor_posts"("tenantId", "username", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_competitor_posts_tenantId_username_postId_key" ON "mkt_competitor_posts"("tenantId", "username", "postId");

-- CreateIndex
CREATE INDEX "mkt_competitor_notes_tenantId_username_date_idx" ON "mkt_competitor_notes"("tenantId", "username", "date");

-- CreateIndex
CREATE INDEX "mkt_social_posts_tenantId_profileId_publishedAt_idx" ON "mkt_social_posts"("tenantId", "profileId", "publishedAt");
