-- 作業表の ID を前から batch_size 件ずつ消す。1回ごとに COMMIT し、かかった時間 × pause_ratio だけ休む。
-- 途中で止めても、次に流すと続きから再開する（_ops_inspection_dedup_state.next_ord）。
-- statement_timeout はこの DO 全体にかかるので、通常は 03_run.sh から max_batches=1 で繰り返し呼ぶ。
-- 変数（-v で上書き可）:
--   max_batches      今回流す回数の上限（試しの1回は 1、本番は 100000 など）
--   batch_size       1回に消す件数
--   pause_ratio      休む時間 = 1回の時間 × この値
--   max_batch_ms     1回がこれより長くかかったら、その回で止める
--   stmt_timeout     この呼び出し全体（削除＋休み）の上限。超えるとその回は ROLLBACK される
\set ON_ERROR_STOP on
\set dashboard_id '7d193f27-52f2-4c5f-be96-071a7208ac4a'
\if :{?max_batches}
\else
  \set max_batches 1
\endif
\if :{?batch_size}
\else
  \set batch_size 5000
\endif
\if :{?pause_ratio}
\else
  \set pause_ratio 1
\endif
\if :{?max_batch_ms}
\else
  \set max_batch_ms 20000
\endif
\if :{?stmt_timeout}
\else
  \set stmt_timeout 90s
\endif

SET statement_timeout = :'stmt_timeout';
SET lock_timeout = '5s';
SELECT set_config('ops.dashboard_id', :'dashboard_id', false),
       set_config('ops.max_batches', :'max_batches', false),
       set_config('ops.batch_size', :'batch_size', false),
       set_config('ops.pause_ratio', :'pause_ratio', false),
       set_config('ops.max_batch_ms', :'max_batch_ms', false);

DO $$
DECLARE
  v_dashboard text := current_setting('ops.dashboard_id');
  v_max_batches int := current_setting('ops.max_batches')::int;
  v_batch bigint := current_setting('ops.batch_size')::bigint;
  v_ratio numeric := current_setting('ops.pause_ratio')::numeric;
  v_max_ms numeric := current_setting('ops.max_batch_ms')::numeric;
  v_last_ord bigint;
  v_next bigint;
  v_deleted bigint;
  v_started timestamptz;
  v_ms numeric;
  v_lsn pg_lsn;
  v_i int := 0;
BEGIN
  SELECT max(ord) INTO v_last_ord FROM "_ops_inspection_dedup_losers";
  LOOP
    SELECT next_ord INTO v_next FROM "_ops_inspection_dedup_state";
    IF v_next > v_last_ord THEN
      RAISE NOTICE 'done: next_ord=% last_ord=%', v_next, v_last_ord;
      EXIT;
    END IF;
    IF v_i >= v_max_batches THEN
      RAISE NOTICE 'stop: max_batches=% reached, next_ord=%', v_max_batches, v_next;
      EXIT;
    END IF;

    v_started := clock_timestamp();
    v_lsn := pg_current_wal_lsn();
    DELETE FROM "CsvDashboardRow" r
    USING "_ops_inspection_dedup_losers" l
    WHERE l.ord >= v_next AND l.ord < v_next + v_batch
      AND r.id = l.id
      AND r."csvDashboardId" = v_dashboard;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    UPDATE "_ops_inspection_dedup_state"
       SET next_ord = v_next + v_batch, deleted = deleted + v_deleted;
    COMMIT;

    v_i := v_i + 1;
    v_ms := extract(epoch FROM clock_timestamp() - v_started) * 1000;
    RAISE NOTICE 'batch=% ord=%..% deleted=% ms=% wal_mb=% at=%',
      v_i, v_next, v_next + v_batch - 1, v_deleted, round(v_ms),
      round(pg_wal_lsn_diff(pg_current_wal_lsn(), v_lsn) / 1048576.0, 1),
      to_char(clock_timestamp() AT TIME ZONE 'Asia/Tokyo', 'HH24:MI:SS');

    IF v_ms > v_max_ms THEN
      RAISE NOTICE 'stop: batch took % ms (> max_batch_ms=%), next_ord=%', round(v_ms), v_max_ms, v_next + v_batch;
      EXIT;
    END IF;
    PERFORM pg_sleep(least(30, v_ms * v_ratio / 1000.0));
  END LOOP;
END
$$;

SELECT s.next_ord, s.deleted, (SELECT count(*) FROM "_ops_inspection_dedup_losers") AS losers_total,
       (SELECT reloptions FROM pg_class WHERE oid = '"CsvDashboardRow"'::regclass) AS reloptions
FROM "_ops_inspection_dedup_state" s;
