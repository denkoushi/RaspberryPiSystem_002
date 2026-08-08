---
title: Pi5単一SSD・業務ファイル保存Runbook
status: active
scope: local durable storage health, integrity backfill, capacity, and recovery
last_verified: 2026-07-31
source_of_truth: docs/runbooks/pi5-local-file-storage.md
related_docs:
  - ../decisions/ADR-20260731-single-ssd-durable-file-storage.md
  - ../plans/pi5-api-image-local-storage-scalability-execplan.md
  - ../guides/operation-manual.md
---

# Pi5単一SSD・業務ファイル保存Runbook

このRunbookは、Pi5の `/opt/RaspberryPiSystem_002/storage` に保存するPDF・JPEG・
CSV等の状態確認と、異常時の初動を扱う。integrity catalogは破損検知用であり、
バックアップではない。異常時に元ファイルやcatalogを推測で上書きしない。

## 正常確認

```bash
curl -ksS https://127.0.0.1/api/system/health | jq '.checks.fileStorage'
df -h /opt/RaspberryPiSystem_002/storage
df -i /opt/RaspberryPiSystem_002/storage
sudo jq . /opt/RaspberryPiSystem_002/storage/.integrity/v1/state.json
```

正常なbackfill完了状態は `status: "complete"`、`mismatchCount: 0`、
`lastErrorCode: null` である。`pending` または `running` は段階登録中で、
API healthはwarningになる。新規保存はbackfill中でも必ずcatalog付きで行われる。

API healthはホストパス、保存キー、ファイル名を外部へ返さない。詳細調査はPi5上の
ログで行う。

```bash
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml \
  logs --since 1h api | grep -E 'File storage|FILE_STORAGE_'
```

## 状態の意味

- `capacity-warning`: 使用率70%以上。増加傾向とDocker cacheを確認する。
- `capacity-high`: 使用率80%以上。新規大容量取込を避け、原因を特定する。
- `capacity-critical`: 使用率90%以上。API healthはerrorになる。
- `capacity-exhausted`: 5GiBまたは全体5%の予約領域を割るため、業務保存をHTTP
  507で拒否している。
- `integrity-backfill`: 既存ファイルの段階登録中。
- `integrity-failed`: 不一致、catalog破損、読取り失敗等でbackfillが停止した。
- `unavailable`: mount、権限、I/O、`statfs`、限定書込みprobeのいずれかに失敗した。

## 整合性エラーの初動

1. そのファイルを再アップロード、自動修復、削除しない。
2. APIログのrequest ID、`FILE_STORAGE_INTEGRITY_MISMATCH`、発生時刻を記録する。
3. `state.json` と対象namespaceの読取り可否を確認する。外部へファイル名を貼らない。
4. 元ファイル、該当catalog、APIログを別の安全な調査場所へ読取り専用で保全する。
5. 正しい内容を業務記録またはバックアップから確定できるまで復旧操作を行わない。

backfillの `failed` は自動的に再走査しない。権限や媒体異常を解消しても、catalog
状態を手編集してはならない。原因、正しい原本、復旧対象を確定し、forward fix
または承認済みの復旧手順で再開する。

## 容量不足の初動

```bash
df -h /opt/RaspberryPiSystem_002/storage
docker system df
docker builder du
systemctl status storage-maintenance.timer
journalctl -u storage-maintenance.service -n 100 --no-pager
```

月初1日だけ実行する `docker builder prune -a --force` は、未使用のbuild cacheを
対象とする。手動で `docker system prune`、volume prune、業務保存ディレクトリの
削除を行わない。月次処理後のログには `docker system df` が記録される。

容量原因が業務ファイルの場合は、保持期限と復旧可能性を業務責任者と確認する。
このRunbookだけを根拠にPDF、JPEG、CSV、DB、稼働imageを削除しない。

## mountまたは利用不能

本番APIは全永続namespaceと `.integrity` の限定書込みprobeに失敗すると起動しない。
次を読取り専用で確認する。

```bash
findmnt /opt/RaspberryPiSystem_002/storage
ls -ld /opt/RaspberryPiSystem_002/storage \
  /opt/RaspberryPiSystem_002/storage/.integrity
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml \
  config
```

所有者、mount、SSD状態に異常がある場合は、原因を直してから標準Ansible
routeで再検証する。container内へ一時保存して運用を継続しない。

## rolloutとrollback

production rolloutはexact main SHA、成功CI、標準
`scripts/update-all-clients.sh` のread-only planを提示して承認を得てから行う。
反映後はhealth、既存ファイル配信、backfill進捗、元ファイルの件数・内容・mtimeが
変わっていないことを確認する。

rollbackでは以前のAPIへ戻す。旧APIは `.integrity` sidecarを無視するため、
sidecarや業務ファイルを削除・移動しない。DB migrationはない。

将来SSDを追加する場合は、停止・バックアップ・照合を伴う別計画で、UUID固定の
mountを同じ `/opt/RaspberryPiSystem_002/storage` へ切り替える。アプリのURLや
保存キーは変更しない。
