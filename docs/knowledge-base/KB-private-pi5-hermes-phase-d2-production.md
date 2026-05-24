# KB-private-pi5-hermes-phase-d2-production: Phase D2 本番反映（file のみ）

- **Status**: reference（2026-05-24 完了）
- **Related**: [Runbook §Phase D2](../runbooks/private-pi5-hermes-deploy.md#phase-d2--file-ツールのみworkspace-限定repo-実装) · [ExecPlan D2](../plans/private-pi5-hermes-tools-security-phase-d2-execplan.md) · [KB Phase D1](./KB-private-pi5-hermes-phase-d1-production.md)

## Context

私用 Pi5 Hermes **Phase D2** — tools プロファイルで **`file` toolset のみ**を有効化し、`~/.hermes-tools/workspace` を Docker `/workspace` にバインド。**`hermes-tools-gateway` を起動**。chat（Discord）は変更なし。

**対象**: 私用 Pi5（`private-pi5-stackchan-bridge`）**のみ** · DGX / 業務 Pi 群は対象外。

## 確定仕様（運用時点）

| 領域 | 仕様 |
|------|------|
| **chat** | 従来どおり · `hermes-gateway` active · 全 toolsets 無効 |
| **tools** | `file` のみ有効 · `terminal`/`web`/`browser` 等は disabled |
| **workspace** | ホスト `/home/hermes/.hermes-tools/workspace` → コンテナ `/workspace` |
| **gateway** | `hermes-tools-gateway` **active**（D2 必須） |
| **承認** | `approvals.mode: manual`（共通 baseline） |
| **DGX** | tools 専用 Bearer（additional 済・再デプロイ不要） |

## 実施タイムライン（2026-05-24）

1. **fragment**（非コミット）: `private_pi5_hermes_tools_file_enabled: true` · `private_pi5_hermes_tools_gateway_enabled: true`（D1 時は false）
2. **私用 Pi5**: `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` — `PLAY RECAP` **ok=61 changed=4 failed=0**（約 **131s**）
3. **検証**: `HERMES_TOOLS_PHASE=d2` + `verify-tools-profile-deploy.sh` → **OK**
4. **smoke**: `verify-tools-file-smoke.sh` → workspace seed OK
5. **Git**: `feat/private-pi5-hermes-d2` @ `630cdbe13` → PR → **`main` マージ**

## fragment（D2 必須・コミット禁止）

```yaml
private_pi5_hermes_tools_profile_enabled: true
private_pi5_hermes_tools_dgx_llm_token: "<dedicated-tools-token>"
private_pi5_hermes_tools_file_enabled: true
private_pi5_hermes_tools_gateway_enabled: true
```

Playbook は **file 有効時に gateway 必須**（assert）。

## 検証結果（実機）

| チェック | 期待 | 実測 |
|----------|------|------|
| `hermes-tools-gateway` | active | **active** |
| `hermes-gateway`（chat） | active | **active** |
| tools config | workspace マウント · file 非 disabled | **OK** |
| tools Bearer → DGX | 200 | **200** |
| chat Bearer → DGX | 200 | **200** |
| workspace seed | 書き込み可 | **OK** |

## Investigation（検証手順）

| 症状 | 根因 | Fix |
|------|------|-----|
| ansible `script` で `HERMES_TOOLS_PHASE=d2` が効かない | ad-hoc の `-a` はスクリプトパスのみ | `copy` → `shell -a 'HERMES_TOOLS_PHASE=d2 /tmp/...'` |
| ansible `script` path not found | cwd が `infrastructure/ansible` | `../../scripts/private-pi5-hermes/...` |

## Prevention

- D2 デプロイ前に fragment の **file + gateway** を確認
- 検証は **`HERMES_TOOLS_PHASE=d2`** を明示（未設定は D1 期待で false negative）
- デプロイ正本は **`deploy-private-pi5-hermes.sh` のみ**

## 未確認

- **Discord 回帰**（任意）— chat 経路未変更のため D1 E2E は有効

## 次

- **Phase D3**: web URL allowlist と `boundary-policy.tools.yaml` 同期

## References

- [Phase D2 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d2-execplan.md)
- CI **`26362979630`**（`feat/private-pi5-hermes-d2` push）
