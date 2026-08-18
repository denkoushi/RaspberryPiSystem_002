---
id: quick-start-deployment
title: デプロイ・クイックスタート
status: active
last_verified: 2026-07-16
---

# デプロイ・クイックスタート

通常更新の入口は `scripts/update-all-clients.sh` だけである。最初にread-only planを確認する。

```bash
git status --short
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan
```

対象SHAの `ci-required`、`codeql`、`gitleaks` が成功し、plan後に選択host、profile、roleとAnsibleの`list-hosts`／`list-tasks`を確認した後、明示したscopeで実行する。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit PATTERN
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --full-fleet
```

通常実行は完了まで待つ。非同期実行では返されたrunIdを使う。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit PATTERN --detach
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --full-fleet --detach
scripts/update-all-clients.sh --status RUN_ID
```

`--status RUN_ID`で標準Ansibleの結果を確認し、失敗時は[デプロイ停止・復旧Runbook](../runbooks/deploy-status-recovery.md)に従う。

トルクレンチ所有権のAPI/Webと既設2端末を同時に切り替える場合だけ、対象を固定した専用モードを使う。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --torque-cutover --print-plan --limit 'raspberrypi5:raspi4-kensaku-stonebase01:raspi4-assembly-01'
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --torque-cutover --limit 'raspberrypi5:raspi4-kensaku-stonebase01:raspi4-assembly-01' --detach
```

今回の実行ではこの明示limitの2台だけをOFFにしてからPi5を更新し、検証済みtorque-agentだけを停止状態で配置する。両台の成功後だけagentとbrowserを再開し、NFC/barcodeは現在の稼働versionを維持する。`--torque-cutover`自体はホスト名を固定せず、明示選択された全Pi4に完全なtorque inventoryを要求するため、未設定端末を推測・自動有効化しない。将来端末は外部アンテナとinventoryを正式に整備してから別展開でlimitへ追加する。

TalkPlaza Pi5は実機が存在しないため、現時点はローカルのinventory解析、profile contract、playbook syntax-checkだけを行う。公開 `--print-plan`、SSH、実機デプロイは行わない。コマンドは [デプロイメントガイド](./deployment.md#実行前確認) に記載する。

直接のAnsible実行、SSH先checkout、手動container操作、lockの手編集は行わない。詳細は [デプロイメントガイド](./deployment.md)を参照する。
