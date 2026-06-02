-- SAMPLE → FIXED_COUNT（前マイグレーションで enum 値が commit 済みであること）
UPDATE "PartMeasurementTemplate"
SET
  "selfInspectionMode" = 'FIXED_COUNT',
  "selfInspectionFixedCount" = "selfInspectionSampleSize"
WHERE "selfInspectionMode" = 'SAMPLE';
