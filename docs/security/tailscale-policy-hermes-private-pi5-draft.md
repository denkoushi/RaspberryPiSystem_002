# Tailscale ACL 草案 — 私用 Pi5（Hermes / StackChan）

- **Status**: draft（手動適用のみ・Phase D0）
- **Related**: [tailscale-policy.md](./tailscale-policy.md) · [ADR-20260525](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md)

## 目的

私用 Pi5（Hermes・StackChan bridge）が **DGX LLM gateway のみ** に到達し、**業務 Pi5（`tag:server`）・Mac 管理端末への横移動**を抑止する。

## 推奨タグ

| タグ | ノード例 |
|------|----------|
| `tag:private-home` | 自宅私用 Pi5（`private-pi5-stackchan-bridge` inventory） |
| `tag:llm` | DGX `dgx-local-llm-system`（既存） |
| `tag:server` | 業務 Pi5（既存） |

私用 Pi5 に `tag:private-home` を付与（Tailscale admin → Machines）。

## grants 案（概念）

既存 [tailscale-policy.md](./tailscale-policy.md) の `grants` 形式に追記するイメージ:

- **許可**: `tag:private-home` → `tag:llm`: `tcp:38081` のみ
- **許可**: `tag:admin` → `tag:private-home`: `tcp:22`（運用 SSH）
- **拒否**: `tag:private-home` → `tag:server`（全ポート）
- **拒否**: `tag:private-home` → `tag:admin`（横移動防止）

StackChan bridge の LAN `192.168.128.0/24:18080` は **tailnet 非公開**（UFW で LAN のみ・既存 Runbook 通り）。

## 適用手順（手動）

1. Tailscale admin → Access controls → 本草案を既存 JSON にマージ（**本番前にステージング tailnet で検証推奨**）
2. 私用 Pi5 に `tag:private-home` を付与
3. 私用 Pi5 から `curl -H "X-LLM-Token: …" http://100.118.82.72:38081/healthz` → **200**
4. 私用 Pi5 から業務 Pi5 tailnet IP へ `nc` / `curl` → **timeout または拒否**

## 注意

- ACL 誤設定で **Ansible SSH や DGX 到達が遮断**される。変更前にコンソールアクセス経路を確保する。
- 本ファイルは repo 草案。**自動適用しない**（Phase D0）。
