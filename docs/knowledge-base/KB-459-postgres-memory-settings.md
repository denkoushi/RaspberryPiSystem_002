---
title: "KB-459: Pi5 の Postgres が入れたときのメモリ設定のままで、並べ替えがディスクにあふれていた"
tags: [PostgreSQL, Pi5, 性能, 設定]
audience: [開発者, 運用者]
last-verified: 2026-11-28
related: [KB-452, KB-458]
category: knowledge-base
---

# KB-459: Pi5 の Postgres のメモリ設定を見直す

- Status: 本番反映済み(2026-11-28 08:46 JST、db の止まった時間は約13秒)。効果の確認は翌日
- Date: 2026-11-28
- Data: 本番 DB の読み取りのみ(`statement_timeout` 付き)

## 見つけたこと

- Pi5 はメモリ 8GB、空きは約 4.4GB。
- Postgres は入れたときの設定のままだった: `shared_buffers=128MB`、`work_mem=4MB`。
- 並べ替えなどの途中結果がディスクにあふれた量は、統計を取り始めてから累計 79,785 回・268,522,993,450 バイト(2026-11-28 08:21 JST)。あふれたファイル1つあたり平均約 3.4MB(問い合わせ1回あたりではない)。統計は一度もリセットされていない(`stats_reset` が空)ので、DB を作ったときからの累計。
- DB は約 4GB。最大の表は `CsvDashboardRow`(2.6GB)。

## 変えたこと

`infrastructure/docker/docker-compose.server.yml` の `db` の `command` に次を足した。

- `shared_buffers=1GB`
- `work_mem=16MB`(ファイル1つあたり平均 3.4MB なので、大半は収まる見込み。ただし1つの問い合わせが複数のファイルを作ることがあるので、効果は反映後に測って確かめる)
- `log_temp_files=10MB`(10MB を超えるあふれだけを DB のログに残す。db のログには大きさの上限が無い(json-file、`max-size` なし)ので、0 や 1MB には下げない)

`docker-compose.replication-primary.yml` は `command` を丸ごと置き換えるので、同じ3つを書いた。片方だけ変えると、複製を有効にしたときに設定が元に戻る。

`shm_size: 512mb` は変えない。`shared_buffers` は `/dev/shm` から取らない。

## 本番に効かせる方法(標準の反映とは別)

標準の反映(`release_pi5`)は `docker-compose.phase3.yml` だけを使い、`db` を作り直さない。マージと反映だけでは本番の DB は古い設定のまま動き続ける。

1. 前日の同じ時刻と比べて、1日あたりのあふれ(`pg_stat_database` の `temp_files`、`temp_bytes`)を記録する。
2. 前に確かめる: Pi5 の checkout がこの PR を含むマージ後の SHA にあること(`git rev-parse HEAD`)、複製の印 `config/pi5-replication-primary` が無いこと(あれば複製用の重ね書きも使う手順に変える)。
3. 業務の外の時間に、Pi5 の `/opt/RaspberryPiSystem_002` で `db` だけを作り直す。再起動の数十秒、キオスクと API は DB につながらない。

   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml up -d --no-deps --pull never --wait --wait-timeout 120 db
   ```

4. 確かめる: `SHOW shared_buffers; SHOW work_mem; SHOW log_temp_files;`、API の health、Pi5 の空きメモリ(2GB 以上残るか)、翌日の1日あたりのあふれ。

元に戻すときは、この PR を戻してから、3 をもう一度行う。

急いで戻すときは、PR を戻す前に、一時ファイル(例: `/tmp/db-default.yml`)に次を書き、重ねて作り直す。`-c` の設定は `ALTER SYSTEM` より強いので、DB の中からは戻せない。

```yaml
services:
  db:
    command: [postgres]
```

```bash
docker compose -f infrastructure/docker/docker-compose.server.yml -f /tmp/db-default.yml up -d --no-deps --pull never --wait db
```

## 注意

- 3 を行うまでは、ほかの手順で `db` を `up` すると(例: `scripts/server/pi5-replication.sh apply`)、予定外の時間に新しい設定で再起動する。

## 本番の反映の記録(2026-11-28)

- PR のマージ前に、ユーザーの許可を得て、同じ `command` を一時ファイル `/tmp/db-mem.yml` で重ねて `db` だけを作り直した(Pi5 の checkout は `5022d3e5d`)。マージ後の compose と中身が同じなので、マージ後に作り直しは起きない。
- 作り直す前(08:45): 累計 79,978 回・269,228,062,506 バイト。08:21 からの24分で 193 回・約 705MB あふれていた。
- 作り直した後: `shared_buffers=1GB`、`work_mem=16MB`、`log_temp_files=10MB`。API の health は 200。止まっていた約13秒の間だけ、API に DB へつながらないエラーが出た。空きメモリは約 4.8GB。
- 翌日の同じ時刻に、1日あたりのあふれを前と比べる。

