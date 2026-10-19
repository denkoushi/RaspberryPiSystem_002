---
id: deploy-status-recovery
title: デプロイ停止・復旧Runbook
status: active
last_verified: 2026-08-18
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

torque cutoverではjournalの最終到達境界を確認する。`PREPARED`失敗は全serviceが変更前のままなので、候補清掃結果を確認してから新しいcanonical runで再試行できる。`QUIESCED`以降の失敗は、選択Pi4すべてでbrowser、agent、BluetoothがOFFであり、切替を試みたimageが捕捉済みprevious imageへ戻ったことを確認する。片側だけを手動再開しない。Pi5がhealthyなら対称性だけを理由に戻さず、exact main release-setを用いる次のcanonical runで復旧する。

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

## キオスクがメンテナンス中のまま

まず `--status RUN_ID` のjournal・recapでrun終了を確認する。実行中の表示は解除しない。
端末の有効な `x-client-key` で `GET /api/system/deploy-status` を読み、`isMaintenance`、`preNotice`、`runId`を確認する（キーをログへ出さない）。
Pi5の `<project>/config/deploy-status.json` の `kioskByClient[status_agent_client_id]` を読み取り、同じrun IDか照合する。
noticeは `noticeStartedAt`、preparing/deploying/failedは `startedAt` から30分を超えるとAPIが表示を解除する。時刻欠落・不正やverifyingには期限を適用しない。
早期解除が必要な場合、運用承認済みのPi5実行環境で、状態ファイル所有者（本番uid 1000）のユーザーとして次を実行する。

```bash
python3 <project>/scripts/deploy/deploy-status-state.py --file <project>/config/deploy-status.json remove-run --run-id <RUN>
```

このヘルパ経由の表示解除は可。状態ファイルやlock・run情報の手編集・直接削除は不可。
解除後、同じAPIで `isMaintenance: false` と `preNotice` 不在を確認し、次のポーリングで画面が戻ることを確認する。
これは表示の復旧だけであり、リリース成功を示さない。health/rollbackとrecapの結果は別に確認する。

## 禁止事項

- 個別container、gateway、serviceを操作して成功状態を作る
- SSH先でfetch/checkoutする
- databaseをdown migrationする
- 上記の表示解除ヘルパを除き、internal deploy scriptや個別Ansible playbookを直接実行する
- lock、run情報、migration台帳を手で編集または削除する
