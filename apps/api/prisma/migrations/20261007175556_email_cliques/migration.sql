-- CreateTable
CREATE TABLE "email_clicks" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "linkIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_clicks_campaignId_linkIndex_idx" ON "email_clicks"("campaignId", "linkIndex");

-- AddForeignKey
ALTER TABLE "email_clicks" ADD CONSTRAINT "email_clicks_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "email_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
