---
id: deployment-guide
title: 標準デプロイ手順
status: active
last_verified: 2026-07-24
---

# デプロイメントガイド

通常の本番更新は、リポジトリ直下の `scripts/update-all-clients.sh` だけを入口にする。Pi5、Kiosk、Signageを個別に直接更新しない。オーケストレーターが差分、実機証跡、依存関係から対象と順序を決める。

### 標準更新入口（ローリング・端末別メンテナンス）

公開CLIは次のとおり。

```text
scripts/update-all-clients.sh <branch> <inventory> [--limit PATTERN] [--reverify-selected] [--full-fleet] [--detach]
scripts/update-all-clients.sh <branch> <inventory> --print-plan
scripts/update-all-clients.sh <branch> <inventory> --preflight-only [--limit PATTERN]
scripts/update-all-clients.sh --status RUN_ID
scripts/update-all-clients.sh --approve RUN_ID
scripts/update-all-clients.sh --cancel RUN_ID --reason TEXT
```

- 引数なしの通常実行は完了まで待つ。
- `--detach` は開始後に `runId` を返す。状態は `--status` で確認する。
- `--dry-run` は `--print-plan` の互換aliasとして使える。
- `--preflight-only` はmigration、Pi5実行経路、選択端末の全前提条件を一括検査する診断コマンドである。release run、systemd unit、fleet state、maintenance、checkout、service変更は作成・実行しない。通常実行は同じ検査をrelease unit作成の直前に必ず実施するため、通常手順で事前に実行する必要はない。
- `human` profileのカナリア待機は `--approve RUN_ID` で現在のgateを明示承認する。複数profileでは順番に承認する。
- 安定化時間を省略できるのは、緊急時に `--emergency-override --reason TEXT` を併用した場合だけである。

## 対象の決まり方

標準実行は対象を自動で最小化する。ただし、安全を優先して次の規則を適用する。

- 目標SHAと実行中SHAが一致し、最新の実機検証が `verified` のhostだけを除外する。
- 未到達、timeout、検証不足、rollback失敗は `unknown` として必ず対象に含める。
- Pi5が必要な変更で `--limit` によりPi5を除外することはできない。
- `--limit` で根拠不明hostを除外することはできない。
- 全台を明示的に再検証するときだけ `--full-fleet` を使う。
- 影響分類がno-opでも、承認済みの限定端末で同一SHAを再検証するときだけ `--limit PATTERN --reverify-selected` を使う。選択されたverified hostだけを対象へ戻し、選択外のunknown host、Pi5必須変更、通常の通知・安定化・ACK・rollback契約は迂回しない。`--print-plan`で正確な対象を確認してから実行する。
- 端末はregistryのprofile順、profile内canary、残りのinventory順で、一台ずつ更新する。

判断の正本は `logs/deploy/fleet-release-state.json` である。手で編集しない。

## 実行前確認

1. 対象branchまたは不変SHAを確定する。
2. deployment/profile/agentへ変更がある場合、下記のローカル正本コマンドを完走する。
3. 対象SHAの `ci-required`、`codeql`、`gitleaks` が成功していることを確認する。
4. ローカルworktreeがcleanであることを確認する。
5. 正しいinventoryを選ぶ。
6. まず `--print-plan` を実行し、対象hostと理由、`unknown` の有無を確認する。
7. inventoryごとに実機実行の明示承認を得る。
8. 通常実行を開始する。release unit作成の直前に、同じ対象・同じ不変SHAに対する全量preflightが自動実行される。`--preflight-only` は、変更を起こさず問題を診断したい場合だけ使う。

ローカルとGitHub Actionsの`deploy-contract`は、同じ実行入口を使う。

```bash
scripts/ci/run-deploy-contracts-local.sh
```

`community.general`が未導入の環境だけ、初回に次を使う。

```bash
scripts/ci/run-deploy-contracts-local.sh --install-collections
```

このコマンドは管理対象hostへ接続しない。全Ansible `.j2`ソースのJinja構文・shell/Jinja区切り衝突、deployment Python/shell契約、隔離Postgresによるdeploy-status統合、安全契約、両inventory、registryから導出したprofile playbook、Ansible syntax/checkを検証し、一時ファイルと隔離DB資源を終了時に削除する。実行可能なリリース重要テンプレートは、代表的な秘密を含まない変数でレンダーした結果にもネイティブ構文検査を持たせる。CIへ個別コマンドを追加せず、このスクリプトを更新してローカルとCIの検査内容を同時に変える。

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

`--preflight-only` はmigration、Pi5、選択した全端末の問題を途中で打ち切らず、一つのJSONとして表示する。JSONには不変SHA、対象host、24段階のroute coverage、各probeのproof・issue・安全な資源値が含まれ、`releaseSubmitted`は常に`false`である。完全合格は終了コード0、通常の前提不足は78、検査自体が欠落・破損・内部失敗した場合は70とする。70を前提不足として扱ったり、probeを省略して続行してはならない。

Pi5 probeは既存fleet lockを全検査中保持し、実機identity、clean checkout、候補commit・protocol・実行成果物、通常Ansible設定とVault、inventory展開、Docker/Compose、空きディスク・メモリ、fleet/Blue-Green/deploy-statusの可読性、active run不在を同時に確認する。端末probeは候補SHAが所有する正確なagent health helperを端末へstdinで送り、現在有効なNFC・バーコード・トルクagentへ本番と同じ安定性判定を行う。各agentは、最大3回の範囲で2回連続してcontainer identity、必要なPC/SC、loopback JSON endpointの全証明に成功しなければならない。出力された問題は、正規のAnsible設定または別途承認された保守変更でまとめて解消し、同じコマンドを再実行する。エラーを一件ずつ見ながら個別service起動や手動checkoutで迂回してはならない。

候補SHAが所有するソースツリー、playbook、agent Dockerfile、Compose定義、設定テンプレートは、Pi5上の候補Git objectから検査する。端末の現在のcheckoutに次リリースで初めて追加されるディレクトリを要求してはならない。端末側の事前検査は、候補checkoutでは作れないOS package、systemd socket、Docker、NetworkManager、既存repository、メモリ、ディスクなどのhost資源だけを対象とする。NFCのPC/SC判定は全段階で`pcscd.socket=loaded/active/enabled`と`/run/pcscd/pcscd.comm`のUnix socketを正とし、`pcscd.service`の常時activeは要求しない。

mainへmerge済みでも本番へ一度も適用されていないmigrationを修正する場合だけ、
`scripts/deploy/migration-repairs.json`へmigration名、旧・新SQLの正確な
SHA-256、理由を宣言する。候補検査はGit object上の両checksumを照合し、修正後
SQLを未適用migrationとしてExpand-only検査する。この例外はrepository候補検査
専用であり、本番DB台帳を読むpreflightとrelease内再検査では有効にならない。
したがって、本番台帳に旧checksumが存在する場合は通常どおりchecksum不一致で
停止する。`prisma migrate resolve`、台帳編集、適用済みmigrationの修正で迂回
してはならない。

## Linux/Pi端末Typeを追加する

端末Typeは端末名、hostname、Raspberry Piの型、hardware `device_type` から推測しない。`scripts/deploy/terminal-profile-registry.json` の安全なprofile IDと、inventoryでそのhostが所属する一つのprofile groupがidentityである。中身の構造はprofileが選ぶadapterとplaybookで決まる。

1. SSH、Ansible、Git、systemd、status-agent、manifest rollbackで足りるなら `generic-systemd` と `playbooks/deploy-terminal-profile.yml` を選ぶ。固有のmaintenance、health、ready、rollbackが必要なら `terminal_adapters.py` と `adapter_registry.py` にadapterを一つ追加し、必要なrepository-owned playbookを用意する。planner、policy、fleet state、coordinatorへType名を追加しない。
2. registryへrollout順、impact component、adapter/playbook、notice秒、canary group、`human` または `health-only`、systemd unit、rollback path、health probe、`control-plane` または `terminal` ready authorityを明記する。path mappingとcomponent-to-profileも同じ変更で追加する。
3. 対象inventoryの `clients.children` にprofile groupを追加し、各hostを登録済みgroupの一つだけに所属させる。非空groupにはcanaryをちょうど一台置き、全hostの `status_agent_client_id` を一意にする。
4. systemd/Docker runtimeのcapture、preflight、restore用リストを別ファイルへ複写しない。adapterの`runtime_manifest_contract`を正本とし、optional agentは「無効でcontainerなし」と「有効でcontainerあり」の双方を`probe-capture`で検証する。
5. ローカル正本コマンドとCIの `deploy-contract` を通す。registryからadapter、group、canary、playbookを動的に読み、`serial: 1`、orchestration guard、rollback ownership、coreのType非依存を検証する。profileごとのworkflow job追加は不要である。
6. production登録に架空Typeを置かない。実製品変更の `--print-plan` を確認し、通常のhuman canary承認またはhealth-only証跡を使って最初の実機証明を行う。

## 通常実行

承認されたinventoryに対して実行する。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
```

通常実行は、release unitの作成前にmigration・Pi5経路・全端末前提検査を一度だけ実行する。通常手順で別途`--preflight-only`を実行する必要はない。状態が変わっても、実行直前の検査で停止し、端末通知、maintenance、checkout、service変更へは進まない。

前回runの中断復旧では、maintenance開始の有無にかかわらず、保存済みの全sealed runtime manifestを先にpreflightする。manifestはmaintenance前でもDocker rollback tagと当時のoptional-agent health authorityを所有し得るためである。復旧後の観測も同じsealed health contractと安定性判定を使う。active/failed run、manifest、rollback tag、fleet stateを手で削除・編集してこの連鎖を迂回してはならない。

非同期で開始する場合:

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach
scripts/update-all-clients.sh --status RUN_ID
```

Pi5が対象の場合は、host設定、Expand-only migration、candidate image、Blue/Green切替、load確認、5分間の安定化を完了してから端末へ進む。端末はprofile指定の通知（現在のKioskは60秒）後に一台ずつ更新する。

端末のforward Ansible playbookだけはSSH pipeliningを使う。各対象端末をdurable stateで`unknown`へ遷移した直後、repository baseline、manifest、通知、maintenance、checkout、service変更より前に、同じpipeliningと`become`で互換性を検査する。検査失敗は端末変更前にfail-closedで停止する。

端末manifest取得は、SSH account identity、file manifest、runtime manifestを候補SHA所有の一つのbundleで検査・取得する。file/runtimeは別々のroot、digest、復元権限のままであり、一方だけ成功した場合や応答を失った場合は成功扱いにしない。Generic Kioskの最終証跡も、Git HEAD、systemd、status identity、各agentの安定性判定を候補SHA所有の一つのbundleで確認する。これらのbundleはpipeliningを使わず、検査内容と必須条件を減らさない。cleanupとrollbackは従来のAnsible transportとsealed manifestだけを使う。

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
