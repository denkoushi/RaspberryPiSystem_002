---
title: 私用 Pi5 Hermes ツール向けセキュリティ Phase D5 ExecPlan
tags: [Hermes Agent, private Pi5, Discord, tools profile, Phase D5, task bridge]
audience: [開発者, 運用者]
last-verified: 2026-05-25
related:
  - private-pi5-hermes-tools-security-phase-d4-execplan.md
  - ../decisions/ADR-20260525-private-pi5-hermes-discord-tools-bridge-d5.md
  - ../runbooks/private-pi5-hermes-deploy.md
  - ../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md
  - private-pi5-hermes-butler-vision-and-roadmap.md
category: plans
update-frequency: medium
---

# Phase D5 ExecPlan — Discord ↔ tools 橋（最小）

## Purpose

Phase D4（**file + web + browser** on tools）の上で、**Discord から `/task` 明示コマンドのみ** tools プロファイルへ委譲する。**chat の `disabled_toolsets` は変更しない**（全ツール直結しない）。**`approvals.mode: manual` 維持**。

## Progress

- [x] `task-bridge.policy.yaml` + `task_bridge_policy.py`
- [x] `task_request.py` / `tools_profile_runner.py` / `discord_task_bridge.py`
- [x] `hermes-discord-task-bridge` CLI + `/task` plugin + Ansible `deploy-discord-task-bridge.yml`
- [x] `config.chat.yaml.j2` — `plugins.enabled: [private-pi5-discord-task-bridge]`（フラグ時のみ）
- [x] Playbook D5 assert · verify-discord-task-bridge.yml
- [x] `validate_boundary_policy.py --validate-task-bridge`
- [x] `verify-discord-task-bridge-smoke.sh` + unittest
- [ ] 実機デプロイ（私用 Pi5 のみ）
- [ ] Discord `/task` E2E（read-only 推奨）
- [ ] Discord 雑談回帰（任意）

## 前提（inventory fragment・非コミット）

D4 フラグに加え:

```yaml
private_pi5_hermes_discord_tools_bridge_enabled: true
private_pi5_hermes_gateway_enabled: true
```

Playbook は **D5 時に D4 tools + chat gateway を assert** する。

## 手順（実機・未実施）

1. fragment を上記に更新
2. `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`
3. Discord: 雑談 1 通（chat 不変）→ `/task List files in workspace` 等
4. `verify-discord-task-bridge-smoke.sh`（Pi5 上は policy 配置後）

## 受け入れ基準

| 項目 | D5 期待 |
|------|---------|
| chat `config.yaml` | **`plugins.enabled` に `private-pi5-discord-task-bridge`** · **file/web/browser/delegation は disabled のまま** |
| tools profile | D4 条件維持 · `hermes-tools-gateway` **active** |
| ブリッジ | tools HOME + tools `.env` のみ · `--toolsets file,web,browser` 固定 |
| 境界 | `task-bridge.policy.yaml` validate **ok** |
| 雑談 | 通常メッセージは **chat LLM**（ツール無効） |

## 既知リスク / follow-up

| 項目 | 内容 |
|------|------|
| manual 承認 | 非対話 `hermes chat -q` は承認待ちでタイムアウトし得る → **D5.1 Discord 承認中継** |
| intent 分類 | D5 は **`/task` 明示のみ**（LLM 自動ルーティングは後続） |

## repo 検証

```bash
python3 -m unittest discover -s scripts/private-pi5-hermes/tests -v
./scripts/private-pi5-hermes/verify-discord-task-bridge-smoke.sh
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --validate-task-bridge
ansible-playbook infrastructure/ansible/playbooks/private-pi5-hermes.yml --syntax-check
```

## ロールバック

- `private_pi5_hermes_discord_tools_bridge_enabled: false` → 再デプロイ（chat から D5 plugin を外す）

## References

- [ADR D5](../decisions/ADR-20260525-private-pi5-hermes-discord-tools-bridge-d5.md)
- [Phase D4 ExecPlan](./private-pi5-hermes-tools-security-phase-d4-execplan.md)
- [`discord_task_bridge.py`](../../scripts/private-pi5-hermes/lib/discord_task_bridge.py)
