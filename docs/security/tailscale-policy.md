# Tailscale Policy（タグ/ACL/SSH）運用台帳

最終更新: 2026-02-17

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
- **重要**: Tailscaleの新しい形式では`grants`を使用します。`acls`形式（旧形式）は`tag:server:22`のようなポート指定が可能ですが、`grants`形式では`ip`フィールドで`tcp:22`のように指定します。

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

### Stage 1: 最小Allowlist（まず壊さない）- grants形式（推奨）

```json
{
  "grants": [
    {
      "src": ["tag:admin"],
      "dst": ["tag:server"],
      "ip": ["tcp:22", "tcp:443"]
    },
    {
      "src": ["tag:server"],
      "dst": ["tag:kiosk", "tag:signage"],
      "ip": ["tcp:22"]
    },
    {
      "src": ["tag:kiosk", "tag:signage"],
      "dst": ["tag:server"],
      "ip": ["tcp:443"]
    }
  ]
}
```

### Stage 1（旧形式: acls）- 参考のみ

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

### Stage 2: `kiosk:7071` を閉じる（横移動面の削減）- grants形式（推奨）

- 原則: `tag:kiosk` への到達許可に `tcp:7071` を含めない。
- 互換期間が必要な場合のみ、短期間だけ次を追加（その後削除）:

```json
{
  "grants": [
    {
      "src": ["tag:server"],
      "dst": ["tag:kiosk"],
      "ip": ["tcp:7071"]
    }
  ]
}
```

### Stage 2（旧形式: acls）- 参考のみ

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

## 実装完了記録（2026-02-17）

### Phase 1: 事前整備（完了）

- ✅ NFC WebSocketのlocalhost優先化実装
  - `apps/web/src/hooks/useNfcStream.ts`: `VITE_AGENT_WS_MODE=local`時に`ws://localhost:7071/stream`を優先、失敗時は`wss://<Pi5>/stream`へフォールバック
  - `infrastructure/ansible/templates/web.env.j2`: `VITE_AGENT_WS_MODE`を追加
  - `infrastructure/ansible/inventory.yml`: kiosk端末に`web_agent_ws_mode: "local"`を設定
- ✅ ドキュメント整備
  - `docs/guides/deployment.md`: WebRTC通話時のlocalモード切替手順、NFC WebSocketの増台対応を追記
  - `docs/security/system-inventory.md`: Tailscale運用（ロールと最小通信）を追記

### Phase 2: Tailscale標準機能の追加（完了）

- ✅ **Phase 2-0: タグ付け（完了）**
  - macbook-air → `tag:admin`
  - raspberrypi → `tag:server`
  - raspberrypi-1 → `tag:kiosk`
  - raspberrypi-2 → `tag:signage`
- ✅ **Phase 2-1: ACL最小化（完了）**
  - grants形式でポート単位の制限を適用
  - `tag:admin → tag:server: tcp:22, tcp:443`
  - `tag:kiosk/tag:signage → tag:server: tcp:443`
  - `tag:server → tag:kiosk/tag:signage: tcp:22`
- ✅ **Phase 2-2: kiosk:7071閉塞（完了）**
  - `tag:server → tag:kiosk: tcp:7071`のgrantを削除
  - Tailnet上の`kiosk:7071`へのアクセスを遮断
  - Pi4キオスクは`localhost:7071`経由でNFC Agentにアクセス（動作確認済み）

### Phase 3: 検証（完了）

- ✅ NFC（Pi4）: キオスクでタグ読み取りが反映される（local経路）
- ✅ 管理UI: `https://<Pi5>/admin`到達（許可CIDR内）
- ✅ API: `GET /api/system/health`が200/ok
- ✅ サイネージ: `https://<Pi5>/api/signage/content`が200（Pi3/Zero2W）
- ✅ デプロイ: Mac→Pi5→clients経路で`update-all-clients.sh`が成功
- ✅ WebRTC: `local`モード（工場LAN）でのみ通話が成立（実機検証完了）

### 知見・トラブルシューティング

- **grants形式でのポート指定**: `dst`フィールドに`tag:server:22`のような形式は無効。`ip`フィールドで`tcp:22`のように指定する必要がある（KB-264参照）
- **NFC WebSocketの動作確認**: ビルド済みJSファイル（`/srv/site/assets/index-*.js`）に`localhost:7071`優先ロジックが含まれていることを確認
- **Tailnet上の横移動面削減**: Mac→Pi4:7071がタイムアウト（到達不可）であることを確認

## ロールバック

- ACL: 変更前のtailnet policyへ即差し戻し
- SSH: Tailscale SSHの適用前に、従来のSSHでserverへ入れる経路が生きていることを確認してから段階適用

