# Tailscale Policy（タグ/ACL/SSH）運用台帳

最終更新: 2026-02-16

## 目的

- Tailscaleを「フルメッシュVPN」として雑に使うのではなく、端末間の横移動を最小化する。
- 端末が増えても、個体名ではなく役割（ロール/タグ）で運用できるようにする。
- 変更を段階的に適用し、問題があれば即ロールバックできる形で運用する。

## 前提（このリポジトリの運用方針）

- 通常運用は `network_mode=tailscale`（Tailscale主運用）。
- `local` は工場LAN限定で、通話等が必要な場面のみ一時的に使用する。
- SSH入口は admin(Mac) → server(Pi5) のみ。clients(Pi4/Pi3/Zero2W)への直接SSHは行わない。

## ロール（タグ）

- `tag:admin`: 運用Mac
- `tag:server`: Pi5（サーバー）
- `tag:kiosk`: Pi4（キオスク、今後増台）
- `tag:signage`: Pi3/Zero2W（サイネージ、今後増台の可能性）

補足:
- 台数が増える前提のため、「端末名での許可」は原則禁止。
- カナリア運用が必要になったら `tag:kiosk-canary` のようにタグで分離する。

## 許可する通信（Allowlistの原型）

最低限これだけ通れば業務が成立する、という線引き。

- `tag:admin` → `tag:server`: SSH（運用入口）
- `tag:server` → `tag:kiosk` / `tag:signage`: SSH（更新・保守）
- `tag:kiosk` / `tag:signage` → `tag:server`: HTTPS 443（UI/API）

NFC（Pi4）について:
- キオスク端末は自端末の `localhost:7071` を優先して使用する（WS/REST）。
- Tailnet上で `kiosk:7071` を恒常的に開けることは避ける（横移動面になるため）。

## 原則禁止（横移動面の削減）

- `tag:kiosk` ↔ `tag:kiosk`: 原則禁止
- `tag:signage` ↔ `tag:*`（server以外）: 原則禁止

## 段階適用の手順（推奨）

### Stage 0: 台帳とタグ付け

- 対象端末にタグを付ける（admin/server/kiosk/signage）。
- 端末台帳（このファイル）と現状の必須通信を一致させる。

### Stage 1: ACLを最小から締める

まずは「不要な端末間通信」を閉じ、必要なHTTPS/SSHは維持する。

チェック項目（最低限）:
- キオスクUI: `https://<Pi5>/kiosk` が表示できる
- API: `GET /api/system/health` が 200/ok
- サイネージ: `https://<Pi5>/api/signage/content` が 200
- デプロイ: Mac → Pi5 → clients が成立する

### Stage 2: `kiosk:7071` を閉じる

NFCを `localhost:7071` 優先に寄せられたら、Tailnet上の `kiosk:7071` をdenyに寄せる。

注意:
- 互換期間が必要な場合のみ、一時的に `server → kiosk:7071` を許可する。

### Stage 3: Tailscale SSH（可能なら）

Tailscale SSHを使う場合は、以下のポリシーを基本にする。

- `tag:admin` → `tag:server` のみ許可
- `tag:server` → `tag:kiosk` / `tag:signage` のみ許可
- それ以外deny

## Tailnet policy雛形（Stage別）

注意:
- Tailscaleのポリシーファイル（ACL/SSH）はTailnet管理画面で設定する（このリポジトリ内では管理しない）。
- 以下は「雛形」。実際の`tagOwners`（タグ付け権限）は、あなたのTailscaleユーザー/組織に合わせて調整する。

### 共通: tagOwners

```json
{
  "tagOwners": {
    "tag:admin": ["autogroup:admin"],
    "tag:server": ["autogroup:admin"],
    "tag:kiosk": ["autogroup:admin"],
    "tag:signage": ["autogroup:admin"]
  }
}
```

### Stage 1: 最小Allowlist（まず壊さない）

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:admin"],
      "dst": ["tag:server:22", "tag:server:443"]
    },
    {
      "action": "accept",
      "src": ["tag:server"],
      "dst": ["tag:kiosk:22", "tag:signage:22", "tag:server:443"]
    },
    {
      "action": "accept",
      "src": ["tag:kiosk", "tag:signage"],
      "dst": ["tag:server:443"]
    }
  ]
}
```

### Stage 2: `kiosk:7071` を閉じる（横移動面の削減）

- 原則: `tag:kiosk:*` への到達許可に `:7071` を含めない。
- 互換期間が必要な場合のみ、短期間だけ次を追加:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:server"],
      "dst": ["tag:kiosk:7071"]
    }
  ]
}
```

### Stage 3: Tailscale SSH（任意）

```json
{
  "ssh": [
    {
      "action": "accept",
      "src": ["tag:admin"],
      "dst": ["tag:server"],
      "users": ["root", "autogroup:nonroot"]
    },
    {
      "action": "accept",
      "src": ["tag:server"],
      "dst": ["tag:kiosk", "tag:signage"],
      "users": ["root", "autogroup:nonroot"]
    }
  ]
}
```

## 合否判定（Stageごと）

Stage 1（ACL最小）:
- MacからPi5へSSHできる
- キオスクUIが表示できる（`https://<Pi5>/kiosk`）
- `GET /api/system/health` が 200/ok
- サイネージ端末が表示更新できる（`https://<Pi5>/api/signage/content` 200）

Stage 2（`kiosk:7071`閉塞）:
- キオスク端末上でNFCが読める（`localhost:7071`経由）
- MacからキオスクのNFCを「直接」叩けなくなる（横移動面の削減）
- 既存のPi5経由の`/stream`が必要なら互換許可（`server → kiosk:7071`）のみで成立する

Stage 3（Tailscale SSH）:
- Mac→Pi5のSSHがTailscale SSHの方針に沿って通る
- Pi5→clientsのSSHが通る
- それ以外のSSHが拒否される（意図した封じ込め）

## ロールバック

- ACL: 変更前のtailnet policyへ即差し戻し
- SSH: Tailscale SSHの適用前に、従来のSSHでserverへ入れる経路が生きていることを確認してから段階適用

