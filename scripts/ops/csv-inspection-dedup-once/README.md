# 加工機_日常点検結果の重複を1回で片付ける（2026-10）

`加工機_日常点検結果`（`7d193f27-52f2-4c5f-be96-071a7208ac4a`）は 2/11〜10/20 に APPEND で取り込まれ、同じ約200行の CSV が10分ごとに丸ごと追加された。
10/21 からは DEDUP になり増えていないが、約226万行のうち必要な行は約3.8万キー分だけ残っている（KB `api.md` CSV ダッシュボード項目8）。
夜間ジョブで毎晩少しずつ消す方法は Pi5 の I/O を飽和させたため（10/24 05:20 の停止）、ここでは一度だけ、計画した時間に、休みを挟みながら片付ける。

業務の表で変えるのは、このダッシュボードの「各キーで最新以外の行」の削除と、残った行への `dataHash` の書き込みだけ。他のダッシュボードの行は触らない。取り込みは止めずに作業でき、作業開始（02 の cutoff）より後に入った行は対象外。

## 実行

Pi5 上で、ファイルを置いたディレクトリから流す。長くかかる 03〜05 は `nohup` で切り離し、ログを見て進める。

```bash
psqlf() { docker exec -i docker-db-1 psql -U postgres -d borrow_return -X "$@"; }
psqlf < 01_check.sql                                   # 読み取りのみ。referencing_rows=0、mismatched=0、fk_count=9 を確認
psqlf < 02_prepare.sql                                 # 消す行の ID を作業表へ（数分）。最後に表の autovacuum を止める
psqlf < 03_delete.sql                                  # 試しの1回。ms と wal_mb を見る
nohup ./03_run.sh > dedup-03.log 2>&1 &                # done まで1回ずつ繰り返す
nohup sh -c 'docker exec -i docker-db-1 psql -U postgres -d borrow_return -X < 04_finish.sql && docker exec -i docker-db-1 psql -U postgres -d borrow_return -X < 05_reindex.sql' > dedup-04-05.log 2>&1 &
```

- 03 は 5000 行ごとに COMMIT し、かかった時間と同じだけ休む（`pause_ratio`）。1回（削除と休み）は `stmt_timeout`（90秒）で打ち切られ、その回は ROLLBACK される。1回が `max_batch_ms`（20秒）を超えたときも止まる。
- 止まっても、もう一度流せば続きから再開する。`03_run: done` が出たら 04 へ進む。
- 作業表は通常の表なので、DB が落ちても進み具合は残る。
- 03 の間は表の autovacuum を止めておき、04 で1回だけ VACUUM して戻す。VACUUM は末尾の切り詰めをしない（表全体を止める鍵を取らない）。
- 05 は索引を1本ずつ `REINDEX CONCURRENTLY` で作り直す（表は止めない）。

## 止めるとき

- 03: 同じディレクトリに `STOP` というファイルを置くと、その回の後で止まる。急ぐときは `pg_cancel_backend(<pid>)` でよい（その回は ROLLBACK され、済んだ回は残る）。再開は同じコマンド。
- 03 の後で今日はやめる、または 04 まで進まずに終えるときは、必ず autovacuum を戻す（止めたままだと表全体の掃除が止まる）:
  `ALTER TABLE "CsvDashboardRow" RESET (autovacuum_enabled);`
  `SELECT reloptions FROM pg_class WHERE oid = '"CsvDashboardRow"'::regclass;` が空であることを確かめる。
- 05: 途中で止めると `*_ccnew` / `*_ccold` という無効な索引が残ることがある。05 はそれが残っていると始めずに一覧を出すので、`DROP INDEX CONCURRENTLY` で消してから、済んでいない索引の行だけ流し直す。

## 止める目安

- 03 の1回が 20 秒を超える、または API のヘルスチェックが落ちる、キオスクで 502 が出る。
- `iostat` などで I/O 待ちが続けて 50% を超える。

## 戻し方

消した行は同じ CSV の重複なので、戻す必要は無い想定。どうしても戻す場合は、作業前夜の外部バックアップ（夜間スナップショット）から復元する。作業前に、その夜のスナップショットが成功していることを確かめておく。
