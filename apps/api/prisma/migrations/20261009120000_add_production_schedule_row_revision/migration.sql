INSERT INTO "CsvDashboardRawRevision" ("csvDashboardId", "revision", "updatedAt")
SELECT '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01', 0, CURRENT_TIMESTAMP
ON CONFLICT ("csvDashboardId") DO NOTHING;

CREATE OR REPLACE FUNCTION "bump_production_schedule_raw_revision"()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "CsvDashboardRawRevision" ("csvDashboardId", "revision", "updatedAt")
  VALUES ('3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01', 1, CURRENT_TIMESTAMP)
  ON CONFLICT ("csvDashboardId") DO UPDATE
  SET "revision" = "CsvDashboardRawRevision"."revision" + 1,
      "updatedAt" = CURRENT_TIMESTAMP;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_production_schedule_raw_revision_on_row_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM new_rows r
    WHERE r."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  ) THEN
    PERFORM "bump_production_schedule_raw_revision"();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_production_schedule_raw_revision_on_row_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM new_rows r
    WHERE r."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  ) OR EXISTS (
    SELECT 1
    FROM old_rows r
    WHERE r."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  ) THEN
    PERFORM "bump_production_schedule_raw_revision"();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_production_schedule_raw_revision_on_row_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM old_rows r
    WHERE r."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  ) THEN
    PERFORM "bump_production_schedule_raw_revision"();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_production_schedule_raw_revision_on_truncate"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "bump_production_schedule_raw_revision"();
  RETURN NULL;
END;
$$;

CREATE TRIGGER "CsvDashboardRow_production_schedule_raw_revision_insert"
AFTER INSERT ON "CsvDashboardRow"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_production_schedule_raw_revision_on_row_insert"();

CREATE TRIGGER "CsvDashboardRow_production_schedule_raw_revision_update"
AFTER UPDATE ON "CsvDashboardRow"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_production_schedule_raw_revision_on_row_update"();

CREATE TRIGGER "CsvDashboardRow_production_schedule_raw_revision_delete"
AFTER DELETE ON "CsvDashboardRow"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_production_schedule_raw_revision_on_row_delete"();

CREATE TRIGGER "CsvDashboardRow_production_schedule_raw_revision_truncate"
AFTER TRUNCATE ON "CsvDashboardRow"
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_production_schedule_raw_revision_on_truncate"();
