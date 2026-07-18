---
id: deployment-guide
title: 標準デプロイ手順
status: active
last_verified: 2026-07-18
---

# デプロイメントガイド

通常の本番更新は、リポジトリ直下の `scripts/update-all-clients.sh` だけを入口にする。Pi5、Kiosk、Signageを個別に直接更新しない。オーケストレーターが差分、実機証跡、依存関係から対象と順序を決める。

### 標準更新入口（ローリング・端末別メンテナンス）

公開CLIは次のとおり。

```text
scripts/update-all-clients.sh <branch> <inventory> [--limit PATTERN] [--full-fleet] [--detach]
scripts/update-all-clients.sh <branch> <inventory> --print-plan
scripts/update-all-clients.sh <branch> <inventory> --preflight-only [--limit PATTERN]
scripts/update-all-clients.sh --status RUN_ID
scripts/update-all-clients.sh --approve RUN_ID
scripts/update-all-clients.sh --cancel RUN_ID --reason TEXT
```

- 引数なしの通常実行は完了まで待つ。
- `--detach` は開始後に `runId` を返す。状態は `--status` で確認する。
- `--dry-run` は `--print-plan` の互換aliasとして使える。
- `--preflight-only` はmigrationと選択端末の全前提条件を読み取り専用で一括検査する。release run、systemd unit、fleet state、maintenance、checkout、service変更は作成・実行しない。
- `human` profileのカナリア待機は `--approve RUN_ID` で現在のgateを明示承認する。複数profileでは順番に承認する。
- 安定化時間を省略できるのは、緊急時に `--emergency-override --reason TEXT` を併用した場合だけである。

## 対象の決まり方

標準実行は対象を自動で最小化する。ただし、安全を優先して次の規則を適用する。

- 目標SHAと実行中SHAが一致し、最新の実機検証が `verified` のhostだけを除外する。
- 未到達、timeout、検証不足、rollback失敗は `unknown` として必ず対象に含める。
- Pi5が必要な変更で `--limit` によりPi5を除外することはできない。
- `--limit` で根拠不明hostを除外することはできない。
- 全台を明示的に再検証するときだけ `--full-fleet` を使う。
- 端末はregistryのprofile順、profile内canary、残りのinventory順で、一台ずつ更新する。

判断の正本は `logs/deploy/fleet-release-state.json` である。手で編集しない。

## 実行前確認

1. 対象branchまたは不変SHAを確定する。
2. 対象SHAの `ci-required`、`codeql`、`gitleaks` が成功していることを確認する。
3. ローカルworktreeがcleanであることを確認する。
4. 正しいinventoryを選ぶ。
5. まず `--print-plan` を実行し、対象hostと理由、`unknown` の有無を確認する。
6. inventoryごとに実機実行の明示承認を得る。
7. 承認された対象へ `--preflight-only` を実行し、全端末が合格することを確認する。

第2工場の標準inventory:

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan
```

TalkPlazaはstatic contractのみを検証する:

```bash
cd infrastructure/ansible
export ANSIBLE_CONFIG="$(pwd)/ansible-readonly.cfg"
ansible-inventory -i inventory-talkplaza.yml --list > /tmp/inventory-talkplaza.json
python3 ../../scripts/deploy/terminal_profile_contracts.py \
  --inventory-json /tmp/inventory-talkplaza.json
for playbook in playbooks/deploy-terminal-profile.yml \
  $(python3 ../../scripts/deploy/terminal_profile_contracts.py --list-playbooks); do
  ansible-playbook --syntax-check "$playbook" -i inventory-talkplaza.yml
done
```

TalkPlaza Pi5は構想段階で実機が存在しない。現状はローカルのinventory解析、profile contract、playbook syntax-checkだけに限定する。remote identityを必要とする公開 `--print-plan`、SSH、実機デプロイは行わない。

`--print-plan` はfleet stateを作成・更新せず、checkout、service、database、maintenance表示も変更しない。

第2工場でPi5とStoneBaseだけを事前検査する例:

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml \
  --limit 'raspberrypi5:raspi4-kensaku-stonebase01' \
  --preflight-only
```

`--preflight-only` は選択した全端末の問題を途中で打ち切らず一括表示し、一件でもあれば終了コード78で失敗する。出力された問題は、正規のAnsible設定または別途承認された保守変更でまとめて解消し、同じコマンドを再実行する。エラーを一件ずつ見ながら個別service起動や手動checkoutで迂回してはならない。

## Linux/Pi端末Typeを追加する

端末Typeは端末名、hostname、Raspberry Piの型、hardware `device_type` から推測しない。`scripts/deploy/terminal-profile-registry.json` の安全なprofile IDと、inventoryでそのhostが所属する一つのprofile groupがidentityである。中身の構造はprofileが選ぶadapterとplaybookで決まる。

1. SSH、Ansible、Git、systemd、status-agent、manifest rollbackで足りるなら `generic-systemd` と `playbooks/deploy-terminal-profile.yml` を選ぶ。固有のmaintenance、health、ready、rollbackが必要なら `terminal_adapters.py` と `adapter_registry.py` にadapterを一つ追加し、必要なrepository-owned playbookを用意する。planner、policy、fleet state、coordinatorへType名を追加しない。
2. registryへrollout順、impact component、adapter/playbook、notice秒、canary group、`human` または `health-only`、systemd unit、rollback path、health probe、`control-plane` または `terminal` ready authorityを明記する。path mappingとcomponent-to-profileも同じ変更で追加する。
3. 対象inventoryの `clients.children` にprofile groupを追加し、各hostを登録済みgroupの一つだけに所属させる。非空groupにはcanaryをちょうど一台置き、全hostの `status_agent_client_id` を一意にする。
4. CIの `deploy-contract` を通す。CIはregistryからadapter、group、canary、playbookを動的に読み、`serial: 1`、orchestration guard、rollback ownership、coreのType非依存を検証する。profileごとのworkflow job追加は不要である。
5. production登録に架空Typeを置かない。実製品変更の `--print-plan` を確認し、通常のhuman canary承認またはhealth-only証跡を使って最初の実機証明を行う。

## 通常実行

承認されたinventoryに対して実行する。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
```

通常実行も、release unitの作成前に`--preflight-only`と同じmigration・全端末前提検査を再実行する。事前検査と実行の間に状態が変わっても、そこで停止し、端末通知、maintenance、checkout、service変更へは進まない。

非同期で開始する場合:

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach
scripts/update-all-clients.sh --status RUN_ID
```

Pi5が対象の場合は、host設定、Expand-only migration、candidate image、Blue/Green切替、load確認、5分間の安定化を完了してから端末へ進む。端末はprofile指定の通知（現在のKioskは60秒）後に一台ずつ更新する。

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
