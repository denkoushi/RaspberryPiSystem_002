---
id: deploy-status-recovery
title: デプロイ停止・復旧Runbook
status: active
last_verified: 2026-07-16
---

# デプロイ停止・復旧Runbook

このRunbookは、標準オーケストレーターのrunが停止、失敗、または長時間進まない場合に使う。復旧の正本はrun state、fleet state、systemd unitであり、手作業で状態を作り替えない。

## 1. 状態を確認する

```bash
scripts/update-all-clients.sh --status RUN_ID
```

確認項目:

- runのphaseと `success|failed|cancelled|interrupted`
- hostごとのdesired/current SHA、evidence、対象理由
- 実行中または失敗したhost
- rollback結果とmaintenance状態

statusが進行中なら、同じinventoryへ別runを重ねない。

## 2. 安全に中止する

停止が必要なら、理由付きの協調cancelを要求する。

```bash
scripts/update-all-clients.sh --cancel RUN_ID --reason "中止理由"
scripts/update-all-clients.sh --status RUN_ID
```

オーケストレーターはphase境界でcancelを検知し、必要なmanifest rollbackと状態記録を行う。cancel後も `--status` でterminal stateまで確認する。

## 3. 再開判断

失敗またはinterruptedのhostは `unknown` へ落ち、次の標準planに必ず含まれる。原因を修正し、対象SHAのCI成功を確認してからread-only planを出す。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan
```

planの対象理由を確認し、inventory単位の明示承認後に新しいrunとして実行する。前runのprocessへattachしたり、途中phaseだけを手で再開したりしない。

## 4. 復旧できたことを確認する

新しいrunの完了後、次を確認する。

- 全対象hostが `verified`
- Pi5のimage/config/migration digestが一致
- Kiosk bundle ACKまたはSignage repo SHAが目標SHAと一致
- 必須serviceと認証済みendpointが正常
- maintenance表示の残留なし
- 同一SHAの標準planがno-op

## 禁止事項

次は行わない。

- coordinatorやremote unitのprocessを強制終了する
- lockファイルを削除する
- `logs/deploy/fleet-release-state.json` やrun stateを手編集する
- SSH先でfetch/checkoutして辻褄を合わせる
- 個別のAnsible playbookや内部deploy scriptを直接実行する
- databaseをdown migrationする
- maintenance状態を手で成功扱いへ変更する

lockはkernelがprocess終了・再起動時に解放する。残って見える通常ファイルはlockの所有を意味しないため削除しない。

## 読み取り専用の追加確認

原因調査では、status出力、CI log、systemd journal、serviceのactive状態、認証済みhealth endpointを読み取る。変更操作が必要になった場合は、原因、対象inventory、実行内容を整理し、新しい明示承認を得る。

Pi5本体の故障・停電は単体構成の対象外である。ハードウェア復旧後もfleet evidenceは自動的に信用せず、`unknown` として標準ワークフローで再検証する。

通常手順は [デプロイメントガイド](../guides/deployment.md)、Pi5固有の診断観点は [Pi5 Blue/Green Runbook](./pi5-blue-green-deploy.md) を参照する。
