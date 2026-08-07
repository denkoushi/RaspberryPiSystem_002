---
id: deployment-modules
title: デプロイ基盤アーキテクチャ
status: active
last_verified: 2026-08-07
---

# デプロイ基盤アーキテクチャ

デプロイ基盤は、公開入口を一つ、release判断を一つ、rollback責任者を一つにする。通常運用の入口は `scripts/update-all-clients.sh` だけである。

## Ansible標準化foundation（非canonical）

`deploy-release-standard.yml` は、今後のcanonical切替に先立って追加した直接検証可能な経路である。このfoundationでは `scripts/update-all-clients.sh` から呼ばれず、本番操作にも使用しない。依存方向は `playbook -> profile role -> standard tools / existing Blue/Green lifecycle` の一方向であり、rolling-release coordinator、fleet state、readiness policy、claimsへ逆参照しない。

```text
GitHub Actions artifact
  -> deploy-release-standard.yml
  -> release_pi5 | release_kiosk | release_signage
  -> prepare while live
  -> switch -> health
       failure -> profile rollback -> rollback health
```

各profileは同じ小さな制御構造を明示するが、artifact、service、health、rollback規則は共有しない。動的adapter registryや新しいstate machineは設けない。

| ファイル | 責務 | 依存先・入力 | 出力・副作用 | テスト境界 |
|---|---|---|---|---|
| `playbooks/deploy-release-standard.yml` | Pi5→Pi4→Pi3の順、group、`serial: 1`を宣言 | inventory、exact SHA、profile変数 | 選択hostのrole起動 | syntax、list-hosts、順序contract |
| `roles/release_pi5/defaults/main.yml` | Pi5の安定pathと時間budgetの既定値 | なし | 変数だけ、副作用なし | YAML/Jinja parse |
| `roles/release_pi5/tasks/main.yml` | prepare→switch→health→rescue rollback→cleanup | 同roleのtask files | block/rescueの結果 | Ansible構造contract |
| `roles/release_pi5/tasks/prepare.yml` | image pull、image ID・資源・live migration ledgerの直接確認 | Docker、expand-only validator、Blue/Green `prepare` | inactive slotとprevious slot fact | sealed evidence非依存contract、Blue/Green test |
| `roles/release_pi5/tasks/switch.yml` | candidateへtraffic切替 | Blue/Green `switch` | active gateway変更 | command contract、Blue/Green test |
| `roles/release_pi5/tasks/health.yml` | API/Web healthと稼働中monitor | Blue/Green `monitor` | health fact、失敗時rescue | success/failure shell test |
| `roles/release_pi5/tasks/rollback.yml` | previous slotへswitchback | Blue/Green `rollback` | gateway復元、rollback health | rescue/rollback contract |
| `roles/release_pi5/tasks/cleanup.yml` | candidate一時資源の後処理 | Blue/Green `cleanup` | lifecycle一時資源削除 | idempotent cleanup shell test |
| `roles/release_kiosk/defaults/main.yml` | Pi4 compose pathとhealth timeoutの既定値 | なし | 変数だけ、副作用なし | YAML/Jinja parse |
| `roles/release_kiosk/tasks/main.yml` | Pi4のblock/rescue/always順序 | 同roleのtask files | 一台単位のrelease結果 | Ansible構造contract |
| `roles/release_kiosk/tasks/prepare.yml` | enabled image pull、previous image/config取得、run-scoped config render | Docker/Compose、inventory agent flags | rollback tagsとstaged config | no-build/pull-before-switch contract |
| `roles/release_kiosk/tasks/switch.yml` | staged configを配置し変更serviceだけrecreate | Compose override | 対象host container/config変更 | `--no-build` contract |
| `roles/release_kiosk/tasks/health_checks.yml` | kioskとenabled agentの個別health probe | systemd、HTTP endpoints | probe結果 | profile scenario contract |
| `roles/release_kiosk/tasks/health.yml` | health checksを通常経路から一度呼ぶ | `health_checks.yml` | healthy fact | one-call contract |
| `roles/release_kiosk/tasks/rollback.yml` | previous image/configを復元しhealth再確認 | rollback tags、backup files | container/config復元 | rollback-once/fail-closed contract |
| `roles/release_kiosk/tasks/cleanup.yml` | run-scoped configとrollback tagを除去 | Docker、staging path | 対象run一時資源削除 | cleanup contract |
| `roles/release_kiosk/templates/client-compose.yml.j2` | build keyを持たないimmutable image override | exact image refs | staged Compose YAML | Compose config、no-build contract |
| `roles/release_kiosk/templates/status-agent.service.j2` | staged status-agent unit | inventory identity | staged unit file | Jinja parse |
| `roles/release_signage/defaults/main.yml` | Pi3 release/config/stage pathとpayload mapping | なし | 変数だけ、副作用なし | YAML/Jinja parse |
| `roles/release_signage/tasks/main.yml` | Pi3のblock/rescue/always順序 | 同roleのtask files | 一台単位のrelease結果 | Ansible構造contract |
| `roles/release_signage/tasks/prepare.yml` | controller取得、単一SHA、tar/tree allowlist、temp展開、read-only、atomic publish、外部host設定 | 既存builder、systemd、inventory | 完成digest directoryとprevious fact | immutable tree、中断耐性、target network禁止contract |
| `roles/release_signage/tasks/switch.yml` | 対象unit停止、current/previousのatomic切替、再起動 | prepared candidate、systemd | active release link変更 | atomic-link/critical-window contract |
| `roles/release_signage/tasks/health_checks.yml` | endpointと通常表示を確認 | systemd、status endpoint | probe結果 | profile scenario contract |
| `roles/release_signage/tasks/health.yml` | health checksを通常経路から一度呼ぶ | `health_checks.yml` | healthy fact | one-call contract |
| `roles/release_signage/tasks/rollback.yml` | previous linkへ戻し、再起動して通常表示を再確認 | previous target、systemd | active release復元 | rollback-once/fail-closed contract |
| `roles/release_signage/tasks/cleanup.yml` | 未完成tempと成功済みrun stageだけを除去 | run-scoped paths | 完成candidateは変更しない | interruption cleanup contract |
| `roles/signage/tasks/runtime-config.yml` | 既存routeでもhost設定を停止前にartifact外へ準備 | inventory、4 templates | 固定`/etc` env/drop-in | deploy safety、rollback manifest contract |
| `roles/signage/templates/signage-runtime.env.j2` | runtime script用host値 | inventory variables | external env file | no-secret-log、Jinja parse |
| `roles/signage/templates/signage-runtime.tmpfiles.j2` | `/run/signage`所有者 | inventory user | external tmpfiles file | fixed destination contract |
| `roles/signage/templates/signage-service-runtime.conf.j2` | systemd User/Groupとenv参照 | inventory user | external service drop-in | fixed destination contract |
| `roles/signage/templates/signage-update-timer-runtime.conf.j2` | host別更新間隔 | inventory interval | external timer drop-in | Jinja parse |
| `playbooks/prepare-signage-artifact.yml` | 旧coordinator hand-offの構文互換だけを検証 | 旧stage mapping | candidate treeを書かない | zero-render compatibility test |
| `scripts/deploy/signage-distribution-artifact.py` | 固定16-file allowlistで決定的tarを生成しtar/treeを検証 | host-neutral canonical source | CI artifact、検証結果JSON | reproducibility、traversal/link/size/missing/tree rejection |
| `rolling_release/signage_artifact_activation.py` | 旧routeがhost-neutral artifactを扱う互換境界 | tar manifest、空render set | 旧activation candidate |既存activation unit test |
| `lib/pi5-blue-green/images-evidence.sh` | evidence付き旧routeとevidenceなし新routeのimage解決 | Docker、任意の旧evidence | image ID |既存Blue/Green test |
| `lib/pi5-blue-green/migrations.sh` | live ledger検証、旧sealed planは任意互換 | Prisma migration、任意の旧plan | migration validation |既存migration shell test |
| `lib/pi5-blue-green/lifecycle.sh` | optional evidence引数をprepareへ伝達 | Blue/Green command args | slot lifecycle | `set -u`、lifecycle test |
| `.github/workflows/ci.yml` | Pi4 agent native contract buildとARM64/ARMv7 main-SHA publish | Buildx、GHCR、Trivy | main時だけpackage publish | staged workflow contract |
| `scripts/ci/classify_changes.py` | 新role/CI artifact変更をdeploy jobへ分類 | Git diff paths | CI job matrix | classifier unit test |
| `scripts/ci/run-deploy-contracts-local.sh` | 新route contractを既存local正本へ追加 | local tools、unique Docker resources | test result、run資源cleanup | self-run、残存0確認 |

profile roleをさらに共通moduleへ分割しない理由は、共有できる行数よりartifact・停止対象・rollback意味の差が大きく、共通化が新たな汎用Deploy frameworkになるためである。既存Blue/Green shell modulesも、実績あるslot境界を保つため内部再分割しない。新経路からsealed evidence引数を渡さず、既存canonical経路の互換部分だけを残す。

Pi4/Pi3の`prepare.yml`をさらに細分化しない理由は、それぞれが「通常表示中に完了する一つの順序付きprepare」であり、pull/transfer→検証→stage→previous取得の順序そのものが停止時間と中断耐性のcontractだからである。task includeを増やして順序を複数fileへ隠すより、profile内の一つの宣言列としてcontract test可能にする。業務状態遷移、health、rollback、cleanupはすでに別fileへ分離済みである。

## 全体フロー

```text
operator
  -> update-all-clients.sh
  -> rolling-release.py / rolling_release.cli
  -> application / coordinator
  -> terminal profile registry
  -> fleet lock + fleet release state
  -> Pi5 adapter or profile-selected TerminalAdapter
  -> evidence verification
  -> per-run state + fleet release state
```

controllerは対象branchを不変SHAへ解決し、remote bootstrapを開始する。remote側はcheckoutより前にkernel `flock`を非待機で取得する。後発runはGitやstateを変更せず失敗する。lock取得後にだけ対象SHAをcheckoutし、transient systemd unit内でPython coordinatorへ `exec` する。

## モジュール境界

- `scripts/update-all-clients.sh`: 引数を変更せずPythonへ渡す薄い公開wrapper。
- `scripts/deploy/rolling-release.py`: remote bootstrapとremote-runの境界。
- `rolling_release/cli.py`: 公開CLIの構文とexit code。
- `rolling_release/application.py`: launch、plan、status、approve、cancelのuse case。
- `rolling_release/coordinator.py`: release phase、順序、cancel、rollback、最終証跡を所有する唯一のcoordinator。
- `rolling_release/planner.py` / `policy.py`: 変更分類、依存関係、対象理由、対象最小化。
- `rolling_release/fleet_state.py`: release判断の唯一の永続的正本。
- `rolling_release/lock.py`: fleet lockとper-run lockのkernel lock契約。
- `rolling_release/backends/pi5.py`: Pi5 host設定、migration、candidate build、Blue/Green切替、health evidence。
- `terminal-profile-registry.json`: 端末profile、inventory group、順序、影響component、adapter、playbook、approvalとrollback/health契約のdata-only正本。
- `rolling_release/terminal_adapters.py`: manifest、通知、maintenance、Ansible適用、health/ready、exact rollback、最終証跡をprofileごとに実行する。
- `rolling_release/adapter_registry.py`: 許可されたadapter IDをrepository-owned実装へ閉じて解決する。
- `rolling_release/remote_control.py`: systemd unitとlocked run stateを使うstatus、approve、cancel。

adapterは実行方法を隠蔽するが、release判断やrollback方針を決めない。coordinatorだけが次phaseへ進むか、止めるか、rollbackするかを決める。

## 永続状態

`logs/deploy/fleet-release-state.json` がrelease判断の唯一の正本である。

```text
generation
activeRun
lastRun
fleet
  <host>
    role
    desiredSha
    currentSha
    previousSha
    evidence
    verifiedAt
    lastRunId
```

Pi5はさらにactive slot、API/Web image、config digest、migration digestを保持する。writeはgenerationを比較し、atomic replaceとkernel lockで競合・中断から守る。

各runのstatusとcontrol requestは、per-run lockで保護した現行形式だけを使う。`--status` はsystemd unitとこのstateを照合する。実体が確認できない成功記録はfleet evidenceへ昇格しない。

## evidenceと対象最小化

除外根拠に使えるのは `evidence=verified` だけである。目標SHAと実行中SHAが一致しても、実機検証が欠けるhostは除外しない。

- verified + 同一desired/current SHA: 標準planから除外可能
- 未到達、timeout、interrupted、rollback失敗: `unknown`
- unknown: 必ず対象へ含める
- Pi5必須変更: `--limit` でPi5を除外できない

`--print-plan` はstateを作成・更新しない。

## Pi5 executor

Pi5処理は次の責務に分かれる。

1. host config収束
2. Expand-only migration planとlive ledger検証
3. run-scoped candidate image build
4. Blue/Green switch、load確認、5分安定化

candidate build後のload evidenceは最終検証で再利用する。databaseはrollbackせず、旧API互換を保つmigrationだけを許可する。API/Web image、config digest、migration digestが揃わない限りPi5を成功扱いにしない。

## Terminal executor

端末はregistryの `rolloutOrder`、profile内canary、inventory順で一台ずつ処理する。通知秒数と `human` / `health-only` approvalはprofileが明示する。現在のKioskは60秒通知とhuman gate、Signageは通知なしとhealth-onlyであり、既存順序を保持する。

端末profileはhostnameやhardware `device_type` では決めない。`clients` 配下で、登録済みprofile groupのちょうど一つに所属することがidentityである。実行構造はprofileが選ぶadapterとplaybookで決まり、同じadapterを使えるTypeはregistryとinventoryだけで追加できる。

成功には次を必要とする。

- remote HEADが目標SHAと一致
- 必須serviceとtimerがactive
- 認証済みstatus endpointが成功
- profileの `readyAuthority` が示すPi5 Web SHAまたは端末repo SHAをACK

`ready` ACKはreleaseSha一致を必須とする。HTTP 401や確認失敗を成功扱いにせず、maintenanceは一致確認後だけ解除する。

## rollback

rollback責任者はcoordinatorだけである。変更前にrun専用manifestへsource、destination、checksum、repository/runtime情報を記録し、そのmanifestだけを復元する。Ansible内部の推測rollbackや最新ファイル探索は行わない。

失敗時は後続hostへ進まず、rollback結果を記録する。復元の検証に失敗したhostは `unknown` とし、次の標準planから消さない。

## cancelと再起動

cancelはcontrol stateへ理由付き要求を書き、coordinatorがphase境界で処理する。cancel経路はfetchやcheckoutをしない。crashまたはreboot後はsystemd unit、run state、fleet state、manifest証跡を照合し、成功を推測しない。

processのkill、lock削除、state手編集は運用手順に含めない。

## 公開契約

```text
update-all-clients.sh <branch> <inventory> [--limit PATTERN] [--full-fleet] [--detach]
update-all-clients.sh <branch> <inventory> --print-plan
update-all-clients.sh --status RUN_ID
update-all-clients.sh --approve RUN_ID
update-all-clients.sh --cancel RUN_ID --reason TEXT
```

通常手順と新Type追加は [deployment guide](../guides/deployment.md)、復旧は [deploy status recovery](../runbooks/deploy-status-recovery.md)、profile/adapter判断は [ADR-20260716](../decisions/ADR-20260716-terminal-profile-registry-adapter-boundary.md)、設計移行の経緯は [Terminal Profile Registry ExecPlan](../plans/terminal-profile-registry-execplan.md) を参照する。旧構成の記録は [architecture archive](../archive/architecture/deployment-modules-legacy-through-2026-07.md) に残す。
