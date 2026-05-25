# KB-private-pi5-hermes-tools-security-threat-model: ツール有効化前の脅威モデル

- **Status**: reference（Phase D0–D1）
- **Related**: [ADR-20260525](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md) · [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md)

## Context

Hermes 雑談プロファイルはツール無効で運用中。将来 web/browser/file/terminal を有効化する際の脅威と、Phase D0 で固定した対策をまとめる。

## 脅威と対策（D0 時点）

| 脅威 | 症状 | D0 対策 | D1+ で必要 |
|------|------|---------|------------|
| **SSRF / 内部スキャン** | web/browser が 100.x / LAN を探索 | `boundary-policy.tools.yaml` · deny RFC1918 | Hermes allowlist 連携・egress 制限 |
| **横移動（業務 Pi5）** | 私用 Pi5 から `tag:server` へ | [grants.json](../security/tailscale-policy-hermes-private-pi5-grants.json)（**admin 適用済 2026-05-24**） | 定期 verification · 業務 Pi5 tailnet 到達の再確認 |
| **トークン漏洩の影響拡大** | StackChan 漏洩で Hermes も利用可能 | DGX `LLM_SHARED_ADDITIONAL_TOKENS` · fragment 変数分離（**chat 分離済 2026-05-24**） | tools トークン・ローテーション Runbook |
| **docker 脱出** | terminal で host 相当権限 | chat/tools とも terminal 無効（D0） | rootless / 別ホスト検討 |
| **プロンプトインジェクション** | Discord 経由で危険ツール実行 | Tirith · manual 承認 · tools 無効 | ツール有効時も manual 維持 |
| **skills 供給鎖** | 悪意 SKILL.md 永続化 | skills 無効 · `allow_lazy_installs: false` | repo 管理 skill のみ |
| **ランサムウェア** | file/terminal で暗号化 | D0 はツール無効 | バックアップ・workspace 限定 |

## 境界ポリシー検証

```bash
python3 scripts/private-pi5-hermes/validate_boundary_policy.py
# 既定 policy: scripts/private-pi5-hermes/config/boundary-policy.tools.yaml
```

期待: `{"ok": true, ...}`

## 本番デプロイ知見（2026-05-24・Phase D0）

**Context**: `feat/private-pi5-hermes-docs`（`8f3dfc03` 以降の deploy 修正含む）を DGX → 私用 Pi5 に反映。雑談は従来どおり（tools プロファイル未デプロイ）。

**Symptoms / 検証**:

| チェック | 期待 | 実測 |
|----------|------|------|
| DGX `healthz` | 200 | OK |
| Pi5 `hermes-gateway` | active | OK |
| Bearer `GET /v1/models` | 200 | OK |
| `tools_profile_enabled` | false | playbook summary どおり |

**Investigation → Fix（Ansible）**:

| 症状 | 根因 | 対策 |
|------|------|------|
| `Recursive loop detected`（chat token） | playbook `vars` が `private_pi5_hermes_chat_dgx_llm_token` を自分自身で解決 | `pre_tasks` で `hostvars[inventory_hostname].get(...)` + `set_fact` |
| `config.base.yaml.j2 not found` | Jinja include が `private-pi5-hermes/...` プレフィックス付き | 同ディレクトリ `{% include 'config.base.yaml.j2' %}` |
| ローカル SSH で Pi5 不可 | 鍵が Ansible 用のみ | `ansible -i inventory-private-pi5-stackchan-bridge-fragment.yml ...` |

**Prevention**: トークン解決は playbook `vars` に置かず **inventory または `set_fact`**。プロファイル用テンプレ include は **ファイル名のみ**。CI に `ansible-playbook --syntax-check` と boundary `validate_boundary_policy.py` を維持。

## D1 チェックリスト

- [x] `private_pi5_hermes_tools_profile_enabled: true` + 専用 `private_pi5_hermes_tools_dgx_llm_token`（chat と別）
- [x] DGX `LLM_SHARED_ADDITIONAL_TOKENS` に tools トークン追記
- [x] `deploy-private-pi5-hermes.sh` + `verify-tools-profile-deploy.sh` PASS
- [x] `hermes-tools-gateway` **stopped**
- [ ] Discord 回帰 OK（手動）
- [x] Tailscale grants（2026-05-24）

## D1 本番知見（2026-05-24）

| 症状 | 根因 | Fix |
|------|------|-----|
| verify script が tools path missing | `~/.hermes-tools` **0700** | `sudo -u hermes test -e` · ansible `-b` |
| ansible inventory empty | 正本は **fragment** のみ | `-i inventory-private-pi5-stackchan-bridge-fragment.yml` |
| DGX 再デプロイ不要 | additional に chat+tools 済 | localhost Bearer 200 確認後スキップ可 |

正本: [KB Phase D1 本番](./KB-private-pi5-hermes-phase-d1-production.md).

## D2 チェックリスト（2026-05-24 完了）

- [x] `file` のみ · workspace 限定 · manual 承認
- [x] `hermes-tools-gateway` 起動（実機 active）
- [x] 実機デプロイ・`HERMES_TOOLS_PHASE=d2` 検証 PASS
- [ ] Discord 回帰（任意）

正本: [KB Phase D2 本番](./KB-private-pi5-hermes-phase-d2-production.md) · [Phase D2 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d2-execplan.md).

## D4 チェックリスト（本番反映・2026-05-25）

- [x] `file` + `web` + `browser` · workspace · `website_blocklist` 維持
- [x] `browser.auto_local_for_private_urls: true` · クラウド browser env キー禁止
- [x] `AGENT_BROWSER_ARGS` in tools `.env`（Pi5 向け既定）
- [x] `install-browser-tooling.yml`（Chromium + **agent-browser symlink**）
- [x] 実機デプロイ（私用 Pi5）· `HERMES_TOOLS_PHASE=d4` · browser smoke（契約・バイナリ・境界）
- [ ] `browser_navigate` LLM E2E（任意）
- [ ] Discord 回帰（任意）

正本: [KB Phase D4 本番](./KB-private-pi5-hermes-phase-d4-production.md) · [ExecPlan D4](../plans/private-pi5-hermes-tools-security-phase-d4-execplan.md)

## D5 チェックリスト（repo 実装・2026-05-25）

- [x] `/task` + Hermes plugin slash command（`private-pi5-discord-task-bridge`）
- [x] chat **`disabled_toolsets` 不変**（delegation 含む）
- [x] tools 実行は **isolated HOME** + **tools Bearer** · toolsets **file,web,browser 固定**
- [x] `task-bridge.policy.yaml` + prompt deny list
- [x] Ansible deploy/verify D5
- [x] 実機デプロイ（私用 Pi5）· Ansible verify + smoke — [KB D5 本番](./KB-private-pi5-hermes-phase-d5-production.md)
- [ ] Discord `/task` E2E（手動 · write + 承認 — D5.1 デプロイ後）
- [x] D5.1 承認 Discord 中継（repo 実装 · [ExecPlan D5.1](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md) · [ADR D5.1](../decisions/ADR-20260525-private-pi5-hermes-discord-approval-relay-d5-1.md)）

## D5.1 チェックリスト（repo 実装 · 2026-05-25）

- [x] `approval_relay` policy + FileApprovalStore（request/response JSON）
- [x] in-process runner + `HERMES_EXEC_ASK=1`
- [x] `/task-approve` · `/task-deny` · yes/no（`pre_gateway_dispatch`）
- [x] Ansible deploy/verify D5.1 · smoke 拡張
- [x] unittest + smoke PASS（ローカル）
- [x] 実機デプロイ（私用 Pi5）· Ansible verify + smoke — 2026-05-25
- [x] Pi5: read-only tools · write + file IPC 承認 sim — [KB D5 §D5.1](./KB-private-pi5-hermes-phase-d5-production.md#phase-d51-追記2026-05-25--repo-実装--私用-pi5-本番反映)
- [ ] Discord `/task` E2E（手動 · write + 承認 UX）

正本: [ExecPlan D5.1](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md)

正本: [ExecPlan D5](../plans/private-pi5-hermes-tools-security-phase-d5-execplan.md) · [ADR D5](../decisions/ADR-20260525-private-pi5-hermes-discord-tools-bridge-d5.md)

## D2+ チェックリスト（残）

- [ ] terminal は最後（または CLI のみ）

## AI執事化 — 先読みチェックリスト（未実施・北極星）

製品方針: [AI執事ビジョンとロードマップ](../plans/private-pi5-hermes-butler-vision-and-roadmap.md)。**chat に全ツール直結はしない**（Discord 橋 + tools プロファイル維持）。

| 能力 | 主なリスク | 有効化前に必要 |
|------|------------|----------------|
| Discord → tools 委譲 | プロンプトインジェクション · 承認 fatigue | **D5 本番（Pi5）** · `/task` 明示 · [task-bridge.policy.yaml](../../scripts/private-pi5-hermes/config/task-bridge.policy.yaml) · [KB D5](./KB-private-pi5-hermes-phase-d5-production.md) |
| memory / リマインド | プライバシー · 保持範囲 | D6 · 削除手順 · Discord 通知設計 |
| X 定時 | API/規約 · egress | D8 · boundary 拡張 |
| Home Assistant / カメラ | LAN 横移動 · 物理セキュリティ | D9 · grants/UFW · 読取専用から |
| code / terminal | docker 脱出 · ランサム | D10 · 脅威モデル「最後」遵守 |

## References

- [KB Phase D0 本番](./KB-private-pi5-hermes-phase-d0-production.md)
- [KB Phase D1 本番](./KB-private-pi5-hermes-phase-d1-production.md)
- [`boundary_policy.py`](../../scripts/private-pi5-hermes/lib/boundary_policy.py)
- [tailscale-policy-hermes-private-pi5-draft.md](../security/tailscale-policy-hermes-private-pi5-draft.md)
