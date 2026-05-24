---
title: 私用 Pi5 Hermes ツール向けセキュリティ Phase D3 ExecPlan
tags: [Hermes Agent, private Pi5, tools profile, Phase D3, web toolset, website_blocklist]
audience: [開発者, 運用者]
last-verified: 2026-05-25
related:
  - private-pi5-hermes-tools-security-phase-d2-execplan.md
  - ../runbooks/private-pi5-hermes-deploy.md
  - ../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md
category: plans
update-frequency: medium
---

# Phase D3 ExecPlan — file + web（URL 境界同期）

## Purpose

Phase D2（**file のみ**）の上で **`web` toolset** を追加する。許可 URL の正本は [`boundary-policy.tools.yaml`](../../scripts/private-pi5-hermes/config/boundary-policy.tools.yaml)。Hermes 側は公式の **`security.website_blocklist`**（拒否リスト）+ **`model`/`custom_providers` の base_url 整合**で同期する（[`hermes_security_adapter.py`](../../scripts/private-pi5-hermes/lib/hermes_security_adapter.py)）。**chat（Discord）は変更しない**。**browser / terminal は無効のまま**。

## Progress

- [x] `ProfilePhase.D3` / `TOOLS_PROFILE_D3`（`file` + `web`）
- [x] `hermes_security_adapter.py` — boundary → Hermes blocklist
- [x] `config_contract.py` — file/web/blocklist/base_url 契約
- [x] `validate_boundary_policy.py --emit-hermes-security`
- [x] `config.tools.yaml.j2` — `private_pi5_hermes_tools_web_enabled` 分岐
- [x] Ansible deploy/verify · playbook D3 assert
- [x] `verify-tools-profile-deploy.sh` — `HERMES_TOOLS_PHASE=d3`
- [x] `verify-tools-web-smoke.sh`（boundary smoke_urls · best-effort）
- [ ] 実機デプロイ（私用 Pi5 のみ）
- [ ] 実機検証 `HERMES_TOOLS_PHASE=d3` PASS
- [ ] Discord 回帰（任意）

## 前提（inventory fragment・非コミット）

```yaml
private_pi5_hermes_tools_profile_enabled: true
private_pi5_hermes_tools_dgx_llm_token: "<dedicated-tools-token>"
private_pi5_hermes_tools_file_enabled: true
private_pi5_hermes_tools_web_enabled: true
private_pi5_hermes_tools_gateway_enabled: true
```

Playbook は **D3 時に `file_enabled` と `gateway_enabled` を assert** する。

## 手順（実機・未実施）

1. fragment を上記に更新（`tools_web_enabled: true`）
2. `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`
3. `HERMES_TOOLS_PHASE=d3` で `verify-tools-profile-deploy.sh`（ansible: `copy` + `shell`、[KB D2](../knowledge-base/KB-private-pi5-hermes-phase-d2-production.md) と同型）
4. `verify-tools-web-smoke.sh`（任意 · DGX 到達時）
5. `verify-tools-file-smoke.sh`（D2 回帰・任意）

## 受け入れ基準

| 項目 | D3 期待 |
|------|---------|
| `hermes-tools-gateway` | **active** |
| `hermes-gateway`（chat） | **active** |
| tools `config.yaml` | D2 条件に加え **`web` が disabled_toolsets に無い** · **`security.website_blocklist.enabled: true`** · blocklist domains が adapter 出力と一致 |
| LLM base_url | `allowed_url_prefixes[0]` と一致（例: `http://100.118.82.72:38081`） |
| 境界 | `validate_boundary_policy.py` **ok** · `--emit-hermes-security` で blocklist 確認 |
| DGX Bearer（tools） | **200** |

## repo 検証

```bash
python3 -m unittest discover -s scripts/private-pi5-hermes/tests -v
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --check-docker-volumes --emit-hermes-security
ansible-playbook infrastructure/ansible/playbooks/private-pi5-hermes.yml --syntax-check
```

## ロールバック

- `private_pi5_hermes_tools_web_enabled: false` → 再デプロイ（D2 相当 · file/gateway は維持可）

## References

- [Phase D2 ExecPlan](./private-pi5-hermes-tools-security-phase-d2-execplan.md)
- [KB 脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md)
- [`config_contract.py`](../../scripts/private-pi5-hermes/lib/config_contract.py)
- [Hermes Security — Website Blocklist](https://hermes-agent.nousresearch.com/docs/user-guide/configuration#website-blocklist)
