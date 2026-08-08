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

TalkPlaza Pi5は実機が存在しないため、現時点はローカルのinventory解析、profile contract、playbook syntax-checkだけを行う。公開 `--print-plan`、SSH、実機デプロイは行わない。コマンドは [デプロイメントガイド](./deployment.md#実行前確認) に記載する。

直接のAnsible実行、SSH先checkout、手動container操作、lockの手編集は行わない。詳細は [デプロイメントガイド](./deployment.md)を参照する。
