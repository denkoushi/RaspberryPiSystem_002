-- CreateTable
CREATE TABLE "MeasuringInstrumentGenre" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrlPrimary" TEXT,
    "imageUrlSecondary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasuringInstrumentGenre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeasuringInstrumentGenre_name_key" ON "MeasuringInstrumentGenre"("name");

-- AlterTable
ALTER TABLE "MeasuringInstrument" ADD COLUMN "genreId" TEXT;

-- AlterTable
ALTER TABLE "InspectionItem" ADD COLUMN "genreId" TEXT;

-- Backfill genre master (one genre per existing instrument)
INSERT INTO "MeasuringInstrumentGenre" ("id", "name", "createdAt", "updatedAt")
SELECT
    mi."id",
    mi."name" || ' (' || mi."managementNumber" || ')',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "MeasuringInstrument" mi;

-- Link instruments and inspection items to the backfilled genre
UPDATE "MeasuringInstrument" SET "genreId" = "id" WHERE "genreId" IS NULL;
UPDATE "InspectionItem" SET "genreId" = "measuringInstrumentId" WHERE "genreId" IS NULL;

-- Drop old relation/indexes before replacing ownership key
ALTER TABLE "InspectionItem" DROP CONSTRAINT "InspectionItem_measuringInstrumentId_fkey";
DROP INDEX IF EXISTS "InspectionItem_measuringInstrumentId_idx";
DROP INDEX IF EXISTS "InspectionItem_measuringInstrumentId_name_key";

-- New relation/indexes for genre-scoped inspection items
ALTER TABLE "InspectionItem" ALTER COLUMN "genreId" SET NOT NULL;
CREATE INDEX "InspectionItem_genreId_idx" ON "InspectionItem"("genreId");
CREATE UNIQUE INDEX "InspectionItem_genreId_name_key" ON "InspectionItem"("genreId", "name");
ALTER TABLE "InspectionItem" ADD CONSTRAINT "InspectionItem_genreId_fkey"
FOREIGN KEY ("genreId") REFERENCES "MeasuringInstrumentGenre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Remove old ownership column
ALTER TABLE "InspectionItem" DROP COLUMN "measuringInstrumentId";

-- Genre relation on instruments
CREATE INDEX "MeasuringInstrument_genreId_idx" ON "MeasuringInstrument"("genreId");
ALTER TABLE "MeasuringInstrument" ADD CONSTRAINT "MeasuringInstrument_genreId_fkey"
FOREIGN KEY ("genreId") REFERENCES "MeasuringInstrumentGenre"("id") ON DELETE SET NULL ON UPDATE CASCADE;
