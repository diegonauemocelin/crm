-- AlterTable
ALTER TABLE "users" ADD COLUMN     "trailDone" TEXT[] DEFAULT ARRAY[]::TEXT[];

