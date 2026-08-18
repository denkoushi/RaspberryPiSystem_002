---
id: deployment-guide
title: 標準デプロイ手順
status: active
last_verified: 2026-08-13
---

# デプロイメントガイド

通常の更新は、リポジトリ直下の `scripts/update-all-clients.sh` だけを入口にする。Pi5、Kiosk、Signageを個別に直接更新しない。operatorが対象を明示し、wrapperは標準Ansible playbookへその対象を渡す。

> **2026-08-08更新:** canonical wrapperは標準Ansible routeを起動する。旧Pi5実行入口は削除済みであり、本書は標準Ansibleの操作契約だけを示す。実機canary・時間計測・production実行は別の明示承認を必要とする。

> **2026-08-13更新:** Pi5の安定確認は10秒間隔の5サンプル（観測幅40秒）に限定する。Pi4/Pi3はPi5 executorからSSH portを各1回、3秒上限で確認し、応答しない任意端末を明示記録して対象外にする。Pi5は必須であり除外しない。

このfoundationで固定した境界は次のとおりである。

- Pi5: 稼働中にCI image、資源、migrationをAnsibleが直接確認し、`release_pi5` roleのslot lifecycleと5回の連続health sampleを利用する。
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

トルクレンチ所有権契約をAPI/Webと既設agentへ同時に切り替える場合だけ、次の限定モードを使う。現在の本番対象は、torque設定が完成しているStoneBaseとAssembly-01の2台に限る。

```text
scripts/update-all-clients.sh <branch> <inventory> --torque-cutover --limit raspberrypi5:raspi4-kensaku-stonebase01:raspi4-assembly-01 [--detach]
```

`--torque-cutover`はPi5と1台以上のPi4を含む明示的な`--limit`を要求し、`--full-fleet`を許可しない。選択されたPi4はすべて、lease、client key、API/TLS、外付けBluetooth adapter、HID by-id identity、parser profileが完全な`torque_agent_enabled=true` inventoryでなければ、端末停止前に拒否される。したがって今回の実行limitは上記2台を厳守し、未設定の4台は推測・自動生成・有効化しない。将来は外部アンテナとinventoryを正式に整備した端末だけを明示limitへ追加でき、wrapper変更は不要である。

選択された全Pi4のbrowser、旧torque-agent、guard intentを停止して外付けBluetooth OFFを確認し、8秒leaseに対して9秒待ってからPi5を更新する。Pi4では明示allowlistの`torque-agent`だけをpull・停止状態で配置し、NFC/barcodeの稼働imageと環境を変更しない。全選択端末の配置が成功した後だけagentを起動し、全台のhealthとBluetooth OFFを集約確認してからbrowserを再開する。Pi5またはPi4の途中失敗では再開せずOFFを維持し、切替を試みたPi4は既存rollback imageへ停止状態で戻す。

- mutationにはexact `--limit`または明示的な`--full-fleet`が必須である。暗黙の全fleet更新は行わない。
- 引数なしの通常実行はsystemd unitの終了まで待つ。`--detach`は`runId`を返し、`--status`はsystemd statusとjournalだけを読む。
- `--print-plan`は`ansible-inventory`と`ansible-playbook --list-hosts/--list-tasks`だけを実行し、選択host、profile、release SHA、GHCR tag、順序を表示する。remote hostやruntimeは変更しない。
- CLIの未文書化されたmutation/control引数はfail-closedで拒否される。
- Pi5で公開release-setからAPI/Web digestを解決し、Pi3は公開image labelから完成tarのSHA-256を一つだけ得る。Ansibleがprepare、switch、health、rescue rollbackを所有する。
- mutation開始時にPi5 executorが選択済みPi4/Pi3のSSH portを各1回だけ確認する。3秒以内に接続できない任意端末は再試行せず `optional-host-preflight` に記録して除外する。Pi5を含む選択ではPi5を必ず実行し、任意端末だけの選択が全台offlineならmutation前に失敗する。

運用者はSSHのユーザー名・ホスト名・ポートを手入力しない。wrapperがinventoryのPi5 executor (`deploy_executor_host`、`ansible_user`、`ansible_port`) を解決し、Pi5上の標準Ansible/Vault設定を使用する。clean worktreeを開始する時点で、標準運用が指定するcredential pathの存在だけを内容非参照で確認する。解決できない、pathが存在しない、credentialが利用できない、またはinventoryが想定外なら実行せず停止し、CI再実行・依存導入・symlink発明へ進まない。credentialのコピー、権限変更、今回限りの一時symlinkは標準手順にしない。

wrapperの出力は次の契約で扱う。

- `--print-plan`のJSONで `releaseSha`、`inventory`、`limit`/`fullFleet`、`executionOrder[].profile`、`executionOrder[].hosts`、`executionOrder[].images` を希望scopeとして記録する。対象host・profile・image tagがCIの成功したrelease artifact manifestと一致しない場合は停止する。
- mutationのJSONで返された `runId` と `statusCommand` だけを後続操作へ渡す。別のrun IDを作らず、別のDeployを起動しない。
- `--status RUN_ID`のJSONに含まれるsystemdのraw fields（`ActiveState`、`SubState`、`Result`、`ExecMainStatus`）とjournalを、preflight除外、実行状態、Ansible recap、health、rollbackの一次証拠として読む。systemd oneshotの正常完了は実績上 `ActiveState=active`、`SubState=exited`、`Result=success`、`ExecMainStatus=0` である。`active`/`inactive`だけでDeploy中・完了を判定しない。`SubState=running`等の非終端なら「実行中」、`SubState=exited`かつ上記Result/ExecMainStatusとrecapが合格なら「完了」、runを開始していなければ「未実行」と報告し、raw fieldsを併記する。手書きの監視shellや独自の終了判定を追加しない。

## 事故を防ぐ標準順序

1. **exact SHAと成果物を確定する**: 対象SHA、required CI/CodeQL/gitleaksの成功、対象profileに必要なAPI/Webまたは端末artifactのdigest/manifestを確認する。成功済みCIをMacで全再実行したり、`pnpm install`でlockfileを変更したりしない。
2. **read-only planを作る**: 次の`--print-plan`を実行し、JSONの対象host、profile、release SHA、image tag、実行順を保存する。executorはinventoryとwrapperの解決結果を正本とし、手入力値で補わない。

   ```bash
   scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan --limit PATTERN
   ```

   全fleetが明示的に承認された場合だけ、`--limit`の代わりに`--full-fleet`を使う。
3. **照合して承認する**: planの`releaseSha`、希望host/profile、image tagとCI artifact manifestのSHA/digestを照合する。実行時に許容するscope縮小は、1回のpreflightでofflineと判定されたPi4/Pi3の除外だけである。Ansible roleが保持するrollback経路と、既存runがないことを確認できない場合はDeployしない。
4. **canonical `--detach`を一度だけ起動する**: planと同じbranch・inventory・limitを使い、返却されたJSONの`runId`を記録する。

   ```bash
   scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit PATTERN --detach
   ```

5. **返却されたrunだけを監視する**: 出力の`runId`をそのまま使い、必要な時に同じcanonical `--status`を実行する。アドホックなmonitor loop、別shellの`ssh`/`systemctl`、新しいrunの二重起動は行わない。

   ```bash
   scripts/update-all-clients.sh --status RUN_ID --inventory infrastructure/ansible/inventory.yml
   ```

6. **影響相応の非破壊post-checkを行う**: roleのhealth/rollback結果をまず確認する。`scripts/deploy/verify-phase12-real.sh`全体はglobal-rank auto-generate等のPOST/PUTを含むため、非破壊post-checkとして無条件実行しない。非破壊の承認がある場合だけ、既存スクリプト内で明示されたGET/service-only部分を使う。標準経路で分離できない項目は未確認として停止し、Pi4確認が必要なら既存のPi5→Pi4 inventory/executor経路に限定する。Mac→Pi4直SSH、物理screen captureの追加、DB/Vault操作、Pi4 agent image再配布は行わない。
7. **cleanupとfinal auditを行う**: 一時credential、symlink、検証process、Docker資源を残さず、対象worktreeがcleanであること、元repoの保護WIPが不変であること、runのsystemdが終端状態であることを報告する。

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

1. 対象branchが指す40文字SHAをCIの成功結果と照合し、inventoryを確定する。公開CLIはbranchを受け取り、plan出力の`releaseSha`で実値を確認する。
2. 対象SHAのrequired CI、CodeQL、gitleaksと、対象profileのrelease artifact manifest/digestが成功・存在することを確認する。
3. Deploy専用のclean worktreeを使い、保護対象の未コミットWIPを含めない。開始時に標準credential pathの存在だけを内容非参照で確認し、無ければ即停止する。credentialがprimary worktreeの既存標準pathにだけ存在する場合は、Ansible標準の`ANSIBLE_VAULT_PASSWORD_FILE`でその既存ファイルを読み取り参照する。秘密のコピー、symlink、新規保存は行わない。元repoのWIPをcheckout、stash、reset、clean、編集で動かさない。
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

非同期実行は `--detach` でrun IDを受け取り、`--status RUN_ID` でsystemd unitとjournalのraw fieldsを読み取る。正常完了は `ActiveState=active`、`SubState=exited`、`Result=success`、`ExecMainStatus=0`、Ansible recap合格が揃った状態であり、`active`/`inactive`単独では判定しない。Pi5、Pi4、Pi3を個別のSSH、container、Ansible playbook、旧deploy scriptで操作しない。

実行結果では、preflightで除外された任意端末と実行対象を区別し、実行対象に対するAnsible recapのfailed/unreachableが0であること、各roleのhealth確認が成功したこと、対象SHAが一致したことを確認する。Pi5のmigrationとrollback判定は `release_pi5` の結果を正本とし、DBを手で巻き戻さない。

目安は、`--print-plan`が数分、detach開始が1分未満、実行本体が対象host数とartifact pull/health待ちに応じて数分から数十分である。固定時間で打ち切らず、返却されたrunの`--status`が終端状態になるまで確認する。

### 停止条件と完了条件

次のいずれかに該当したら、Deployを開始・再起動せずに停止する。

- exact SHA、required CI、artifact manifest/digest、planの対象host/profile/imageが一致しない。
- inventoryからexecutorまたは標準credentialを解決できない、別runが非終端、またはrollbackの一次証拠がない。
- `--status`のjournalで失敗原因が未確定、記録済みのoffline Pi4/Pi3除外以外で対象scopeがplanから変化、または成功済みCIの反復でしか説明できない。

完了は、返却されたrunのsystemdが `SubState=exited`、`Result=success`、`ExecMainStatus=0` で、実行対象に対するAnsibleのfailed/unreachableが0、対象SHA/artifact digest/rollback結果が一致し、必要な非破壊post-checkとcleanup/final auditが完了した時だけとする。報告にはrun ID、判定（「実行中」/「完了」/「未実行」）、`ActiveState`/`SubState`/`Result`/`ExecMainStatus`のraw fields、対象SHA、実行したprofile、preflightで除外した任意端末、未確認項目を含める。

## 共有application smoke

`scripts/deploy/verify-phase12-real.sh` はGETだけでなくglobal-rank auto-generate等のPOST/PUTを含む混在スクリプトである。全体を非破壊post-checkとして無条件実行せず、非破壊承認時に既存の明示GET/service-only部分だけを使う。標準経路で安全に分離できない場合は未確認として停止する。Pi5のmigration、container discovery、runtime log判定を追加せず、Deployの成功判定を重複実装しない。

## 失敗時

同じSHAとinventoryの標準実行結果を確認し、Ansible roleの失敗箇所とCI成果物を調査する。手動container操作、SSH先のcheckout、database down migration、stateファイルの編集で成功状態を作らない。再実行が必要な場合は原因修正後に同じcanonical entrypointから新しいplanを確認する。

既成功CIのローカル全再実行、手入力SSH user/host、Mac→Pi4直SSH、アドホック監視loop、新規Deployの二重起動、`pnpm install`・lockfile変更、credentialのコピー・権限変更、scope外のDB/Vault/Pi4 agent操作は、原因調査や復旧であっても禁止する。物理画面のscreenshot/remote-debugging機構はこの標準経路へ追加しない。

## 履歴

旧設計、過去の実績、ADR、ExecPlanは履歴として保持する。現行手順の判断にはこのガイドと、[デプロイ停止・復旧Runbook](../runbooks/deploy-status-recovery.md)だけを使用する。
