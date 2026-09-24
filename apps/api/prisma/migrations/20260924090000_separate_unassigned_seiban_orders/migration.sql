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

-- Board row IDs also gain ProductNo. Keep existing per-site overrides attached
-- to the order that owned the former four-column key.
CREATE TEMP TABLE unassigned_board_item_keys ON COMMIT DROP AS
SELECT
  serialized."id",
  'row:' || rtrim(translate(replace(encode(convert_to(serialized.legacy_json, 'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=') AS legacy_item_key,
  'row:' || rtrim(translate(replace(encode(convert_to(
    left(serialized.legacy_json, length(serialized.legacy_json) - 1) || ',' || to_json(serialized.product_no)::text || ']',
    'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=') AS next_item_key
FROM (
  SELECT
    "id",
    "rowData"->>'ProductNo' AS product_no,
    '[' || to_json(coalesce("rowData"->>'FSEIBAN', ''))::text
        || ',' || to_json(coalesce("rowData"->>'FHINCD', ''))::text
        || ',' || to_json(coalesce("rowData"->>'FSIGENCD', ''))::text
        || ',' || to_json(coalesce("rowData"->>'FKOJUN', ''))::text || ']' AS legacy_json
  FROM "CsvDashboardRow"
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
    AND btrim(coalesce("rowData"->>'FSEIBAN', '')) = '********'
) AS serialized;

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

  IF EXISTS (
    SELECT 1 FROM unassigned_board_item_keys GROUP BY legacy_item_key HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Ambiguous legacy unassigned planning board item key';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ProductionScheduleGrindingPlanningBoardOverride" AS old_override
    INNER JOIN unassigned_board_item_keys AS k ON k.legacy_item_key = old_override."itemKey"
    INNER JOIN "ProductionScheduleGrindingPlanningBoardOverride" AS new_override
      ON new_override."csvDashboardId" = old_override."csvDashboardId"
     AND new_override."siteKey" = old_override."siteKey"
     AND new_override."itemKey" = k.next_item_key
     AND new_override."id" <> old_override."id"
    WHERE old_override."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  ) THEN
    RAISE EXCEPTION 'Unassigned planning board override key collides with an existing override';
  END IF;
END $$;

UPDATE "CsvDashboardRow" AS r
SET "dataHash" = h.next_hash
FROM unassigned_order_hashes AS h
WHERE r."id" = h."id" AND r."dataHash" IS DISTINCT FROM h.next_hash;

UPDATE "ProductionScheduleGrindingPlanningBoardOverride" AS o
SET "itemKey" = k.next_item_key
FROM unassigned_board_item_keys AS k
WHERE o."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  AND o."itemKey" = k.legacy_item_key
  AND o."itemKey" IS DISTINCT FROM k.next_item_key;

COMMIT;
