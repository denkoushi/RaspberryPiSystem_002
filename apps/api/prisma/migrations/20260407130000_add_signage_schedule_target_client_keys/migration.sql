-- AlterTable
ALTER TABLE "SignageSchedule" ADD COLUMN "targetClientKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
