---
title: 私用 Pi5 Hermes ツール向けセキュリティ Phase D1 ExecPlan
tags: [Hermes Agent, private Pi5, tools profile, Phase D1]
audience: [開発者, 運用者]
last-verified: 2026-05-24
related:
  - private-pi5-hermes-tools-security-phase-d0-execplan.md
  - ../runbooks/private-pi5-hermes-deploy.md
  - ../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md
category: plans
update-frequency: medium
---

# Phase D1 ExecPlan — tools プロファイル骨格（実機）

## Purpose

Phase D0 の repo 骨格を **私用 Pi5 に実機デプロイ**し、**tools 専用 DGX トークン**を追加する。`hermes-tools-gateway` は **起動しない**。Discord 雑談（chat）は回帰しないこと。

## Progress

- [x] DGX `LLM_SHARED_ADDITIONAL_TOKENS` に tools トークン追記（2026-05-24）
- [x] fragment: `private_pi5_hermes_tools_profile_enabled: true` + 専用 `private_pi5_hermes_tools_dgx_llm_token`
- [x] `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`（`PLAY RECAP` **ok=57 failed=0** · 約 123s · 2026-05-24 再実行）
- [x] `verify-tools-profile-deploy.sh` PASS（ansible `-b` · fragment inventory）
- [x] CI **`26361904957`** success（`feat/private-pi5-hermes-d1`）
- [x] `main` マージ（`15a95e13` + docs）
- [ ] Discord 回帰（任意・D0 E2E 継続有効）

## Outcomes（2026-05-24）

| 項目 | 結果 |
|------|------|
| DGX 再デプロイ | **スキップ**（additional 済 · chat/tools Bearer 200） |
| Pi5 | tools 骨格配備 · `hermes-tools-gateway` inactive · chat gateway active |
| 検証 | playbook verify-tools + shell script **OK** |
| 記録 | [KB Phase D1 本番](../knowledge-base/KB-private-pi5-hermes-phase-d1-production.md) |

## 次: Phase D2

- `file` toolset のみ有効化
- `boundary-policy.tools.yaml` の workspace パス厳守
- 危険操作は **manual 承認**（[脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md)）

## 手順

### 1. DGX（先）

1. tools トークン生成: `openssl rand -hex 32`
2. `gateway-server.env`: `LLM_SHARED_ADDITIONAL_TOKENS=<chat>,<tools>`（chat は既存を維持）
3. gateway 再起動（PID 削除 → `start-gateway-server.sh`）

### 2. fragment（非コミット）

```yaml
private_pi5_hermes_tools_profile_enabled: true
private_pi5_hermes_tools_dgx_llm_token: "<tools-token>"
private_pi5_hermes_tools_gateway_enabled: false
```

Playbook は **専用 tools トークン必須**（chat トークンと同一は assert で拒否）。

### 3. Pi5 デプロイ

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
```

### 4. 検証

```bash
# Pi5 上
./scripts/private-pi5-hermes/verify-tools-profile-deploy.sh
```

## ロールバック

- `private_pi5_hermes_tools_profile_enabled: false` → 再デプロイ（tools タスクスキップ）
- DGX additional から tools トークンを削除 → gateway 再起動

## References

- [Phase D0 ExecPlan](./private-pi5-hermes-tools-security-phase-d0-execplan.md)
- [KB Phase D0 本番](../knowledge-base/KB-private-pi5-hermes-phase-d0-production.md)
