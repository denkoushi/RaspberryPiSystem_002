ALTER TABLE "Machine" DROP CONSTRAINT "Machine_siteKey_fkey";
DROP INDEX "Machine_siteKey_idx";
ALTER TABLE "Machine" DROP COLUMN "siteKey";
