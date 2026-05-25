---
title: 私用 Pi5 Hermes ツール向けセキュリティ Phase D4 ExecPlan
tags: [Hermes Agent, private Pi5, tools profile, Phase D4, browser toolset, agent-browser]
audience: [開発者, 運用者]
last-verified: 2026-05-25
related:
  - private-pi5-hermes-tools-security-phase-d3-execplan.md
  - ../runbooks/private-pi5-hermes-deploy.md
  - ../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md
  - private-pi5-hermes-butler-vision-and-roadmap.md
category: plans
update-frequency: medium
---

# Phase D4 ExecPlan — file + web + browser（隔離・ローカルのみ）

## Purpose

Phase D3（**file + web**）の上で **`browser` toolset** を有効化する。ローカル **agent-browser + Chromium** のみ（クラウド browser API キー禁止）。**chat（Discord）は変更しない**。**`website_blocklist`**（D3）を維持し、**`AGENT_BROWSER_ARGS`** を tools `.env` で管理する。

## Progress

- [x] `ProfilePhase.D4` / `TOOLS_PROFILE_D4`（`file` + `web` + `browser`）
- [x] `hermes_browser_adapter.py` — browser config / env / cloud キー禁止リスト
- [x] `config_contract.py` — browser 有効時の契約（web/file 必須）
- [x] `validate_boundary_policy.py --emit-browser-env`
- [x] `config.tools.yaml.j2` / `env.tools.j2` — D4 分岐
- [x] Ansible: D4 assert · `install-browser-tooling.yml`（条件付き）· verify D4
- [x] `verify-tools-profile-deploy.sh` — `HERMES_TOOLS_PHASE=d4`
- [x] `verify-tools-browser-smoke.sh`
- [ ] 実機デプロイ（私用 Pi5 のみ）— 運用者実施
- [ ] Discord 回帰（任意）

## 前提（inventory fragment・非コミット）

```yaml
private_pi5_hermes_tools_profile_enabled: true
private_pi5_hermes_tools_dgx_llm_token: "<dedicated-tools-token>"
private_pi5_hermes_tools_file_enabled: true
private_pi5_hermes_tools_web_enabled: true
private_pi5_hermes_tools_gateway_enabled: true
private_pi5_hermes_tools_browser_enabled: true
# 任意（Pi5/ARM）:
# private_pi5_hermes_browser_agent_args: "--no-sandbox,--disable-dev-shm-usage"
```

Playbook は **D4 時に file + web + gateway + browser を assert** する。初回 Hermes install は **`--skip-browser` 維持**；browser バイナリは **D4 フラグ時のみ** `install-browser-tooling.yml`。

## 手順（実機・未実施）

1. fragment を上記に更新（`tools_browser_enabled: true`）
2. `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`
3. `HERMES_TOOLS_PHASE=d4` で `verify-tools-profile-deploy.sh`（ansible: `copy` + `shell`）
4. `verify-tools-browser-smoke.sh`（バイナリ・境界・`.env`）
5. `verify-tools-web-smoke.sh` / `verify-tools-file-smoke.sh`（D3/D2 回帰）

## 受け入れ基準

| 項目 | D4 期待 |
|------|---------|
| `hermes-tools-gateway` | **active** |
| `hermes-gateway`（chat） | **active** |
| tools `config.yaml` | D3 条件 + **`browser` が disabled_toolsets に無い** + **`browser.auto_local_for_private_urls: true`** |
| `security.website_blocklist` | D3 と同様 **enabled** |
| tools `.env` | **`AGENT_BROWSER_ARGS` あり**（既定 Pi5 向け）· **BROWSERBASE_* 等なし** |
| 境界 | `validate_boundary_policy.py` **ok** |
| DGX Bearer（tools） | **200** |

## repo 検証

```bash
python3 -m unittest discover -s scripts/private-pi5-hermes/tests -v
python3 scripts/private-pi5-hermes/validate_boundary_policy.py \
  --check-docker-volumes --emit-hermes-security --emit-browser-env
ansible-playbook infrastructure/ansible/playbooks/private-pi5-hermes.yml --syntax-check
```

## ロールバック

- `private_pi5_hermes_tools_browser_enabled: false` → 再デプロイ（**D3 相当**·Chromium 残留は許容）

## References

- [Phase D3 ExecPlan](./private-pi5-hermes-tools-security-phase-d3-execplan.md)
- [KB 脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md)
- [Hermes Browser 公式](https://hermes-agent.nousresearch.com/docs/user-guide/features/browser)
- [`hermes_browser_adapter.py`](../../scripts/private-pi5-hermes/lib/hermes_browser_adapter.py)
