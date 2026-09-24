-- Keep each existing schedule row ID and its relations while changing only its
-- DEDUP hash. Abort before any update if the new identity is ambiguous.
BEGIN;

CREATE TEMP TABLE unassigned_order_hashes ON COMMIT DROP AS
SELECT
  "id",
  encode(sha256(convert_to(concat_ws('|',
    lower(btrim("rowData"->>'FSEIBAN')),
    lower(btrim("rowData"->>'FHINCD')),
    lower(btrim("rowData"->>'FSIGENCD')),
    lower(btrim("rowData"->>'FKOJUN')),
    lower(btrim("rowData"->>'ProductNo'))
  ), 'UTF8')), 'hex') AS next_hash
FROM "CsvDashboardRow"
WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  AND btrim(coalesce("rowData"->>'FSEIBAN', '')) = '********';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CsvDashboardRow" AS r
    INNER JOIN unassigned_order_hashes AS h ON h."id" = r."id"
    WHERE nullif(btrim(coalesce(r."rowData"->>'FHINCD', '')), '') IS NULL
       OR nullif(btrim(coalesce(r."rowData"->>'FSIGENCD', '')), '') IS NULL
       OR nullif(btrim(coalesce(r."rowData"->>'FKOJUN', '')), '') IS NULL
       OR nullif(btrim(coalesce(r."rowData"->>'ProductNo', '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Unassigned production schedule key has a missing field';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unassigned_order_hashes GROUP BY next_hash HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate unassigned production schedule order identity';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unassigned_order_hashes AS h
    INNER JOIN "CsvDashboardRow" AS r
      ON r."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
     AND r."dataHash" = h.next_hash
     AND r."id" <> h."id"
  ) THEN
    RAISE EXCEPTION 'Unassigned production schedule hash collides with an existing row';
  END IF;
END $$;

UPDATE "CsvDashboardRow" AS r
SET "dataHash" = h.next_hash
FROM unassigned_order_hashes AS h
WHERE r."id" = h."id" AND r."dataHash" IS DISTINCT FROM h.next_hash;

COMMIT;
