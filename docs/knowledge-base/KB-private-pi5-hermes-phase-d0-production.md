# KB-private-pi5-hermes-phase-d0-production: Phase D0 本番反映・運用到達

- **Status**: reference（2026-05-24 完了）
- **Related**: [Runbook](../runbooks/private-pi5-hermes-deploy.md) · [ExecPlan D0](../plans/private-pi5-hermes-tools-security-phase-d0-execplan.md) · [ADR-20260525](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md)

## Context

私用 Pi5 Hermes の **Phase D0**（chat/tools 分離骨格・DGX 複数トークン・境界ポリシー・Tailscale grants）を、**業務 Pi 群を触らず** DGX → 私用 Pi5 の順で本番反映した記録。

## 確定仕様（運用時点）

| 領域 | 仕様 |
|------|------|
| **プロファイル** | **chat のみ**稼働（`~/.hermes` · `hermes-gateway`） |
| **tools** | repo/Ansible 骨格あり・**実機未デプロイ**（fragment 未設定） |
| **DGX LLM** | primary＝StackChan · additional＝Hermes chat（Bearer） |
| **Tailscale** | `tag:private-server` · DGX `38081` のみ許可 · admin→私用 Pi5 SSH |
| **Discord** | 許可 User のみ · 全 toolsets 無効 · `max_tokens` 128 · thinking off（gateway 注入） |

## 実施タイムライン

1. **DGX**: `gateway-server.py` + `gateway_llm_auth.py` scp → gateway 再起動
2. **私用 Pi5**: `deploy-private-pi5-hermes.sh`（Ansible 修正含む）
3. **トークン分離**: `LLM_SHARED_ADDITIONAL_TOKENS` + fragment `private_pi5_hermes_chat_dgx_llm_token` → 再デプロイ
4. **Tailscale**: admin に grants 2 件追加（`tagOwners` は既存 `denkoushi@github` 維持）
5. **E2E**: Discord 応答確認（分離後も正常）

## Investigation（Ansible）

| 症状 | 根因 | Fix |
|------|------|-----|
| `Recursive loop detected` | playbook `vars` で chat トークンを同名解決 | `pre_tasks` `set_fact` + `hostvars` |
| `config.base.yaml.j2 not found` | Jinja include パス | 同ディレクトリ `config.base.yaml.j2` |
| `test_gateway_server` import 失敗 | `gateway_llm_auth` が path 外 | `sys.path.insert`（テスト） |

## Investigation（Tailscale admin）

| 症状 | 根因 | Fix |
|------|------|-----|
| `duplicate name tag:private-server` | `tagOwners` に既存キーへ再追加 | **grants のみ**追加 |

## Investigation（認証・到達）

| 症状 | 根因 | Fix |
|------|------|-----|
| Mac→Pi5 SSH denied | 鍵は Ansible 用 | inventory 経由 ansible |
| Mac→DGX curl timeout | ACL は Pi5→DGX 想定 | DGX localhost または Pi5 から検証 |

## Prevention

- トークン・秘密は **fragment のみ**（`.gitignore`）
- デプロイは **`deploy-private-pi5-hermes.sh` のみ**（`update-all-clients.sh` 禁止）
- Tailscale 変更前に **verification.sh** のベースラインを取る
- Phase D1 前に [脅威モデル](./KB-private-pi5-hermes-tools-security-threat-model.md) チェックリストを再読

## References

- [KB 脅威モデル](./KB-private-pi5-hermes-tools-security-threat-model.md)
- [KB Discord E2E](./KB-private-pi5-hermes-discord-e2e-and-latency.md)
- [KB 403](./KB-private-pi5-hermes-dgx-403-bearer-token.md)
