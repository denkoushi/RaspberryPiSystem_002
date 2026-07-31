---
id: ADR-20260731-single-ssd-durable-file-storage
title: Keep business files on one Pi5 SSD behind a durable storage port
status: accepted
date: 2026-07-31
source_of_truth: true
scope: Pi5 local business-file writes, integrity metadata, capacity safety, and backfill
related_code:
  - apps/api/src/services/file-storage
  - infrastructure/docker/docker-compose.server.yml
  - scripts/server/storage-maintenance.sh
related_docs:
  - ../plans/pi5-api-image-local-storage-scalability-execplan.md
  - ../runbooks/pi5-local-file-storage.md
validation: filesystem fault tests, storage route integrations, disposable PostgreSQL, Compose contracts, and hosted CI
open_items:
  - hosted CI and PR integration
  - separately approved Pi5 rollout and production backfill evidence
---

# ADR-20260731: Keep business files on one Pi5 SSD behind a durable storage port

## Context

PDF、JPEG、図面、組立画像、測定器画像、パレット画像、CSV原本は、すでに
Pi5の `/opt/RaspberryPiSystem_002/storage` 以下へ永続化されている。現在は
1,541ファイル、約163MBで、約917GBのSSDには約685GBの空きがあるため、
直近の問題は総容量ではない。

一方、各機能が個別に直接書込みを行っており、書込み途中の停止、内容破損、
容量枯渇を一貫して検出する境界がなかった。クラウド、S3互換ストレージ、
MinIO、2台目SSDは当面導入しない。単一SSD内の整合性対策は、別媒体へ戻せる
バックアップや災害復旧の代替にはならない。

## Decision

API内に `DurableFileStorePort` を置き、ローカル実装
`LocalDurableFileStore` を唯一の業務ファイル書込み境界にする。既存helperと
HTTP URLは維持し、内部だけをこの境界へ委譲する。標準ルートは
`FILE_STORAGE_ROOT=/app/storage`、ホスト側は従来どおり
`/opt/RaspberryPiSystem_002/storage` とする。旧環境変数は同じルートを表す
互換aliasとして検証し、矛盾した本番設定では起動しない。

永続ファイルは、保存先と同じディレクトリの排他的な一時ファイルへ書き、
ファイルを `fsync`、読戻しSHA-256を照合した後にrenameし、親ディレクトリも
`fsync`する。作成と置換を明示し、写真とサムネイルなど複数ファイルは全件を
準備してから確定する。絶対パス、NUL、空要素、`.`、`..`、バックスラッシュ、
シンボリックリンクによる脱出を拒否する。

SHA-256、サイズ、保存キー、作成・更新日時、形式versionは
`.integrity/v1` の非公開sidecarへ原子的に保存する。既存ファイルはscheduler
leaderだけが1回最大2GiB、同時実行1で段階登録する。standbyとdeploy
candidateは実行しない。中断はcursorから再開し、既知の不一致または読取り
失敗は記録して停止する。全件完了かつ不一致ゼロの後は、カタログ欠落も
整合性エラーにする。元ファイルの内容、パス、mtimeは変更しない。

起動時は全永続namespaceとcatalog mountで限定的な作成、flush、読戻し、
SHA-256照合、削除を行い、`statfs`も確認する。永続保存前には5GiBまたは
ファイルシステム全体の5%の大きい方を残す。容量不足はHTTP 507
`FILE_STORAGE_CAPACITY_EXHAUSTED`、利用不能はHTTP 503
`FILE_STORAGE_UNAVAILABLE`、不一致はHTTP 503
`FILE_STORAGE_INTEGRITY_MISMATCH`とする。ヘルスAPIは状態と限定理由だけを返し、
ホストパスやファイル名を返さない。

`pdf-pages`、signage render、図面派生画像は再生成可能なcacheとし、同じ
原子的writerを使うがintegrity catalogには登録しない。サムネイルの公開URLは
変えず、CaddyからAPIへ内部転送して読取り時のSHA-256照合を迂回させない。

月初の `docker builder prune -a --force` はDocker build cacheだけを対象として
維持する。業務ファイル、DB、稼働中コンテナ、稼働イメージを自動削除する処理は
追加しない。

## Consequences

各業務機能は保存媒体や整合性実装から疎結合になり、将来SSDを追加する場合も
UUID固定で同じホストパスへmountすればAPI変更なしで移行できる。sidecarは旧API
から無視されるため、コードrollbackで業務ファイルの移動や削除は不要である。

書込みと読取りにはhash計算と追加I/Oが発生し、Caddy静的配信だった
サムネイルもAPIを通る。現在のファイル量とPi5の容量では安全性を優先できる
範囲だが、production rolloutでレイテンシとbackfillを観測する。

この決定はバックアップ完成を意味しない。SSD自体の故障、盗難、火災、誤削除に
対する別媒体への復旧は別計画で扱う。S3、MinIO、クラウド、追加SSD、既存
ファイルの物理移行、DB migrationは今回含めない。

## Alternatives considered

クラウドまたはS3互換ストレージは、当面導入しないという運用方針のため見送った。
2台目SSDは未調達であり、同一筐体内の追加だけでは災害復旧も完成しない。
各helperの個別改善は重複と挙動差を残すため採用しなかった。整合性catalogを
PostgreSQLへ置く案は、無関係なdomainをDB schemaへ結合し、将来のmount移行を
複雑にするため採用しなかった。
