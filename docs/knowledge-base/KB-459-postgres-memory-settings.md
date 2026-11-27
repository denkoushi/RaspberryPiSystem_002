---
title: "KB-459: Pi5 の Postgres が入れたときのメモリ設定のままで、並べ替えがディスクにあふれていた"
tags: [PostgreSQL, Pi5, 性能, 設定]
audience: [開発者, 運用者]
last-verified: 2026-11-28
related: [KB-452, KB-458]
category: knowledge-base
---

# KB-459: Pi5 の Postgres のメモリ設定を見直す

- Status: 設定を変更(このKBと同じ PR)。本番の db の作り直しは別の作業
- Date: 2026-11-28
- Data: 本番 DB の読み取りのみ(`statement_timeout` 付き)

## 見つけたこと

- Pi5 はメモリ 8GB、空きは約 4.4GB。
- Postgres は入れたときの設定のままだった: `shared_buffers=128MB`、`work_mem=4MB`。
- 並べ替えなどの途中結果がディスクにあふれた量は、統計を取り始めてから累計 79,785 回・268,522,993,450 バイト(2026-11-28 08:21 JST)。1回あたり平均約 3.4MB。
- DB は約 4GB。最大の表は `CsvDashboardRow`(2.6GB)。

## 変えたこと

`infrastructure/docker/docker-compose.server.yml` の `db` の `command` に次を足した。

- `shared_buffers=1GB`
- `work_mem=16MB`(1回あたり平均 3.4MB のあふれは、大半がこれで収まる見込み。反映後に測って確かめる)
- `log_temp_files=10MB`(10MB を超えてあふれた問い合わせだけを DB のログに残す。0 にするとログがあふれる)

`docker-compose.replication-primary.yml` は `command` を丸ごと置き換えるので、同じ3つを書いた。片方だけ変えると、複製を有効にしたときに設定が元に戻る。

`shm_size: 512mb` は変えない。`shared_buffers` は `/dev/shm` から取らない。

## 本番に効かせる方法(標準の反映とは別)

標準の反映(`release_pi5`)は `docker-compose.phase3.yml` だけを使い、`db` を作り直さない。マージと反映だけでは本番の DB は古い設定のまま動き続ける。

1. 前日の同じ時刻と比べて、1日あたりのあふれ(`pg_stat_database` の `temp_files`、`temp_bytes`)を記録する。
2. 業務の外の時間に、Pi5 の `/opt/RaspberryPiSystem_002` で `db` だけを作り直す。再起動の数十秒、キオスクと API は DB につながらない。

   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml up -d --no-deps --wait db
   ```

3. 確かめる: `SHOW shared_buffers; SHOW work_mem;`、API の health、Pi5 の空きメモリ(2GB 以上残るか)、翌日の1日あたりのあふれ。

元に戻すときは、この PR を戻してから、2 をもう一度行う。

## 注意

- 2 を行うまでは、ほかの手順で `db` を `up` すると(例: `scripts/server/pi5-replication.sh apply`)、予定外の時間に新しい設定で再起動する。
