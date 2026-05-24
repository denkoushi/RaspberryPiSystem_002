---
title: 私用 Pi5 Hermes ツール向けセキュリティ Phase D2 ExecPlan
tags: [Hermes Agent, private Pi5, tools profile, Phase D2, file toolset]
audience: [開発者, 運用者]
last-verified: 2026-05-24
related:
  - private-pi5-hermes-tools-security-phase-d1-execplan.md
  - ../runbooks/private-pi5-hermes-deploy.md
  - ../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md
category: plans
update-frequency: medium
---

# Phase D2 ExecPlan — file ツールのみ（workspace 限定）

## Purpose

Phase D1 の tools 骨格の上で、**file toolset のみ**を有効化する。ファイル操作は **`~/.hermes-tools/workspace`（Docker 内 `/workspace`）** に限定し、**manual 承認**を維持する。**chat（Discord）プロファイルは変更しない**。

## Progress

- [x] `profile_phase.py` / `config_contract.py`（境界 YAML ↔ docker_volumes 契約）
- [x] `config.tools.yaml.j2` — `private_pi5_hermes_tools_file_enabled` 分岐
- [x] Ansible verify — D1（gateway inactive）/ D2（gateway active）条件分岐
- [x] `verify-tools-profile-deploy.sh` — `HERMES_TOOLS_PHASE=d1|d2`
- [x] `verify-tools-file-smoke.sh`（workspace seed・best-effort）
- [x] 実機デプロイ（私用 Pi5 のみ · 2026-05-24）
- [x] 実機検証 `HERMES_TOOLS_PHASE=d2` PASS
- [ ] Discord 回帰（任意）

## Outcomes（2026-05-24 実機）

| 項目 | 結果 |
|------|------|
| デプロイ | `PLAY RECAP` **ok=61 changed=4 failed=0**（約 131s） |
| gateway | `hermes-tools-gateway` **active** · chat **active** |
| 検証 | `verify-tools-profile-deploy.sh` + smoke **OK** |
| 記録 | [KB Phase D2 本番](../knowledge-base/KB-private-pi5-hermes-phase-d2-production.md) |

## 前提（inventory fragment・非コミット）

```yaml
private_pi5_hermes_tools_profile_enabled: true
private_pi5_hermes_tools_dgx_llm_token: "<dedicated-tools-token>"
private_pi5_hermes_tools_file_enabled: true
private_pi5_hermes_tools_gateway_enabled: true
```

Playbook は **D2 時に `tools_gateway_enabled: true` を assert** する。

## 手順（実機・2026-05-24 実施済）

1. fragment を上記に更新（`tools_file_enabled` · `tools_gateway_enabled: true`）
2. `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`
3. `HERMES_TOOLS_PHASE=d2` で `verify-tools-profile-deploy.sh`（ansible: `copy` + `shell`、[KB](../knowledge-base/KB-private-pi5-hermes-phase-d2-production.md) 参照）
4. `verify-tools-file-smoke.sh` → workspace seed OK

## 受け入れ基準

| 項目 | D2 期待 |
|------|---------|
| `hermes-tools-gateway` | **active** |
| `hermes-gateway`（chat） | **active**（従来どおり） |
| tools `config.yaml` | `docker_volumes` に `…/workspace:/workspace` · **`file` は disabled_toolsets に無い** |
| 境界 | [`boundary-policy.tools.yaml`](../../scripts/private-pi5-hermes/config/boundary-policy.tools.yaml) とマウント一致 |
| DGX Bearer（tools） | **200** |

## ロールバック

- `private_pi5_hermes_tools_file_enabled: false` · `private_pi5_hermes_tools_gateway_enabled: false` → 再デプロイ（D1 相当）

## References

- [Phase D1 ExecPlan](./private-pi5-hermes-tools-security-phase-d1-execplan.md)
- [KB 脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md)
- [`config_contract.py`](../../scripts/private-pi5-hermes/lib/config_contract.py)
