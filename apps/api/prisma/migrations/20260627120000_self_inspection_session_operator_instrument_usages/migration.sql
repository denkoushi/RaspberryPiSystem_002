-- Session-level NFC operator and per-JST-day measuring instrument usage history.

ALTER TABLE "SelfInspectionSession"
  ADD COLUMN "operatorEmployeeId" TEXT,
  ADD COLUMN "operatorEmployeeNameSnapshot" TEXT,
  ADD COLUMN "operatorEmployeeTagUidSnapshot" TEXT,
  ADD COLUMN "operatorRegisteredAt" TIMESTAMP(3);

CREATE TABLE "SelfInspectionInstrumentUsage" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "inspectionDateJst" VARCHAR(10) NOT NULL,
  "measuringInstrumentId" TEXT,
  "loanId" TEXT,
  "registeredByEmployeeId" TEXT,
  "registeredByEmployeeNameSnapshot" TEXT,
  "measuringInstrumentManagementNumberSnapshot" TEXT NOT NULL,
  "measuringInstrumentNameSnapshot" TEXT NOT NULL,
  "measuringInstrumentTagUidSnapshot" TEXT,
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SelfInspectionInstrumentUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SelfInspectionSession_idx_operator_employee"
  ON "SelfInspectionSession"("operatorEmployeeId");

CREATE INDEX "SelfInspectionInstrumentUsage_idx_session_date"
  ON "SelfInspectionInstrumentUsage"("sessionId", "inspectionDateJst");

CREATE INDEX "SelfInspectionInstrumentUsage_idx_instrument"
  ON "SelfInspectionInstrumentUsage"("measuringInstrumentId");

CREATE INDEX "SelfInspectionInstrumentUsage_idx_loan"
  ON "SelfInspectionInstrumentUsage"("loanId");

CREATE INDEX "SelfInspectionInstrumentUsage_idx_registered_by"
  ON "SelfInspectionInstrumentUsage"("registeredByEmployeeId");

CREATE INDEX "SelfInspectionInstrumentUsage_idx_cancelled_at"
  ON "SelfInspectionInstrumentUsage"("cancelledAt");

CREATE UNIQUE INDEX "SelfInspectionInstrumentUsage_unique_active_session_date_instrument"
  ON "SelfInspectionInstrumentUsage"("sessionId", "inspectionDateJst", "measuringInstrumentId")
  WHERE "cancelledAt" IS NULL AND "measuringInstrumentId" IS NOT NULL;

ALTER TABLE "SelfInspectionSession"
  ADD CONSTRAINT "SelfInspectionSession_operatorEmployeeId_fkey"
  FOREIGN KEY ("operatorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInstrumentUsage"
  ADD CONSTRAINT "SelfInspectionInstrumentUsage_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "SelfInspectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInstrumentUsage"
  ADD CONSTRAINT "SelfInspectionInstrumentUsage_measuringInstrumentId_fkey"
  FOREIGN KEY ("measuringInstrumentId") REFERENCES "MeasuringInstrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInstrumentUsage"
  ADD CONSTRAINT "SelfInspectionInstrumentUsage_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SelfInspectionInstrumentUsage"
  ADD CONSTRAINT "SelfInspectionInstrumentUsage_registeredByEmployeeId_fkey"
  FOREIGN KEY ("registeredByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH first_operator AS (
  SELECT DISTINCT ON (e."sessionId")
    e."sessionId",
    e."createdByEmployeeId",
    e."createdByEmployeeNameSnapshot",
    emp."nfcTagUid",
    e."createdAt"
  FROM "SelfInspectionLotEntry" e
  LEFT JOIN "Employee" emp ON emp."id" = e."createdByEmployeeId"
  WHERE e."createdByEmployeeId" IS NOT NULL
  ORDER BY e."sessionId", e."createdAt" ASC, e."entryIndex" ASC
)
UPDATE "SelfInspectionSession" s
SET
  "operatorEmployeeId" = fo."createdByEmployeeId",
  "operatorEmployeeNameSnapshot" = fo."createdByEmployeeNameSnapshot",
  "operatorEmployeeTagUidSnapshot" = fo."nfcTagUid",
  "operatorRegisteredAt" = fo."createdAt"
FROM first_operator fo
WHERE s."id" = fo."sessionId"
  AND s."operatorEmployeeId" IS NULL;

INSERT INTO "SelfInspectionInstrumentUsage" (
  "id",
  "sessionId",
  "inspectionDateJst",
  "measuringInstrumentId",
  "registeredByEmployeeId",
  "registeredByEmployeeNameSnapshot",
  "measuringInstrumentManagementNumberSnapshot",
  "measuringInstrumentNameSnapshot",
  "measuringInstrumentTagUidSnapshot",
  "registeredAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  src."sessionId",
  src."inspectionDateJst",
  src."measuringInstrumentId",
  src."createdByEmployeeId",
  src."createdByEmployeeNameSnapshot",
  src."measuringInstrumentManagementNumberSnapshot",
  src."measuringInstrumentNameSnapshot",
  src."measuringInstrumentTagUidSnapshot",
  src."registeredAt",
  src."registeredAt",
  src."registeredAt"
FROM (
  SELECT DISTINCT ON (
    e."sessionId",
    to_char(e."createdAt" AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'),
    e."measuringInstrumentId"
  )
    e."sessionId",
    to_char(e."createdAt" AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS "inspectionDateJst",
    e."measuringInstrumentId",
    e."createdByEmployeeId",
    e."createdByEmployeeNameSnapshot",
    COALESCE(e."measuringInstrumentManagementNumberSnapshot", mi."managementNumber") AS "measuringInstrumentManagementNumberSnapshot",
    COALESCE(e."measuringInstrumentNameSnapshot", mi."name") AS "measuringInstrumentNameSnapshot",
    e."measuringInstrumentTagUidSnapshot",
    e."createdAt" AS "registeredAt"
  FROM "SelfInspectionLotEntry" e
  LEFT JOIN "MeasuringInstrument" mi ON mi."id" = e."measuringInstrumentId"
  WHERE e."measuringInstrumentId" IS NOT NULL
    AND COALESCE(e."measuringInstrumentManagementNumberSnapshot", mi."managementNumber") IS NOT NULL
    AND COALESCE(e."measuringInstrumentNameSnapshot", mi."name") IS NOT NULL
  ORDER BY
    e."sessionId",
    to_char(e."createdAt" AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'),
    e."measuringInstrumentId",
    e."createdAt" ASC,
    e."entryIndex" ASC
) src
ON CONFLICT DO NOTHING;
