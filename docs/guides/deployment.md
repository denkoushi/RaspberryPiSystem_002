---
id: deployment-guide
title: 標準デプロイ手順
status: active
last_verified: 2026-08-01
---

# デプロイメントガイド

通常の本番更新は、リポジトリ直下の `scripts/update-all-clients.sh` だけを入口にする。Pi5、Kiosk、Signageを個別に直接更新しない。オーケストレーターが差分、実機証跡、依存関係から対象と順序を決める。

### 標準更新入口（ローリング・端末別メンテナンス）

公開CLIは次のとおり。

```text
scripts/update-all-clients.sh <branch> <inventory> [--limit PATTERN] [--reverify-selected] [--full-fleet] [--detach]
scripts/update-all-clients.sh <branch> <inventory> --print-plan
scripts/update-all-clients.sh <branch> <inventory> --preflight-only [--limit PATTERN] [--reverify-selected]
scripts/update-all-clients.sh --status RUN_ID
scripts/update-all-clients.sh --approve RUN_ID
scripts/update-all-clients.sh --cancel RUN_ID --reason TEXT
```

- 引数なしの通常実行は完了まで待つ。
- `--detach` は開始後に `runId` を返す。状態は `--status` で確認する。
- `--dry-run` は `--print-plan` の互換aliasとして使える。
- `--preflight-only` はmigration、Pi5実行経路、実作業計画に含まれる端末だけの全前提条件を一括検査する診断コマンドである。release run、systemd unit、fleet state、maintenance、checkout、service変更は作成・実行しない。`--full-fleet` と `--limit PATTERN --reverify-selected` もread-only計画のまま検査できる。通常実行は同じ検査をrelease unit作成の直前に必ず実施するため、通常手順で事前に実行する必要はない。
- `human` profileのカナリア待機は `--status RUN_ID` の
  `actionRequired.type=canary-approval` を確認し、表示されたrun固有コマンドで
  現在のgateだけを明示承認する。監視中は30秒以内の間隔でstatusを確認し、
  `actionRequired`が出た時点で人へ判断を依頼する。事前のDeploy承認を流用した
  自動承認はしない。複数profileでは順番に承認する。
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

Pi5専用Webビルド値は
`infrastructure/ansible/group_vars/server/web-build.yml`が所有する。この
ファイルとPi5 Web環境テンプレートは`server-app`であり、Pi5イメージ更新と
Kioskブラウザのactivation／独立検証を選ぶ。KioskのGit checkoutやAnsible
mutation、Signageは選ばない。一般inventory、共通role、未登録pathは
`global`または`unknown`として従来どおり全対象へ広げる。詳細な判断は
[ADR-20260728](../decisions/ADR-20260728-change-aware-main-ci-and-server-web-ownership.md)
を参照する。

`scripts/deploy/validate-expand-only-migrations.py` は候補migrationを受理する前に
Pi5 checkoutから実行されるため、一般的な `deploy-control` ではなく
`pi5-control` として分類する。このvalidator自身の変更はmigrationや端末runtimeの
変更を意味しないが、修正版を実行権限へ収束させるためPi5を対象に含める。

Pi5のCI成果物昇格は既定無効である。別途承認して有効化した場合だけ、
exact main SHAとbuild設定hashに一致する署名済みLinux ARM64 API/Web pairを
候補tagへ移す。release setの欠落・一時的な取得不能・tool不在は、従来の
Pi5ローカルbuildへ戻る。署名、source、設定、platform、repository、digest、
schema、labelの不一致は改ざんまたはproducer不整合として停止し、fallbackで
隠さない。成果物取得後もmigration、health、Caddy、load、Blue/Green、5分監視、
rollbackは従来どおり実施する。正本は
[ARM64成果物昇格ADR](../decisions/ADR-20260728-attested-arm64-release-artifact-promotion.md)
である。公開packageでは実トークンを保存せず、隔離した一時GitHub CLI設定で
OCI内の署名bundleを検証する。private packageへ変更する場合だけ、root所有かつ
release runner groupだけが読める設定のread-only tokenを使う。

成果物昇格の待機上限はrelease set取得120秒、API image取得1200秒、
Web image取得600秒、その他の検証300秒、promotion全体1500秒である。
各処理は30秒ごとに安全な
stage名をheartbeatとして記録する。image pullはDocker Engineが返す転送量、
展開量、layer数、処理段階、直近30秒の増加量、最後の進捗からの経過も記録する。
コマンド、image参照、URL、token、認証header、生のdaemon errorは記録しない。
pullのtimeoutまたは通信不能は`unavailable`としてローカルbuildへ戻る。
署名、digest、platform、source、設定hashの不一致は
`integrity-failure`として停止する。診断項目と既知の未確定原因は
[KB-404](../knowledge-base/KB-404-pi5-ghcr-api-image-pull-timeout.md)と
[bounded API runtime ADR](../decisions/ADR-20260730-bounded-api-runtime-artifact.md)を参照する。

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

「mainが最新」「反映済み」と報告するときは、次の4項目を分けて確認する。ローカル
`main`と`origin/main`が一致するだけでは、feature branchの実装がmainへ統合済みとは
判定しない。

1. worktreeがcleanか。
2. ローカルbranchと対応するorigin branchが一致するか。
3. デプロイ対象SHAが`origin/main`の祖先か、未統合なら対応PRと統合予定があるか。
4. fleet stateの各hostで、実行中SHAと検証証跡が何か。

feature branchを本番検証に使った場合は、同じ作業の完了条件にPR作成、必須CI、main
統合を含める。main統合前の本番成功を「main反映済み」と表現してはならない。

標準CLIは上記判断を `mainIntegration` JSONとして `--print-plan`、通常実行結果、
`--status` に表示する。主要フィールドは次のとおり。

- `sourceSha` / `originMainSha`: 候補SHAと権威あるremote `main` SHA
- `sourceShaIsInMain`: 候補SHAが`origin/main`の祖先か
- `productionSha`: 全hostが同じSHAならその値。混在時は`null`
- `productionShas`: fleetで観測した重複なしの全SHA
- `productionShaIsInMain`: 観測した全本番SHAが`origin/main`に含まれるか
- `integrationPending`: 未統合または証拠不明が一つでもあれば`true`
- `completionEligible`: main統合について作業完了を主張できる場合だけ`true`
- `issues`: 判定不能理由を示す秘密を含まないstable code

feature branchの先行検証では、release自体は`success`になり得るが、
`mainIntegration.completionEligible=false`の間はExecPlanと作業報告を完了にしない。
remote `main`へ到達できない、SHAが欠ける、Git ancestryを判定できない場合も
Fail-Closedで`integrationPending=true`とする。この監査は対象host、canary、rollback、
releaseの成功／失敗を変更せず、リポジトリ完了状態だけを別に表す。

ローカルとGitHub Actionsの`deploy-contract`は、同じ実行入口を使う。

```bash
scripts/ci/run-deploy-contracts-local.sh
```

`community.general`が未導入の環境だけ、初回に次を使う。

```bash
scripts/ci/run-deploy-contracts-local.sh --install-collections
```

このコマンドは管理対象hostへ接続しない。全Ansible `.j2`ソースのJinja構文・shell/Jinja区切り衝突、deployment Python/shell契約、隔離Postgresによるdeploy-status統合、安全契約、両inventory、registryから導出したprofile playbook、Ansible syntax/checkを検証し、一時ファイルと隔離DB資源を終了時に削除する。隔離Postgresは固有名・固有label・ランダムloopback portを使い、migration台帳、`ClientDevice.apiKey`検索の`EXPLAIN (ANALYZE, BUFFERS)`、成功／失敗時の資源0件を確認する。実行可能なリリース重要テンプレートは、代表的な秘密を含まない変数でレンダーした結果にもネイティブ構文検査を持たせる。CIへ個別コマンドを追加せず、このスクリプトを更新してローカルとCIの検査内容を同時に変える。

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

`--preflight-only` はmigration、Pi5、plannerの`terminalWork`に入った端末の問題を途中で打ち切らず、一つのversion 2 JSONとして表示する。inventory全端末を代替対象にはしない。ローカルGit取得や計画情報の検査自体が失敗した場合も、内部詳細を漏らさず`status: incomplete`のJSONを一つ返す。JSONには不変SHA、実作業host、25段階のroute coverage、data-only readiness policyのdigest、適用gate、probe capability、proof、host付きstable issue code、復旧方法、対応test、合格scopeを封印した`readinessAdmission`が含まれ、`releaseSubmitted`は常に`false`である。完全合格またはobserve警告だけなら終了コード0、enforce判定失敗は78、未登録issue・証拠欠落・契約不整合は70とする。70を前提不足として扱ったり、probeを省略して続行してはならない。

Pi5 probeは既存fleet lockを全検査中保持し、実機identity、clean checkout、候補commit・protocol・実行成果物、通常Ansible設定とVault、inventory展開、Docker/Compose、空きディスク・メモリ、fleet/Blue-Green/deploy-statusの可読性、active run不在を同時に確認する。影響分類が`server-app`または`unknown`なら、Docker Hub、npm、Prisma、GitHub、PyPI、Playwright、Go module proxyへの証明書検証付きTLS接続を3回ずつPi5から並列確認する。一つでも失敗すれば全取得先の結果をまとめて表示し、release unitを作成しない。image buildを行わない既知の変更にはこの外部接続判定を適用しない。

端末probeは候補SHAが所有する正確なagent health helperを端末へstdinで送り、現在有効なNFC・バーコード・トルクagentへ本番と同じ安定性判定を行う。各agentは、最大3回の範囲で2回連続してcontainer identity、必要なPC/SC、loopback JSON endpointの全証明に成功しなければならない。NFCとバーコードは`readerConnected=true`を必須とし、NFCは`queueSize=0`も必須とする。キューが1件でもあればbusiness eventを自動削除・flushせず、端末変更前に停止する。ブラウザ側のKiosk ready ACKも、local-only policy、正確なloopback endpoint、reader接続、queue 0を1秒間隔で2回確認するまで送らない。出力された問題は、正規のAnsible設定または別途承認された保守変更でまとめて解消し、同じコマンドを再実行する。エラーを一件ずつ見ながら個別service起動や手動checkoutで迂回してはならない。設定契約と周辺機器監視の正本は[KB-403](../knowledge-base/KB-403-production-config-contract-and-nfc-health.md)を参照する。

開発・保守で周辺機器を意図的に外す場合、agentの`*_enabled`をfalseへ変えて検査を消してはならない。対象hostの`terminal_agent_maintenance_leases`へ、`nfc-agent`、`barcode-agent`、`torque-agent`のいずれか、英小文字の`reasonCode`、UTCの`expiresAt`を登録する。期限は評価時点から最大7日で、期限内だけその1機器の物理probeと異常episodeを保守扱いにする。他機器の検査、コンテナ配置、rollback、canaryは維持される。期限切れ・未知項目・不正時刻は通常のFail-Closedへ戻る。無期限の除外、キュー削除、コマンドラインだけの一時迂回は禁止する。

運用中は既存`status-agent` timerが60秒ごとにinventoryで有効なNFC・バーコード・トルクを検査する。1回目の異常は端末内episode stateだけへ記録し、2回連続異常で既存operations Slack経路へsanitized alertを送る。同じepisodeは重複通知せず、送信失敗は次回再試行、復旧後の再発は新しいepisodeとする。カードUID、last event、token、raw URL、raw responseをログやSlackへ含めてはならない。

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

通常実行は、release unitの作成前にdata-only policyが選んだmigration・Pi5経路・実作業端末の検査を一度だけ実行する。通常手順で別途`--preflight-only`を実行する必要はない。合格時のSHA、policy digest、component、host、action、claim、capabilityは`ReadinessAdmission`としてrelease unitへ渡される。coordinatorがlock下で再計画したscopeが減る場合は続行できるが、host追加、action昇格、claim追加、capability追加は新releaseの変更前に停止する。過去runのsealed authorityによる復旧はこの比較より先に完了できる。

readiness判定の正本は`scripts/deploy/readiness-gates.json`である。新しい判定は原則`observe`で登録し、3件以上の本番run証跡と人によるレビューを別変更で行うまで`enforce`へ昇格しない。安全上の即時blockだけは、具体的な実害と即時理由を台帳へ登録する。コマンド、Python import、任意コードは台帳に登録できない。

前回runの中断復旧では、maintenance開始の有無にかかわらず、保存済みの全sealed runtime manifestを先にpreflightする。manifestはmaintenance前でもDocker rollback tagと当時のoptional-agent health authorityを所有し得るためである。復旧後の観測も同じsealed health contractと安定性判定を使う。active/failed run、manifest、rollback tag、fleet stateを手で削除・編集してこの連鎖を迂回してはならない。

非同期で開始する場合:

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach
scripts/update-all-clients.sh --status RUN_ID
```

Pi5が対象の場合は、host設定、Expand-only migration、candidate image、Blue/Green切替、load確認、5分間の安定化を完了してから端末へ進む。端末はprofile指定の通知（現在のKioskは60秒）後に一台ずつ更新する。

`device_type_defaults`で`stop_lightdm: true`のSignage端末は、release-only適用中だけSignage runtimeとlightdmを停止してメモリを確保する。適用後は同じplayのpost-taskでlightdmとSignage runtimeを再開し、coordinatorがdisplay、status-agent、認証済みSignage endpoint、repo SHAを検証する。途中失敗時はsealed runtime manifestから復元し、手動のservice起動で成功扱いにしない。

端末のforward Ansible playbookだけはSSH pipeliningを使う。各対象端末をdurable stateで`unknown`へ遷移した直後、repository baseline、manifest、通知、maintenance、checkout、service変更より前に、同じpipeliningと`become`で互換性を検査する。検査失敗は端末変更前にfail-closedで停止する。

端末manifest取得は、SSH account identity、file manifest、runtime manifestを候補SHA所有の一つのbundleで検査・取得する。file/runtimeは別々のroot、digest、復元権限のままであり、一方だけ成功した場合や応答を失った場合は成功扱いにしない。Generic Kioskの最終証跡も、Git HEAD、systemd、status identity、各agentの安定性判定を候補SHA所有の一つのbundleで確認する。これらのbundleはpipeliningを使わず、検査内容と必須条件を減らさない。cleanupとrollbackは従来のAnsible transportとsealed manifestだけを使う。

## 成功の確認

`--status RUN_ID` で次を確認する。

- run全体が `success` である。
- 進行中に`actionRequired`が出た場合は、そのrun ID、canary、期限、残り秒数を
  人が確認し、承認すると判断した場合だけ表示済みコマンドを実行する。
- 対象hostの desired/current SHA が一致し、evidenceが `verified` である。
- Pi5はactive slot、API/Web image、config digest、migration digestが一致する。
- 成果物昇格を有効にしたrunは、candidateの`build.mode`が`promoted`であり、
  `artifactPromotion`にrelease set digestと両image digestがある。
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

成果物取得に失敗した場合、`disabled`または`unavailable`だけはローカルbuildへ
自動復帰する。`integrity-failure`ではpromotion設定を手で書き換えたり、
未検証tagを直接pullしたりせず、release set、attestation、source SHA、
configuration hashを調査する。可用性問題で次回runも確実にローカルbuildへ
戻す必要がある場合は、正規Ansible変数でpromotionを無効化し、
`--print-plan`からやり直す。

`artifactPromotion.status=unavailable`に`reasonCode`、`stage`、
`elapsedSeconds`、`timeoutSeconds`がある場合は、その処理の可用性timeoutを
示す。`pullDiagnostics`がある場合、`downloading`で転送量が増えなければ
回線・registry・Docker転送境界、転送完了後の`verifying`／`extracting`停滞なら
Pi5上のchecksum・展開・disk処理を調べる。転送量が増え続ける場合は、成果物容量と
実効速度を比較する。`transportReasonCode`は安全な分類であり、生のDocker error
ではない。診断方法は
[KB-404](../knowledge-base/KB-404-pi5-ghcr-api-image-pull-timeout.md)を参照する。
`failureCode=canary-approval-timeout`はcanary自体の更新失敗ではなく、
1,800秒以内にrun固有の人承認が届かなかったことを示す。残り端末へ進まず、
新しい実行は原因確認と`--print-plan`から始める。

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
