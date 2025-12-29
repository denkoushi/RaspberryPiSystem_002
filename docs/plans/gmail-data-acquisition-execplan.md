# Gmail経由データ取得機能実装 ExecPlan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

PowerAutomateからGmailに添付ファイルとして送信されたCSVやJPEGなどのファイルを、Pi5が自動的に取得して処理する機能を実装します。既存のDropbox連携機能と同じStorageProviderインターフェースを使用し、設定で選択可能にします。

実装完了後、ユーザーは管理画面からGmail OAuth認証を設定し、スケジュール実行を設定することで、Gmail経由でCSVファイルを自動的に取得してインポートできます。既存のDropbox連携機能と同様に、設定ファイルを編集するだけで、Gmailプロバイダーを選択してCSVインポートを実行できます。

動作確認方法: 管理画面でGmail OAuth認証を設定し、テストメールを送信して、スケジュール実行時にCSVファイルが自動的に取得・インポートされることを確認します。

## Context

### 関連ドキュメント

- `docs/requirements/gmail-data-acquisition-requirements.md`: 要件定義書
- `docs/analysis/dropbox-csv-integration-status.md`: Dropbox CSV統合ステータス
- `docs/plans/backup-modularization-execplan.md`: バックアップ機能のモジュール化ExecPlan（参考）

### 既存実装

- `apps/api/src/services/backup/storage/storage-provider.interface.ts`: StorageProviderインターフェース定義
- `apps/api/src/services/backup/storage/dropbox-storage.provider.ts`: DropboxStorageProvider実装（参考）
- `apps/api/src/services/backup/dropbox-oauth.service.ts`: DropboxOAuthService実装（参考）
- `apps/api/src/services/backup/storage-provider-factory.ts`: StorageProviderFactory実装
- `apps/api/src/services/backup/backup-config.ts`: BackupConfigスキーマ定義
- `apps/api/src/services/imports/csv-import-scheduler.ts`: CSVインポートスケジューラー実装
- `apps/api/src/routes/imports.ts`: CSVインポートAPI実装

### 用語定義

- **StorageProvider**: ファイルのアップロード・ダウンロード・削除・一覧取得を提供するインターフェース。既存実装として`LocalStorageProvider`と`DropboxStorageProvider`がある。
- **GmailStorageProvider**: Gmail APIを使用してメールから添付ファイルを取得するStorageProviderの実装。
- **GmailOAuthService**: Gmail APIへのアクセスに必要なOAuth 2.0認証フローを管理するサービス。
- **GmailApiClient**: Gmail APIを使用してメール検索、添付ファイル取得、メールアーカイブを行うクライアント。
- **BackupConfig**: バックアップ設定を定義するZodスキーマ。`storage.provider`に`'local' | 'dropbox' | 'gmail'`を設定可能。
- **CsvImportScheduler**: cron形式のスケジュールに基づいてCSVインポートを実行するスケジューラー。

## Architecture

### 設計原則

1. **既存インターフェースの再利用**: `StorageProvider`インターフェースを実装し、既存のCSVインポート機能と統合
2. **Dropbox実装のパターンに従う**: `DropboxOAuthService`と`DropboxStorageProvider`の実装パターンを参考にする
3. **設定ベース**: `BackupConfig`スキーマを拡張してGmail設定を追加
4. **セキュリティファースト**: OAuth 2.0認証を使用し、トークンを安全に保存

### コンポーネント構成

```
apps/api/src/services/backup/
├── gmail-oauth.service.ts              # Gmail OAuth認証サービス（新規）
├── gmail-api-client.ts                # Gmail APIクライアント（新規）
└── storage/
    └── gmail-storage.provider.ts      # GmailStorageProvider実装（新規）

apps/api/src/routes/
└── gmail/
    ├── oauth.ts                       # Gmail OAuth認証エンドポイント（新規）
    └── config.ts                     # Gmail設定管理エンドポイント（新規）
```

### データフロー

1. **OAuth認証フロー**:
   - ユーザーが管理画面で「Gmail認証」ボタンをクリック
   - `/api/gmail/oauth/authorize`エンドポイントが認証URLを生成
   - ユーザーがGoogle認証ページで認証
   - `/api/gmail/oauth/callback`エンドポイントが認証コードを受け取り、アクセストークン・リフレッシュトークンを取得
   - トークンを`BackupConfig`に保存

2. **CSVインポート実行フロー**:
   - `CsvImportScheduler`がスケジュール実行時に設定を読み込み
   - `provider: 'gmail'`の場合、`GmailStorageProvider`を作成
   - `GmailApiClient`を使用してメール検索（件名パターン）
   - 添付ファイルを取得して`Buffer`として返す
   - 既存のCSVインポート処理を実行
   - 処理完了後、メールをアーカイブ

### 設定スキーマ拡張

`BackupConfig`スキーマを以下のように拡張:

```typescript
storage: {
  provider: 'local' | 'dropbox' | 'gmail', // 'gmail'を追加
  options: {
    // Gmail用設定
    clientId?: string;        // OAuth 2.0 Client ID
    clientSecret?: string;    // OAuth 2.0 Client Secret
    refreshToken?: string;    // リフレッシュトークン
    accessToken?: string;     // アクセストークン（自動更新）
    redirectUri?: string;     // OAuth リダイレクトURI
    subjectPattern?: string;  // 件名パターン（正規表現または固定文字列）
    fromEmail?: string;       // 送信者メールアドレス（オプション）
  }
}

csvImports: [{
  id: string;
  name?: string;
  provider?: 'dropbox' | 'gmail'; // プロバイダーを選択可能に（オプション、デフォルト: storage.provider）
  employeesPath?: string;        // Dropbox用: パス、Gmail用: 件名パターン
  itemsPath?: string;            // Dropbox用: パス、Gmail用: 件名パターン
  schedule: string;              // cron形式
  enabled: boolean;
  replaceExisting: boolean;
  retryConfig?: {
    maxRetries: number;          // 最大リトライ回数（デフォルト: 3）
    retryInterval: number;        // リトライ間隔（秒、デフォルト: 60）
    exponentialBackoff: boolean; // 指数バックオフ（デフォルト: true）
  };
}]
```

## Milestones

### Milestone 1: Gmail OAuth認証サービスの実装

Gmail APIへのアクセスに必要なOAuth 2.0認証フローを実装します。`DropboxOAuthService`の実装パターンを参考に、Gmail用のOAuthサービスを作成します。

実装内容:
- `apps/api/src/services/backup/gmail-oauth.service.ts`を作成
- `GmailOAuthService`クラスを実装
  - `getAuthorizationUrl(state?: string): string`: 認証URL生成
  - `exchangeCodeForTokens(code: string): Promise<GmailTokenInfo>`: 認証コードをトークンに交換
  - `refreshAccessToken(refreshToken: string): Promise<GmailTokenInfo>`: リフレッシュトークンからアクセストークンを更新
- ユニットテストを実装

検証方法: `GmailOAuthService`の各メソッドをテストし、認証URLが正しく生成され、トークン交換が正常に動作することを確認します。

### Milestone 2: Gmail APIクライアントの実装

Gmail APIを使用してメール検索、添付ファイル取得、メールアーカイブを行うクライアントを実装します。

実装内容:
- `apps/api/package.json`に`googleapis`パッケージを追加（`npm install googleapis`を実行）
- `apps/api/src/services/backup/gmail-api-client.ts`を作成
- `GmailApiClient`クラスを実装
  - コンストラクタで`OAuth2Client`を受け取り、`gmail`スコープで認証
  - `searchMessages(query: string): Promise<Message[]>`: メール検索（Gmail APIの`messages.list`を使用）
  - `getMessage(messageId: string): Promise<Message>`: メール詳細取得（`messages.get`を使用）
  - `getAttachment(messageId: string, attachmentId: string): Promise<Buffer>`: 添付ファイル取得（`messages.attachments.get`を使用）
  - `archiveMessage(messageId: string): Promise<void>`: メールアーカイブ（`messages.modify`を使用して`INBOX`ラベルを削除）
- `googleapis`パッケージの`gmail`スコープを使用
- ユニットテストを実装（モックGmail APIを使用）

検証方法: `GmailApiClient`の各メソッドをテストし、メール検索、添付ファイル取得、メールアーカイブが正常に動作することを確認します。

### Milestone 3: GmailStorageProviderの実装

`StorageProvider`インターフェースを実装して、Gmailからファイルを取得する機能を提供します。

実装内容:
- `apps/api/src/services/backup/storage/gmail-storage.provider.ts`を作成
- `GmailStorageProvider`クラスを実装
  - `download(path: string): Promise<Buffer>`: Gmailからファイルを取得
    - `path`は件名パターンとして解釈
    - `GmailApiClient`を使用してメール検索
    - 最初に見つかったメールの添付ファイルを取得
    - ファイル名にタイムスタンププレフィックスを追加（例: `20251229_120000_employees.csv`）
  - `list(path: string): Promise<FileInfo[]>`: メール一覧を取得（将来の拡張用、実装は簡易版）
  - `upload`: 未実装（Gmailは読み取り専用）
  - `delete`: 未実装（Gmailは読み取り専用）
- ユニットテストを実装

検証方法: `GmailStorageProvider`の`download`メソッドをテストし、Gmailからファイルが正しく取得されることを確認します。

### Milestone 4: StorageProviderFactoryの拡張

`StorageProviderFactory`を拡張して、`GmailStorageProvider`を作成できるようにします。

実装内容:
- `apps/api/src/services/backup/storage-provider-factory.ts`を修正
- `StorageProviderOptions`インターフェースに`'gmail'`を追加
- `providerCreators`マップに`'gmail'`の作成ロジックを追加
- `createFromConfig`メソッドにGmailプロバイダーの処理を追加
  - `refreshToken`から`accessToken`を自動取得（`GmailOAuthService`を使用）
  - トークン更新コールバックで設定ファイルを更新
- ユニットテストを実装

検証方法: `StorageProviderFactory`の`create`メソッドと`createFromConfig`メソッドをテストし、`GmailStorageProvider`が正しく作成されることを確認します。

### Milestone 5: BackupConfigスキーマの拡張

`BackupConfig`スキーマを拡張して、GmailプロバイダーとGmail用設定項目を追加します。

実装内容:
- `apps/api/src/services/backup/backup-config.ts`を修正
- `BackupConfigSchema`の`storage.provider`に`'gmail'`を追加
- `storage.options`にGmail用設定項目を追加:
  - `clientId?: string`
  - `clientSecret?: string`
  - `refreshToken?: string`
  - `accessToken?: string`
  - `redirectUri?: string`
  - `subjectPattern?: string`
  - `fromEmail?: string`
- `csvImports`配列の各要素に`provider?: 'dropbox' | 'gmail'`を追加（オプション、デフォルト: `storage.provider`）
- `csvImports`配列の各要素に`retryConfig`を追加（オプション）

検証方法: `BackupConfigSchema`を使用して設定ファイルをバリデーションし、Gmail設定が正しく読み込まれることを確認します。

### Milestone 6: Gmail OAuth認証エンドポイントの追加

Gmail OAuth認証のためのAPIエンドポイントを追加します。

実装内容:
- `apps/api/src/routes/gmail/oauth.ts`を作成
- `registerGmailOAuthRoutes`関数を実装
  - `GET /api/gmail/oauth/authorize`: 認証URL生成
    - `state`パラメータを生成（CSRF保護）
    - `GmailOAuthService.getAuthorizationUrl`を呼び出し
    - 認証URLを返す
  - `GET /api/gmail/oauth/callback`: OAuthコールバック処理
    - `code`パラメータを受け取り
    - `GmailOAuthService.exchangeCodeForTokens`を呼び出し
    - トークンを`BackupConfig`に保存
    - 成功ページにリダイレクト
- `apps/api/src/routes/index.ts`にルートを登録
- 認証が必要（`authorizeRoles('ADMIN')`）

検証方法: OAuth認証フローをテストし、認証URLが正しく生成され、コールバック処理が正常に動作することを確認します。

### Milestone 7: Gmail設定管理エンドポイントの追加

Gmail設定の取得・更新・テストを行うAPIエンドポイントを追加します。

実装内容:
- `apps/api/src/routes/gmail/config.ts`を作成
- `registerGmailConfigRoutes`関数を実装
  - `GET /api/gmail/config`: Gmail設定取得
    - `BackupConfig`からGmail設定を取得して返す
  - `PUT /api/gmail/config`: Gmail設定更新
    - リクエストボディからGmail設定を取得
    - `BackupConfig`を更新して保存
  - `POST /api/gmail/test`: Gmail接続テスト
    - `GmailApiClient`を使用して接続テスト
    - 成功/失敗を返す
- `apps/api/src/routes/index.ts`にルートを登録
- 認証が必要（`authorizeRoles('ADMIN')`）

検証方法: 各エンドポイントをテストし、設定の取得・更新・テストが正常に動作することを確認します。

### Milestone 8: CsvImportSchedulerの拡張

`CsvImportScheduler`を拡張して、Gmailプロバイダーをサポートします。

実装内容:
- `apps/api/src/services/imports/csv-import-scheduler.ts`を修正
- `executeImport`メソッドを修正
  - `importSchedule.provider`または`config.storage.provider`に基づいてプロバイダーを選択
  - `provider === 'gmail'`の場合、`GmailStorageProvider`を使用
  - `employeesPath`と`itemsPath`を件名パターンとして解釈
  - 既存のCSVインポート処理を実行
- リトライ機能を実装（`retryConfig`を使用）
  - 指数バックオフによるリトライ
  - 最大リトライ回数・リトライ間隔を設定可能
- 統合テストを実装

検証方法: Gmail経由のCSVインポートをテストし、スケジュール実行時にGmailからCSVファイルが正しく取得・インポートされることを確認します。

### Milestone 9: 設定管理UIの拡張

管理画面にGmail設定画面を追加し、OAuth認証フローを実装します。

実装内容:
- `apps/web/src/pages/admin/GmailConfigPage.tsx`を作成
- Gmail設定画面を実装
  - OAuth認証ボタン（`/api/gmail/oauth/authorize`にリダイレクト）
  - 設定項目の表示・編集フォーム
  - 接続テストボタン（`/api/gmail/test`を呼び出し）
- `apps/web/src/routes.tsx`にルートを追加
- ナビゲーションメニューにリンクを追加

検証方法: 管理画面でGmail設定画面にアクセスし、OAuth認証フローが正常に動作することを確認します。

### Milestone 10: ユニットテスト・統合テスト・E2Eテストの実装

すべての機能に対してテストを実装します。

実装内容:
- `apps/api/src/services/backup/__tests__/gmail-oauth.service.test.ts`: GmailOAuthServiceのユニットテスト
- `apps/api/src/services/backup/__tests__/gmail-api-client.test.ts`: GmailApiClientのユニットテスト
- `apps/api/src/services/backup/__tests__/gmail-storage.provider.test.ts`: GmailStorageProviderのユニットテスト
- `apps/api/src/services/imports/__tests__/gmail-csv-import.integration.test.ts`: Gmail経由のCSVインポート統合テスト
- `e2e/gmail.spec.ts`: Gmail設定管理UIのE2Eテスト

検証方法: すべてのテストを実行し、すべてのテストが成功することを確認します。

### Milestone 11: ドキュメント作成

Gmail連携ガイドとPowerAutomate側仕様を作成します。

実装内容:
- `docs/guides/gmail-setup-guide.md`: Gmail連携セットアップガイド
  - OAuth設定手順（Google Cloud Consoleでの設定）
  - Pi5側の設定方法
  - トラブルシューティング
- `docs/guides/powerautomate-gmail-integration.md`: PowerAutomate側仕様
  - メール送信仕様
  - 件名パターン仕様
  - 添付ファイル仕様

検証方法: ドキュメントを確認し、設定手順が明確であることを確認します。

## Progress

- [x] (2025-12-29) Milestone 1: Gmail OAuth認証サービスの実装
  - [x] `apps/api/src/services/backup/gmail-oauth.service.ts`の作成
  - [x] `GmailOAuthService`クラスの実装
  - [x] ユニットテストの実装（9テストすべて成功）
- [x] (2025-12-29) Milestone 2: Gmail APIクライアントの実装
  - [x] `googleapis`パッケージの追加
  - [x] `apps/api/src/services/backup/gmail-api-client.ts`の作成
  - [x] `GmailApiClient`クラスの実装
  - [x] ユニットテストの実装（13テストすべて成功）
- [ ] Milestone 3: GmailStorageProviderの実装
  - [ ] `apps/api/src/services/backup/storage/gmail-storage.provider.ts`の作成
  - [ ] `GmailStorageProvider`クラスの実装
  - [ ] ユニットテストの実装
- [ ] Milestone 4: StorageProviderFactoryの拡張
  - [ ] `StorageProviderOptions`インターフェースの拡張
  - [ ] `providerCreators`マップへの`'gmail'`追加
  - [ ] `createFromConfig`メソッドの拡張
  - [ ] ユニットテストの実装
- [ ] Milestone 5: BackupConfigスキーマの拡張
  - [ ] `storage.provider`に`'gmail'`を追加
  - [ ] `storage.options`にGmail用設定項目を追加
  - [ ] `csvImports`配列の各要素に`provider`と`retryConfig`を追加
- [ ] Milestone 6: Gmail OAuth認証エンドポイントの追加
  - [ ] `apps/api/src/routes/gmail/oauth.ts`の作成
  - [ ] `registerGmailOAuthRoutes`関数の実装
  - [ ] `apps/api/src/routes/index.ts`へのルート登録
- [ ] Milestone 7: Gmail設定管理エンドポイントの追加
  - [ ] `apps/api/src/routes/gmail/config.ts`の作成
  - [ ] `registerGmailConfigRoutes`関数の実装
  - [ ] `apps/api/src/routes/index.ts`へのルート登録
- [ ] Milestone 8: CsvImportSchedulerの拡張
  - [ ] `executeImport`メソッドの修正
  - [ ] リトライ機能の実装
  - [ ] 統合テストの実装
- [ ] Milestone 9: 設定管理UIの拡張
  - [ ] `apps/web/src/pages/admin/GmailConfigPage.tsx`の作成
  - [ ] Gmail設定画面の実装
  - [ ] ナビゲーションメニューへのリンク追加
- [ ] Milestone 10: ユニットテスト・統合テスト・E2Eテストの実装
  - [ ] GmailOAuthServiceのユニットテスト
  - [ ] GmailApiClientのユニットテスト
  - [ ] GmailStorageProviderのユニットテスト
  - [ ] Gmail経由のCSVインポート統合テスト
  - [ ] Gmail設定管理UIのE2Eテスト
- [ ] Milestone 11: ドキュメント作成
  - [ ] `docs/guides/gmail-setup-guide.md`の作成
  - [ ] `docs/guides/powerautomate-gmail-integration.md`の作成

## Surprises & Discoveries

（実装中に発見された予期しない動作、バグ、最適化、洞察を記録）

## Decision Log

（実装中の重要な設計決定とその理由を記録）

## Outcomes & Retrospective

（実装完了後の成果と振り返りを記録）

