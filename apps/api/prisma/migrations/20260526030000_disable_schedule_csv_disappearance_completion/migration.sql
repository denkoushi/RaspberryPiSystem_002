-- 生産日程CSV差分消失はキオスク完了正本から外す。
-- 手動完了は ProductionScheduleProgress 側のためここでは触らない。
UPDATE "ProductionScheduleExternalCompletion"
SET
  "externallyCompletedFromFkojunstDisappeared" = FALSE,
  "externallyCompletedFromScheduleCsvDisappeared" = FALSE,
  "isExternallyCompleted" = COALESCE("externallyCompletedFromFkojunstMailStatus", FALSE),
  "updatedAt" = NOW()
WHERE
  "externallyCompletedFromFkojunstDisappeared" = TRUE
  OR "externallyCompletedFromScheduleCsvDisappeared" = TRUE
  OR "isExternallyCompleted" <> COALESCE("externallyCompletedFromFkojunstMailStatus", FALSE);
