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
- plugin 変更後は **`hermes-gateway` restart**（playbook が verify 前に **自動 restart** — [`restart-chat-gateway.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/restart-chat-gateway.yml)）
- Pi5 上の Python smoke は **plugin ディレクトリを `sys.path` に載せる**（repo の `lib` パッケージ import とは別）
- Discord E2E は **read-only プロンプト**から開始 · write タスクは **D5.1 承認中継**（[ExecPlan D5.1](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md)）

## Phase D5.1 追記（2026-05-25 · repo 実装 + 私用 Pi5 本番反映）

| 項目 | 内容 |
|------|------|
| **モジュール** | `scripts/private-pi5-hermes/lib/approval_relay/`（FileApprovalStore · coordinator · runner） |
| **policy** | `approval_relay.enabled: true` · `store_dir: ~/.hermes/task-bridge/approvals` |
| **plugin** | `/task-approve` · `/task-deny` · `pre_gateway_dispatch`（pending 時の yes/no） |
| **runner** | `HERMES_EXEC_ASK=1` + in-process `hermes_cli.main`（notify 登録を同一プロセスに保持） |
| **branch** | `feat/private-pi5-hermes-phase-d5-1-approval-relay` @ `27c10d05` + hotfix（venv python 解決） |

### 実施タイムライン（2026-05-25 夜）

1. **標準デプロイ**: `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` → **`PLAY RECAP` ok=107 changed=9 failed=0**（約 **158s**）
2. **Ansible verify**: D5 · D5.1 · tools D4 · `container_disk: 0` — **すべて PASS**
3. **Pi5 smoke**: plugin 3 コマンド + `pre_gateway_dispatch` + FileApprovalStore ラウンドトリップ — **OK**
4. **Pi5 tools 契約**: `HERMES_TOOLS_PHASE=d4 /tmp/verify-tools-profile-deploy.sh` — **OK**
5. **read-only 実機**: tools `hermes chat -q 'List files in workspace' --toolsets file` — **~18s** · workspace 応答 OK
6. **write + 承認 relay 実機**（`response.json` 自動投入）: `hello-d51-verify.txt` 作成 — **~91s** · 内容 `relay-ok` 確認
7. **Discord UI E2E**（`/task` + yes/no または slash）— **未実施**（手動・次タスク）

### 検証結果（実機）

| チェック | 期待 | 実測 |
|----------|------|------|
| `approval_relay/` 配置 | plugin 配下 | **OK** |
| store dir `0700` | `~/.hermes/task-bridge/approvals` | **OK** |
| `hermes-task-with-approval-relay` CLI | executable | **OK** |
| plugin register | task / task-approve / task-deny + hook | **OK** |
| tools D4 契約 | gateway active · Bearer 200 | **OK** |
| read-only tools 実行 | 承認なし · ~10–60s | **~18s** |
| write + file IPC 承認 | request → response → ファイル作成 | **OK**（Discord 外 sim） |
| Discord `/task` E2E | 承認 UX 完結 | **未**（Discord UI 手動）· handler 直呼び **OK**（2026-05-25 22:36 JST デプロイ後） |

### 本番デプロイ（session context API 修正 · 2026-05-25 22:36 JST）

| 項目 | 内容 |
|------|------|
| **branch** | `fix/private-pi5-hermes-task-session-context-api` @ `79d1fdf3` |
| **対象** | 私用 Pi5 `raspi5-private`（inventory: `private-pi5-stackchan-bridge`） |
| **手順** | 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` |
| **PLAY RECAP** | **ok=123 changed=6 failed=0**（約 **175s**） |
| **gateway** | `hermes-gateway` **active** · 起動 **22:36:19 JST** · PID **150145** |
| **配布物** | `approval_relay/session_context.py` · `coordinator.py` re-export · verify smoke 拡張 · gateway restart + `discover_plugins(force=True)` パッチ |

**実機検証（Ansible verify + SSH smoke）**:

| 検証 | 結果 |
|------|------|
| `session_context.py` 配置 | **OK** |
| session context adapter smoke（TypeError → os.environ フォールバック） | **OK** |
| async `/task` handler smoke | **OK** |
| gateway/plugin 鮮度（restart ≥ plugin mtime） | **OK** |
| `discover_plugins(force=True)` パッチ存在 | **OK** |
| plugin discovery order smoke（`task` handler 登録） | **OK** |
| handler 直呼び `List files in workspace` | **OK** · ~31s · **TypeError なし** |
| gateway.log `Unknown command /task` | **21:45 / 21:55 のみ**（デプロイ後 **新規なし**） |

**仕様（session context 契約）**:

- Hermes 現 API: `get_session_env(name: str, default="") -> str`（キー単位）
- adapter: `HERMES_SESSION_USER_ID` / `HERMES_SESSION_CHAT_ID` / `HERMES_SESSION_THREAD_ID` を順に解決
- `TypeError` / `ImportError` 時は `os.environ` フォールバック（gateway が plugin 例外を DEBUG で握りつぶすため **plugin 内で完結必須**）

### Investigation（D5.1 デプロイ・実機検証）

| 症状 | 根因 | Fix |
|------|------|-----|
| `verify-tools-profile-deploy.sh` が d1 扱いで FAIL | ansible `script` モジュールに **`HERMES_TOOLS_PHASE` 未伝播** | **`HERMES_TOOLS_PHASE=d4 /tmp/verify-tools-profile-deploy.sh`**（Runbook 既存パターン） |
| approval relay write テストが即 FAIL | **`/home/hermes/.local/bin/hermes` は bash ラッパ** · `_resolve_hermes_python` が `/usr/bin/python3` にフォールバック → `hermes_cli` 不在 | ラッパ内 `exec ".../venv/bin/hermes"` を解析 · fallback **`~/.hermes/hermes-agent/venv/bin/python3`**（[`tools_profile_runner.py`](../../scripts/private-pi5-hermes/lib/tools_profile_runner.py)） |
| 実機 venv パス想定違い | 当初 `~/.local/share/hermes-agent/venv` を仮定 | 正: **`~/.hermes/hermes-agent/venv/bin/python3`** |
| Discord write `/task` が **承認なし ~23s** で完了 · TUI 生出力 · store に request なし | D5.1 配布後 **`hermes-gateway` 未再起動**（11:27 起動の **D5 旧 plugin がメモリ常駐**）· playbook は `state: started` のみ | verify 前に **gateway restart** を playbook へ追加 · 手動 hotfix 時も **`systemctl restart hermes-gateway`** |
| restart 後 **`Unknown command /task`** | **`model_tools` import 時の `discover_plugins()`** が先に走り user plugin をスキップ → gateway 側 idempotent discover が **no-op**（※21:55 事象の主因ではない — 下表参照） | **`gateway/run.py` を `discover_plugins(force=True)` にパッチ**（[`deploy-hermes-gateway-plugin-discover-fix.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/deploy-hermes-gateway-plugin-discover-fix.yml)） |
| restart + discover fix 後も **`Unknown command /task`** | [`read_gateway_session_context()`](../../scripts/private-pi5-hermes/lib/approval_relay/coordinator.py) が **`get_session_env()` を引数なし**で呼ぶ · Pi5 Hermes API は **`get_session_env(name, default) -> str`** · handler 実行時 **TypeError** → gateway plugin dispatch が DEBUG で握りつぶし skill 未登録扱い | [`approval_relay/session_context.py`](../../scripts/private-pi5-hermes/lib/approval_relay/session_context.py) でキー単位アダプタ + `os.environ` フォールバック · verify smoke 追加 |
| write `/task` が **承認なし**で `write_file` 完了（`request.json` なし） | D5.1 relay は **`tools.approval`（危険シェルコマンド）** のみフック · LLM は **`write_file` / `patch` ツール**で workspace 書き込み（承認経路外） | **`approval_relay/tool_write_gate.py`** — runner が `pre_tool_call` で write ツールを file IPC 承認に接続（2026-05-26 repo） |
| **`yes` が雑談扱い**（承認プロンプト後 · `history=0` chat） | Hermes gateway: **plugin slash `/task` が `_set_session_env` より先**に実行 · `read_gateway_session_context()` が空 → **`by-user/` 未作成** · `try_resolve_text` が active task を見つけられない | **`approval_relay/gateway_actor_context.py`** — `pre_gateway_dispatch` で `event.source` を ContextVar に退避し session 解決の第一候補に（PR [#343](https://github.com/denkoushi/RaspberryPiSystem_002/pull/343)） |
| **`yes` 後に write が進まない**（承認プロンプトは表示 · ファイル未作成） | `runner.py` の **`_poll_responses_until_stop`** が `response.json` を先に読み **`resolve_gateway_approval` + unlink** · `tool_write_gate` の `wait_for_discord_approval` が応答を取りこぼす | **`pattern_key` が `tool:*` のとき poll スレッドは response を触らない** · `request.json` 無し時も触らない（[`runner.py`](../../scripts/private-pi5-hermes/lib/approval_relay/runner.py) `_poll_thread_should_consume_response` · PR poll-race fix） |
| **`verify-tool-write-approval-gate-pi5.sh` が FAIL**（`request.json` 無し · ファイルは ~23s で作成） | runner 直呼び smoke と **Discord `/task` 経路**で `pre_tool_call` 登録タイミングが異なる可能性 · 本件は **poll 修正とは独立**（ゲート未発火の切り分けが別タスク） | poll 専用 smoke [`verify-poll-thread-tool-write-pi5.sh`](../../scripts/private-pi5-hermes/verify-poll-thread-tool-write-pi5.sh) で **poll 競合のみ**実機確認 · Discord UI E2E で write 完結を確認 |

### 本番デプロイ（poll スレッド · tool write 承認応答 · 2026-05-26 JST）

| 項目 | 内容 |
|------|------|
| **branch** | `fix/private-pi5-hermes-tool-write-poll-race` @ `b3866764` |
| **対象** | 私用 Pi5 `raspi5-private` のみ |
| **手順** | 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` |
| **PLAY RECAP** | **ok=123 changed=6 failed=0**（約 **413s**） |
| **gateway** | `hermes-gateway` **active** · 起動 **2026-05-26 14:01:25 JST** · PID **169596** |
| **配布物** | `approval_relay/runner.py`（`_poll_thread_should_consume_response`）· 新規 smoke `verify-poll-thread-tool-write-pi5.sh` |

**実機検証（Pi5 · Ansible smoke）**:

| 検証 | 結果 |
|------|------|
| playbook D5 / D5.1 / tools D4 verify | **PASS**（デプロイ内蔵） |
| `HERMES_TOOLS_PHASE=d4 verify-tools-profile-deploy.sh` | **OK** |
| `verify-actor-context-bind-pi5.sh` | **OK** |
| `verify-poll-thread-tool-write-pi5.sh`（tool `response.json` が poll で消えない） | **OK** |
| `verify-tool-write-approval-gate-pi5.sh`（runner 直呼び · `request.json` 必須） | **FAIL**（`request.json` 未作成 · ファイルは作成 — 上表） |
| Discord `/task` → `yes` → ファイル作成 E2E | **要確認**（手動 · poll 修正後） |

### Discord 承認 UX 修正（2026-05-30 · repo）

| 症状 | 根拠 | 対策（repo） |
|------|------|----------------|
| 承認文が **~300s 後**に最終返信へ後載せ | `request_timeout_seconds: 300` と gateway 時刻差が一致 · 即時 REST 失敗は **ログ無し** | `send_discord_channel_message` → **`DiscordSendResult` + ERROR ログ** · 失敗時 **`delivery_failed.json`** で runner を **即中断**（300s 待たない） |
| timeout 後の **`yes` が雑談** | `finish_task_context` が by-user 索引を即消去 | **承認 timeout 時のみ** `TaskRunContext.approval_timed_out`（`_compose_task_response` 整形前に立てる）→ `enter_grace=True` · ユーザー向け文言置換後も grace が効く · grace 中の `yes` は intercept · **grace は concurrent `/task` をブロックしない**（`running_task_id` と分離） |
| 期限切れ後に **yes を促す文言**が最終返信に残る | `intermediate_messages` 後載せ | 承認プロンプトは **Discord 即時送信のみ** · timeout 時は **`承認期限切れ。もう一度 /task`** のみ |
| `/novel` 後 `/task` が 2048 で落ちる | DGX profile 残留 | `ensure_tools_dgx_runtime_ready` 後に **`verify_dgx_runtime_profile`**（`/v1/models` 200 + `activeProfileId` 一致） |

**受け入れ（未完了）**: Discord 実機で「`/task` write → **10s 以内**に承認通知 → `yes` → ファイル作成」。read-only smoke / runner 直呼び / **`response.json` 手動投入**は **別扱い**（E2E 成功証明にならない）。

**読み取り専用確認**: [`verify-task-bridge-readonly-state-pi5.sh`](../../scripts/private-pi5-hermes/verify-task-bridge-readonly-state-pi5.sh)（**`sudo -u hermes`**）。

**仕様（poll スレッドと tool write IPC）**:

- **shell 承認**（`tools.approval` notify）: `notify_cb` が同一プロセスで `wait_for_response` · poll スレッドは **`pattern_key` が `tool:*` 以外**のときのみ `response.json` を読んで `resolve_gateway_approval` + unlink
- **tool write 承認**（`write_file` / `patch`）: `pre_tool_call` → `wait_for_discord_approval` が `response.json` を消費 · poll スレッドは **`tool:*` または request 無し**のときは **一切触らない**
- **修正前の症状**: Discord で `yes` 成功表示後も write 再開せずファイル未作成（`response.json` が poll に先取り）

**検証コマンド（Pi5）**:

```bash
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m copy -a "src=scripts/private-pi5-hermes/verify-poll-thread-tool-write-pi5.sh dest=/tmp/verify-poll-thread-tool-write-pi5.sh mode=0755" -b
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "sudo -u hermes /tmp/verify-poll-thread-tool-write-pi5.sh" -b
```

### 本番デプロイ（write_file 承認ゲート · 2026-05-26 JST）

| 項目 | 内容 |
|------|------|
| **branch** | `feat/private-pi5-hermes-tool-write-approval-gate` @ `bd87e47c`（PR [#342](https://github.com/denkoushi/RaspberryPiSystem_002/pull/342)） |
| **対象** | 私用 Pi5 `raspi5-private`（inventory: `private-pi5-stackchan-bridge`）のみ |
| **手順** | 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` |
| **PLAY RECAP** | **ok=123 changed=8 failed=0**（約 **421s**） |
| **gateway** | `hermes-gateway` **active** · 起動 **2026-05-26 09:01:20 JST** · PID **157959** |
| **配布物** | `approval_relay/pending_approval.py` · `tool_write_gate.py` · `runner.py`（`install_tool_write_approval_relay`）· `store.clear_pending_files()` |

**実機検証（Ansible verify + Pi5 smoke）**:

| 検証 | 結果 |
|------|------|
| playbook D5 / D5.1 / tools D4 verify | **PASS** |
| `tool_write_gate.py` / `pending_approval.py` 配置 | **OK** |
| `HERMES_TOOLS_PHASE=d4 verify-tools-profile-deploy.sh` | **OK** |
| runner + write プロンプト → **`request.json` 生成**（task `verify-write-gate-1779753830`） | **OK** — `pre_tool_call` 承認ゲート発火を確認 |
| Discord `/task` write E2E（承認 UX 完結） | **未**（手動 · 次タスク） |

### 本番デプロイ（gateway actor context · `yes` ルーティング · 2026-05-26 JST）

| 項目 | 内容 |
|------|------|
| **branch** | `fix/private-pi5-hermes-discord-approval-actor-context` @ `350e8fbb`（PR [#343](https://github.com/denkoushi/RaspberryPiSystem_002/pull/343)） |
| **対象** | 私用 Pi5 `raspi5-private` のみ |
| **手順** | 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` |
| **PLAY RECAP** | **ok=123 changed=6 failed=0**（約 **405s**） |
| **gateway** | `hermes-gateway` **active** · 起動 **2026-05-26 11:00:42 JST** · PID **164302** |
| **配布物** | `approval_relay/gateway_actor_context.py` · `session_context.py`（actor 優先解決）· plugin `__init__.py`（`stash_from_message_source`） |

**実機検証（Pi5 · Ansible smoke）**:

| 検証 | 結果 |
|------|------|
| playbook D5 / D5.1 verify | **PASS** |
| `gateway_actor_context.py` 配置 | **OK** |
| `verify-actor-context-bind-pi5.sh`（stash → `read_gateway_session_context` → `by-user/{id}.json`） | **OK** |
| Discord `/task` → `yes` → ファイル作成 E2E | **要確認**（手動 · ゲート+actor 両方デプロイ後） |

**仕様（actor context）**:

- Hermes は slash 処理時点では `HERMES_SESSION_USER_ID` をまだ ContextVar に載せない（`_set_session_env` は agent ループ側で後から実行）
- `pre_gateway_dispatch`（全 inbound・slash 含む）で **`event.source.user_id` / `chat_id` を退避**
- `/task` handler 内の `read_gateway_session_context()` が退避値を読み **`bind_active_task`**
- 続く `yes` は `try_resolve_text` → `response.json` → runner が write 再開

**検証コマンド（Pi5）**:

```bash
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m copy -a "src=scripts/private-pi5-hermes/verify-actor-context-bind-pi5.sh dest=/tmp/verify-actor-context-bind-pi5.sh mode=0755" -b
ansible private-pi5-stackchan-bridge -i inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "sudo -u hermes /tmp/verify-actor-context-bind-pi5.sh" -b
```

**実機事象（2026-05-26 朝 · 修正前）**: 承認プロンプトは表示されたが `yes` が通常 chat に入り雑談応答 — `approvals/by-user/` **ディレクトリなし**（bind 未実行）を SSH で確認。

**仕様（write ツール承認）**:

- `write_file` / `patch` 実行直前に `pre_tool_call` が **`request.json` を作成**しブロック
- chat 側 `DiscordApprovalRelayCoordinator.watch_task` が Discord に承認依頼（従来の shell 承認と同一 store）
- ユーザーが `yes` / `/task-approve` → `response.json` → ツール実行再開
- 各ツール呼び出し前に **`clear_pending_files()`** で stale IPC を防止

**検証コマンド（Pi5 · Runbook 追記）**:

```bash
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m copy -a "src=scripts/private-pi5-hermes/verify-tool-write-approval-gate-pi5.sh dest=/tmp/verify-tool-write-approval-gate-pi5.sh mode=0755" -b
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "sudo -u hermes /tmp/verify-tool-write-approval-gate-pi5.sh" -b
```

### Discord `/task` E2E（2026-05-25 夜 · write 承認）

| テスト | 結果 | 備考 |
|--------|------|------|
| `/task List files in workspace` | OK · ~23s | read-only · 承認不要 |
| `/task Create hello-d51.txt ...` | **NG** · ~23s · 承認なしで作成 | 旧 plugin 経路（上表根因） |
| **gateway restart 後**（21:40 JST · PID 140530） | playbook verify **PASS** · write relay sim **OK** | `hello-d51-restart.txt` · `relay-restart-ok` · ~91s |
| **session context fix デプロイ後**（22:36 JST · PID 150145） | Ansible verify **PASS** · handler 直呼び **OK** · Unknown command **再発なし** | branch `fix/private-pi5-hermes-task-session-context-api` |
| Discord write `/task` 再試行（ゲートデプロイ前） | **NG** · 承認なし | `write_file` 経路（上表） |
| Discord write `/task`（**2026-05-26 ゲートデプロイ後**） | 承認表示 **OK** · `yes` **NG**（雑談） | write ゲートのみ · `by-user` 未作成（上表） |
| Discord write `/task`（**2026-05-26 actor context デプロイ後**） | 承認表示 **OK** · `yes` **OK** · ファイル作成 **NG** | poll スレッドが `response.json` を消費（上表） |
| Discord write `/task`（**2026-05-26 poll 修正デプロイ後**） | **要確認**（手動） | Pi5 smoke: poll **OK** · actor **OK** · runner 直呼び write gate smoke **FAIL**（別経路） |

正本: [ADR D5.1](../decisions/ADR-20260525-private-pi5-hermes-discord-approval-relay-d5-1.md) · [ExecPlan D5.1](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md) · [Runbook §D5.1](../runbooks/private-pi5-hermes-deploy.md#phase-d51--discord-承認中継2026-05-25--repo-実装)

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
