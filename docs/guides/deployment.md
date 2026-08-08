---
id: deployment-guide
title: 標準デプロイ手順
status: active
last_verified: 2026-08-08
---

# デプロイメントガイド

通常の更新は、リポジトリ直下の `scripts/update-all-clients.sh` だけを入口にする。Pi5、Kiosk、Signageを個別に直接更新しない。operatorが対象を明示し、wrapperは標準Ansible playbookへその対象を渡す。

> **2026-08-08更新:** canonical wrapperは標準Ansible routeを起動する。旧Pi5実行入口は削除済みであり、本書は標準Ansibleの操作契約だけを示す。実機canary・時間計測・production実行は別の明示承認を必要とする。

このfoundationで固定した境界は次のとおりである。

- Pi5: 稼働中にCI image、資源、migrationをAnsibleが直接確認し、`release_pi5` roleのslot lifecycleを利用する。
- Pi4: exact `--limit`と`serial: 1`で一台ずつ、image pull完了後に`--no-build`で変更serviceだけを切り替える。他hostは停止しない。
- Pi3: controllerから完成tarを転送し、端末で代表SHA-256を一度確認する。固定allowlistを検証してrun-scoped tempへ展開・read-only化後、digest名へatomic renameする。端末固有値はimmutable release外のenv/drop-inに置き、Pi3からGit、GHCR、外部HTTPへ接続しない。

### 標準更新入口

公開CLIは次のとおり。

```text
scripts/update-all-clients.sh <branch> <inventory> --limit PATTERN [--detach]
scripts/update-all-clients.sh <branch> <inventory> --full-fleet [--detach]
scripts/update-all-clients.sh <branch> <inventory> --print-plan [--limit PATTERN]
scripts/update-all-clients.sh --status RUN_ID [--inventory INVENTORY]
```

- mutationにはexact `--limit`または明示的な`--full-fleet`が必須である。暗黙の全fleet更新は行わない。
- 引数なしの通常実行はsystemd unitの終了まで待つ。`--detach`は`runId`を返し、`--status`はsystemd statusとjournalだけを読む。
- `--print-plan`は`ansible-inventory`と`ansible-playbook --list-hosts/--list-tasks`だけを実行し、選択host、profile、release SHA、GHCR tag、順序を表示する。remote hostやruntimeは変更しない。
- CLIの未文書化されたmutation/control引数はfail-closedで拒否される。
- Pi5で公開release-setからAPI/Web digestを解決し、Pi3は公開image labelから完成tarのSHA-256を一つだけ得る。Ansibleがprepare、switch、health、rescue rollbackを所有する。

## 標準経路の責務

標準経路は次の一方向だけを使う。

```text
scripts/update-all-clients.sh
  -> scripts/deploy/standard-ansible-release.py
  -> infrastructure/ansible/playbooks/deploy-release-standard.yml
  -> release_pi5 | release_kiosk | release_signage
```

- `standard-ansible-release.py` は対象SHA、inventory、対象host、systemd実行単位を解決する。
- `deploy-release-standard.yml` は server、kiosk、signage の順序と `serial: 1` を宣言する。
- `release_pi5` はPi5のimage、migration、health、slot切替、失敗時rollbackをAnsible role内で確認する。
- `release_kiosk` はPi4のimage/configと有効agentのhealthを一台ずつ確認する。
- `release_signage` はPi3の検証済み配布artifactをatomicにstageし、端末側のGitや外部HTTP取得を行わない。

旧control planeや削除済みentrypointを標準手順の入力や操作として使用しない。

## 実行前確認

1. 対象branchまたは40文字のSHAとinventoryを確定する。
2. 対象SHAのrequired CI、CodeQL、gitleaksが成功していることを確認する。
3. worktreeがcleanで、保護対象の未コミットWIPを含めていないことを確認する。
4. read-onlyの対象確認を実行する。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan
```

`--print-plan` はinventoryとAnsibleのlist-hosts/list-tasksを確認するだけで、remote host、service、database、stateを変更しない。対象を限定する場合は `--limit PATTERN`、全fleetを明示する場合だけ `--full-fleet` を使う。

## 標準実行

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit PATTERN
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --full-fleet
```

非同期実行は `--detach` でrun IDを受け取り、`--status RUN_ID` でsystemd unitとjournalの終了状態を読み取る。Pi5、Pi4、Pi3を個別のSSH、container、Ansible playbook、旧deploy scriptで操作しない。

実行結果では、Ansible recapのfailed/unreachableが0であること、各roleのhealth確認が成功したこと、対象SHAが一致したことを確認する。Pi5のmigrationとrollback判定は `release_pi5` の結果を正本とし、DBを手で巻き戻さない。

## 共有application smoke

`scripts/deploy/verify-phase12-real.sh` はAPI、deploy-status、signage、kiosk applicationのHTTP smokeとPi3/Pi4の共有service確認に限定する。Pi5のmigration、container discovery、runtime log判定は行わず、Deployの成功判定を重複実装しない。

## 失敗時

同じSHAとinventoryの標準実行結果を確認し、Ansible roleの失敗箇所とCI成果物を調査する。手動container操作、SSH先のcheckout、database down migration、stateファイルの編集で成功状態を作らない。再実行が必要な場合は原因修正後に同じcanonical entrypointから新しいplanを確認する。

## 履歴

旧設計、過去の実績、ADR、ExecPlanは履歴として保持する。現行手順の判断にはこのガイドと、[デプロイ停止・復旧Runbook](../runbooks/deploy-status-recovery.md)だけを使用する。
