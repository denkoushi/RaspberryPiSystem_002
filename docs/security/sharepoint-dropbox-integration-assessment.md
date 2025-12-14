# SharePoint → Dropbox → Pi5 データ連携スキームのセキュリティ評価

最終更新: 2025-12-14

## 概要

SharePointリストからPowerAutomateでCSV出力し、DropboxにCSV保存して、Pi5がDropboxからCSVデータを取得するスキームについて、セキュリティの観点から評価します。

## スキームの概要

```
SharePointリスト
    ↓ (PowerAutomate)
Dropbox（CSV保存）
    ↓ (Pi5が取得)
Raspberry Pi 5（CSVインポート）
```

## セキュリティ評価：所見

### ✅ セキュアに稼働可能（適切な実装により）

**結論**: 適切なセキュリティ対策を実装すれば、セキュアに稼働可能です。

### セキュリティ上の懸念点と対策

#### 1. Dropbox API認証情報の管理

**懸念点**:
- Dropbox APIトークン（アクセストークン/リフレッシュトークン）の漏洩リスク
- トークンが漏洩した場合、Dropbox上のCSVファイルに不正アクセスされる可能性

**対策**:
- ✅ **環境変数で管理**: `DROPBOX_ACCESS_TOKEN`を環境変数として管理（`.env`ファイル、Ansible変数）
- ✅ **Ansible Vaultで暗号化**: 機密情報としてAnsible Vaultで暗号化
- ✅ **最小権限の原則**: Dropboxアプリには必要最小限の権限（特定フォルダの読み取りのみ）を付与
- ✅ **トークンのローテーション**: 定期的なトークン更新（リフレッシュトークンを使用）

#### 2. Pi5からDropboxへの接続（インターネット経由）⚠️ **重要**

**懸念点**:
- Pi5がインターネットに接続する必要がある（現在の運用方針「通常運用: ローカルネットワークのみ」と矛盾）
- インターネット経由の通信が傍受されるリスク
- **中間者攻撃（MITM）のリスク**
- **接続の確立と維持の安全性**

**通信経路のセキュリティ評価**:

##### 2.1 TLS/SSL接続の安全性

**Dropbox APIのTLS設定**:
- ✅ **HTTPS必須**: Dropbox APIはHTTPSのみをサポート（HTTPは不可）
- ✅ **TLS 1.2以上**: Dropbox APIはTLS 1.2以上を要求（TLS 1.0/1.1は不可）
- ✅ **証明書検証**: Dropbox APIの証明書は、信頼されたCA（Certificate Authority）によって発行されている
- ✅ **証明書ピニング**: Dropbox APIの証明書を固定することで、中間者攻撃を防止可能（実装推奨）

**Node.jsのHTTPS実装**:
- ✅ **デフォルトで証明書検証**: Node.jsの`https`モジュールは、デフォルトで証明書を検証する
- ✅ **CA証明書バンドル**: Node.jsは、システムのCA証明書バンドルを使用して証明書を検証
- ⚠️ **注意**: `rejectUnauthorized: false`を設定すると証明書検証が無効化される（**絶対に設定しない**）

**推奨される実装**:
```typescript
import https from 'https';
import { readFileSync } from 'fs';

// 証明書ピニング（推奨）
const DROPBOX_CERTIFICATE_PIN = 'sha256/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'; // Dropbox APIの証明書フィンガープリント

const agent = new https.Agent({
  rejectUnauthorized: true, // 証明書検証を有効化（必須）
  checkServerIdentity: (servername, cert) => {
    // 証明書ピニングの検証
    const fingerprint = cert.fingerprint256;
    if (fingerprint !== DROPBOX_CERTIFICATE_PIN) {
      throw new Error(`Certificate pinning failed: expected ${DROPBOX_CERTIFICATE_PIN}, got ${fingerprint}`);
    }
    return undefined; // デフォルトの検証を継続
  }
});
```

##### 2.2 中間者攻撃（MITM）への対策

**リスク**:
- 攻撃者がPi5とDropboxの間の通信を傍受・改ざんする可能性
- 偽のDropboxサーバーに接続される可能性

**対策**:
- ✅ **証明書ピニング**: Dropbox APIの証明書を固定することで、中間者攻撃を防止
- ✅ **DNS over HTTPS (DoH)**: DNSクエリを暗号化（実装推奨）
- ✅ **接続先の検証**: Dropbox APIのエンドポイント（`api.dropboxapi.com`）が正しいことを確認
- ✅ **HSTS**: Dropbox APIはHSTS（HTTP Strict Transport Security）をサポート

**実装例**:
```typescript
// DNS over HTTPSを使用してDropbox APIのIPアドレスを解決
const DROPBOX_API_DOMAIN = 'api.dropboxapi.com';
const DROPBOX_API_IPS = ['162.125.1.18', '162.125.1.19']; // Dropbox APIのIPアドレス（固定）

// IPアドレスの検証
const resolvedIP = await dns.resolve4(DROPBOX_API_DOMAIN);
if (!DROPBOX_API_IPS.includes(resolvedIP[0])) {
  throw new Error(`DNS resolution failed: expected one of ${DROPBOX_API_IPS.join(', ')}, got ${resolvedIP[0]}`);
}
```

##### 2.3 接続の確立と維持の安全性

**接続確立時の検証**:
- ✅ **TLSハンドシェイク**: TLS 1.2以上で接続を確立
- ✅ **証明書検証**: サーバー証明書を検証（CA証明書バンドルを使用）
- ✅ **証明書ピニング**: 証明書のフィンガープリントを検証（実装推奨）

**接続維持時の検証**:
- ✅ **セッション再ネゴシエーション**: TLSセッションの再ネゴシエーションを無効化（実装推奨）
- ✅ **接続タイムアウト**: 適切なタイムアウト設定（例: 30秒）
- ✅ **リトライロジック**: ネットワークエラー時の適切なリトライ（指数バックオフ）

**実装例**:
```typescript
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: true, // 証明書検証を有効化（必須）
  keepAlive: true, // 接続を再利用
  keepAliveMsecs: 1000, // キープアライブ間隔
  maxSockets: 5, // 最大接続数
  timeout: 30000, // 接続タイムアウト（30秒）
  // TLS 1.2以上を強制
  secureProtocol: 'TLSv1_2_method',
  // セッション再ネゴシエーションを無効化
  secureOptions: require('constants').SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION
});
```

##### 2.4 既存のセキュリティ機能との統合

**ファイアウォール（ufw）**:
- ✅ **アウトバウンド通信**: Dropbox APIへのアウトバウンド通信（HTTPS: 443）を許可
- ✅ **インバウンド通信**: 不要なインバウンド通信をブロック（既存の設定を維持）

**レート制限**:
- ✅ **Dropbox API呼び出し**: Dropbox APIへの呼び出しにレート制限を適用（実装推奨）
- ✅ **既存のレート制限**: 既存の`rate-limit.ts`を拡張してDropbox API呼び出しを監視

**監視・アラート**:
- ✅ **接続エラー監視**: Dropbox API接続エラーを`security-monitor.sh`で監視
- ✅ **アラート生成**: 接続エラー時に既存の`generate-alert.sh`でアラート生成
- ✅ **ログ記録**: すべてのDropbox API呼び出しをログに記録

##### 2.5 運用方針との整合性

**現在の運用方針**:
- **通常運用**: ローカルネットワークのみ（インターネット接続なし）
- **メンテナンス時**: インターネット接続が必要（Tailscale経由）

**新スキームとの整合性**:
- **推奨**: **メンテナンス時間帯にのみインターネット接続を有効化**
  - CSV取得時: Tailscale経由でDropboxに接続
  - 取得後: インターネット接続を無効化（通常運用に戻る）
- **代替**: **専用のネットワークインターフェース**
  - CSV取得専用のネットワークインターフェースを用意
  - 通常運用時は無効化、CSV取得時のみ有効化

**実装例**:
```bash
# CSV取得前: インターネット接続を有効化（Tailscale経由）
sudo systemctl start tailscale

# CSV取得実行
node scripts/dropbox-csv-fetch.js

# CSV取得後: インターネット接続を無効化
sudo systemctl stop tailscale
```

##### 2.6 セキュリティチェックリスト

**実装時に確認すべき項目**:
- [ ] **証明書検証**: `rejectUnauthorized: true`を設定（必須）
- [ ] **証明書ピニング**: Dropbox APIの証明書を固定（推奨）
- [ ] **TLS 1.2以上**: TLS 1.2以上を強制（必須）
- [ ] **接続タイムアウト**: 適切なタイムアウト設定（30秒推奨）
- [ ] **リトライロジック**: 指数バックオフでリトライ（推奨）
- [ ] **DNS検証**: DNS over HTTPSまたはIPアドレス固定（推奨）
- [ ] **レート制限**: Dropbox API呼び出しにレート制限を適用（推奨）
- [ ] **ログ記録**: すべてのDropbox API呼び出しをログに記録（必須）
- [ ] **エラーハンドリング**: 接続エラー時にアラートを生成（必須）
- [ ] **運用方針**: メンテナンス時のみインターネット接続を有効化（推奨）

#### 3. CSVファイルの改ざんリスク

**懸念点**:
- Dropbox上のCSVファイルが改ざんされる可能性
- 改ざんされたCSVをPi5が取り込むと、データベースが汚染される

**対策**:
- ✅ **ファイル整合性検証**: CSVファイルのハッシュ値（SHA256）を検証
  - PowerAutomateでハッシュ値を計算し、メタデータとして保存
  - Pi5でダウンロード後にハッシュ値を検証
- ✅ **署名検証**: PowerAutomateでCSVファイルにデジタル署名を追加（GPG署名など）
- ✅ **バージョン管理**: Dropboxのファイルバージョン履歴を確認
- ✅ **データ検証**: CSVインポート時の厳密なバリデーション（既存のZodスキーマを活用）

#### 4. データの機密性

**懸念点**:
- CSVファイルに機密情報（従業員情報、工具情報）が含まれる可能性
- Dropbox上でのデータ漏洩リスク

**対策**:
- ✅ **暗号化**: PowerAutomateでCSVファイルを暗号化してからDropboxに保存（GPG暗号化）
  - Pi5でダウンロード後に復号
- ✅ **最小データ原則**: CSVに含めるデータを必要最小限に
- ✅ **アクセス制御**: Dropboxフォルダへのアクセスを特定ユーザーのみに制限

#### 5. 認証・認可

**懸念点**:
- Pi5がDropboxからCSVを取得する際の認証・認可
- 不正なCSVファイルの取得を防ぐ

**対策**:
- ✅ **APIキー認証**: Dropbox APIトークンによる認証
- ✅ **IP制限**: Dropboxアプリの設定で、Pi5のIPアドレス（Tailscale IP）のみ許可（可能な場合）
- ✅ **ファイル名検証**: 期待されるファイル名パターンに一致する場合のみ処理
- ✅ **タイムスタンプ検証**: CSVファイルの更新日時を確認し、古いファイルは処理しない

#### 6. エラーハンドリングと監視

**懸念点**:
- Dropbox接続エラー、CSV解析エラーが適切に処理されない可能性
- 異常なCSVファイルの取り込みを検知できない

**対策**:
- ✅ **エラーログ**: すべてのエラーをログに記録（既存のログ機能を活用）
- ✅ **アラート通知**: Dropbox接続エラー、CSV検証エラー時にアラートを生成（既存の`generate-alert.sh`を活用）
- ✅ **監査ログ**: CSVインポートの履歴を記録（誰が/いつ/どのファイルをインポートしたか）

### 実装上の推奨事項

#### 1. 接続方式の選択

**推奨**: **Pull方式（Pi5がDropboxから取得）**
- Pi5が定期的に（例: 毎日1回）DropboxからCSVを取得
- PowerAutomateはCSVを生成してDropboxに保存するだけ
- Pi5側で取得タイミングを制御可能

**代替**: Push方式（PowerAutomateがPi5に直接送信）
- より複雑（Pi5側にWebhookエンドポイントが必要）
- セキュリティリスクが高い（Pi5をインターネットに公開する必要がある）

#### 2. インターネット接続の運用方針

**現在の運用方針との整合性**:
- **現在**: 通常運用はローカルネットワークのみ（インターネット接続なし）
- **新スキーム**: Pi5がDropboxからCSVを取得するため、インターネット接続が必要

**推奨される運用方針**:
- **通常運用**: ローカルネットワークのみ（インターネット接続なし）
- **CSV取得時**: メンテナンス時間帯にインターネット接続を有効化し、CSVを取得
- **取得後**: インターネット接続を無効化（通常運用に戻る）

または

- **CSV取得専用のネットワーク**: Tailscale経由でDropboxに接続（メンテナンス時のみ）
- **自動取得**: systemd timerで定期的に（例: 毎日4時）Tailscale経由でCSVを取得

#### 3. セキュリティ機能の活用

**既存のセキュリティ機能を活用**:
- ✅ **レート制限**: Dropbox API呼び出しにレート制限を適用（既存の`rate-limit.ts`を拡張）
- ✅ **監視**: Dropbox接続エラーを`security-monitor.sh`で監視
- ✅ **アラート**: エラー時に既存の`generate-alert.sh`でアラート生成
- ✅ **ログ**: 既存のログ機能でDropbox接続ログを記録

### リスク評価

| リスク | 影響度 | 発生確率 | 対策の有効性 | 総合評価 |
|--------|--------|----------|--------------|----------|
| **Dropbox APIトークン漏洩** | 高 | 低 | 高（環境変数管理、Ansible Vault） | 🟢 低リスク |
| **CSVファイル改ざん** | 高 | 中 | 高（ハッシュ検証、署名検証） | 🟡 中リスク |
| **データ漏洩** | 高 | 低 | 高（暗号化、アクセス制御） | 🟢 低リスク |
| **インターネット接続** | 中 | 高 | 中（HTTPS、タイムアウト、リトライ） | 🟡 中リスク |
| **エラー処理不足** | 中 | 中 | 高（既存のログ・アラート機能） | 🟢 低リスク |

### 結論

**セキュアに稼働可能**: ✅ **はい**

**条件**:
1. Dropbox APIトークンを適切に管理（環境変数、Ansible Vault）
2. CSVファイルの整合性を検証（ハッシュ値、署名）
3. データの暗号化（GPG暗号化）
4. 適切なエラーハンドリングと監視（既存機能を活用）
5. インターネット接続の運用方針を明確化（メンテナンス時のみ、またはTailscale経由）

**推奨される実装順序**:
1. **Phase 1**: Dropbox API接続の基本実装（認証、ファイル取得）
2. **Phase 2**: CSVファイルの整合性検証（ハッシュ値検証）
3. **Phase 3**: データ暗号化（GPG暗号化・復号）
4. **Phase 4**: エラーハンドリングと監視の統合
5. **Phase 5**: 運用方針の明確化とドキュメント化

## 関連ドキュメント

- [セキュリティ要件定義](./requirements.md)
- [Phase 9/10 詳細仕様書](./phase9-10-specifications.md)
- [CSVインポート機能](../api/imports.md)
