# Gmail経由データ取得機能 要件定義書

最終更新: 2025-12-29

## 概要

PowerAutomateからGmailに添付ファイルとして送信されたCSVやJPEGなどのファイルを、Pi5が自動的に取得して処理する機能を実装します。既存のDropbox連携機能と同じStorageProviderインターフェースを使用し、設定で選択可能にします。

### 背景

- 以前はPowerAutomate → Dropbox → Pi5のルートを想定していたが、このルートが不可になった
- Dropboxはバックアップ専用に置き換えられた
- 新しいルート: PowerAutomate → Gmail（添付ファイル） → Pi5が許可されそう
- PowerPlatformのSharePointリストやSharePointドキュメントライブラリのCSVやJPEGなどをGmail経由でPi5へ届け、活用したい

### 目的

- PowerAutomateからGmail経由でCSVやJPEGなどのファイルを取得
- 既存のStorageProviderインターフェースを使用して実装
- 既存のCSVインポート機能と統合
- 設定可能なスケジュール実行
- エラーハンドリングとリトライ機能

## 現状分析

### 既存機能

1. **StorageProviderインターフェース** (`apps/api/src/services/backup/storage/storage-provider.interface.ts`)
   - `upload`, `download`, `delete`, `list`メソッドを定義
   - `LocalStorageProvider`, `DropboxStorageProvider`が実装済み

2. **CSVインポート機能** (`apps/api/src/services/imports/csv-import-scheduler.ts`)
   - DropboxからCSVファイルを取得してインポート
   - スケジュール実行（cron形式）
   - インポート履歴管理
   - エラーハンドリングとアラート機能

3. **バックアップ設定** (`apps/api/src/services/backup/backup-config.ts`)
   - `BackupConfig`スキーマに`csvImports`配列を定義
   - 各インポートスケジュールに`employeesPath`, `itemsPath`を設定

4. **写真ストレージ** (`apps/api/src/lib/photo-storage.ts`)
   - JPEGファイルの保存・管理機能
   - サムネイル生成機能

### 不足している機能

1. **Gmail OAuth認証**
   - Gmail APIへのアクセス認証
   - トークンリフレッシュ機能

2. **Gmail APIクライアント**
   - メール検索（件名ベース）
   - 添付ファイル取得
   - メールアーカイブ機能

3. **GmailStorageProvider**
   - StorageProviderインターフェースの実装
   - Gmailからファイルを取得する機能

4. **設定拡張**
   - BackupConfigスキーマにGmailプロバイダーを追加
   - Gmail用設定項目の追加

5. **ファイル処理**
   - CSVファイルのインポート処理（既存機能と統合）
   - JPEGファイルの処理（要件定義時に決定）

## 要件定義

### 機能要件

#### FR-1: Gmail OAuth認証

- **FR-1.1**: Gmail OAuth 2.0認証フローを実装
  - 認証URL生成
  - コールバック処理
  - アクセストークン・リフレッシュトークンの取得・保存

- **FR-1.2**: トークンリフレッシュ機能
  - リフレッシュトークンからアクセストークンを自動更新
  - トークン更新コールバックで設定ファイルを更新

#### FR-2: Gmail APIクライアント

- **FR-2.1**: メール検索機能
  - 件名パターンによる検索（設定可能）
  - 検索結果の取得

- **FR-2.2**: 添付ファイル取得機能
  - メールから添付ファイルを取得
  - 複数添付ファイルの処理

- **FR-2.3**: メールアーカイブ機能
  - 処理完了後のメールをアーカイブ（受信トレイから削除）

#### FR-3: GmailStorageProvider実装

- **FR-3.1**: StorageProviderインターフェースの実装
  - `download`: Gmailからファイルを取得
  - `list`: メール一覧を取得（将来の拡張用）
  - `upload`: 未実装（Gmailは読み取り専用）
  - `delete`: 未実装（Gmailは読み取り専用）

- **FR-3.2**: ファイル命名規則
  - タイムスタンプをプレフィックスに追加（例: `20251229_120000_employees.csv`）

#### FR-4: CSVインポート機能との統合

- **FR-4.1**: GmailStorageProviderを使用したCSVインポート
  - 既存の`CsvImportScheduler`を拡張
  - Gmailプロバイダーを選択可能に

- **FR-4.2**: スケジュール実行
  - cron形式で設定可能
  - 既存のスケジュール機能と統合

#### FR-5: 設定拡張

- **FR-5.1**: BackupConfigスキーマの拡張
  - `provider: 'gmail'`を追加
  - Gmail用設定項目を追加（OAuth設定、検索条件など）

- **FR-5.2**: StorageProviderFactoryの拡張
  - GmailStorageProviderの作成ロジックを追加

#### FR-6: ファイル処理

- **FR-6.1**: CSVファイルの処理
  - 既存のCSVインポート機能を使用
  - 従業員CSV・アイテムCSVのインポート

- **FR-6.2**: JPEGファイルの処理
  - 要件定義時に決定（未定）

- **FR-6.3**: その他のファイルタイプ
  - 将来的な拡張を考慮した設計

#### FR-7: エラーハンドリング

- **FR-7.1**: リトライ機能
  - 設定可能なリトライ回数・間隔
  - 指数バックオフによるリトライ

- **FR-7.2**: エラーアラート
  - 既存のアラート機能と統合
  - 連続失敗時のアラート

### 非機能要件

#### NFR-1: パフォーマンス

- **NFR-1.1**: メール検索の応答時間
  - 1件あたり1秒以内

- **NFR-1.2**: ファイル取得の応答時間
  - 1ファイルあたり5秒以内（ファイルサイズに依存）

#### NFR-2: セキュリティ

- **NFR-2.1**: OAuth認証のセキュアな実装
  - トークンの安全な保存
  - HTTPS通信の強制

- **NFR-2.2**: ファイル検証
  - ファイルサイズ制限
  - ファイルタイプ検証

#### NFR-3: 可用性

- **NFR-3.1**: エラー時のフォールバック
  - Gmail取得失敗時は既存の処理を継続

- **NFR-3.2**: ログ記録
  - すべての操作をログに記録
  - エラー時の詳細ログ

#### NFR-4: 保守性

- **NFR-4.1**: 既存コードとの整合性
  - 既存のStorageProviderインターフェースに準拠
  - 既存の設定ファイル形式に準拠

- **NFR-4.2**: テストカバレッジ
  - ユニットテスト: 80%以上
  - 統合テスト: 主要機能をカバー

## 技術仕様

### アーキテクチャ

```
PowerAutomate → Gmail (添付ファイル) → Pi5 (GmailStorageProvider) → CSVインポート処理
                                                                    → JPEG処理（未定）
```

### データフロー

1. **スケジュール実行時**:
   - `CsvImportScheduler`が設定を読み込み
   - `GmailStorageProvider`を作成
   - Gmail APIでメール検索（件名パターン）
   - 添付ファイルを取得
   - CSVインポート処理を実行
   - メールをアーカイブ

2. **エラー時**:
   - リトライ（設定可能）
   - エラーアラートを生成
   - ログに記録

### 設定スキーマ

```typescript
// BackupConfigの拡張
storage: {
  provider: 'local' | 'dropbox' | 'gmail', // 'gmail'を追加
  options: {
    // Gmail用設定
    clientId?: string;        // OAuth 2.0 Client ID
    clientSecret?: string;   // OAuth 2.0 Client Secret
    refreshToken?: string;    // リフレッシュトークン
    accessToken?: string;     // アクセストークン（自動更新）
    redirectUri?: string;     // OAuth リダイレクトURI
    // 検索条件
    subjectPattern?: string;  // 件名パターン（正規表現または固定文字列）
    fromEmail?: string;       // 送信者メールアドレス（オプション）
  }
}

// csvImportsの拡張
csvImports: [{
  id: string;
  name?: string;
  provider: 'dropbox' | 'gmail'; // プロバイダーを選択可能に
  employeesPath?: string;        // Dropbox用: パス、Gmail用: 件名パターン
  itemsPath?: string;            // Dropbox用: パス、Gmail用: 件名パターン
  schedule: string;              // cron形式
  enabled: boolean;
  replaceExisting: boolean;
  // エラーハンドリング設定
  retryConfig?: {
    maxRetries: number;          // 最大リトライ回数（デフォルト: 3）
    retryInterval: number;        // リトライ間隔（秒、デフォルト: 60）
    exponentialBackoff: boolean; // 指数バックオフ（デフォルト: true）
  };
}]
```

### APIエンドポイント

#### Gmail OAuth認証

- `GET /api/gmail/oauth/authorize`: 認証URL生成
- `GET /api/gmail/oauth/callback`: OAuthコールバック処理

#### Gmail設定管理

- `GET /api/gmail/config`: Gmail設定取得
- `PUT /api/gmail/config`: Gmail設定更新
- `POST /api/gmail/test`: Gmail接続テスト

## 実装計画

### Phase 1: Gmail OAuth認証実装

1. **GmailOAuthServiceの実装**
   - OAuth 2.0認証フロー
   - トークンリフレッシュ機能
   - ユニットテスト

2. **OAuth認証エンドポイントの追加**
   - `/api/gmail/oauth/authorize`
   - `/api/gmail/oauth/callback`

### Phase 2: Gmail APIクライアント実装

1. **GmailApiClientの実装**
   - メール検索機能
   - 添付ファイル取得機能
   - メールアーカイブ機能
   - ユニットテスト

### Phase 3: GmailStorageProvider実装

1. **GmailStorageProviderの実装**
   - StorageProviderインターフェースの実装
   - ファイル命名規則の実装
   - ユニットテスト

2. **StorageProviderFactoryの拡張**
   - GmailStorageProviderの作成ロジック追加

### Phase 4: 設定拡張

1. **BackupConfigスキーマの拡張**
   - `provider: 'gmail'`を追加
   - Gmail用設定項目を追加

2. **設定管理UIの拡張**
   - Gmail設定画面の追加
   - OAuth認証フローの実装

### Phase 5: CSVインポート機能との統合

1. **CsvImportSchedulerの拡張**
   - GmailStorageProviderのサポート
   - プロバイダー選択機能

2. **統合テスト**
   - Gmail経由のCSVインポートテスト

### Phase 6: エラーハンドリングとリトライ機能

1. **リトライ機能の実装**
   - 設定可能なリトライ回数・間隔
   - 指数バックオフ

2. **エラーアラートの統合**
   - 既存のアラート機能と統合

### Phase 7: JPEGファイル処理（要件定義時に決定）

1. **JPEGファイル処理の実装**
   - 要件定義時に決定

### Phase 8: ドキュメント作成

1. **Gmail連携ガイド**
   - OAuth設定手順
   - 設定方法
   - トラブルシューティング

2. **PowerAutomate側仕様**
   - メール送信仕様
   - 件名パターン仕様

## テスト計画

### ユニットテスト

1. **GmailOAuthService**
   - OAuth認証フローのテスト
   - トークンリフレッシュのテスト

2. **GmailApiClient**
   - メール検索のテスト
   - 添付ファイル取得のテスト
   - メールアーカイブのテスト

3. **GmailStorageProvider**
   - downloadメソッドのテスト
   - ファイル命名規則のテスト

### 統合テスト

1. **GmailStorageProvider統合テスト**
   - Gmail APIとの統合テスト
   - モックGmail APIを使用

2. **CSVインポート統合テスト**
   - Gmail経由のCSVインポートテスト
   - エラーハンドリングのテスト

### E2Eテスト

1. **Gmail設定管理UIテスト**
   - OAuth認証フローのテスト
   - 設定更新のテスト

2. **CSVインポートE2Eテスト**
   - スケジュール実行のテスト
   - エラー時の動作テスト

## リスクと対策

### リスク1: Gmail APIのレート制限

- **影響**: 大量のメール取得時にレート制限に達する可能性
- **対策**: 
  - リトライ時の指数バックオフを実装
  - レート制限エラーを検出して適切に処理

### リスク2: OAuth認証の複雑さ

- **影響**: OAuth認証フローの実装が複雑
- **対策**: 
  - 既存のDropboxOAuthServiceを参考に実装
  - 段階的に実装してテスト

### リスク3: ファイルタイプの拡張

- **影響**: 将来的に新しいファイルタイプを追加する必要がある
- **対策**: 
  - 拡張可能な設計にする
  - プラグイン的な実装を検討

## 関連ドキュメント

- [バックアップ対象管理UI実装計画](./backup-target-management-ui.md)
- [Dropbox CSV統合ステータス](../analysis/dropbox-csv-integration-status.md)
- [StorageProviderインターフェース](../../apps/api/src/services/backup/storage/storage-provider.interface.ts)

