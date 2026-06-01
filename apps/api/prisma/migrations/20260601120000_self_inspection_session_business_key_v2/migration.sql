-- 自主検査セッションの業務キーから templateId を除外し、日程行単位で一意化する。
-- 旧形式: productNo::processGroup::resourceCd::templateId::scheduleRowId
-- 新形式: productNo::processGroup::resourceCd::scheduleRowId
--
-- 改版不具合で同一日程行に templateId だけ異なるセッションが複数ある場合は、
-- 移行前に勝者を 1 件に絞り、空の重複は削除・エントリは非衝突分のみ移す。
-- 移行後も重複セッションにエントリが残る場合は例外で止め、手動統合を促す。

CREATE TEMP TABLE si_session_new_key AS
SELECT
  s.id,
  CASE
    WHEN array_length(string_to_array(s."sessionBusinessKey", '::'), 1) = 5 THEN
      CONCAT(
        BTRIM(split_part(s."sessionBusinessKey", '::', 1)),
        '::',
        BTRIM(split_part(s."sessionBusinessKey", '::', 2)),
        '::',
        BTRIM(split_part(s."sessionBusinessKey", '::', 3)),
        '::',
        COALESCE(
          NULLIF(BTRIM(s."scheduleRowId"), ''),
          BTRIM(split_part(s."sessionBusinessKey", '::', 5))
        )
      )
    WHEN s."scheduleRowId" IS NOT NULL AND BTRIM(s."scheduleRowId") <> '' THEN
      CONCAT(
        BTRIM(s."productNo"),
        '::',
        s."processGroup"::text,
        '::',
        BTRIM(s."resourceCd"),
        '::',
        BTRIM(s."scheduleRowId")
      )
    ELSE
      s."sessionBusinessKey"
  END AS new_key,
  s."completedAt",
  s."updatedAt",
  s."createdAt",
  (
    SELECT COUNT(*)::int
    FROM "SelfInspectionLotEntry" e
    WHERE e."sessionId" = s.id
  ) AS entry_count
FROM "SelfInspectionSession" s;

CREATE TEMP TABLE si_session_winner AS
SELECT DISTINCT ON (nk.new_key)
  nk.new_key,
  nk.id AS winner_id
FROM si_session_new_key nk
ORDER BY
  nk.new_key,
  nk.entry_count DESC,
  CASE WHEN nk."completedAt" IS NULL THEN 0 ELSE 1 END,
  nk."updatedAt" DESC,
  nk."createdAt" ASC;

-- 1) エントリ 0 件の重複セッションを削除
DELETE FROM "SelfInspectionSession" s
USING si_session_new_key nk
JOIN si_session_winner w ON w.new_key = nk.new_key
WHERE s.id = nk.id
  AND s.id <> w.winner_id
  AND nk.entry_count = 0;

-- 2) templateId が異なり測定値を持つ重複は自動統合しない（敗者の templateItemId が勝者テンプレと不一致になるため）
DO $$
DECLARE
  template_mismatch_count integer;
BEGIN
  SELECT COUNT(*)::integer
  INTO template_mismatch_count
  FROM si_session_new_key nk
  JOIN si_session_winner w ON w.new_key = nk.new_key
  JOIN "SelfInspectionSession" loser ON loser.id = nk.id
  JOIN "SelfInspectionSession" winner ON winner.id = w.winner_id
  WHERE nk.id <> w.winner_id
    AND loser."templateId" IS DISTINCT FROM winner."templateId"
    AND EXISTS (
      SELECT 1
      FROM "SelfInspectionLotEntry" e
      INNER JOIN "SelfInspectionMeasurementValue" v ON v."entryId" = e.id
      WHERE e."sessionId" = loser.id
    );

  IF template_mismatch_count > 0 THEN
    RAISE EXCEPTION
      'SelfInspectionSession business key migration blocked: % duplicate session(s) have measurement values under a different templateId than the winner. Merge or delete losers manually. List with: SELECT nk.new_key, loser.id AS loser_session_id, winner.id AS winner_session_id, loser."templateId", winner."templateId" FROM si_session_new_key nk JOIN si_session_winner w ON w.new_key = nk.new_key JOIN "SelfInspectionSession" loser ON loser.id = nk.id JOIN "SelfInspectionSession" winner ON winner.id = w.winner_id WHERE nk.id <> w.winner_id AND loser."templateId" IS DISTINCT FROM winner."templateId" AND EXISTS (SELECT 1 FROM "SelfInspectionLotEntry" e INNER JOIN "SelfInspectionMeasurementValue" v ON v."entryId" = e.id WHERE e."sessionId" = loser.id);',
      template_mismatch_count;
  END IF;
END $$;

-- 3) 重複セッションのエントリを、同一 templateId かつ勝者側 entryIndex が空いている分だけ移す
UPDATE "SelfInspectionLotEntry" e
SET "sessionId" = w.winner_id
FROM si_session_new_key nk
JOIN si_session_winner w ON w.new_key = nk.new_key
JOIN "SelfInspectionSession" loser ON loser.id = nk.id
JOIN "SelfInspectionSession" winner ON winner.id = w.winner_id
WHERE e."sessionId" = nk.id
  AND nk.id <> w.winner_id
  AND loser."templateId" = winner."templateId"
  AND NOT EXISTS (
    SELECT 1
    FROM "SelfInspectionLotEntry" existing
    WHERE existing."sessionId" = w.winner_id
      AND existing."entryIndex" = e."entryIndex"
  );

-- 4) まだエントリを持つ重複が残る = 同一 entryIndex で統合不能 → 手動対応
DO $$
DECLARE
  unresolved_count integer;
BEGIN
  SELECT COUNT(*)::integer
  INTO unresolved_count
  FROM si_session_new_key nk
  JOIN si_session_winner w ON w.new_key = nk.new_key
  WHERE nk.id <> w.winner_id
    AND EXISTS (
      SELECT 1
      FROM "SelfInspectionLotEntry" e
      WHERE e."sessionId" = nk.id
    );

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'SelfInspectionSession business key migration blocked: % duplicate session(s) still have lot entries that could not be merged (conflicting entryIndex). List with: SELECT nk.new_key, nk.id AS session_id, nk.entry_count FROM si_session_new_key nk JOIN si_session_winner w ON w.new_key = nk.new_key WHERE nk.id <> w.winner_id AND EXISTS (SELECT 1 FROM "SelfInspectionLotEntry" e WHERE e."sessionId" = nk.id);',
      unresolved_count;
  END IF;
END $$;

-- 5) 残った重複セッション（エントリなし）を削除
DELETE FROM "SelfInspectionSession" s
USING si_session_new_key nk
JOIN si_session_winner w ON w.new_key = nk.new_key
WHERE s.id = nk.id
  AND s.id <> w.winner_id;

-- 6) 業務キーを新形式へ更新
UPDATE "SelfInspectionSession" s
SET "sessionBusinessKey" = nk.new_key
FROM si_session_new_key nk
WHERE s.id = nk.id
  AND s."sessionBusinessKey" IS DISTINCT FROM nk.new_key;

DROP TABLE IF EXISTS si_session_winner;
DROP TABLE IF EXISTS si_session_new_key;
