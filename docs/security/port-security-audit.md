# ポートセキュリティ監査レポート

最終更新: 2026-01-18

## 概要

インターネット接続状態での本番運用開始前に、ポート公開状況とWAN向け防御を点検しました。

## ポート公開状況の確認

### Docker Compose設定（`docker-compose.server.yml`）

| サービス | ポートマッピング | 状態 | リスク評価 |
|---------|----------------|------|----------|
| PostgreSQL | ~~`5432:5432`~~（削除） | ✅ **非公開**（Docker内部のみ） | 🟢 低リスク |
| API | ~~`8080:8080`~~（削除） | ✅ **非公開**（Docker内部のみ） | 🟢 低リスク |
| Web (Caddy) | `80:80`, `443:443` | ✅ 意図的 | 🟢 低リスク（HTTPS強制） |

### UFW（ファイアウォール）設定

**設定ファイル**: `infrastructure/ansible/group_vars/all.yml`

```yaml
ufw_enabled: true
ufw_default_incoming_policy: "deny"  # デフォルトで全拒否
ufw_allowed_tcp_ports:
  - "80"   # HTTP
  - "443"  # HTTPS
ufw_ssh_allowed_networks:
  - "192.168.10.0/24"    # ローカルネットワーク
  - "100.64.0.0/10"      # Tailscaleネットワーク
ufw_vnc_allowed_networks:
  - "192.168.10.0/24"
  - "192.168.128.0/24"
```

**UFWの動作**:
- ✅ **デフォルトポリシー**: 全着信を拒否（`deny`）
- ✅ **許可ポート**: HTTP（80）、HTTPS（443）のみ
- ✅ **SSH（22）**: 信頼ネットワークのみ許可（ローカル/Tailscale）
- ✅ **VNC（5900）**: 信頼ネットワークのみ許可
- ✅ **PostgreSQL（5432）**: UFWで**ブロック**されている（許可リストにない）
- ✅ **API（8080）**: UFWで**ブロック**されている（許可リストにない）

## 追加の改善（2026-01-18）

### 不要サービスの停止（LISTEN自体を削減）

UFWで遮断されていても LISTEN している限り、攻撃面・監視ノイズの原因になります。Pi5上で不要な常駐サービスを止め、LISTEN/UNCONNを削減しました。

- 対象（例）: `rpcbind` / `avahi-daemon` / `exim4` / `cups`
- 方針: **stop + disable + mask**（socket起動系はsocket/serviceの両方）
- 詳細: [KB-177](../knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ)

### `ports-unexpected` の精度改善（外部露出 + プロセス込み）

ポート番号だけの検知は誤検知/ノイズになりやすいため、`security-monitor` を `ss -H -tulpen` ベースにし、`addr:port(process,proto)` を含めて原因特定しやすくしました（Tailscale/loopback/link-localは除外）。

- 詳細: [KB-177](../knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ)
- 証跡: [ports baseline (2026-01-18)](../knowledge-base/infrastructure/ports-baseline-20260118.md)

## セキュリティ実装状況

### ✅ 実装済みの対策（Phase 1-10完了）

1. **ネットワーク層の防御**
   - ✅ UFWファイアウォール（デフォルト拒否、HTTP/HTTPSのみ許可）
   - ✅ Tailscale VPN（メンテナンス時の安全なSSH接続）

2. **アプリケーション層の防御**
   - ✅ HTTPS強制（CaddyによるHTTP→HTTPSリダイレクト）
   - ✅ セキュリティヘッダー（Strict-Transport-Security含む）
   - ✅ 管理画面IP制限（`ADMIN_ALLOW_NETS`環境変数）
   - ✅ レート制限（認証10 req/min、グローバル120 req/min）
   - ✅ fail2ban（SSH/Caddy HTTP認証のブルートフォース対策）

3. **認証・認可**
   - ✅ MFA（多要素認証、TOTP/バックアップコード）
   - ✅ JWT認証（アクセストークン/リフレッシュトークン）
   - ✅ 権限監査（異常パターン検知・アラート生成）

4. **監視・アラート**
   - ✅ リアルタイム監視（ファイル整合性・プロセス・ポート監視）
   - ✅ fail2ban Banイベントの自動監視（15分間隔）
   - ✅ マルウェアスキャン結果の自動アラート化
   - ✅ Webhookアラート通知（Slack等への外部通知）

5. **マルウェア対策**
   - ✅ ClamAV/Trivy/rkhunter（日次スキャン）
   - ✅ DockerイメージのTrivyスキャン（CI・定期ジョブ）

6. **ランサムウェア対策**
   - ✅ バックアップ暗号化（GPG）
   - ✅ バックアップ復元テスト（検証用DBで実施済み）

## リスク評価と対策

### 🔴 高リスク項目（過去の指摘）

#### 1. PostgreSQLポート（5432）の公開

**現状**:
- ✅ Docker Composeのポートマッピングは削除済み（Docker内部ネットワークのみ）

**リスク**:
- 過去はUFW依存でリスクが残っていた（UFW無効化時に露出）
- **現在はDockerレベルで非公開**になり、UFW依存が低減

**推奨対策**:
1. **実施済み**: Docker Composeのポートマッピングを削除
   ```yaml
   # 修正前
   ports:
     - "5432:5432"
   
   # 修正後（ポートマッピングを削除）
   # ports:
   #   - "5432:5432"
   ```
   - APIコンテナからは`db:5432`でアクセス可能（Docker内部ネットワーク）
   - 外部からの直接アクセスは不要

2. **パスワード変更**: 本番環境では強力なパスワードに変更
   ```yaml
   POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:-postgres}"  # 環境変数から取得
   ```

#### 2. APIポート（8080）の公開

**現状**:
- ✅ Docker Composeのポートマッピングは削除済み（Caddy→`api:8080`のみ）

**リスク**:
- 過去はUFW依存でリスクが残っていた（UFW無効化時に露出）
- **現在はDockerレベルで非公開**になり、UFW依存が低減

**推奨対策**:
1. **実施済み**: Docker Composeのポートマッピングを削除
   ```yaml
   # 修正前
   ports:
     - "8080:8080"
   
   # 修正後（ポートマッピングを削除）
   # ports:
   #   - "8080:8080"
   ```
   - Caddyからは`api:8080`でアクセス可能（Docker内部ネットワーク）
   - 外部からの直接アクセスは不要

### 🟡 中リスク項目

#### 3. デフォルトパスワードの使用

**現状**:
- PostgreSQL: `postgres/postgres`
- 管理ユーザー: `admin/admin1234`（シードデータ）

**推奨対策**:
1. **本番環境では強力なパスワードに変更**
2. **環境変数で管理**（`.env`ファイル、Ansible Vault等）

## インターネット接続時のセキュリティ評価

### ✅ 安全に運用可能な理由

1. **多層防御の実装**
   - ネットワーク層（UFW）→ アプリケーション層（HTTPS/認証）→ 監視層（fail2ban/アラート）の3層防御
   - 各層が独立して機能し、1つの対策が失敗しても他の対策で保護される

2. **UFWによるポート制限**
   - HTTP/HTTPS（80/443）のみ許可
   - PostgreSQL（5432）、API（8080）はUFWでブロックされている
   - SSH（22）は信頼ネットワークのみ許可

3. **Phase 9/10の追加防御**
   - 管理画面IP制限（インターネット接続時の追加防御）
   - セキュリティヘッダー（Strict-Transport-Security含む）
   - レート制限（DDoS/ブルートフォース緩和）
   - MFA（多要素認証）
   - リアルタイム監視（ファイル整合性・プロセス・ポート監視）

### ⚠️ 改善が必要な点

1. **Docker Composeのポート公開**
   - PostgreSQL（5432）とAPI（8080）のポートマッピングを削除すべき
   - UFWに依存せず、Dockerレベルでブロックする方が安全

2. **デフォルトパスワード**
   - 本番環境では強力なパスワードに変更すべき
   - 環境変数で管理し、`.env`ファイルを`.gitignore`に追加

## 推奨される修正手順

### ステップ1: Docker Composeのポートマッピングを削除

```yaml
# infrastructure/docker/docker-compose.server.yml

services:
  db:
    # ports:
    #   - "5432:5432"  # 削除（Docker内部ネットワークでアクセス可能）

  api:
    # ports:
    #   - "8080:8080"  # 削除（Caddy経由でアクセス可能）
```

**影響**:
- ✅ APIコンテナからは`db:5432`でアクセス可能（変更なし）
- ✅ Caddyからは`api:8080`でアクセス可能（変更なし）
- ✅ 外部からの直接アクセスは不可（セキュリティ向上）

### ステップ2: パスワードを環境変数で管理

```yaml
# infrastructure/docker/docker-compose.server.yml

services:
  db:
    environment:
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:-postgres}"  # 環境変数から取得
```

**`.env`ファイルの作成**:
```bash
# apps/api/.env
POSTGRES_PASSWORD=your-strong-password-here
```

### ステップ3: 実機での動作確認

1. **ポートマッピング削除後の動作確認**
   ```bash
   # APIコンテナからデータベースにアクセスできるか確認
   docker compose exec api curl http://db:5432
   
   # CaddyからAPIにアクセスできるか確認
   docker compose exec web curl http://api:8080/api/system/health
   ```

2. **外部からのアクセス不可を確認**
   ```bash
   # 外部からPostgreSQLにアクセスできないことを確認
   telnet <pi5-ip> 5432  # 接続拒否されることを確認
   
   # 外部からAPIにアクセスできないことを確認
   curl http://<pi5-ip>:8080/api/system/health  # タイムアウトまたは接続拒否
   ```

## 結論

### 修正実施状況（2025-12-18）

✅ **修正完了**: Docker Composeのポートマッピングを削除
- PostgreSQL（5432）: ポートマッピング削除済み
- API（8080）: ポートマッピング削除済み

### 修正後の評価: **✅ 安全に運用可能**

**修正後の状態**:
- ✅ Dockerレベルでポートがブロックされる（UFWに依存しない）
- ✅ 多層防御が実装されている（ネットワーク層→アプリケーション層→監視層）
- ✅ Phase 9/10の追加防御が有効（管理画面IP制限、MFA、リアルタイム監視）

**インターネット接続状態での本番運用**: **✅ 可能**

### 残タスク

⚠️ **推奨**: パスワードを環境変数で管理し、強力なパスワードに変更
- 現状: デフォルトパスワード（`postgres/postgres`）が使用されている
- 対応: `.env`ファイルで環境変数管理、Ansible Vault等で暗号化

## 関連ドキュメント

- [セキュリティ要件定義](./requirements.md)
- [セキュリティ実装の妥当性評価](./implementation-assessment.md)
- [セキュリティ強化 ExecPlan](../plans/security-hardening-execplan.md)
- [Phase 9/10 詳細仕様書](./phase9-10-specifications.md)
