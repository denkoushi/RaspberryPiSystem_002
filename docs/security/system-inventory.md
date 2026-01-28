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
- **Tailscale**: メンテナンス時の安全なリモート接続

参考: [docs/guides/external-integration-ledger.md](../guides/external-integration-ledger.md)

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

