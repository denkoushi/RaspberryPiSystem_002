---
title: 私用 Pi5 Hermes ツール向けセキュリティ Phase D0 ExecPlan
tags: [Hermes Agent, private Pi5, DGX Spark, security, Phase D0]
audience: [開発者, 運用者]
last-verified: 2026-05-24
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
- [ ] 実機: `private_pi5_hermes_tools_profile_enabled: true`（D1）

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

## DGX 手動反映（トークン分離）

1. Hermes chat 用トークンを生成（StackChan 用と別）
2. DGX `/srv/dgx/system-prod/secrets/gateway-server.env` に追記:

   ```dotenv
   LLM_SHARED_ADDITIONAL_TOKENS=hermes-chat-token,hermes-tools-token
   ```

3. gateway 再起動（[Runbook §gateway PID](../runbooks/dgx-system-prod-local-llm.md) 参照）
4. fragment に `private_pi5_hermes_chat_dgx_llm_token` を設定

## D1 以降

[KB 脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md) のチェックリストに従う。

## References

- [ADR-20260525](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md)
