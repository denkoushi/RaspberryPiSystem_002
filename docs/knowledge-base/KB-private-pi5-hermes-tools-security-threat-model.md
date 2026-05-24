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

## D2+ チェックリスト（未実施）

- [ ] `file` のみ · workspace 限定 · manual 承認
- [ ] web URL allowlist を `boundary-policy.tools.yaml` と同期
- [ ] browser 隔離 Docker · `AGENT_BROWSER_ARGS` 実機検証
- [ ] terminal は最後（または CLI のみ）

## References

- [KB Phase D0 本番](./KB-private-pi5-hermes-phase-d0-production.md)
- [KB Phase D1 本番](./KB-private-pi5-hermes-phase-d1-production.md)
- [`boundary_policy.py`](../../scripts/private-pi5-hermes/lib/boundary_policy.py)
- [tailscale-policy-hermes-private-pi5-draft.md](../security/tailscale-policy-hermes-private-pi5-draft.md)
