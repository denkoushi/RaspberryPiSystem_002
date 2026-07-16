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

対象SHAの `ci-required`、`codeql`、`gitleaks` が成功し、planの対象理由と `unknown` hostを確認した後、inventory単位で明示承認を得て実行する。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
```

通常実行は完了まで待つ。非同期実行では返されたrunIdを使う。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach
scripts/update-all-clients.sh --status RUN_ID
```

`human` profileの現在のカナリア承認:

```bash
scripts/update-all-clients.sh --approve RUN_ID
```

安全に止める場合:

```bash
scripts/update-all-clients.sh --cancel RUN_ID --reason "中止理由"
scripts/update-all-clients.sh --status RUN_ID
```

同一SHAの成功後は、もう一度planを出してno-opを確認する。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan
```

標準では検証済み同一SHAのhostだけを除外し、`unknown` hostは対象に含める。全台再検証が必要な場合だけ `--full-fleet` を使う。

TalkPlaza Pi5は実機が存在しないため、現時点はローカルのinventory解析、profile contract、playbook syntax-checkだけを行う。公開 `--print-plan`、SSH、実機デプロイは行わない。コマンドは [デプロイメントガイド](./deployment.md#実行前確認) に記載する。

直接のAnsible実行、SSH先checkout、process kill、lock削除、fleet state編集は行わない。詳細は [デプロイメントガイド](./deployment.md)、復旧は [deploy status recovery](../runbooks/deploy-status-recovery.md) を参照する。
