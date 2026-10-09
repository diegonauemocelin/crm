-- AlterTable
ALTER TABLE "capture_whatsapps" ADD COLUMN     "requireEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireName" BOOLEAN NOT NULL DEFAULT true;

