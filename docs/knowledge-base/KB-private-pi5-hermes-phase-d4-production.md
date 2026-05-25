# KB-private-pi5-hermes-phase-d4-production: Phase D4 本番反映（file + web + browser）

- **Status**: reference（2026-05-25 完了）
- **Related**: [Runbook §Phase D4](../runbooks/private-pi5-hermes-deploy.md#phase-d4--file--web--browser実機本番反映2026-05-25) · [ExecPlan D4](../plans/private-pi5-hermes-tools-security-phase-d4-execplan.md) · [KB Phase D3](./KB-private-pi5-hermes-phase-d3-production.md) · [脅威モデル §D4](./KB-private-pi5-hermes-tools-security-threat-model.md#d4-チェックリストrepo-実装2026-05-25)

## Context

私用 Pi5 Hermes **Phase D4** — tools プロファイルで **file + web + browser** を有効化。browser は **ローカル agent-browser + Chromium** のみ（`BROWSERBASE_*` 等のクラウド browser API キーは fragment/template に置かない）。**`AGENT_BROWSER_ARGS`**（Pi5/ARM 向け `--no-sandbox,--disable-dev-shm-usage`）を tools `.env` に配置。**`browser.auto_local_for_private_urls: true`** で Tailscale/LAN の DGX 等はローカル Chromium 側車。**chat（Discord）は変更なし**（全 toolsets 無効のまま）。

**対象**: 私用 Pi5（`private-pi5-stackchan-bridge` / `raspi5-private` / Tailscale `100.89.190.21`）**のみ** · 業務 Pi5 / Pi3 / Pi4 / DGX 本体への Hermes D4 デプロイは対象外。

## 確定仕様（運用時点）

| 領域 | 仕様 |
|------|------|
| **chat** | 従来どおり · `hermes-gateway` active · 全 toolsets 無効 |
| **tools** | **file + web + browser** 有効 · `terminal` 等は disabled |
| **workspace** | `/home/hermes/.hermes-tools/workspace` → Docker `/workspace`（D2/D3 維持） |
| **web 境界** | D3 と同様 `security.website_blocklist.enabled: true` |
| **browser** | `disabled_toolsets` に **含めない** · `auto_local_for_private_urls: true` |
| **browser 実行** | バンドル `agent-browser`（`~/.hermes/hermes-agent/node_modules`）を **`~/.local/bin/agent-browser` に symlink** · システム **chromium**（apt） |
| **tools .env** | `AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage`（既定）· クラウド browser キー **なし** |
| **gateway** | `hermes-tools-gateway` **active** |
| **初回 Hermes install** | 従来どおり **`--skip-browser`** · browser 系は **`install-browser-tooling.yml`（D4 フラグ時のみ）** |
| **DGX** | tools 専用 Bearer **200**（デプロイ verify + 実機 smoke） |

## fragment（D4 必須・コミット禁止）

D3 フラグに加え:

```yaml
private_pi5_hermes_tools_browser_enabled: true
# 任意:
# private_pi5_hermes_browser_agent_args: "--no-sandbox,--disable-dev-shm-usage"
```

Playbook は **D4 時に file + web + gateway + browser を assert** する。

## 実施タイムライン（2026-05-25）

1. **fragment**（非コミット）: 既存 D3 設定に **`private_pi5_hermes_tools_browser_enabled: true`** を追加（運用者ローカル fragment）
2. **repo 修正**: `install-browser-tooling.yml` — 非対話 `hermes setup` は agent-browser を入れないため **node_modules → `~/.local/bin` symlink** · PATH 検証は **`bash -c` + 明示 `export PATH`**（login shell が PATH を上書きするため）
3. **私用 Pi5**: `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` — 1 回目は browser 未フラグで D4 assert 失敗 → fragment 更新後再実行 → **`PLAY RECAP` ok=78 changed=2 failed=0**（約 **132s**）
4. **検証**:
   - `HERMES_TOOLS_PHASE=d4 /tmp/verify-tools-profile-deploy.sh` → **OK**（gateway active · config · `AGENT_BROWSER_ARGS` · Bearer 200）
   - `verify-tools-browser-smoke.sh`（`REPO_ROOT=/tmp/smoke-repo` で lib 配置）→ **OK**（境界 · agent-browser PATH · chromium）

## 検証結果（実機）

| チェック | 期待 | 実測 |
|----------|------|------|
| `hermes-tools-gateway` | active | **active** |
| `hermes-gateway`（chat） | active | **active** |
| tools config | file+web+browser 有効 · blocklist · `auto_local_for_private_urls` | **OK** |
| tools `.env` | `AGENT_BROWSER_ARGS` · クラウド browser キーなし | **OK** |
| tools Bearer → DGX | 200 | **200** |
| chat Bearer → DGX | 200 | **200** |
| `agent-browser` | PATH（`~/.local/bin`） | **0.26.0** |
| chromium（apt） | 存在 | **ok** |
| boundary `validate_url` | loopback 拒否 · DGX healthz 許可 | **OK** |

## Investigation（デプロイ・検証トラブルシュート）

| 症状 | 根因 | Fix |
|------|------|-----|
| D4 playbook verify: browser が disabled のまま | fragment に **`tools_browser_enabled` 未設定**（D3 のみ） | fragment に `private_pi5_hermes_tools_browser_enabled: true` → 再デプロイ |
| `install-browser-tooling` が `hermes setup browser` 後に rc=1 | **`setup browser` サブコマンド不存在** · 非対話 `setup` / `setup tools` は **ウィザード案内のみ**で agent-browser をインストールしない | **symlink**: `~/.hermes/hermes-agent/node_modules/.bin/agent-browser` → `~/.local/bin/agent-browser`（[`install-browser-tooling.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/install-browser-tooling.yml)） |
| symlink 作成後も `command -v agent-browser` が Ansible で失敗 | **`bash -lc`** が login profile で **PATH を上書き**（`Environment=PATH` が効かない） | 検証を **`bash -c`** + コマンド内 **`export PATH=...`** に変更 |
| `verify-tools-browser-smoke` が Pi5 で `lib.boundary_policy` 不足 | `/tmp` に script のみ copy し **repo ツリー未配置** | `REPO_ROOT` 下に `scripts/private-pi5-hermes/lib` と `config/boundary-policy.tools.yaml` を配置（[KB D3](./KB-private-pi5-hermes-phase-d3-production.md) 同型） |
| 初回デプロイで D4 assert **skipped** | 上記のとおり browser フラグ off | fragment 修正後は **D4 assert / install-browser-tooling が実行**される |

## Prevention

- D4 前に fragment の **profile + file + web + gateway + browser** を一覧確認
- 検証は **`HERMES_TOOLS_PHASE=d4`** を明示（未設定は d1 扱い）
- デプロイ正本は **`deploy-private-pi5-hermes.sh` のみ**（`--limit private-pi5-stackchan-bridge` 既定）
- browser バイナリは **`hermes setup` 非対話に頼らない** — playbook の symlink + `.browser-tooling-ready` マーカー
- Pi5 上の Python 境界 smoke は **lib ツリーごと copy** する

## 未確認

- **Discord 回帰**（任意）— chat 経路・テンプレ未変更
- **`browser_navigate` 実 LLM E2E** — 本番 smoke は契約・バイナリ・境界のみ（LLM 呼び出しなし）
- **D5 Discord↔tools 橋** — ロードマップ次候補（chat にツール直結しない）

## Git / CI

- ブランチ: `feat/docs-hermes-butler-vision`（D4 実装 + 本番 KB + browser install 修正）
- 実機反映コミット後: main マージ · ローカル `main` を `git pull --ff-only origin main`

## References

- [`hermes_browser_adapter.py`](../../scripts/private-pi5-hermes/lib/hermes_browser_adapter.py)
- [`install-browser-tooling.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/install-browser-tooling.yml)
- [Hermes Browser 公式](https://hermes-agent.nousresearch.com/docs/user-guide/features/browser)
