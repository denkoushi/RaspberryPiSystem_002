BEGIN;

CREATE TABLE "ProductionSchedulePartNameLookup" (
    "partNumberKey" TEXT NOT NULL PRIMARY KEY,
    "partName" TEXT
);
CREATE TABLE "ProductionSchedulePartNameLookupState" (
    "id" INTEGER NOT NULL DEFAULT 1 PRIMARY KEY CHECK ("id" = 1),
    "builtAt" TIMESTAMP(3) NOT NULL
);

INSERT INTO "ProductionSchedulePartNameLookup" ("partNumberKey", "partName")
SELECT UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC))),
       MIN(NULLIF(TRIM("rowData"->>'FHINMEI'), ''))
FROM "CsvDashboardRow"
WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  AND UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC))) IS NOT NULL
GROUP BY UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC)));
INSERT INTO "ProductionSchedulePartNameLookupState" ("id", "builtAt") VALUES (1, CURRENT_TIMESTAMP);

COMMIT;
