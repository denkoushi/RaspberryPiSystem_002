-- Cutting piece sets (and their history markers) are keyed by the same five-element row
-- identity as the schedule rows: FSEIBAN, FHINCD, FSIGENCD, FKOJUN and ProductNo.
-- Existing sets take the ProductNo of the row that carried the four-column key before the
-- 20261125110000 rehash: the visible (not superseded) row with the highest numeric
-- ProductNo, then newest createdAt, then highest id (same pick as the board item key rewrite).
-- A set whose four-column key has no visible row keeps the empty ProductNo. No row has an
-- empty ProductNo, so such a set stays stored but attaches to no order.
BEGIN;

ALTER TABLE "ProductionScheduleSessakuPieceSet" ADD COLUMN "productNo" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductionScheduleSessakuPieceHistory" ADD COLUMN "productNo" TEXT NOT NULL DEFAULT '';

UPDATE "ProductionScheduleSessakuPieceSet" AS s
SET "productNo" = w."productNo"
FROM (
  SELECT DISTINCT ON (set_row."id") set_row."id", coalesce(r."rowData"->>'ProductNo', '') AS "productNo"
  FROM "ProductionScheduleSessakuPieceSet" AS set_row
  INNER JOIN "CsvDashboardRow" AS r
    ON r."csvDashboardId" = set_row."csvDashboardId"
   AND r."supersededAt" IS NULL
   AND coalesce(r."rowData"->>'FSEIBAN', '') = set_row."fseiban"
   AND coalesce(r."rowData"->>'FHINCD', '') = set_row."fhincd"
   AND coalesce(r."rowData"->>'FSIGENCD', '') = set_row."fsigencd"
   AND coalesce(r."rowData"->>'FKOJUN', '') = set_row."fkojun"
  ORDER BY set_row."id",
    CASE WHEN (r."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN ((r."rowData"->>'ProductNo'))::bigint ELSE -1 END DESC,
    r."createdAt" DESC, r."id" DESC
) AS w
WHERE s."id" = w."id";

UPDATE "ProductionScheduleSessakuPieceHistory" AS s
SET "productNo" = w."productNo"
FROM (
  SELECT DISTINCT ON (hist."id") hist."id", coalesce(r."rowData"->>'ProductNo', '') AS "productNo"
  FROM "ProductionScheduleSessakuPieceHistory" AS hist
  INNER JOIN "CsvDashboardRow" AS r
    ON r."csvDashboardId" = hist."csvDashboardId"
   AND r."supersededAt" IS NULL
   AND coalesce(r."rowData"->>'FSEIBAN', '') = hist."fseiban"
   AND coalesce(r."rowData"->>'FHINCD', '') = hist."fhincd"
   AND coalesce(r."rowData"->>'FSIGENCD', '') = hist."fsigencd"
   AND coalesce(r."rowData"->>'FKOJUN', '') = hist."fkojun"
  ORDER BY hist."id",
    CASE WHEN (r."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN ((r."rowData"->>'ProductNo'))::bigint ELSE -1 END DESC,
    r."createdAt" DESC, r."id" DESC
) AS w
WHERE s."id" = w."id";

ALTER TABLE "ProductionScheduleSessakuPieceSet" ALTER COLUMN "productNo" DROP DEFAULT;
ALTER TABLE "ProductionScheduleSessakuPieceHistory" ALTER COLUMN "productNo" DROP DEFAULT;

DROP INDEX "PSSPieceSet_logical_key";
CREATE UNIQUE INDEX "PSSPieceSet_logical_key" ON "ProductionScheduleSessakuPieceSet"("csvDashboardId", "fseiban", "fhincd", "fsigencd", "fkojun", "productNo");
DROP INDEX "PSSPieceHistory_logical_key";
CREATE UNIQUE INDEX "PSSPieceHistory_logical_key" ON "ProductionScheduleSessakuPieceHistory"("csvDashboardId", "fseiban", "fhincd", "fsigencd", "fkojun", "productNo");

COMMIT;
