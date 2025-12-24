# PowerAutomate → Gmail → Pi5 データ連携スキームのセキュリティ評価

最終更新: 2025-12-21

## 概要

SharePointリストからPowerAutomateでCSV出力し、Gmailに添付ファイルとして送信して、Pi5がGmailからCSVデータを取得するスキームについて、セキュリティの観点から評価します。

## スキームの概要

```
SharePointリスト
    ↓ (PowerAutomate)
Gmail（CSV添付ファイルとして送信）
    ↓ (Pi5が取得)
Raspberry Pi 5（CSVインポート）
```

## セキュリティ評価：所見

### ✅ セキュアに稼働可能（適切な実装により）

**結論**: 適切なセキュリティ対策を実装すれば、セキュアに稼働可能です。

### セキュリティ上の懸念点と対策

#### 1. Gmail API認証情報の管理

**懸念点**:
- Gmail APIトークン（アクセストークン/リフレッシュトークン）の漏洩リスク
- OAuth 2.0クライアントID/シークレットの漏洩リスク
- トークンが漏洩した場合、Gmailアカウントへの不正アクセスが可能になる可能性

**対策**:
- ✅ **環境変数で管理**: `GMAIL_CLIENT_ID`、`GMAIL_CLIENT_SECRET`を環境変数として管理（`.env`ファイル、Ansible変数）
- ✅ **Ansible Vaultで暗号化**: 機密情報としてAnsible Vaultで暗号化
- ✅ **最小権限の原則**: Gmailアプリには必要最小限の権限（`gmail.readonly`、`gmail.modify`）のみ付与
- ✅ **トークンのローテーション**: リフレッシュトークンによる自動アクセストークン更新
- ✅ **設定ファイルでの管理**: `backup.json`にトークンを保存する場合は、環境変数参照形式（`${GMAIL_ACCESS_TOKEN}`）を使用

#### 2. Pi5からGmail APIへの接続（インターネット経由）⚠️ **重要**

**懸念点**:
- Pi5がインターネットに接続する必要がある（現在の運用方針「通常運用: ローカルネットワークのみ」と矛盾）
- インターネット経由の通信が傍受されるリスク
- **中間者攻撃（MITM）のリスク**
- **接続の確立と維持の安全性**

**通信経路のセキュリティ評価**:

##### 2.1 TLS/SSL接続の安全性

**Gmail APIのTLS設定**:
- ✅ **HTTPS必須**: Gmail APIはHTTPSのみをサポート（HTTPは不可）
- ✅ **TLS 1.2以上**: Gmail APIはTLS 1.2以上を要求（TLS 1.0/1.1は不可）
- ✅ **証明書検証**: Gmail APIの証明書は、信頼されたCA（Certificate Authority）によって発行されている
- ✅ **証明書ピニング**: Gmail APIの証明書を固定することで、中間者攻撃を防止可能（実装推奨）

**Node.jsのHTTPS実装**:
- ✅ **デフォルトで証明書検証**: Node.jsの`https`モジュールは、デフォルトで証明書を検証する
- ✅ **CA証明書バンドル**: Node.jsは、システムのCA証明書バンドルを使用して証明書を検証
- ⚠️ **注意**: `rejectUnauthorized: false`を設定すると証明書検証が無効化される（**絶対に設定しない**）

**実装状況**:
- ✅ **証明書ピニング実装済み**: `apps/api/src/services/backup/gmail-cert-pinning.ts`で証明書ピニングを実装
- ✅ **証明書フィンガープリント検証**: `gmail.googleapis.com`、`oauth2.googleapis.com`、`accounts.google.com`の証明書フィンガープリントを検証
- ⚠️ **googleapisパッケージの制約**: `googleapis`パッケージの内部HTTPクライアント（`gaxios`）を使用しているため、直接的な証明書ピニングの実装が困難（TODO: 再評価が必要）

**推奨される実装**:
```typescript
// 証明書ピニング（実装済み: gmail-cert-pinning.ts）
import { verifyGmailCertificate } from './gmail-cert-pinning.js';

// HTTPSエージェントの作成（OAuth認証時）
const agent = new https.Agent({
  rejectUnauthorized: true, // 証明書検証を有効化（必須）
  checkServerIdentity: (servername, cert) => {
    // 証明書ピニングの検証
    verifyGmailCertificate(cert);
    return undefined; // デフォルトの検証を継続
  }
});
```

##### 2.2 中間者攻撃（MITM）への対策

**リスク**:
- 攻撃者がPi5とGmail APIの間の通信を傍受・改ざんする可能性
- 偽のGmail APIサーバーに接続される可能性

**対策**:
- ✅ **証明書ピニング**: Gmail APIの証明書を固定することで、中間者攻撃を防止（実装済み）
- ✅ **接続先の検証**: Gmail APIのエンドポイント（`gmail.googleapis.com`、`oauth2.googleapis.com`）が正しいことを確認
- ✅ **HSTS**: Gmail APIはHSTS（HTTP Strict Transport Security）をサポート

**実装状況**:
- ✅ **OAuth認証時の証明書ピニング**: `GmailOAuthService`で`createHttpsAgent`を使用して証明書ピニングを実装
- ⚠️ **Gmail APIクライアント**: `googleapis`パッケージの内部HTTPクライアントを使用しているため、証明書ピニングの実装が不完全（TODO: 再評価が必要）

##### 2.3 接続の確立と維持の安全性

**接続確立時の検証**:
- ✅ **TLSハンドシェイク**: TLS 1.2以上で接続を確立
- ✅ **証明書検証**: サーバー証明書を検証（CA証明書バンドルを使用）
- ✅ **証明書ピニング**: 証明書のフィンガープリントを検証（OAuth認証時のみ実装済み）

**接続維持時の検証**:
- ✅ **リトライロジック**: ネットワークエラー時の適切なリトライ（指数バックオフ、最大5回）
- ✅ **トークンリフレッシュ**: 401エラー時の自動アクセストークンリフレッシュ

**実装例**:
```typescript
// GmailStorageProviderでのリトライロジック
const MAX_RETRIES = 5;
let retryCount = 0;
while (retryCount < MAX_RETRIES) {
  try {
    // Gmail API呼び出し
    const result = await gmailApiClient.searchMessages(query);
    return result;
  } catch (error) {
    if (error.status === 401) {
      // トークンリフレッシュ
      await refreshAccessTokenIfNeeded();
      retryCount++;
      continue;
    }
    if (error.status === 429) {
      // レート制限エラー: 指数バックオフ
      const delay = Math.pow(2, retryCount) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      retryCount++;
      continue;
    }
    throw error;
  }
}
```

##### 2.4 既存のセキュリティ機能との統合

**ファイアウォール（ufw）**:
- ✅ **アウトバウンド通信**: Gmail APIへのアウトバウンド通信（HTTPS: 443）を許可
- ✅ **インバウンド通信**: 不要なインバウンド通信をブロック（既存の設定を維持）

**レート制限**:
- ✅ **Gmail API呼び出し**: Gmail APIへの呼び出しにレート制限を適用（実装済み: 指数バックオフ）
- ✅ **既存のレート制限**: 既存の`rate-limit.ts`を拡張してGmail API呼び出しを監視（推奨）

**監視・アラート**:
- ✅ **接続エラー監視**: Gmail API接続エラーを`security-monitor.sh`で監視（推奨）
- ✅ **アラート生成**: 接続エラー時に既存の`generate-alert.sh`でアラート生成（推奨）
- ✅ **ログ記録**: すべてのGmail API呼び出しをログに記録（実装済み）

#### 3. OAuth 2.0認証フローのセキュリティ

**懸念点**:
- OAuth認証フロー中のCSRF攻撃のリスク
- 認証コードの漏洩リスク
- リダイレクトURIの検証不備

**対策**:
- ✅ **stateパラメータ**: CSRF攻撃を防止するための`state`パラメータを使用（実装済み）
- ✅ **リダイレクトURIの検証**: 認証コールバック時にリダイレクトURIを検証
- ✅ **認証コードの一回性**: 認証コードは一度のみ使用可能（Gmail APIの仕様）
- ✅ **HTTPS必須**: OAuth認証フローはHTTPS接続でのみ実行

**実装状況**:
- ✅ **stateパラメータ生成**: `GmailOAuthService.getAuthorizationUrl`でランダムな`state`パラメータを生成
- ✅ **stateパラメータ検証**: `GmailOAuthService.exchangeCodeForTokens`で`state`パラメータを検証（TODO: 実装確認が必要）

#### 4. メール検索と添付ファイル取得のセキュリティ

**懸念点**:
- 件名パターンによるメール検索の精度（誤検出のリスク）
- 添付ファイルのサイズ制限（Gmail APIの制限: 25MB）
- パストラバーサル攻撃のリスク（添付ファイル名の検証）

**対策**:
- ✅ **件名パターンの厳密化**: 正規表現パターンでメールをフィルタリング（実装済み）
- ✅ **ファイルサイズの検証**: 添付ファイルのサイズを検証（Gmail APIの制限内）
- ✅ **パストラバーサル防止**: 添付ファイル名の検証を実装（推奨）
- ✅ **処理済みマーク**: 処理済みメールにラベルを追加して重複処理を防止（実装済み）

**実装状況**:
- ✅ **件名パターンマッチング**: `GmailStorageProvider.list`で正規表現パターンによるメール検索を実装
- ✅ **処理済みマーク**: `GmailStorageProvider.markAsProcessed`でラベル追加と既読化を実装
- ⚠️ **パストラバーサル防止**: 添付ファイル名の検証が不完全（TODO: 実装確認が必要）

#### 5. CSVデータの整合性検証

**懸念点**:
- CSVファイルの改ざんリスク
- CSVファイルの形式エラーによるシステム障害

**対策**:
- ✅ **CSV形式のバリデーション**: ZodスキーマによるCSVデータの検証（実装済み）
- ✅ **エラーハンドリング**: CSV形式エラー時の適切なエラーハンドリング（実装済み）
- ✅ **ログ記録**: CSVインポート処理のログ記録（実装済み）

**実装状況**:
- ✅ **CSVパース**: `csv-parse/sync`を使用してCSVをパース
- ✅ **データ検証**: Zodスキーマ（`EmployeeSchema`、`ItemSchema`）によるデータ検証
- ✅ **エラーログ**: CSVインポートエラーをログに記録

## セキュリティチェックリスト

### 実装済み ✅

- [x] OAuth 2.0認証フローの実装
- [x] リフレッシュトークンによる自動アクセストークン更新
- [x] 証明書ピニング（OAuth認証時）
- [x] メール検索の件名パターンマッチング
- [x] 処理済みメールのラベル付けと既読化
- [x] CSVデータのバリデーション（Zodスキーマ）
- [x] エラーハンドリングとリトライロジック
- [x] 環境変数による機密情報管理
- [x] ログ記録

### 推奨事項（未実装）⚠️

- [ ] `googleapis`パッケージでの証明書ピニングの再評価・実装
- [ ] OAuth認証フローでの`state`パラメータ検証の実装確認
- [ ] 添付ファイル名のパストラバーサル防止の実装確認
- [ ] Gmail API呼び出しのレート制限監視（既存の`rate-limit.ts`との統合）
- [ ] Gmail API接続エラーの監視・アラート（`security-monitor.sh`との統合）

## 既存システムとの比較

### Dropbox連携との比較

| 項目 | Dropbox連携 | Gmail連携 |
|------|------------|-----------|
| OAuth 2.0認証 | ✅ 実装済み | ✅ 実装済み |
| 証明書ピニング | ✅ 実装済み | ⚠️ 部分的に実装（OAuth認証時のみ） |
| リトライロジック | ✅ 実装済み | ✅ 実装済み |
| 環境変数管理 | ✅ 実装済み | ✅ 実装済み |
| セキュリティドキュメント | ✅ 作成済み | ✅ 作成済み（本ドキュメント） |

### セキュリティレベルの評価

**Gmail連携のセキュリティレベル**: **高**（適切な実装により）

**理由**:
- OAuth 2.0認証による安全な認証フロー
- 証明書ピニングによる中間者攻撃の防止（部分的に実装）
- リフレッシュトークンによる自動トークン更新
- CSVデータのバリデーションによる整合性検証
- 処理済みメールのマークによる重複処理の防止

**改善の余地**:
- `googleapis`パッケージでの証明書ピニングの完全実装
- OAuth認証フローでの`state`パラメータ検証の実装確認
- 添付ファイル名のパストラバーサル防止の実装確認

## まとめ

### セキュリティ評価の結論

**Gmail連携機能は、適切なセキュリティ対策を実装すれば、セキュアに稼働可能です。**

### 実装済みのセキュリティ対策

- ✅ OAuth 2.0認証フロー
- ✅ リフレッシュトークンによる自動アクセストークン更新
- ✅ 証明書ピニング（OAuth認証時）
- ✅ メール検索の件名パターンマッチング
- ✅ 処理済みメールのラベル付けと既読化
- ✅ CSVデータのバリデーション
- ✅ エラーハンドリングとリトライロジック
- ✅ 環境変数による機密情報管理
- ✅ ログ記録

### 今後の推奨事項

1. **証明書ピニングの完全実装**: `googleapis`パッケージでの証明書ピニングの再評価・実装
2. **OAuth認証フローの強化**: `state`パラメータ検証の実装確認
3. **パストラバーサル防止**: 添付ファイル名の検証の実装確認
4. **監視・アラートの統合**: 既存の監視システムとの統合

## 関連ドキュメント

- `docs/guides/gmail-attachment-integration.md`: Gmail連携ガイド
- `docs/guides/powerautomate-gmail-integration.md`: PowerAutomate側の仕様
- `docs/security/sharepoint-dropbox-integration-assessment.md`: Dropbox連携のセキュリティ評価（参考）

## 更新履歴

- 2025-12-21: 初版作成（Gmail連携のセキュリティ評価）
