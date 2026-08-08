---
id: deployment-modules
title: デプロイ基盤アーキテクチャ
status: active
last_verified: 2026-08-08
---

# デプロイ基盤アーキテクチャ

デプロイ基盤は、公開入口を一つ、release判断を一つ、rollback責任者を一つにする。通常運用の入口は `scripts/update-all-clients.sh` だけである。

## Ansible標準route（canonical）

`scripts/update-all-clients.sh` はlauncherへ引数をそのまま渡し、launcherは対象SHA、CI公開物、inventory、標準Ansible argvを直線的に解決してPi5のtransient systemd unitを起動する。依存方向は `wrapper -> launcher -> systemd -> playbook -> profile role -> standard tools` の一方向である。

```text
GitHub Actions artifact
  -> update-all-clients.sh -> standard-ansible-release.py
  -> Pi5 transient systemd unit
  -> deploy-release-standard.yml
  -> release_pi5 | release_kiosk | release_signage
  -> prepare while live
  -> switch -> health
       failure -> profile rollback -> rollback health
```

各profileは同じ小さな制御構造を明示するが、artifact、service、health、rollback規則は共有しない。動的adapter registryや新しいstate machineは設けない。

| ファイル | 責務 | 依存先・入力 | 出力・副作用 | テスト境界 |
|---|---|---|---|---|
| `scripts/update-all-clients.sh` | 引数を変更せず目的別launcherへexec | operator argv | process置換 | 10行以下、strict exec contract |
| `scripts/deploy/standard-ansible-release.py` | parser、SHA/CI公開値解決、Ansible argv、既存systemd primitiveへの送信 | Git、inventory、GHCR、Ansible、SSH/systemd | Pi5 unit起動またはread-only plan/status | parser、target guard、argv、plan、detach/status、global flock contract |
| `playbooks/deploy-release-standard.yml` | Pi5→Pi4→Pi3の順、group、`serial: 1`を宣言 | inventory、exact SHA、profile変数 | 選択hostのrole起動 | syntax、list-hosts、順序contract |
| `roles/release_pi5/defaults/main.yml` | Pi5の安定pathと時間budgetの既定値 | なし | 変数だけ、副作用なし | YAML/Jinja parse |
| `roles/release_pi5/tasks/main.yml` | prepare→switch→health→rescue rollback→cleanup | 同roleのtask files | block/rescueの結果 | Ansible構造contract |
| `roles/release_pi5/tasks/prepare.yml` | image、資源、migration ledger、slot identityを直接確認 | Docker、expand-only migration | inactive slot facts | role structure and migration contract |
| `roles/release_pi5/tasks/switch.yml` | canonical slotへtrafficを切替 | Compose slot services | active route変更 | command contract |
| `roles/release_pi5/tasks/health.yml` | API/Web healthと安定性を確認 | role health tasks | healthy fact、失敗時rescue | health contract |
| `roles/release_pi5/tasks/rollback.yml` | previous slotを復元しhealthを再確認 | captured role facts | route復元、rollback health | rescue/rollback contract |
| `roles/release_pi5/tasks/cleanup.yml` | run-scoped一時資源を後処理 | role facts、Compose | candidate/previous資源整理 | idempotent cleanup contract |
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
| `playbooks/prepare-signage-artifact.yml` | Pi3 artifact preparationの構文と入力契約を検証 | artifact stage mapping | candidate treeを書かない | zero-render compatibility test |
| `scripts/deploy/signage-distribution-artifact.py` | 固定16-file allowlistで決定的tarを生成しtar/treeを検証 | host-neutral canonical source | CI artifact、検証結果JSON | reproducibility、traversal/link/size/missing/tree rejection |
| `rolling_release/signage_artifact_activation.py` | host-neutral artifactを既存signage経路へ渡す共有境界 | tar manifest、render set | activation input | activation unit test |
| `.github/workflows/ci.yml` | Pi4 agent native contract buildとARM64/ARMv7 main-SHA publish | Buildx、GHCR、Trivy | main時だけpackage publish | staged workflow contract |
| `scripts/ci/classify_changes.py` | 新role/CI artifact変更をdeploy jobへ分類 | Git diff paths | CI job matrix | classifier unit test |
| `scripts/ci/run-deploy-contracts-local.sh` | 新route contractを既存local正本へ追加 | local tools、unique Docker resources | test result、run資源cleanup | self-run、残存0確認 |

launcherをapplication/domain/adapterへ分割しない理由は、標準Ansible routeを一度起動するだけの直線的な入口であり、再利用可能な業務状態遷移を所有しないためである。profile roleをさらに共通moduleへ分割しない理由は、artifact・停止対象・rollback意味の差が大きく、共通化が新たな汎用Deploy frameworkになるためである。

Pi4/Pi3の`prepare.yml`をさらに細分化しない理由は、それぞれが「通常表示中に完了する一つの順序付きprepare」であり、pull/transfer→検証→stage→previous取得の順序そのものが停止時間と中断耐性のcontractだからである。task includeを増やして順序を複数fileへ隠すより、profile内の一つの宣言列としてcontract test可能にする。業務状態遷移、health、rollback、cleanupはすでに別fileへ分離済みである。

## Runtime invariants

- The public entrypoint is `scripts/update-all-clients.sh`; it execs `scripts/deploy/standard-ansible-release.py`.
- The launcher owns target SHA, inventory, explicit host scope, systemd invocation, read-only plan, and status.
- `deploy-release-standard.yml` is the only release playbook for the standard route and preserves server, kiosk, signage order with `serial: 1`.
- `release_pi5`, `release_kiosk`, and `release_signage` own their own prepare, switch, health, rollback, and cleanup semantics.
- Pi3/Pi4 shared agent, systemd, artifact, and CI modules remain separate from the Pi5 role.
- `fleet-release-state.lock`, `read_only_ansible_context.py`, and `safe_diagnostics.py` remain protected shared assets.

## Verification boundaries

`scripts/ci/run-deploy-contracts-local.sh` is the local/CI contract entrypoint. It validates the canonical launcher, Ansible syntax/list-hosts/list-tasks, role ordering, Pi3/Pi4 contracts, and shared safety tests. `scripts/deploy/verify-phase12-real.sh` is an application HTTP smoke; it does not duplicate role-owned migration, runtime discovery, or rollback checks.

Production execution is performed by the standard Ansible route. No separate control plane, compatibility adapter, or legacy entrypoint is part of the active architecture.

Historical architecture and migration rationale remain in [the deployment architecture archive](../archive/architecture/deployment-modules-legacy-through-2026-07.md).
