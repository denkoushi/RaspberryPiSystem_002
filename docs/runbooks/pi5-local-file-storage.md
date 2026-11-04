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
for c in bluegreen-api-blue-1 bluegreen-api-green-1; do docker logs --since 1h "$c" 2>&1; done | grep -E 'File storage|FILE_STORAGE_'
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

## Pi5 Docker旧リリースイメージ整理

`storage-maintenance.timer` は毎日03:00に起動する。`storage-maintenance.sh` は、当日（JST）の完了マーカーが未完了の場合だけ、次の2つの非ブロッキングロックを取得して整理を実行する。2026-09まで整理は月1回だったが、1リリース約3.4GB・1日約21GBの増加で月末前にSSDが84%まで埋まったため、2026-10から毎日に変えた。旧形式 `YYYY-MM` のマーカーも有効で、切り替え直後に1回整理が走る。

- fleetデプロイ共通ロック: `/opt/RaspberryPiSystem_002/logs/deploy/fleet-release-state.lock`
- イメージ整理ロック: `/var/lib/raspi-release/image-retention-maintenance.lock`

デプロイまたは別の整理が実行中なら、Docker変更も完了マーカー更新も行わず、翌日のタイマーで再試行する。保持状態が欠落・不正、plan/applyが失敗、または一部削除が未解決の場合は `storage-maintenance-failed` アラートを生成し、完了マーカーを古いまま残す。

Dockerコマンドは1回300秒で打ち切る。2026-10-22は03:00のClamAV検査の開始と重なり、`docker image ls --all`（約575件）が当時の上限60秒を超えて `"error":"Docker image list failed"` で止まり、誤アラートになった。平常時は約14秒で終わる。この種の失敗は完了マーカーが進まないため翌日自動で再試行される。出力は `journalctl -u storage-maintenance.service` に出る（`/var/log/storage-maintenance.log` は使っていない）。

整理対象のallowlistは固定されている。対象はAPIリポジトリ（`ghcr.io/denkoushi/raspisys-api`、旧ローカル `raspi-system-api` / `docker-api`）、Webリポジトリ（`ghcr.io/denkoushi/raspisys-web`、旧ローカル `raspi-system-web` / `docker-web`）、および `ghcr.io/denkoushi/raspisys-release-set` の未使用イメージだけである。現行・直前版、稼働コンテナが参照するイメージ、24時間未満のイメージは保持する。DB、gateway、Postgres、Pi3、BuildKit内部、volume、業務ファイルは対象外である。

手動確認でも、planとapplyの各操作ごとにfleetデプロイ共通ロックとイメージ整理ロックを非ブロッキング取得する。root shellで次を実行し、どちらかのロックが使用中なら終了コード75で中断する。

```bash
set -euo pipefail
FLEET_LOCK=/opt/RaspberryPiSystem_002/logs/deploy/fleet-release-state.lock
MAINTENANCE_LOCK=/var/lib/raspi-release/image-retention-maintenance.lock
STATE_FILE=/var/lib/raspi-release/image-retention.json
PLAN_FILE=/var/lib/raspi-release/image-retention-plan.json

run_retention_locked() {
  (
    exec 9>>"${FLEET_LOCK}"
    flock -n 9 || { echo 'fleet deploy lock is busy' >&2; exit 75; }
    exec 8>>"${MAINTENANCE_LOCK}"
    flock -n 8 || { echo 'image retention lock is busy' >&2; exit 75; }
    "$@"
  )
}

run_retention_locked python3 scripts/server/docker-release-image-maintenance.py plan \
  --state-file "${STATE_FILE}" \
  --output "${PLAN_FILE}" \
  --minimum-age-hours 24
MARKER_FILE=/var/lib/raspi-release/image-retention.last-success
MARKER_TMP=''
apply_and_mark() {
  python3 scripts/server/docker-release-image-maintenance.py apply \
    --state-file "${STATE_FILE}" \
    --plan "${PLAN_FILE}"
  MARKER_TMP="$(mktemp /var/lib/raspi-release/.image-retention.last-success.tmp.XXXXXX)"
  trap 'rm -f -- "${MARKER_TMP}"' EXIT
  TZ=Asia/Tokyo date +%Y-%m-%d >"${MARKER_TMP}"
  chown root:root "${MARKER_TMP}"
  chmod 0644 "${MARKER_TMP}"
  mv -f -- "${MARKER_TMP}" "${MARKER_FILE}"
  MARKER_TMP=''
  trap - EXIT
}
run_retention_locked apply_and_mark
```

planはDocker一覧と保持状態のsealed snapshotを含む。planとapplyの間にデプロイ、状態ファイル変更、Dockerイメージ変更などがあればapplyは `snapshot_changed` として拒否し、削除せず完了マーカーも更新しない。ロック競合またはsealed snapshot拒否後は、古いplanを再利用せず、ロック取得後にplanから取り直す。

applyと当日の完了マーカーの作成は同じ `run_retention_locked` サブシェル内で連続して実行する。applyが終了コード0で成功した場合だけ、完了マーカーをシェルのリダイレクトで直接上書きせず、同じディレクトリのroot所有一時ファイルから原子的に作成する。通常の自動経路では `docker-release-image-monthly.sh` がこの処理を行う。マーカーは `YYYY-MM-DD`（旧形式 `YYYY-MM` も可）と改行1つだけでなければならず、余分な行や改行欠落を作らない。apply失敗時はこの作成手順を実行せず、古いマーカーを残して翌日の自動再試行に任せる。

`docker system prune`、`docker image prune -a`、volume prune、BuildKit以外の一括prune、または業務保存ディレクトリの削除は禁止する。通常の日次処理は固定allowlistの完全なイメージIDだけを個別に扱う。

## mountまたは利用不能

本番APIは全永続namespaceと `.integrity` の限定書込みprobeに失敗すると起動しない。
次を読取り専用で確認する。

```bash
findmnt /opt/RaspberryPiSystem_002/storage
ls -ld /opt/RaspberryPiSystem_002/storage \
  /opt/RaspberryPiSystem_002/storage/.integrity
docker ps -a --filter label=com.docker.compose.project=bluegreen --format '{{.Names}}' \
  | grep -E '^bluegreen-api-(blue|green)-' \
  | xargs -r docker inspect --format '{{.Name}} {{json .Mounts}}'
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
