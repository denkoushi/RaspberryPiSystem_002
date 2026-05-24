# ADR-20260525: 私用 Pi5 Hermes ツール向けセキュリティ Phase D0

- **Status**: accepted
- **Date**: 2026-05-24

## Context

- 雑談プロファイル（[ADR-20260524](./ADR-20260524-private-pi5-hermes-security-profile.md)）は Phase C まで完了し Discord E2E が実用レベル。
- 将来 **web / browser / terminal / file / skills** を有効化する前に、攻撃面の分離とトークン・ネットワーク境界を repo で固定したい。
- DGX `gateway-server.py` は単一 `LLM_SHARED_TOKEN` のみ受理していた（StackChan と Hermes で共有）。

## Decision

### Phase D0（今回・repo のみ）

1. **プロファイル分離（骨格）**
   - **chat**: `~/.hermes` · `hermes-gateway` · Discord（現行維持）
   - **tools**: `~/.hermes-tools` · `hermes-tools-gateway` · **既定はデプロイしない**（`private_pi5_hermes_tools_profile_enabled: false`）
   - 共通 baseline: `config.base.yaml.j2`（terminal / approvals / security / display）

2. **DGX 複数 LLM トークン（後方互換）**
   - 新モジュール [`gateway_llm_auth.py`](../../scripts/dgx-local-llm-system/gateway_llm_auth.py)
   - 既存 `LLM_SHARED_TOKEN` + 任意 `LLM_SHARED_ADDITIONAL_TOKENS`（カンマ区切り）
   - StackChan は従来トークン、Hermes 専用は additional に登録

3. **Pi5 トークン変数**
   - `private_pi5_hermes_chat_dgx_llm_token`（省略時 `private_pi5_dgx_llm_shared_token`）
   - `private_pi5_hermes_tools_dgx_llm_token`（省略時 chat と同値・分離推奨）

4. **境界ポリシー正本**
   - [`boundary_policy.py`](../../scripts/private-pi5-hermes/lib/boundary_policy.py) + [`boundary-policy.tools.yaml`](../../scripts/private-pi5-hermes/config/boundary-policy.tools.yaml)
   - Hermes 本体は未接続（D0）。Ansible smoke / 将来 tool allowlist の単一ソース

5. **Ansible タスク分割**
   - `infrastructure/ansible/tasks/private-pi5-hermes/{install,ufw,deploy-chat-profile,deploy-tools-profile,keep-warm,verify}.yml`

6. **Tailscale**
   - [草案](../security/tailscale-policy-hermes-private-pi5-draft.md) + [grants.json](../security/tailscale-policy-hermes-private-pi5-grants.json)
   - **2026-05-24**: admin へ grants マージ済（`tag:private-server` · `tagOwners` は `denkoushi@github` 維持）

7. **tools プロファイルのツール**
   - **全 disabled_toolsets 維持**（web/browser 等は有効化しない）

### 明示的に repo 段階ではやらないこと（実機は 2026-05-24 に別途実施）

- tools gateway の本番起動（`tools_gateway_enabled` 既定 false）— **未実施のまま**
- Tailscale ACL の **自動**適用（admin 手動は実施済）
- web/browser/terminal の有効化

## Alternatives

| 案 | 却下理由 |
|----|----------|
| 単一 config に tools を足す | 雑談 Discord から攻撃面が一気に広がる |
| DGX gateway をプロセス複製 | 運用コスト大。additional tokens で十分 |
| `allow_private_urls: false` のみ | DGX Tailscale 到達が阻害される |

## Consequences

### 良い点

- chat 挙動を壊さず、tools / トークン / 境界を段階導入できる。
- DGX・Pi5・ドキュメントの責務が分離（SOLID）。

### 悪い点

- tools gateway は **isolated HOME**（`~/.hermes-tools/home/.hermes`）を使うため、chat と設定ファイルは分離される。ただし D0 では **tools gateway を起動しない**前提で、実機同時稼働は D1 で検証する。
- DGX 側 `LLM_SHARED_ADDITIONAL_TOKENS` は **初回手動反映**が必要（**2026-05-24 実施済**）。

### 実機到達（2026-05-24）

- DGX + 私用 Pi5 デプロイ · Hermes chat トークン分離 · Tailscale grants · Discord E2E 正常
- 正本: [KB Phase D0 本番](../knowledge-base/KB-private-pi5-hermes-phase-d0-production.md) · [Runbook](../runbooks/private-pi5-hermes-deploy.md)

## References

- [private-pi5-hermes-tools-security-phase-d0-execplan.md](../plans/private-pi5-hermes-tools-security-phase-d0-execplan.md)
- [KB-private-pi5-hermes-tools-security-threat-model.md](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md)
- [ADR-20260524](./ADR-20260524-private-pi5-hermes-security-profile.md)
