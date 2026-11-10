---
title: Pi5標準Ansible診断Runbook
status: historical
scope: standard Ansible Pi5 API and Web release diagnosis
last_verified: 2026-08-08
source_of_truth: docs/runbooks/deploy-status-recovery.md
superseded_by: docs/runbooks/deploy-status-recovery.md
related_docs:
  - ../../guides/deployment.md
  - ../../runbooks/deploy-status-recovery.md
  - ../../architecture/deployment-modules.md
---

# Pi5標準Ansible診断Runbook

> 2026-11 にアーカイブした。現行の状態確認・復旧は [デプロイ停止・復旧Runbook](../../runbooks/deploy-status-recovery.md) を正本とする。

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

現行の手順は [Pi5単一SSD・業務ファイル保存Runbook](../../runbooks/pi5-local-file-storage.md#pi5-docker旧リリースイメージ整理) を参照する。

## 失敗時の切り分け

1. CI、対象SHA、inventory、`--print-plan`の対象hostを確認する。
2. `--status RUN_ID` とsystemd journalから、Ansible playまたは `release_pi5` taskの最初の失敗を確認する。
3. 原因修正後、同じcanonical entrypointで新しいread-only planを作る。

SSH先でのcheckout、個別container操作、直接Ansible playbook実行、DBのdown migration、旧deploy scriptの実行で成功状態を作らない。実機に対する追加操作は別途明示承認が必要である。

## Database

database rollbackは行わない。migrationの安全性と適用確認は `release_pi5` roleが所有し、失敗時はroleのrollback手順に従う。
