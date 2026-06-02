-- 自主検査 4モード: enum / カラム追加のみ（同一トランザクションで新 enum 値を UPDATE に使わない）
CREATE TYPE "SelfInspectionEntrySlotKind" AS ENUM ('SINGLE', 'FIRST', 'LAST', 'FIXED');

ALTER TYPE "SelfInspectionMode" ADD VALUE IF NOT EXISTS 'SINGLE';
ALTER TYPE "SelfInspectionMode" ADD VALUE IF NOT EXISTS 'FIRST_LAST';
ALTER TYPE "SelfInspectionMode" ADD VALUE IF NOT EXISTS 'FIXED_COUNT';

ALTER TABLE "PartMeasurementTemplate" ADD COLUMN IF NOT EXISTS "selfInspectionFixedCount" INTEGER;

ALTER TABLE "SelfInspectionLotEntry" ADD COLUMN IF NOT EXISTS "entrySlotKind" "SelfInspectionEntrySlotKind" NOT NULL DEFAULT 'FIXED';
