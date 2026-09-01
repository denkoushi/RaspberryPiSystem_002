---
title: Pi5標準Ansible診断Runbook
status: active
scope: standard Ansible Pi5 API and Web release diagnosis
last_verified: 2026-08-08
source_of_truth: docs/runbooks/pi5-blue-green-deploy.md
related_docs:
  - ../guides/deployment.md
  - ./deploy-status-recovery.md
  - ../architecture/deployment-modules.md
---

# Pi5標準Ansible診断Runbook

このRunbookは、canonical standard Ansible routeのPi5結果を読み取り、失敗箇所を切り分けるために使う。デプロイの入口は `scripts/update-all-clients.sh` だけであり、Pi5専用の旧scriptや個別container操作は行わない。

## 標準状態確認

まず対象SHAとinventoryをread-onlyで確認する。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan --limit raspberrypi5
scripts/update-all-clients.sh --status RUN_ID --inventory infrastructure/ansible/inventory.yml
```

`--print-plan` は対象host、release SHA、Ansible playbook/tasksを表示するだけで、hostやruntimeを変更しない。実行結果は `deploy-release-standard.yml` のPi5 playと `release_pi5` roleのrecap、health、rollback結果で確認する。

## Pi5結果の確認

- `release_pi5` のprepare、switch、health、cleanupがrole内の順序で完了している。
- APIとWebのcanonical health確認が成功している。
- migration確認が成功し、Ansible recapのfailed/unreachableが0である。
- 対象SHAとroleへ渡されたimage identityが一致している。
- 失敗時はroleのrescue rollbackとrollback healthの結果を確認する。

`scripts/deploy/verify-phase12-real.sh` は共有application HTTP smoke用であり、Pi5のmigration、runtime discovery、log判定、rollback判定を重複実装しない。

## Pi5 Docker旧リリースイメージ整理

`storage-maintenance.timer` は毎日03:00に起動する。`storage-maintenance.sh` は、当月の完了マーカーが未完了の場合だけ、次の2つの非ブロッキングロックを取得して整理を実行する。

- fleetデプロイ共通ロック: `/opt/RaspberryPiSystem_002/logs/deploy/fleet-release-state.lock`
- イメージ整理ロック: `/var/lib/raspi-release/image-retention-maintenance.lock`

デプロイまたは別の整理が実行中なら、Docker変更も完了マーカー更新も行わず、翌日のタイマーで再試行する。保持状態が欠落・不正、plan/applyが失敗、または一部削除が未解決の場合は `storage-maintenance-failed` アラートを生成し、完了マーカーを古いまま残す。

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
  printf '2026-09\n' >"${MARKER_TMP}"
  chown root:root "${MARKER_TMP}"
  chmod 0644 "${MARKER_TMP}"
  mv -f -- "${MARKER_TMP}" "${MARKER_FILE}"
  MARKER_TMP=''
  trap - EXIT
}
run_retention_locked apply_and_mark
```

planはDocker一覧と保持状態のsealed snapshotを含む。planとapplyの間にデプロイ、状態ファイル変更、Dockerイメージ変更などがあればapplyは `snapshot_changed` として拒否し、削除せず完了マーカーも更新しない。ロック競合またはsealed snapshot拒否後は、古いplanを再利用せず、ロック取得後にplanから取り直す。

applyと9月完了マーカーの作成は同じ `run_retention_locked` サブシェル内で連続して実行する。applyが終了コード0で成功した場合だけ、完了マーカーをシェルのリダイレクトで直接上書きせず、同じディレクトリのroot所有一時ファイルから原子的に作成する。通常の自動経路では `docker-release-image-monthly.sh` がこの処理を行う。マーカーは `YYYY-MM` と改行1つだけ（9月は正確に `2026-09\n`）でなければならず、余分な行や改行欠落を作らない。apply失敗時はこの作成手順を実行せず、古いマーカーを残して翌日の自動再試行に任せる。

`docker system prune`、`docker image prune -a`、volume prune、BuildKit以外の一括prune、または業務保存ディレクトリの削除は禁止する。通常の月次処理は固定allowlistの完全なイメージIDだけを個別に扱う。

## 失敗時の切り分け

1. CI、対象SHA、inventory、`--print-plan`の対象hostを確認する。
2. `--status RUN_ID` とsystemd journalから、Ansible playまたは `release_pi5` taskの最初の失敗を確認する。
3. 原因修正後、同じcanonical entrypointで新しいread-only planを作る。

SSH先でのcheckout、個別container操作、直接Ansible playbook実行、DBのdown migration、旧deploy scriptの実行で成功状態を作らない。実機に対する追加操作は別途明示承認が必要である。

## Database

database rollbackは行わない。migrationの安全性と適用確認は `release_pi5` roleが所有し、失敗時はroleのrollback手順に従う。
