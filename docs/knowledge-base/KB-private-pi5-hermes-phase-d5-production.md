# KB-private-pi5-hermes-phase-d5-production: Phase D5 本番反映（Discord `/task` 橋）

- **Status**: reference（2026-05-25 完了）
- **Related**: [Runbook §Phase D5](../runbooks/private-pi5-hermes-deploy.md#phase-d5--discord-task-橋実機本番反映2026-05-25) · [ExecPlan D5](../plans/private-pi5-hermes-tools-security-phase-d5-execplan.md) · [KB Phase D4](./KB-private-pi5-hermes-phase-d4-production.md) · [脅威モデル §D5](./KB-private-pi5-hermes-tools-security-threat-model.md#d5-チェックリストrepo-実装2026-05-25) · [ADR D5](../decisions/ADR-20260525-private-pi5-hermes-discord-tools-bridge-d5.md)

## Context

私用 Pi5 Hermes **Phase D5** — Discord **雑談（chat）プロファイルはツール無効のまま**、**`/task <指示>`** のみ **tools プロファイル**（D4: file+web+browser）へ委譲。当初検討した `quick_commands`（type: exec）は **ユーザー引数を渡さない**ため不採用。**Hermes plugin slash command**（`private-pi5-discord-task-bridge`）で `/task` を登録。

**対象**: 私用 Pi5（`private-pi5-stackchan-bridge` / `raspi5-private`）**のみ** · 業務 Pi5 / Pi3 / Pi4 / DGX 本体への D5 デプロイは対象外。

## 確定仕様（運用時点）

| 領域 | 仕様 |
|------|------|
| **chat** | `hermes-gateway` active · **全 toolsets 無効**（`disabled_toolsets` 不変） |
| **chat plugins** | `plugins.enabled: [private-pi5-discord-task-bridge]`（D5 フラグ時のみ） |
| **plugin 配置** | `~/.hermes/plugins/private-pi5-discord-task-bridge/`（`plugin.yaml` + `__init__.py` + 同ディレクトリ flat Python + `task-bridge.policy.yaml`） |
| **`/task`** | plugin `ctx.register_command("task", …)` → `run_tools_profile_prompt`（**`--toolsets file,web,browser` 固定**） |
| **tools** | D4 維持 · `hermes-tools-gateway` **active** · isolated `~/.hermes-tools` HOME |
| **policy** | `task-bridge.policy.yaml`（prompt 長上限・deny パターン） |
| **承認** | tools **`approvals.mode: manual`** — **D5.1** で Discord 承認中継（file IPC · `/task-approve`/`/task-deny` · yes/no） |

## fragment（D5 必須・コミット禁止）

D4 フラグに加え:

```yaml
private_pi5_hermes_discord_tools_bridge_enabled: true
private_pi5_hermes_gateway_enabled: true
```

## 実施タイムライン（2026-05-25）

1. **fragment**（非コミット）: `private_pi5_hermes_discord_tools_bridge_enabled: true` を追加（D4 一式は既存）
2. **私用 Pi5 デプロイ 1 回目**: `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` — 配置は成功したが **`verify-discord-task-bridge.yml` が false negative**（下記 Investigation）
3. **repo 修正**: verify の `file` マッチを緩和 · plugin **flat deploy** 向け **ImportError フォールバック**（相対 import → 同ディレクトリ import）
4. **私用 Pi5 デプロイ 2 回目**: **`PLAY RECAP` ok=91 changed=3 failed=0** · summary `discord_tools_bridge_enabled=True`
5. **ホットフィックス**（import 修正を実機へ即反映）: plugin 3 ファイル copy + `hermes-gateway` restart · `register-ok True`
6. **検証**:
   - Ansible D5 verify（2 回目デプロイ後）: **PASS**
   - Pi5: `load_task_bridge_policy()` → **policy-ok 2000**
   - Pi5: `HERMES_TOOLS_PHASE=d4 verify-tools-profile-deploy.sh` → **OK**
   - Pi5: `verify-discord-task-bridge-smoke.sh`（`REPO_ROOT=/tmp/smoke-repo`）→ **OK**
   - ローカル: unittest **48 OK** · `verify-discord-task-bridge-smoke.sh` **OK**

## 検証結果（実機）

| チェック | 期待 | 実測 |
|----------|------|------|
| `hermes-gateway` | active | **active** |
| `hermes-tools-gateway` | active | **active** |
| chat `plugins.enabled` | `private-pi5-discord-task-bridge` | **OK** |
| chat `disabled_toolsets` | file/web/browser/delegation 等は無効 | **OK** |
| plugin manifest | `plugin.yaml` 存在 | **OK** |
| `task-bridge.policy.yaml` | plugin ディレクトリに配置 | **OK** |
| plugin `register()` | callable | **OK**（`runpy` / import 検証） |
| tools D4 契約 | `HERMES_TOOLS_PHASE=d4` | **OK** |
| Discord `/task` E2E | read-only タスクで応答 | **未実施**（手動・承認 UI 依存） |
| Discord 雑談回帰 | chat 不変 | **未実施**（任意） |

## Investigation（デプロイ・検証トラブルシュート）

| 症状 | 根因 | Fix |
|------|------|-----|
| D5 verify: `file` が disabled と判定されない | Ansible assert が **`'    - file\n'`** の厳密文字列マッチ（実機 YAML の改行/インデントと不一致） | **`'    - file' in config`** に緩和（[`verify-discord-task-bridge.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/verify-discord-task-bridge.yml)） |
| `from discord_task_bridge_plugin import register` が失敗 | デプロイは **`discord_task_bridge_plugin.py` → `__init__.py`**（モジュール名は存在しない） | Hermes は **`__init__.py` の `register()`** で読み込み。検証は `runpy.run_path(__init__.py)` または plugin ディレクトリを `sys.path` に追加 |
| plugin 読み込みで **ImportError**（相対 import） | Ansible は **flat 配置**（`lib/` パッケージではない）なのに **`from .discord_task_bridge`** | **`try: relative / except: flat`** を `discord_task_bridge_plugin.py` · `discord_task_bridge.py` · `tools_profile_runner.py` に追加 · policy パスは **`plugin_dir / task-bridge.policy.yaml`** 優先 |
| `/task` が Hermes トップレベル CLI にない | `/task` は **gateway/plugin スラッシュコマンド**（`hermes task` ではない） | Discord または gateway セッションで `/task` を使用 |

## Prevention

- D5 前に fragment の **`discord_tools_bridge_enabled`** と **D4 一式**を一覧確認
- verify 失敗時は **実機 `config.yaml` を slurp して文字列マッチを疑う**（D3/D4 と同型）
- plugin 変更後は **`hermes-gateway` restart**（デプロイ playbook が再起動する）
- Pi5 上の Python smoke は **plugin ディレクトリを `sys.path` に載せる**（repo の `lib` パッケージ import とは別）
- Discord E2E は **read-only プロンプト**から開始 · write タスクは **D5.1 承認中継**（[ExecPlan D5.1](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md)）

## Phase D5.1 追記（2026-05-25 · repo 実装完了）

| 項目 | 内容 |
|------|------|
| **モジュール** | `scripts/private-pi5-hermes/lib/approval_relay/`（FileApprovalStore · coordinator · runner） |
| **policy** | `approval_relay.enabled: true` · `store_dir: ~/.hermes/task-bridge/approvals` |
| **plugin** | `/task-approve` · `/task-deny` · `pre_gateway_dispatch`（pending 時の yes/no） |
| **runner** | `HERMES_EXEC_ASK=1` + in-process `hermes_cli.main`（notify 登録を同一プロセスに保持） |
| **検証** | unittest **66 OK** · `verify-discord-task-bridge-smoke.sh` **OK** |
| **実機 E2E** | write + 承認フロー — **未実施**（[ExecPlan D5.1 §E2E](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md#実機手動-e2eデプロイ後)） |

正本: [ADR D5.1](../decisions/ADR-20260525-private-pi5-hermes-discord-approval-relay-d5-1.md) · [ExecPlan D5.1](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md)

## 未確認

- Discord 上での **`/task List files in workspace`** 応答（tools 承認フロー含む）— **2026-05-25 実機で初回 E2E 実施・2 件の根因を修正**（下記 KB 追記）
- 通常雑談メッセージが **chat LLM のみ**のままであることの回帰

## Investigation（Discord `/task` E2E — 2026-05-25 夕方）

| 症状 | 根因 | Fix |
|------|------|-----|
| `/task` 送信後 **~5 分無反応**（👀 のみ）→ 長い TUI 出力 | plugin handler が **同期 `subprocess.run`** で tools `hermes chat -q` を実行し **Discord gateway の asyncio ループをブロック**（`heartbeat blocked` 270s+） | **`async def _handle_task_command` + `asyncio.to_thread(run_task_bridge, …)`**（[`discord_task_bridge_plugin.py`](../../scripts/private-pi5-hermes/lib/discord_task_bridge_plugin.py)） |
| 応答は来るが **Docker 120s タイムアウト**・file 一覧不可 | Hermes 既定 **`container_disk: 51200`** が Docker **`--storage-opt`** を付与 → Pi5 **ext4 overlay** では `containers/create` 失敗（dockerd: `storage-opt is supported only for overlay over xfs with pquota`） | **`container_disk: 0`** を [`config.base.yaml.j2`](../../infrastructure/ansible/templates/private-pi5-hermes/config.base.yaml.j2) に明示 · verify 追加 |
| 初回 `/task` がさらに遅い | **`nikolaik/python-nodejs:python3.11-nodejs20`** 初回 pull（~3 分） | 実機で **docker pull 済** · 以降は ~1 分前後（LLM+tool） |

**修正後実機（2026-05-25）**: `container_disk: 0` 反映 + イメージ pull 後、`hermes chat -q 'List files in workspace' --toolsets file` → **~54s** · workspace 参照 OK（Docker コンテナ起動成功）。

## References

- [ADR D5](../decisions/ADR-20260525-private-pi5-hermes-discord-tools-bridge-d5.md)
- [`deploy-discord-task-bridge.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/deploy-discord-task-bridge.yml)
- [`discord_task_bridge_plugin.py`](../../scripts/private-pi5-hermes/lib/discord_task_bridge_plugin.py)
