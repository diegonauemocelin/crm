-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "userIds" UUID[] DEFAULT ARRAY[]::UUID[];

