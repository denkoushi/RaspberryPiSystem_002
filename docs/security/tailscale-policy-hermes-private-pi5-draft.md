# Tailscale ACL 草案 — 私用 Pi5（Hermes / StackChan）

- **Status**: **applied**（2026-05-24・`tagOwners` は既存 `denkoushi@github` を維持・`grants` 2件追加）
- **Related**: [tailscale-policy.md](./tailscale-policy.md) · [ADR-20260525](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md)

## 目的

私用 Pi5（Hermes・StackChan bridge）が **DGX LLM gateway のみ** に到達し、**業務 Pi5（`tag:server`）・Mac 管理端末への横移動**を抑止する。

## 推奨タグ

| タグ | ノード例 |
|------|----------|
| `tag:private-server` | 自宅私用 Pi5（`raspi5-private`・**2026-05-24 実機で付与済**） |
| `tag:llm` | DGX `dgx-local-llm-system`（既存） |
| `tag:server` | 業務 Pi5（既存） |

**命名**: [stackchan-private-pi5-tailnet-workflow-plan.md](../plans/stackchan-private-pi5-tailnet-workflow-plan.md) では `private-server`。Hermes 草案の `tag:private-home` は同一意図の別名 — **ACL では `tag:private-server` を使用**。

未タグの場合のみ Tailscale admin → Machines で `tag:private-server` を付与。

## grants 案（概念）

既存 [tailscale-policy.md](./tailscale-policy.md) の `grants` 形式に追記するイメージ:

- **許可**: `tag:private-server` → `tag:llm`: `tcp:38081` のみ（[grants.json](./tailscale-policy-hermes-private-pi5-grants.json)）
- **許可**: `tag:admin` → `tag:private-server`: `tcp:22`（運用 SSH）
- **暗黙拒否**: `tag:private-server` → `tag:server` / `tag:admin`（grants に含めない。Tailscale grants は allowlist）

StackChan bridge の LAN `192.168.128.0/24:18080` は **tailnet 非公開**（UFW で LAN のみ・既存 Runbook 通り）。

## 適用手順（手動）

1. [https://login.tailscale.com/admin/acls](https://login.tailscale.com/admin/acls) → 既存 policy の `tagOwners` / `grants` に [tailscale-policy-hermes-private-pi5-grants.json](./tailscale-policy-hermes-private-pi5-grants.json) を**マージ**（既存 `tag:server`→`tag:llm` 等は削除しない）
2. 保存後、私用 Pi5 で `sudo tailscale up --advertise-tags=tag:private-server`（タグ未反映時のみ）
3. 検証: [tailscale-policy-hermes-private-pi5-verification.sh](./tailscale-policy-hermes-private-pi5-verification.sh) を Pi5 で実行

### ベースライン（2026-05-24・ACL マージ前）

| チェック | 結果 |
|----------|------|
| `raspi5-private` タグ | `tag:private-server` |
| DGX `healthz` | **200** |
| 業務 Pi5 `100.106.158.2:443` | **timeout**（`tailscale status` に業務 Pi5 未表示） |
| Hermes Bearer → DGX | **200**（トークン分離後） |

## 注意

- ACL 誤設定で **Ansible SSH や DGX 到達が遮断**される。変更前にコンソールアクセス経路を確保する。
- 本ファイルは repo 草案。**自動適用しない**（Phase D0）。
