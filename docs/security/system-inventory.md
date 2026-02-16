# セキュリティ評価向け システム構造台帳

最終更新: 2026-01-28

## 目的

セキュリティ評価の前提となる「現在のシステム構造」を整理し、評価対象・攻撃面・外部連携・秘密情報の所在を明確化する。

## 対象範囲

- **評価対象**: Pi5（サーバー）、Pi4（キオスク）、Pi3（サイネージ）
- **評価対象外**: 物理セキュリティ、外部サービス側のセキュリティ設定

## コンポーネント構成（概要）

- **Pi5（サーバー）**
  - API: Fastify + Prisma + PostgreSQL
  - Web UI: React + Vite
  - Reverse Proxy: Caddy（TLS終端）
  - 監視: security-monitor / fail2ban / ClamAV / Trivy / rkhunter
- **Pi4（キオスク）**
  - Web UI（キオスク画面）
  - NFC Agent（Python、WebSocket）
- **Pi3（サイネージ）**
  - サイネージ表示（軽量クライアント）

参考: [docs/architecture/overview.md](../architecture/overview.md)

## データフロー（主要）

1. **認証フロー**
   - `/api/auth/login` → JWT（access/refresh）
   - AuthorizationヘッダーにBearerトークンを付与
2. **NFC持出フロー**
   - NFC Agent → WebSocket → Web UI → API（POST）
3. **サイネージ配信**
   - APIがレンダリング済み画像/構成を配信

参考: [docs/architecture/overview.md](../architecture/overview.md)

## 外部連携（攻撃面に影響する統合）

- **Dropbox**: バックアップ保存/復元
- **Gmail**: CSV自動インポート
- **Slack**: キオスク問い合わせ通知
- **Tailscale**: 通常運用の安全な接続経路（localは緊急時のみ）

参考: [docs/guides/external-integration-ledger.md](../guides/external-integration-ledger.md)

## Tailscale運用（ロールと最小通信）

目的: 端末台数が増えても、個体依存ではなく「役割（ロール）」でアクセス制御を維持し、横移動（端末間）を最小化する。

### ロール（タグの想定）

- **admin**: 運用Mac（開発・デプロイ指示端末）
- **server**: Pi5（サーバー）
- **kiosk**: Pi4/将来のキオスク端末群（入力・NFC等）
- **signage**: Pi3/Zero2W等のサイネージ端末群（表示専用）

### 必須通信（Allowlistの原型）

- **admin → server**: SSH（運用入口をPi5に固定）
- **kiosk → server**: HTTPS 443（`/kiosk`、`/api/*` 等）
- **signage → server**: HTTPS 443（表示コンテンツ取得）
- **server → kiosk/signage**: SSH（更新・保守）
- **kiosk内ループバック**: `ws://localhost:7071/stream`、`http://localhost:7071/api/agent/*`（NFC Agent）

### 原則禁止（横移動面の削減）

- **client ↔ client**（kiosk↔kiosk、signage↔kiosk、signage↔signage など）は原則不要のため禁止に寄せる

### 運用上の割り切り（WebRTC通話）

- WebRTC通話は同一LAN内のみで良い（遠隔通話は不要）方針とし、通話時のみ `local` モードへ切り替えて運用する。
  - これにより Tailnet 側の client↔client を恒常的に許可せずに済む。

## 公開面（Attack Surface）

- **公開ポート**: 22/80/443/5900（詳細はポート監査ドキュメント参照）
- **内部限定ポート**: 5432/8080（Docker内部のみ）
- **管理画面**: IP制限あり

参考: [docs/security/port-security-audit.md](./port-security-audit.md), [docs/security/port-security-verification-results.md](./port-security-verification-results.md)

## 認証方式の分類

- **JWT認証**: 管理画面/API
- **RBAC**: ADMIN/MANAGER/VIEWER
- **MFA**: 管理画面の追加強化（TOTP/バックアップコード）
- **`x-client-key`認証**: キオスク系API

参考: [docs/api/auth.md](../api/auth.md), [docs/security/requirements.md](./requirements.md)

## 秘密情報の所在

- **Ansible Vault**: `infrastructure/ansible/host_vars/*/vault.yml`
  - Dropbox App Key/Secret/Refresh Token
  - Slack Webhook URL
- **backup.json**: `/opt/RaspberryPiSystem_002/config/backup.json`
  - Gmail OAuth設定・トークン
  - Dropbox OAuthトークン
- **環境変数**: `infrastructure/docker/.env`（Ansibleで生成）
- **証明書**: `/opt/RaspberryPiSystem_002/certs/`

参考: [docs/guides/external-integration-ledger.md](../guides/external-integration-ledger.md), [docs/security/requirements.md](./requirements.md)

## 差分確認ポイント（今回評価で必ず確認）

- 新規エンドポイント追加の有無（認証/認可の適用漏れ）
- `x-client-key`系APIの情報最小化・列挙耐性
- 監視・アラート機能の設定変更有無
- Docker Compose設定のハードニング状況（readOnlyRootFilesystem等）

