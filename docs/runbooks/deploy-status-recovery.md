---
id: deploy-status-recovery
title: デプロイ停止・復旧Runbook
status: active
last_verified: 2026-08-08
---

# デプロイ停止・復旧Runbook

このRunbookは、canonical standard Ansible routeの実行が停止、失敗、または長時間進まない場合に使う。入口は `scripts/update-all-clients.sh`、実行経路は `standard-ansible-release.py` → `deploy-release-standard.yml` → profile roleで固定する。

## 1. 状態を確認する

```bash
scripts/update-all-clients.sh --status RUN_ID --inventory infrastructure/ansible/inventory.yml
```

次を読み取り専用で確認する。

- systemd unitの終了状態とjournalの最初の失敗
- 対象SHA、inventory、対象host
- `deploy-release-standard.yml` のplay順序と実行role
- `release_pi5`、`release_kiosk`、`release_signage` のhealth/rollback結果
- Ansible recapのfailed/unreachable

実行中のrunへ別のmutationを重ねない。既存runの終了結果を確認してから次を判断する。

## 2. 失敗後の再実行

原因を修正し、対象SHAのCI成功を確認したうえでread-only planを作る。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan
```

planの対象hostとroleを確認し、明示承認後にcanonical entrypointから新しいrunを開始する。途中taskだけの再開、個別hostへの直接Ansible、SSH先のcheckoutは行わない。

## 3. 復旧できたことを確認する

- 全対象roleが正常終了し、failed/unreachableが0である。
- Pi5は `release_pi5` のmigration、API/Web health、rollback結果が整合している。
- Pi4は `release_kiosk` のenabled agent healthとservice確認が成功している。
- Pi3は `release_signage` のartifact SHA、atomic activation、service healthが成功している。
- 共有application smokeが必要な場合だけ `scripts/deploy/verify-phase12-real.sh` を実行する。

## 禁止事項

- 個別container、gateway、serviceを操作して成功状態を作る
- SSH先でfetch/checkoutする
- databaseをdown migrationする
- internal deploy scriptや個別Ansible playbookを直接実行する
- lock、run情報、migration台帳を手で編集または削除する
