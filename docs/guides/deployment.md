---
id: deployment-guide
title: 標準デプロイ手順
status: active
last_verified: 2026-07-16
---

# デプロイメントガイド

通常の本番更新は、リポジトリ直下の `scripts/update-all-clients.sh` だけを入口にする。Pi5、Kiosk、Signageを個別に直接更新しない。オーケストレーターが差分、実機証跡、依存関係から対象と順序を決める。

### 標準更新入口（ローリング・端末別メンテナンス）

公開CLIは次のとおり。

```text
scripts/update-all-clients.sh <branch> <inventory> [--limit PATTERN] [--full-fleet] [--detach]
scripts/update-all-clients.sh <branch> <inventory> --print-plan
scripts/update-all-clients.sh --status RUN_ID
scripts/update-all-clients.sh --approve RUN_ID
scripts/update-all-clients.sh --cancel RUN_ID --reason TEXT
```

- 引数なしの通常実行は完了まで待つ。
- `--detach` は開始後に `runId` を返す。状態は `--status` で確認する。
- `--dry-run` は `--print-plan` の互換aliasとして使える。
- Pi5後のカナリア待機は `--approve RUN_ID` で明示承認する。
- 安定化時間を省略できるのは、緊急時に `--emergency-override --reason TEXT` を併用した場合だけである。

## 対象の決まり方

標準実行は対象を自動で最小化する。ただし、安全を優先して次の規則を適用する。

- 目標SHAと実行中SHAが一致し、最新の実機検証が `verified` のhostだけを除外する。
- 未到達、timeout、検証不足、rollback失敗は `unknown` として必ず対象に含める。
- Pi5が必要な変更で `--limit` によりPi5を除外することはできない。
- `--limit` で根拠不明hostを除外することはできない。
- 全台を明示的に再検証するときだけ `--full-fleet` を使う。
- 端末はPi4カナリア、残りのPi4、Pi3 Signageの順に、一台ずつ更新する。

判断の正本は `logs/deploy/fleet-release-state.json` である。手で編集しない。

## 実行前確認

1. 対象branchまたは不変SHAを確定する。
2. 対象SHAの `ci-required`、`codeql`、`gitleaks` が成功していることを確認する。
3. ローカルworktreeがcleanであることを確認する。
4. 正しいinventoryを選ぶ。
5. まず `--print-plan` を実行し、対象hostと理由、`unknown` の有無を確認する。
6. inventoryごとに実機実行の明示承認を得る。

第2工場の標準inventory:

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan
```

TalkPlazaのinventory:

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml --print-plan
```

TalkPlaza Pi5は構想段階で実機が存在しない。現状はplan確認に限定し、Pi5を含む実機デプロイを開始しない。

`--print-plan` はfleet stateを作成・更新せず、checkout、service、database、maintenance表示も変更しない。

## 通常実行

承認されたinventoryに対して実行する。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
```

非同期で開始する場合:

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach
scripts/update-all-clients.sh --status RUN_ID
```

Pi5が対象の場合は、host設定、Expand-only migration、candidate image、Blue/Green切替、load確認、5分間の安定化を完了してから端末へ進む。端末は60秒の通知後に一台ずつ更新する。

## 成功の確認

`--status RUN_ID` で次を確認する。

- run全体が `success` である。
- 対象hostの desired/current SHA が一致し、evidenceが `verified` である。
- Pi5はactive slot、API/Web image、config digest、migration digestが一致する。
- Kioskは新Web bundle SHA、Signageは更新済みrepo SHAを返す。
- 必須serviceとtimerがactiveで、認証済みendpointが成功する。
- maintenance表示が全端末で解除されている。

同じSHAでもう一度 `--print-plan` し、標準planがno-opになることを確認する。

## 中止と復旧

停止が必要な場合は協調cancelを使う。

```bash
scripts/update-all-clients.sh --cancel RUN_ID --reason "中止理由"
scripts/update-all-clients.sh --status RUN_ID
```

processのkill、lockファイルの削除、fleet stateの手編集、直接checkout、個別Ansible実行はしない。詳細は [deploy status recovery](../runbooks/deploy-status-recovery.md) を参照する。

Pi5 DBはdown migrationしない。rollbackはコード、image、設定、端末ファイルをrun専用manifestに従って戻し、databaseは旧API互換を保てるExpand-only migrationだけを許可する。

## 禁止する迂回経路

通常更新では次を直接実行しない。

- `ansible-playbook`
- SSH先での `git fetch` / `git checkout`
- `scripts/server/deploy*.sh`
- `scripts/deploy/pi5-image-deploy.sh`
- `scripts/deploy/pi5-blue-green.sh`
- legacy Composeや個別container操作

これらはオーケストレーター配下の内部実装または隔離テスト用であり、公開入口ではない。

## 過去記録

現行手順ではないデプロイ実績は月別archiveへ移した。

- [2026年4月](../archive/deployments/2026-04.md)
- [2026年5月](../archive/deployments/2026-05.md)
- [2026年6月](../archive/deployments/2026-06.md)
- [2026年7月](../archive/deployments/2026-07.md)
- [旧オペレーターガイド](../archive/deployments/legacy-operator-guide-through-2026-07.md)

設計の経緯と受入証跡は [deployment foundation refactor ExecPlan](../plans/deployment-foundation-refactor-execplan.md) と [rolling terminal Blue/Green plan](../plans/rolling-terminal-bluegreen-deploy.md) に残す。
