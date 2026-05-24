---
title: 私用 Pi5 Hermes ツール向けセキュリティ Phase D0 ExecPlan
tags: [Hermes Agent, private Pi5, DGX Spark, security, Phase D0]
audience: [開発者, 運用者]
last-verified: 2026-05-24（実機・Tailscale 適用済）
related:
  - ../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md
  - ../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md
  - private-pi5-hermes-agent-plan.md
  - ../runbooks/private-pi5-hermes-deploy.md
category: plans
update-frequency: medium
---

# 私用 Pi5 Hermes ツール向けセキュリティ Phase D0 ExecPlan

## Purpose

将来 web/browser/tool を有効化する前に、**chat と tools のプロファイル分離**・**DGX 複数トークン**・**境界ポリシー正本**を repo に固定する。雑談（Discord）は **現行どおり**（tools はデプロイ・起動しない）。

完了後、ローカルで単体テストと Ansible syntax-check が通り、運用者は D1 以降の手順が ADR/KB/Runbook から辿れる。

## Progress

- [x] `gateway_llm_auth.py` + `gateway-server.py` 複数トークン
- [x] `scripts/private-pi5-hermes/lib/` 境界・プロファイル spec
- [x] Ansible テンプレ分割 + tasks 分割
- [x] ADR / KB / Tailscale 草案 / 本 ExecPlan
- [x] 実機: DGX `gateway-server.py` + `gateway_llm_auth.py` 反映・再起動（2026-05-24）
- [x] 実機: 私用 Pi5 Ansible デプロイ（chat のみ・tools 骨格 OFF）
- [x] 実機: DGX `LLM_SHARED_ADDITIONAL_TOKENS` 反映（Hermes chat 専用・2026-05-24）
- [x] 実機: Tailscale grants マージ（admin 保存・`tag:private-server` · verification PASS）
- [x] Discord E2E（トークン分離後・ユーザー確認 正常）
- [ ] 実機: `private_pi5_hermes_tools_profile_enabled: true`（**Phase D1**）

## マイルストーン（2026-05-24・運用到達点）

**Phase D0 は「repo + 私用 Pi5/DGX 実機 + ネットワーク・トークン分離」まで完了**。雑談は **Phase C と同品質**（8.7〜10.7 s/通）を維持。

| 日付 | 作業 | コミット例 |
|------|------|------------|
| 同日 AM | repo 実装・`main` マージ（`0bee0f73` 含む） | `8f3dfc03` … `0bee0f73` |
| 同日 | DGX→Pi5 順次デプロイ・Ansible 修正 | Runbook §本番反映 |
| 同日 | Hermes chat トークン分離 | `f3c6be1e`（docs） |
| 同日 | Tailscale grants 適用 | `6ba313c6` … `65d21c3f`（docs） |

## 本番反映（2026-05-24）

**順序**: DGX → 私用 Pi5（各 1 台）。詳細・トラブルシュート: [Runbook §本番反映](../runbooks/private-pi5-hermes-deploy.md#本番反映2026-05-24phase-d0-骨格私用-pi5--dgx-順次)。

**Surprises**:

- Ansible playbook `vars` のトークン解決式は **同名キーで再帰**する。`hostvars` + `set_fact` が必須。
- `config.chat.yaml.j2` の Jinja `include` は **テンプレート相対パス**（`config.base.yaml.j2`）にしないと tasks 配下から失敗する。
- ローカル `unittest` の `load_module()` は `gateway_llm_auth` を import するため **`sys.path` に `scripts/dgx-local-llm-system` を追加**する必要がある（`test_gateway_server.py` 修正済み）。

## 検証（repo ローカル）

```bash
python3 -m unittest discover -s scripts/dgx-local-llm-system/tests -p 'test_*.py'
python3 -m unittest discover -s scripts/private-pi5-hermes/tests -p 'test_*.py'
python3 scripts/private-pi5-hermes/validate_boundary_policy.py
cd infrastructure/ansible && ansible-playbook playbooks/private-pi5-hermes.yml --syntax-check \
  -i inventory-private-pi5-stackchan-bridge-fragment.sample.yml
```

## DGX 手動反映（トークン分離）— **実施済 2026-05-24**

1. Hermes chat 用トークンを `openssl rand -hex 32` 等で生成
2. DGX `gateway-server.env` に `LLM_SHARED_ADDITIONAL_TOKENS=<chat-token>` を追記（`LLM_SHARED_TOKEN` は StackChan 用のまま）
3. gateway 再起動（PID 削除 → `start-gateway-server.sh`）
4. fragment に `private_pi5_hermes_chat_dgx_llm_token` を設定 → Pi5 再デプロイ

詳細: [Runbook §トークン分離](../runbooks/private-pi5-hermes-deploy.md#トークン分離2026-05-24-実施)。

## Tailscale — **実施済 2026-05-24**

- `tagOwners` の `tag:private-server` は **`denkoushi@github` を維持**（repo 案の `autogroup:admin` とは別で可）
- `grants` 2 件のみ admin に追加
- 検証 script PASS

## D1 以降（次マイルストーン）

[KB 脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md) のチェックリストに従う。

## References

- [ADR-20260525](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md)
