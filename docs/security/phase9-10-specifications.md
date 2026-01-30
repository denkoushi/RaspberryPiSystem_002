# Phase 9/10 セキュリティ機能詳細仕様書

最終更新: 2026-01-03

## 概要

本ドキュメントでは、Phase 9（インターネット接続時の追加防御）およびPhase 10（認証・監視強化）で実装したセキュリティ機能の詳細仕様を記録します。今後の実装・運用・保守時に参照できるよう、設定方法、動作仕様、API仕様、テスト方法を詳細に記載します。

## Phase 9: インターネット接続時の追加防御

### 1. 管理画面へのIP制限

#### 概要
Caddyのマッチャー機能を使用して、管理画面（`/admin*`）へのアクセスを許可ネットワークに限定します。

#### 実装詳細

**設定ファイル**: `infrastructure/docker/Caddyfile.local.template`、`infrastructure/docker/Caddyfile.production`

**設定方法**:
```caddy
# 管理画面へのIP制限（Tailscale / ローカルLAN をデフォルト許可）
# 環境変数 ADMIN_ALLOW_NETS で上書き可能（空白区切りのCIDRリスト）
@admin_protect {
  path /admin*
  not remote_ip {$ADMIN_ALLOW_NETS:192.168.10.0/24 192.168.128.0/24 100.64.0.0/10 127.0.0.1/32}
}
respond @admin_protect "Forbidden" 403
```

**環境変数設定** (`docker-compose.server.yml`):
```yaml
web:
  environment:
    ADMIN_ALLOW_NETS: ${ADMIN_ALLOW_NETS:-"192.168.10.0/24 192.168.128.0/24 100.64.0.0/10 127.0.0.1/32"}
```

**デフォルト許可ネットワーク**:
- `192.168.10.0/24`: ローカルネットワーク（オフィス）
- `192.168.128.0/24`: 自宅ネットワーク（VNC用）
- `100.64.0.0/10`: Tailscaleネットワーク（通常運用）
- `127.0.0.1/32`: ローカルホスト

**動作仕様**:
- 許可ネットワークからのアクセス: 200/302（正常）
- 非許可ネットワークからのアクセス: 403 Forbidden
- 環境変数`ADMIN_ALLOW_NETS`が設定されていない場合、デフォルト値が使用される
- Caddyの`remote_ip`マッチャーを使用してクライアントIPを判定

**テスト方法**:
```bash
# 許可IPからのアクセス確認
curl -kI https://<pi5>/admin
# → 200または302が返ることを確認

# 非許可IPからのアクセス確認（ADMIN_ALLOW_NETSを一時的に変更）
# → 403が返ることを確認
```

**実機テスト結果（2025-12-14）**:
- ✅ 許可IP（Tailscale経由）から `curl -kI https://100.106.158.2/admin` が200 OKを確認
- ✅ `ADMIN_ALLOW_NETS`環境変数が正しく設定されていることを確認

**関連ドキュメント**:
- `docs/guides/deployment.md`: IP制限手順とTailscale ACL推奨

---

### 2. アラートの外部通知（Webhook）

#### 概要
`generate-alert.sh`スクリプトにWebhook送信機能を追加し、Slack等の外部サービスへアラートを通知できるようにします。

#### 実装詳細

**スクリプト**: `scripts/generate-alert.sh`

**環境変数**:
- `WEBHOOK_URL`: Webhook送信先URL（未設定時はファイルアラートのみ）
- `WEBHOOK_TIMEOUT_SECONDS`: Webhook送信タイムアウト（デフォルト: 5秒）

**動作仕様**:
1. アラートファイルを`alerts/alert-{timestamp}.json`に生成
2. `WEBHOOK_URL`が設定されている場合、JSONペイロードをPOST送信
3. Webhook送信失敗時は警告を出力するが、スクリプトは継続（ファイルアラートは必ず生成）

**Webhookペイロード形式**:
```json
{
  "type": "alert-type",
  "message": "Alert message",
  "details": "Additional details",
  "timestamp": "2025-12-14T06:28:21Z"
}
```

**Ansible設定** (`infrastructure/ansible/group_vars/all.yml`):
```yaml
alert_webhook_url: ""  # Webhook URL（未設定時は空文字）
alert_webhook_timeout_seconds: 5
```

**security-monitor.shからの呼び出し**:
- `security-monitor.sh.j2`テンプレートから環境変数として渡される
- fail2ban Ban、ファイル整合性、プロセス欠落、許可外ポート検知時に呼び出される

**テスト方法**:
```bash
# Webhook URL未設定時（ファイルアラートのみ）
WEBHOOK_URL='' bash scripts/generate-alert.sh test 'Test alert' 'Details'

# Webhook URL設定時
WEBHOOK_URL='https://httpbin.org/post' bash scripts/generate-alert.sh test 'Test alert' 'Details'
```

**実機テスト結果（2025-12-14）**:
- ✅ Webhook URL未設定時はファイルアラートのみ生成されることを確認
- ✅ Webhook URL設定時（`https://httpbin.org/post`）にWebhook送信が成功することを確認
- ✅ `security-monitor.sh`から`generate-alert.sh`が正しく呼び出されることを確認

#### セキュリティ上の注意（運用ルール）

- **Webhook URLは機密情報**:
  - Webhook URLは、完全なURLだけでなく **部分文字列（先頭/末尾の一部）もログに出力しない**。
  - ログに残す必要がある場合は、`requestId` 等の相関IDのみとする。
- **目的**:
  - ログ（APIログ、監視ログ、CIログ等）からWebhook URLが復元・推測されるリスクを避ける。
- **実装例**:
  - `apps/api/src/services/notifications/slack-webhook.ts` では、Webhook URLの部分文字列をログに出力しないように実装する。
  - ログメッセージは `"Webhook URL is set"` のような汎用的な表現を使用する。

---

### 3. Dockerイメージ単位のTrivyスキャン

#### 概要
CI/CDパイプラインとPi5上での定期実行で、Dockerイメージ単位の脆弱性スキャンを実施します。

#### 実装詳細

**CI設定** (`.github/workflows/ci.yml`):
- API/Webイメージをビルドして`trivy image`でスキャン
- HIGH/CRITICAL脆弱性でFail
- `skip-dirs`で`certs/alerts`を除外

**定期実行スクリプト** (`infrastructure/ansible/templates/trivy-image-scan.sh.j2`):
- Pi5上でcronで毎日4時に実行
- スキャン結果を`/var/log/trivy/trivy-image-{timestamp}.log`に記録
- 検知時は`generate-alert.sh`でアラート生成（Webhook通知対応）

**スキャン対象**:
- `docker-api:latest`
- `docker-web:latest`

**テスト方法**:
- CI: GitHub Actionsの結果を確認
- Pi5上: 次回デプロイ後に定期実行を確認

---

### 4. セキュリティヘッダー

#### 概要
Caddyの`header`ディレクティブを使用して、すべてのHTTPSレスポンスにセキュリティヘッダーを追加します。

#### 実装詳細

**設定ファイル**: `infrastructure/docker/Caddyfile.local.template`

**設定内容**:
```caddy
# セキュリティヘッダー
header {
  Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
  X-Content-Type-Options "nosniff"
  X-Frame-Options "DENY"
  X-XSS-Protection "1; mode=block"
  Referrer-Policy "strict-origin-when-cross-origin"
}
```

**各ヘッダーの説明**:
- `Strict-Transport-Security`: HSTS（HTTP Strict Transport Security）、1年間有効、サブドメイン含む、preload対応
- `X-Content-Type-Options: nosniff`: MIMEタイプスニッフィング攻撃を防止
- `X-Frame-Options: DENY`: クリックジャッキング攻撃を防止
- `X-XSS-Protection: 1; mode=block`: XSS攻撃の検知とブロック
- `Referrer-Policy: strict-origin-when-cross-origin`: リファラー情報の漏洩を制限

**テストスクリプト**: `scripts/test/check-caddy-https-headers.sh`

**テスト方法**:
```bash
export TARGET_HOST="100.106.158.2"
bash scripts/test/check-caddy-https-headers.sh
```

**実機テスト結果（2025-12-14）**:
- ✅ HTTP→HTTPSリダイレクト（301）を確認
- ✅ 主要セキュリティヘッダーがすべて確認できた

---

### 5. DDoS/ブルートフォース緩和（レート制限）

#### 概要
Fastifyの`@fastify/rate-limit`プラグインを使用して、APIエンドポイントごとにレート制限を設定します。

#### 実装詳細

**実装ファイル**: `apps/api/src/plugins/rate-limit.ts`

**レート制限設定**:
- **グローバル**: 120 req/min（全エンドポイントのデフォルト）
- **認証エンドポイント** (`/api/auth/login`, `/api/auth/refresh`): 10 req/min
- **システムAPI** (`/api/system/*`): 60 req/min（グローバル制限が適用）
- **管理画面API** (`/api/admin/*`): 30 req/min（グローバル制限が適用）

**スキップ対象（allowList）**:
- `/api/kiosk/*`: キオスク用API
- `/api/tools/*`: ツール用API
- `/api/imports/*`: インポートAPI
- `/ws`: WebSocket
- `/api/signage/*`: サイネージAPI
- `/api/storage/*`: ストレージAPI

**キー生成方法**:
- `{IP}:{URL}`形式でエンドポイント別にカウント
- 同一IPから異なるエンドポイントへのアクセスは別々にカウント

**エラーレスポンス**:
```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Retry in {after}."
}
```

**テスト方法**:
```bash
# 認証エンドポイントのレート制限テスト（10 req/min）
for i in {1..15}; do
  curl -k -X POST https://<pi5>/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"test"}'
done
# → 10回の401の後、5回の429が返ることを確認

# システムAPIのレート制限テスト（120 req/min）
for i in {1..130}; do
  curl -k https://<pi5>/api/system/health
done
# → 120回の200の後、10回の429が返ることを確認
```

**実機テスト結果（2025-12-14）**:
- ✅ 認証エンドポイントで10 req/minのレート制限が正しく動作
- ✅ システムAPIで120 req/minのグローバルレート制限が正しく動作

---

### 6. ログ保持とローテーション

#### 概要
セキュリティログの長期保持とローテーション設定を実装します。

#### 実装詳細

**設定ファイル**: `infrastructure/ansible/templates/logrotate-security.conf.j2`

**ログローテーション設定**:
- **fail2ban**: `/var/log/fail2ban.log` - 週次ローテーション、52週保持
- **ClamAV**: `/var/log/clamav/*.log` - 週次ローテーション、52週保持
- **Trivy**: `/var/log/trivy/*.log` - 週次ローテーション、52週保持
- **rkhunter**: `/var/log/rkhunter/*.log` - 週次ローテーション、52週保持
- **alerts**: `/opt/RaspberryPiSystem_002/alerts/*.json` - 週次ローテーション、26週保持

**デプロイ方法**:
- Ansibleタスク（`infrastructure/ansible/roles/server/tasks/security.yml`）で`/etc/logrotate.d/raspisys-security`に配置
- 次回デプロイ時に適用予定

**容量影響**:
- 52週保持で約数GB程度の想定
- 外部ストレージ/リモート転送は現時点では不要と判断（ローカル運用が主のため）

**実機テスト結果（2025-12-14）**:
- ✅ セキュリティログファイルが存在し、正常に記録されていることを確認
- ⚠️ ログローテーション設定は次回デプロイ時に適用予定

---

### 7. リクエストログの機密情報取り扱い（運用ルール）

#### 概要
APIリクエストログにおいて、機密情報（`x-client-key`、Webhook URL等）を適切に秘匿する運用ルールを定義します。

#### 実装詳細

**対象となる機密情報**:
- `x-client-key`: キオスク端末の認証キー（機密情報）
- `Authorization` ヘッダー: JWTトークン（既に`[REDACTED]`として処理済み）
- Webhook URL: 外部通知サービスのWebhook URL（部分文字列も含めて秘匿）

**運用ルール**:

1. **`x-client-key`のログ出力**:
   - `x-client-key` は機密情報として扱い、ログには出力しない。
   - 必要に応じて `[REDACTED]` またはハッシュ化した値のみをログに記録する。
   - **実装例**: `apps/api/src/plugins/request-logger.ts` で `x-client-key` を `[REDACTED]` に置換する。

2. **Webhook URLのログ出力**:
   - Webhook URLは、完全なURLだけでなく **部分文字列（先頭/末尾の一部）もログに出力しない**。
   - ログに残す必要がある場合は、`requestId` 等の相関IDのみとする。
   - **実装例**: `apps/api/src/services/notifications/slack-webhook.ts` では、ログメッセージを `"Webhook URL is set"` のような汎用的な表現に変更する。

3. **目的**:
   - ログ（APIログ、監視ログ、CIログ等）から機密情報が復元・推測されるリスクを避ける。
   - ログの漏洩時にも、機密情報が含まれないようにする。

**実装ファイル**:
- `apps/api/src/plugins/request-logger.ts`: リクエストログの機密情報秘匿処理
- `apps/api/src/services/notifications/slack-webhook.ts`: Webhook送信時のログ出力

**優先度**: 🟡 中優先度（将来の実装時に考慮）

**関連要件**: [セキュリティ要件定義](./requirements.md)の「2.6 キオスクAPIの個人情報最小化・列挙耐性（将来要件）」を参照

---

## Phase 10: 認証・監視強化

### 1. MFA（多要素認証）

#### 概要
管理画面ログインにTOTP（Time-based One-Time Password）コードを必須化し、バックアップコードと30日記憶オプションを提供します。

#### 実装詳細

**データベーススキーマ** (`prisma/schema.prisma`):
```prisma
model User {
  // ... existing fields
  mfaEnabled      Boolean   @default(false)
  totpSecret     String?   @unique
  mfaBackupCodes String?   // JSON配列をハッシュ化して保存
}
```

**APIエンドポイント**:

1. **MFA初期化** (`POST /api/auth/mfa/initiate`)
   - レスポンス: `{ secret: string, otpauthUrl: string, backupCodes: string[] }`
   - バックアップコードは10個生成（各4文字以上）

2. **MFA有効化** (`POST /api/auth/mfa/activate`)
   - リクエスト: `{ secret: string, code: string, backupCodes: string[] }`
   - TOTPコードを検証して有効化

3. **MFA無効化** (`POST /api/auth/mfa/disable`)
   - リクエスト: `{ password: string }`
   - パスワード確認後に無効化

4. **ログイン** (`POST /api/auth/login`)
   - リクエスト: `{ username: string, password: string, totpCode?: string, backupCode?: string, rememberMe?: boolean }`
   - MFA有効時は`totpCode`または`backupCode`が必須
   - `rememberMe: true`時は30日間有効なトークンを発行

**フロントエンド実装**:
- ログイン画面: TOTPコード入力欄を追加
- Securityページ (`/admin/security`): MFAセットアップUI
  - QRコード表示（otpauth URL）
  - バックアップコード表示
  - 有効化/無効化ボタン

**30日記憶オプション**:
- `AuthContext.tsx`で`localStorage`に`expiresAt`を保存
- `REMEMBER_DAYS = 30`で30日間有効
- `rememberMe: false`時は`localStorage`から削除（セッションのみ）

**テスト方法**:
```bash
# MFA初期化
curl -k -X POST https://<pi5>/api/auth/mfa/initiate \
  -H "Authorization: Bearer <token>"

# MFA有効化
curl -k -X POST https://<pi5>/api/auth/mfa/activate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"secret":"...","code":"123456","backupCodes":["code1","code2",...]}'

# MFA有効時のログイン
curl -k -X POST https://<pi5>/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password","totpCode":"123456"}'
```

**実機テスト結果（2025-12-14）**:
- ✅ APIエンドポイントが存在し、正しく応答することを確認
- ✅ 統合テストで動作確認済み（CI通過）

**関連ファイル**:
- `apps/api/src/lib/mfa.ts`: TOTP/バックアップコード生成・検証ロジック
- `apps/api/src/routes/auth.ts`: MFA管理API
- `apps/web/src/pages/admin/SecurityPage.tsx`: MFAセットアップUI

---

### 2. リアルタイム監視強化

#### 概要
ファイル整合性、必須プロセス、許可外LISTENポートを監視し、異常を検知してアラートを生成します。

#### 実装詳細

**監視スクリプト**: `infrastructure/ansible/templates/security-monitor.sh.j2`

**監視項目**:

1. **ファイル整合性監視** (`process_file_integrity`)
   - 環境変数: `FILE_HASH_TARGETS`（監視対象ファイル、空白区切り）
   - 環境変数: `FILE_HASH_EXCLUDES`（除外ファイルパターン、空白区切り）
   - 状態ファイル: `${STATE_DIR}/file-hashes.txt`
   - 動作: SHA256ハッシュを計算し、前回の状態と比較。差分があればアラート

2. **必須プロセス監視** (`process_required_processes`)
   - 環境変数: `REQUIRED_PROCESSES`（必須プロセス名、空白区切り）
   - 動作: `pgrep -f`でプロセス存在を確認。欠落があればアラート

3. **許可外ポート監視** (`process_listen_ports`)
   - 環境変数: `ALLOWED_LISTEN_PORTS`（許可ポート、空白区切り）
   - 動作: `ss`または`netstat`でLISTENポートを取得し、許可リストと比較。許可外があればアラート

**デフォルト値**:
```bash
FILE_HASH_TARGETS="${FILE_HASH_TARGETS:-/etc/ssh/sshd_config /etc/passwd /etc/shadow}"
FILE_HASH_EXCLUDES="${FILE_HASH_EXCLUDES:-}"
REQUIRED_PROCESSES="${REQUIRED_PROCESSES:-sshd caddy}"
ALLOWED_LISTEN_PORTS="${ALLOWED_LISTEN_PORTS:-22 80 443}"
```

**実行頻度**:
- systemd timerで15分間隔で実行（`security-monitor.timer`）

**アラート生成**:
- `generate-alert.sh`を呼び出してアラートファイルを生成
- Webhook URLが設定されている場合はWebhook送信

**テスト方法**:
```bash
# ファイル整合性テスト
FILE_HASH_TARGETS="/tmp/test.txt" FILE_HASH_STATE="/tmp/state.txt" \
  bash /usr/local/bin/security-monitor.sh
echo "modified" >> /tmp/test.txt
bash /usr/local/bin/security-monitor.sh
# → アラートが生成されることを確認

# 必須プロセステスト
REQUIRED_PROCESSES="nonexistent-process" \
  bash /usr/local/bin/security-monitor.sh
# → アラートが生成されることを確認

# 許可外ポートテスト
ALLOWED_LISTEN_PORTS="22 80 443" \
  python3 -m http.server 8080 &
bash /usr/local/bin/security-monitor.sh
# → アラートが生成されることを確認
```

**実機テスト結果（2025-12-14）**:
- ✅ `/usr/local/bin/security-monitor.sh`が存在し実行可能
- ✅ アラートディレクトリにアラートファイルが生成されていることを確認
- ✅ 環境変数のデフォルト値が正しく設定されていることを確認

**関連ファイル**:
- `infrastructure/ansible/templates/security-monitor.sh.j2`: 監視スクリプトテンプレート
- `infrastructure/ansible/templates/security-monitor.service.j2`: systemdサービス定義
- `infrastructure/ansible/templates/security-monitor.timer.j2`: systemd timer定義

---

### 3. 権限監査

#### 概要
権限変更の履歴を記録し、異常パターン（自己変更、ADMIN昇格、業務時間外、短時間に複数のADMIN昇格）を検知してアラートを生成します。

#### 実装詳細

**データベーススキーマ** (`prisma/schema.prisma`):
```prisma
model RoleAuditLog {
  id          String   @id @default(uuid())
  actorUserId String
  targetUserId String
  fromRole    UserRole
  toRole      UserRole
  createdAt   DateTime @default(now())
  
  actorUser   User @relation("RoleAuditLogActor", fields: [actorUserId], references: [id])
  targetUser  User @relation("RoleAuditLogTarget", fields: [targetUserId], references: [id])
}
```

**APIエンドポイント**:

1. **ロール変更** (`POST /api/auth/users/:id/role`)
   - リクエスト: `{ role: "ADMIN" | "MANAGER" | "VIEWER" }`
   - 動作:
     - ロール変更を実行
     - `RoleAuditLog`に記録
     - 異常パターンを検知してアラート生成

2. **監査ログ取得** (`GET /api/auth/role-audit`)
   - クエリパラメータ: `limit`（デフォルト: 100、最大: 200）
   - レスポンス: `{ logs: RoleAuditLog[] }`

**異常パターン検知**:

1. **自己変更** (`self-role-change`)
   - 条件: `actorUserId === targetUserId`

2. **ADMIN昇格** (`promotion-to-admin`)
   - 条件: `fromRole !== "ADMIN" && toRole === "ADMIN"`

3. **業務時間外** (`outside-business-hours`)
   - 条件: 現在時刻が業務時間外（デフォルト: 8:00-20:00）
   - 環境変数: `BUSINESS_HOUR_START`（デフォルト: 8）、`BUSINESS_HOUR_END`（デフォルト: 20）

4. **短時間に複数のADMIN昇格** (`bulk-promotion-{count}-within-{minutes}m`)
   - 条件: 指定時間内にADMIN昇格が閾値以上発生
   - 環境変数:
     - `BULK_PROMOTION_WINDOW_MINUTES`（デフォルト: 60分）
     - `BULK_PROMOTION_THRESHOLD`（デフォルト: 3件）

**アラート生成**:
- `emitRoleChangeAlert`関数でアラートファイルを生成
- Webhook URLが設定されている場合はWebhook送信

**アラート形式**:
```json
{
  "id": "uuid",
  "type": "role_change",
  "severity": "warning",
  "message": "権限変更: {targetUsername} を {fromRole} から {toRole} に変更 (by {actorUsername})",
  "reasons": ["self-role-change", "promotion-to-admin", ...],
  "details": {
    "actorUserId": "...",
    "actorUsername": "...",
    "targetUserId": "...",
    "targetUsername": "...",
    "fromRole": "VIEWER",
    "toRole": "ADMIN"
  },
  "timestamp": "2025-12-14T06:28:21Z",
  "acknowledged": false
}
```

**フロントエンド実装**:
- Securityページ (`/admin/security`): 監査ログ一覧表示
- `RoleAuditLog`型で型安全に実装

**テスト方法**:
```bash
# ロール変更
curl -k -X POST https://<pi5>/api/auth/users/{userId}/role \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"role":"MANAGER"}'

# 監査ログ取得
curl -k -X GET https://<pi5>/api/auth/role-audit?limit=100 \
  -H "Authorization: Bearer <token>"
```

**実機テスト結果（2025-12-14）**:
- ✅ APIエンドポイントが存在し、正しく応答することを確認
- ✅ 統合テストで動作確認済み（CI通過）

**関連ファイル**:
- `apps/api/src/routes/auth.ts`: ロール変更・監査ログAPI
- `apps/web/src/pages/admin/SecurityPage.tsx`: 監査ログUI
- `apps/web/src/api/types.ts`: `RoleAuditLog`型定義

---

## 設定方法まとめ

### 環境変数一覧

#### Docker Compose (`docker-compose.server.yml`)
- `ADMIN_ALLOW_NETS`: 管理画面アクセス許可ネットワーク（CIDR空白区切り）
- `USE_LOCAL_CERTS`: 自己署名証明書使用フラグ（`"true"`）

#### API環境変数
- `BUSINESS_HOUR_START`: 業務開始時刻（デフォルト: 8）
- `BUSINESS_HOUR_END`: 業務終了時刻（デフォルト: 20）
- `BULK_PROMOTION_WINDOW_MINUTES`: 一括昇格検知ウィンドウ（分、デフォルト: 60）
- `BULK_PROMOTION_THRESHOLD`: 一括昇格検知閾値（件数、デフォルト: 3）
- `ALERT_WEBHOOK_URL`: アラートWebhook URL
- `ALERT_WEBHOOK_TIMEOUT_MS`: Webhook送信タイムアウト（ミリ秒、デフォルト: 5000）

#### security-monitor.sh環境変数
- `FILE_HASH_TARGETS`: 監視対象ファイル（空白区切り）
- `FILE_HASH_EXCLUDES`: 除外ファイルパターン（空白区切り）
- `REQUIRED_PROCESSES`: 必須プロセス名（空白区切り）
- `ALLOWED_LISTEN_PORTS`: 許可ポート（空白区切り）
- `WEBHOOK_URL`: Webhook送信先URL
- `WEBHOOK_TIMEOUT_SECONDS`: Webhook送信タイムアウト（秒）

#### Ansible変数 (`group_vars/all.yml`)
- `alert_webhook_url`: アラートWebhook URL
- `alert_webhook_timeout_seconds`: Webhook送信タイムアウト（秒）

---

## トラブルシューティング

### Phase 9関連

**問題**: 管理画面に403が返る
- **原因**: `ADMIN_ALLOW_NETS`に現在のIPが含まれていない
- **解決**: `docker-compose.server.yml`の`ADMIN_ALLOW_NETS`を確認・更新

**問題**: Webhook送信が失敗する
- **原因**: Webhook URLが無効、またはネットワーク接続不可
- **解決**: `WEBHOOK_URL`を確認、タイムアウトを延長（`WEBHOOK_TIMEOUT_SECONDS`）

**問題**: レート制限が効かない
- **原因**: allowListに該当エンドポイントが含まれている
- **解決**: `apps/api/src/plugins/rate-limit.ts`の`skipPrefixes`を確認

### Phase 10関連

**問題**: MFAセットアップができない
- **原因**: TOTPコードが一致しない（時刻ずれ）
- **解決**: システム時刻を確認、TOTPアプリの時刻同期を確認

**問題**: リアルタイム監視で誤検知が多い
- **原因**: `FILE_HASH_EXCLUDES`に除外パターンが設定されていない
- **解決**: 除外パターンを`FILE_HASH_EXCLUDES`に追加

**問題**: 権限監査アラートが生成されない
- **原因**: 異常パターンの条件に該当しない
- **解決**: 環境変数（`BUSINESS_HOUR_START`等）を確認

---

## 関連ドキュメント

- [セキュリティ要件定義](./requirements.md)
- [セキュリティ実装評価](./implementation-assessment.md)
- [セキュリティ強化 ExecPlan](../plans/security-hardening-execplan.md)
- [デプロイメントガイド](../guides/deployment.md)
- [インシデント対応手順](./incident-response.md)
