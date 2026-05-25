# KB-private-pi5-hermes-phase-d3-production: Phase D3 本番反映（file + web）

- **Status**: reference（2026-05-25 完了）
- **Related**: [Runbook §Phase D3](../runbooks/private-pi5-hermes-deploy.md#phase-d3--file--webboundary--website_blocklist-同期) · [ExecPlan D3](../plans/private-pi5-hermes-tools-security-phase-d3-execplan.md) · [KB Phase D2](./KB-private-pi5-hermes-phase-d2-production.md)

## Context

私用 Pi5 Hermes **Phase D3** — tools プロファイルで **file + web** を有効化。URL 境界の正本は [`boundary-policy.tools.yaml`](../../scripts/private-pi5-hermes/config/boundary-policy.tools.yaml)。Hermes 側は **`security.website_blocklist`**（拒否リスト）と **`model`/`custom_providers` の DGX base_url** を [`hermes_security_adapter.py`](../../scripts/private-pi5-hermes/lib/hermes_security_adapter.py) で同期。**chat（Discord）は変更なし**。**browser / terminal は無効のまま**。

**対象**: 私用 Pi5（`private-pi5-stackchan-bridge` / `raspi5-private` / Tailscale `100.89.190.21`）**のみ** · DGX / 業務 Pi 群 / Pi3 / Pi4 は対象外。

## 確定仕様（運用時点）

| 領域 | 仕様 |
|------|------|
| **chat** | 従来どおり · `hermes-gateway` active · 全 toolsets 無効 |
| **tools** | **file + web** 有効 · `terminal`/`browser` 等は disabled |
| **workspace** | `/home/hermes/.hermes-tools/workspace` → Docker `/workspace` |
| **web 境界** | `website_blocklist.enabled: true` · domains: `localhost`, `127.0.0.1`, `*.local`, `*.internal`, `192.168.128.`（adapter 出力） |
| **LLM** | tools の `base_url` は DGX プレフィックス（`http://100.118.82.72:38081/v1`）のみ |
| **gateway** | `hermes-tools-gateway` **active**（D2/D3 必須） |
| **承認** | `approvals.mode: manual`（共通 baseline） |
| **DGX** | tools 専用 Bearer（additional 済 · 本番再デプロイで 200 確認） |

## fragment（D3 必須・コミット禁止）

```yaml
private_pi5_hermes_tools_profile_enabled: true
private_pi5_hermes_tools_dgx_llm_token: "<dedicated-tools-token>"
private_pi5_hermes_tools_file_enabled: true
private_pi5_hermes_tools_web_enabled: true
private_pi5_hermes_tools_gateway_enabled: true
```

Playbook は **D3 時に `file_enabled` と `gateway_enabled` を assert** する。

## 実施タイムライン（2026-05-25）

1. **fragment**（非コミット）: 上記に **`private_pi5_hermes_tools_web_enabled: true`** を追加（D2 フラグは維持）
2. **私用 Pi5**: `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` — 初回は playbook 内 D3 assert で失敗（後述）→ **verify 修正後** `PLAY RECAP` **ok=67 changed=1 failed=0**（約 **123s**）
3. **検証**: ansible `copy` + `HERMES_TOOLS_PHASE=d3 /tmp/verify-tools-profile-deploy.sh` → **OK**
4. **D2 回帰**: `verify-tools-file-smoke.sh` → workspace seed **OK**
5. **web smoke（任意）**: Pi5 上で `smoke_urls` の curl **200**（`http://100.118.82.72:38081/healthz`）。`validate_url` 部分は **repo の `scripts/private-pi5-hermes` が必要**（`/tmp` のみ copy では `lib` 不足）— Mac からは validate **OK**、curl は tailnet 未接続で warn（best-effort）

## 検証結果（実機）

| チェック | 期待 | 実測 |
|----------|------|------|
| `hermes-tools-gateway` | active | **active** |
| `hermes-gateway`（chat） | active | **active** |
| tools config | D2 + web 非 disabled + blocklist | **OK** |
| `security:` ブロック | 1 つのみ（`website_blocklist` 内包） | **OK** |
| tools Bearer → DGX | 200 | **200** |
| chat Bearer → DGX | 200 | **200** |
| workspace seed（D2） | 書き込み可 | **OK** |
| DGX healthz curl（Pi5） | 200/204 | **200** |

## Investigation（デプロイ・検証トラブルシュート）

| 症状 | 根因 | Fix |
|------|------|-----|
| playbook D3 assert: `split('\nsecurity:\n')` が false | Ansible/Jinja の **単一引用符 `\n` は改行にならない** · `regex_findall(..., multiline=True)` も **0 件** | `splitlines() \| select('equalto', 'security:') \| length == 1` に変更（[`verify-tools-profile.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/verify-tools-profile.yml)） |
| blocklist domains の一括 `in` 検証が false | 期待文字列の **インデント不一致** · `join('\n')` も改行未展開 | **ドメインごと**に `'"' ~ item ~ '"'` が config に含まれることを loop assert |
| ansible `script` で `HERMES_TOOLS_PHASE=d3` が効かない | ad-hoc `-a` はパスのみ | `copy` → `shell -a 'HERMES_TOOLS_PHASE=d3 /tmp/...'`（[KB D2](./KB-private-pi5-hermes-phase-d2-production.md) 同型） |
| Pi5 上 `verify-tools-web-smoke.sh` が `lib` 不足 | `REPO_ROOT=/tmp` のみでは Python パッケージなし | Pi5 では **curl 部のみ実施可** · 契約検証は **Mac/repo** または **repo ツリーを copy** |

## Prevention

- D3 デプロイ前に fragment の **file + web + gateway** を確認
- 検証は **`HERMES_TOOLS_PHASE=d3`** を明示
- デプロイ正本は **`deploy-private-pi5-hermes.sh` のみ**
- playbook 内の文字列検証は **Jinja の改行エスケープ**に注意（`join("\n")` またはドメイン単位 assert）

## 未確認

- **Discord 回帰**（任意）— chat 経路未変更のため D1/D2 E2E は有効
- **browser 隔離** — Phase D3 スコープ外（次マイルストーン候補）

## Git / CI

- ブランチ: **`feat/private-pi5-hermes-d3`**
- 実装コミット: **`cfdae77a`** `feat(hermes): add Phase D3 file and web tools profile`
- 本番ドキュメント + ansible verify 修正: （本 KB 反映コミット）
- CI（初回 push）: **`26375912601`** success（`feat/private-pi5-hermes-d3`）

## 次

- **browser** 有効化は別フェーズ（sandbox / 隔離設計が必要）
- **web-smoke** を Pi5 ansible で完走させる場合は `scripts/private-pi5-hermes` ツリーごと copy するか、リモート検証を playbook 化

## References

- [Phase D3 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d3-execplan.md)
- [`hermes_security_adapter.py`](../../scripts/private-pi5-hermes/lib/hermes_security_adapter.py)
- [KB 脅威モデル](./KB-private-pi5-hermes-tools-security-threat-model.md)
