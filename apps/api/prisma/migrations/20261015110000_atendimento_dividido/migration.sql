-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "assignedUserId" UUID,
ADD COLUMN     "sectorId" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "sectors" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "splitAttendance" BOOLEAN NOT NULL DEFAULT false;

