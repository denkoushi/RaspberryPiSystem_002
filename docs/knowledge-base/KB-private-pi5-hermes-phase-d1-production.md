# KB-private-pi5-hermes-phase-d1-production: Phase D1 本番反映（tools 骨格）

- **Status**: reference（2026-05-24 完了）
- **Related**: [Runbook §Phase D1](../runbooks/private-pi5-hermes-deploy.md#phase-d1--tools-プロファイル骨格実機本番反映2026-05-24) · [ExecPlan D1](../plans/private-pi5-hermes-tools-security-phase-d1-execplan.md) · [KB Phase D0](./KB-private-pi5-hermes-phase-d0-production.md) · [KB 脅威モデル](./KB-private-pi5-hermes-tools-security-threat-model.md)

## Context

私用 Pi5 Hermes **Phase D1** — `~/.hermes-tools` 骨格の実機配備、**tools 専用 DGX Bearer**、**`hermes-tools-gateway` は停止のまま**。対象は **私用 Pi5 のみ**（DGX は additional トークンが既に有効なら再設定不要）。業務 Pi 群・`update-all-clients.sh` は対象外。

## 確定仕様（運用時点）

| 領域 | 仕様 |
|------|------|
| **chat** | `~/.hermes` · `hermes-gateway` **active**（変更なし） |
| **tools** | `~/.hermes-tools` 配備済 · 全 toolsets **無効** · `hermes-tools-gateway` **inactive** |
| **DGX LLM** | primary＝StackChan · additional＝**chat + tools**（別トークン・カンマ区切り） |
| **Playbook** | tools トークン未設定または chat と同一 → **assert fail** |
| **検証** | playbook `verify-tools-profile.yml` + `verify-tools-profile-deploy.sh` |

## 実施タイムライン（2026-05-24）

1. **DGX**: `LLM_SHARED_ADDITIONAL_TOKENS` 済（chat+tools）· localhost Bearer **200×2** — **gateway 再起動スキップ**
2. **fragment**（非コミット）: `private_pi5_hermes_tools_profile_enabled: true` · 専用 `private_pi5_hermes_tools_dgx_llm_token` · `private_pi5_hermes_tools_gateway_enabled: false`
3. **私用 Pi5**: `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` — `PLAY RECAP` **ok=57 failed=0**（約 **123s**）· `tools_profile_enabled=True`
4. **追加検証**: `ansible … -m script -a verify-tools-profile-deploy.sh -b` → **OK**（paths · inactive tools gateway · chat active · Bearer 200×2）
5. **CI**: branch `feat/private-pi5-hermes-d1` · run **`26361904957`** **success**（12m16s）
6. **Git**: `15a95e13` + docs → **`main` マージ**（本 KB 同梱）

## Investigation（検証スクリプト）

| 症状 | 根因 | Fix |
|------|------|-----|
| `verify-tools-profile-deploy.sh` で path missing | `~/.hermes-tools` が **0700** · root の `test -e` 不可 | スクリプトは **`sudo -u hermes test -e`** · Ansible は **`-b`** |
| `ansible -i inventory-private-pi5-stackchan-bridge.yml` が空 inventory | 正本 inventory は **fragment のみ** | `cd infrastructure/ansible && ansible -i inventory-private-pi5-stackchan-bridge-fragment.yml …` |

## Investigation（DGX）

| 症状 | 根因 | Fix |
|------|------|-----|
| tools Bearer **403** after env edit | additional に tools が未反映 or  typo | `gateway-server.env` を確認 → PID 削除 → `start-gateway-server.sh` |
| Mac から DGX **curl timeout** | Tailscale ACL は Pi5→DGX 想定 | DGX **127.0.0.1:38081** または Pi5/ansible から検証 |

## Prevention

- tools 有効化（D2+）前に [脅威モデル D2 チェックリスト](./KB-private-pi5-hermes-tools-security-threat-model.md#d2-チェックリスト未実施) を満たす
- `hermes-tools-gateway` を **意図なく enable しない**（fragment `private_pi5_hermes_tools_gateway_enabled`）
- デプロイ正本は **`deploy-private-pi5-hermes.sh` のみ**

## 未確認・次

- **Discord 回帰**: D1 は chat テンプレ・gateway 単位を変えていないため **D0 E2E が有効**。必要なら手動 DM で再確認。
- **次マイルストーン**: **Phase D2** — `file` のみ · workspace 限定 · manual 承認（[ExecPlan D1 §次](../plans/private-pi5-hermes-tools-security-phase-d1-execplan.md)）

## References

- [Phase D1 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d1-execplan.md)
- [`verify-tools-profile-deploy.sh`](../../scripts/private-pi5-hermes/verify-tools-profile-deploy.sh)
- PR / merge: `feat/private-pi5-hermes-d1` → `main`（2026-05-24）
