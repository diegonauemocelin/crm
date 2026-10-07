-- AlterTable
ALTER TABLE "capture_forms" ADD COLUMN     "brandIds" UUID[],
ADD COLUMN     "customerTypeId" UUID;

-- AlterTable
ALTER TABLE "capture_popups" ADD COLUMN     "brandIds" UUID[],
ADD COLUMN     "customerTypeId" UUID,
ADD COLUMN     "ownerId" UUID;
