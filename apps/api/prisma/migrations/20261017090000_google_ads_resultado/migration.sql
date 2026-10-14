-- AlterTable
ALTER TABLE "google_ads_conversions" ADD COLUMN     "googleCheckedAt" TIMESTAMP(3),
ADD COLUMN     "googleDetail" TEXT,
ADD COLUMN     "googleStatus" TEXT;

