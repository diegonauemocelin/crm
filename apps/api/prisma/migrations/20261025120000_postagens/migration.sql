-- CreateTable
CREATE TABLE "social_media" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "width" INTEGER,
    "height" INTEGER,
    "size" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "accountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "networks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "format" TEXT NOT NULL DEFAULT 'FEED',
    "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "publicToken" TEXT NOT NULL,
    "results" JSONB,
    "error" TEXT,
    "reviewNote" TEXT,
    "createdById" UUID,
    "createdByName" TEXT,
    "updatedByName" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_media_tenantId_createdAt_idx" ON "social_media"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "social_posts_tenantId_scheduledAt_idx" ON "social_posts"("tenantId", "scheduledAt");

-- CreateIndex
CREATE INDEX "social_posts_status_scheduledAt_idx" ON "social_posts"("status", "scheduledAt");

