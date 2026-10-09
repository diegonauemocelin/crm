-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "adsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "adsFirstAt" TIMESTAMP(3),
ADD COLUMN     "adsFirstCampaign" TEXT,
ADD COLUMN     "adsFirstCampaignId" TEXT,
ADD COLUMN     "adsLastAt" TIMESTAMP(3),
ADD COLUMN     "adsLastCampaign" TEXT,
ADD COLUMN     "adsLastCampaignId" TEXT;

-- AlterTable
ALTER TABLE "service_records" ADD COLUMN     "adsCampaign" TEXT,
ADD COLUMN     "adsCampaignId" TEXT,
ADD COLUMN     "adsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "adsTouchAt" TIMESTAMP(3),
ADD COLUMN     "adsVia" TEXT;

