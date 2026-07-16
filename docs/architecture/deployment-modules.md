---
id: deployment-modules
title: デプロイ基盤アーキテクチャ
status: active
last_verified: 2026-07-16
---

# デプロイ基盤アーキテクチャ

デプロイ基盤は、公開入口を一つ、release判断を一つ、rollback責任者を一つにする。通常運用の入口は `scripts/update-all-clients.sh` だけである。

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
