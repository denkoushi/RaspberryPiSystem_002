-- 自主検査アイテムの不可逆な論理無効化を追加する。
-- 既存セッション・測定・承認・紙帳票・監査行は更新も削除もしない。

CREATE TYPE "SelfInspectionItemInvalidationState" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'REVIEW_PENDING',
  'COMPLETED',
  'APPROVED'
);

ALTER TABLE "SelfInspectionSession"
  ADD COLUMN "invalidatedAt" TIMESTAMP(3);

CREATE TABLE "SelfInspectionItemInvalidation" (
    "id" TEXT NOT NULL,
    "itemBusinessKey" TEXT NOT NULL,
    "requestId" VARCHAR(120) NOT NULL,
    "sessionId" TEXT,
    "scheduleRowId" TEXT NOT NULL,
    "sourceState" "SelfInspectionItemInvalidationState" NOT NULL,
    "templateIdSnapshot" TEXT,
    "productNoSnapshot" TEXT NOT NULL,
    "processGroupSnapshot" "PartMeasurementProcessGroup" NOT NULL,
    "resourceCdSnapshot" TEXT NOT NULL,
    "fseibanSnapshot" TEXT,
    "fhincdSnapshot" TEXT NOT NULL,
    "fhinmeiSnapshot" TEXT NOT NULL,
    "machineNameSnapshot" TEXT,
    "plannedQuantitySnapshot" INTEGER,
    "expectedEntryCountSnapshot" INTEGER,
    "reason" TEXT NOT NULL,
    "invalidatedByUsernameSnapshot" TEXT,
    "invalidatedByClientDeviceId" TEXT,
    "invalidatedByClientDeviceNameSnapshot" TEXT,
    "invalidatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionItemInvalidation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SelfInspectionItemInvalidation_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "SelfInspectionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SelfInspectionItemInvalidation_invalidatedByClientDeviceId_fkey"
      FOREIGN KEY ("invalidatedByClientDeviceId") REFERENCES "ClientDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SelfInspectionItemInvalidation_reason_not_blank"
      CHECK (char_length(btrim("reason")) BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX "SelfInspectionItemInvalidation_itemBusinessKey_key"
  ON "SelfInspectionItemInvalidation"("itemBusinessKey");
CREATE UNIQUE INDEX "SelfInspectionItemInvalidation_requestId_key"
  ON "SelfInspectionItemInvalidation"("requestId");
CREATE UNIQUE INDEX "SelfInspectionItemInvalidation_sessionId_key"
  ON "SelfInspectionItemInvalidation"("sessionId");
CREATE INDEX "SelfInspectionItemInvalidation_idx_invalidated"
  ON "SelfInspectionItemInvalidation"("invalidatedAt");
CREATE INDEX "SelfInspectionItemInvalidation_idx_schedule_time"
  ON "SelfInspectionItemInvalidation"("scheduleRowId", "invalidatedAt");
CREATE INDEX "SelfInspectionItemInvalidation_idx_client_time"
  ON "SelfInspectionItemInvalidation"("invalidatedByClientDeviceId", "invalidatedAt");
CREATE INDEX "SelfInspectionSession_idx_invalidation_updated"
  ON "SelfInspectionSession"("invalidatedAt", "updatedAt");
