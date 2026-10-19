CREATE TABLE "CsvDashboardRawRevision" (
    "csvDashboardId" TEXT NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsvDashboardRawRevision_pkey" PRIMARY KEY ("csvDashboardId")
);

INSERT INTO "CsvDashboardRawRevision" ("csvDashboardId", "revision", "updatedAt")
SELECT 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e', 0, CURRENT_TIMESTAMP
ON CONFLICT ("csvDashboardId") DO NOTHING;

CREATE OR REPLACE FUNCTION "bump_fkojunst_status_mail_raw_revision"()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "CsvDashboardRawRevision" ("csvDashboardId", "revision", "updatedAt")
  VALUES ('b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e', 1, CURRENT_TIMESTAMP)
  ON CONFLICT ("csvDashboardId") DO UPDATE
  SET "revision" = "CsvDashboardRawRevision"."revision" + 1,
      "updatedAt" = CURRENT_TIMESTAMP;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_row_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Bump for every mail raw row, including PROCESSING/FAILED source rows.
  -- This is conservative by design: an uncommitted row insert can race with
  -- a publication update and must invalidate after its own commit as well.
  IF EXISTS (
    SELECT 1
    FROM new_rows r
    WHERE r."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
  ) THEN
    PERFORM "bump_fkojunst_status_mail_raw_revision"();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_row_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM new_rows r
    WHERE r."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
  ) OR EXISTS (
    SELECT 1
    FROM old_rows r
    WHERE r."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
  ) THEN
    PERFORM "bump_fkojunst_status_mail_raw_revision"();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_row_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM old_rows r
    WHERE r."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
  ) THEN
    PERFORM "bump_fkojunst_status_mail_raw_revision"();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_run_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM new_runs r
    WHERE r."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
      AND r."status" = 'COMPLETED'::"ImportStatus"
      AND r."completedAt" IS NOT NULL
  ) THEN
    PERFORM "bump_fkojunst_status_mail_raw_revision"();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_run_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM new_runs n
    JOIN old_runs o ON o."id" = n."id"
    WHERE (
      n."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
      OR o."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
    )
      AND (
        n."csvDashboardId" IS DISTINCT FROM o."csvDashboardId"
        OR n."status" IS DISTINCT FROM o."status"
        OR n."completedAt" IS DISTINCT FROM o."completedAt"
      )
      AND (
        (
          n."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
          AND n."status" = 'COMPLETED'::"ImportStatus"
          AND n."completedAt" IS NOT NULL
        )
        OR (
          o."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
          AND o."status" = 'COMPLETED'::"ImportStatus"
          AND o."completedAt" IS NOT NULL
        )
      )
  ) THEN
    PERFORM "bump_fkojunst_status_mail_raw_revision"();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_truncate"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "bump_fkojunst_status_mail_raw_revision"();
  RETURN NULL;
END;
$$;

CREATE TRIGGER "CsvDashboardRow_fkojunst_raw_revision_insert"
AFTER INSERT ON "CsvDashboardRow"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_row_insert"();

CREATE TRIGGER "CsvDashboardRow_fkojunst_raw_revision_update"
AFTER UPDATE ON "CsvDashboardRow"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_row_update"();

CREATE TRIGGER "CsvDashboardRow_fkojunst_raw_revision_delete"
AFTER DELETE ON "CsvDashboardRow"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_row_delete"();

CREATE TRIGGER "CsvDashboardIngestRun_fkojunst_raw_revision_insert"
AFTER INSERT ON "CsvDashboardIngestRun"
REFERENCING NEW TABLE AS new_runs
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_run_insert"();

CREATE TRIGGER "CsvDashboardIngestRun_fkojunst_raw_revision_update"
AFTER UPDATE ON "CsvDashboardIngestRun"
REFERENCING OLD TABLE AS old_runs NEW TABLE AS new_runs
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_run_update"();

CREATE TRIGGER "CsvDashboardRow_fkojunst_raw_revision_truncate"
AFTER TRUNCATE ON "CsvDashboardRow"
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_truncate"();

CREATE TRIGGER "CsvDashboardIngestRun_fkojunst_raw_revision_truncate"
AFTER TRUNCATE ON "CsvDashboardIngestRun"
FOR EACH STATEMENT
EXECUTE FUNCTION "bump_fkojunst_status_mail_raw_revision_on_truncate"();
