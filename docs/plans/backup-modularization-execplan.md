# バックアップ機能のモジュール化・Dropbox統合 ExecPlan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

現在のバックアップ機能はスクリプトベースでモノリシックな構造になっており、Dropbox経由でのバックアップ拡張や、CSV・画像ファイルなど多様なバックアップ対象への対応が困難です。本ExecPlanでは、バックアップ機能をモジュール化し、Dropbox統合を実装することで、以下の機能を実現します：

1. **モジュール化されたバックアップサービス**: プラグイン可能なバックアップ対象とストレージプロバイダー
2. **Dropbox統合**: セキュアなDropbox API統合によるクラウドバックアップ
3. **多様なバックアップ対象への対応**: CSV、画像ファイル、データベースなど、設定ベースで追加可能
4. **スケーラブルな構造**: 新しいバックアップ対象・先を追加する際の工数削減

実装完了後、ユーザーは管理画面からバックアップを実行でき、Dropboxに自動的にアップロードされます。また、設定ファイルを編集するだけで、新しいバックアップ対象を追加できます。

## Context

### 関連ドキュメント

- `docs/architecture/backup-modularity-assessment.md`: バックアップ機能のモジュール化・スケーラビリティ評価
- `docs/security/sharepoint-dropbox-integration-assessment.md`: Dropbox統合のセキュリティ評価
- `docs/security/sharepoint-dropbox-multi-purpose-assessment.md`: 多目的用途の評価
- `docs/plans/imports-ts-refactoring-plan.md`: CSVインポート機能のリファクタリング計画（完了）

### 既存実装

- `scripts/server/backup.sh`: 現在のバックアップスクリプト（モノリシック）
- `apps/api/src/lib/photo-storage.ts`: 写真ストレージサービス（モジュール化済み）
- `apps/api/src/lib/pdf-storage.ts`: PDFストレージサービス（モジュール化済み）
- `apps/api/src/routes/imports.ts`: CSVインポート機能（リファクタリング完了）

### 評価結果の要約

**現状の評価**:
- モジュール化: ⚠️ 部分的（ストレージサービスはモジュール化されているが、バックアップ機能は未モジュール化）
- 疎結合: ⚠️ 部分的（サービス層は疎結合だが、バックアップスクリプトは密結合）
- スケーラビリティ: ❌ 不十分（新しいバックアップ対象・先の追加が困難）

## Scope

### 改修範囲

**本ExecPlanの範囲**:
1. ✅ バックアップサービスのモジュール化（Phase 1）
2. ✅ Dropbox統合の実装（Phase 2）
3. ✅ CSV・画像バックアップの追加（Phase 3）
4. ✅ 設定・スケジューリング機能（Phase 4）

**範囲外**:
- ❌ CSVインポート機能のリファクタリング（`imports.ts`のリファクタリングは既に完了）
- ❌ SharePoint統合（評価のみ完了、実装は別計画）
- ❌ PowerAutomate統合（評価のみ完了、実装は別計画）
- ❌ 既存のストレージサービス（PhotoStorage, PdfStorage）の変更（統合のみ）

### 改修範囲の明確化

**現在実装中の範囲に留まるか？**: **いいえ、拡張が必要**

理由:
1. **`imports.ts`のリファクタリングは完了**: Phase 1-3すべて完了、テストも追加済み
2. **バックアップ機能のモジュール化は未着手**: 評価のみ完了、実装はこれから
3. **統合が必要**: CSVインポート機能とバックアップ機能を統合する必要がある

**統合計画**:
- CSVインポート機能（`imports.ts`）は既にリファクタリング完了
- バックアップ機能のモジュール化を実装し、CSVインポート機能と統合
- Dropbox統合により、CSVファイルの自動バックアップを実現

## Architecture

### 設計原則

1. **インターフェース分離**: `BackupProvider`, `StorageProvider`, `BackupTarget`を分離
2. **依存性逆転**: 具象実装ではなくインターフェースに依存
3. **設定ベース**: コード変更なしでバックアップ対象を追加・削除可能
4. **セキュリティファースト**: Dropbox統合では証明書ピニング、TLS検証を必須

### コンポーネント構成

```
apps/api/src/services/backup/
├── backup.service.ts              # メインのバックアップサービス
├── backup-provider.interface.ts   # BackupProviderインターフェース
├── backup-target.interface.ts    # BackupTargetインターフェース
├── backup-config.ts               # 設定型定義
├── backup-config.loader.ts        # 設定読み込み
├── storage/
│   ├── storage-provider.interface.ts
│   ├── local-storage.provider.ts
│   └── dropbox-storage.provider.ts
├── targets/
│   ├── database-backup.target.ts
│   ├── file-backup.target.ts
│   ├── directory-backup.target.ts
│   ├── csv-backup.target.ts
│   └── image-backup.target.ts
└── scheduler/
    └── backup-scheduler.ts        # cron形式のスケジューリング
```

### インターフェース定義

```typescript
// BackupProvider: バックアップの実行・管理を提供
interface BackupProvider {
  backup(target: BackupTarget, options?: BackupOptions): Promise<BackupResult>;
  restore(backupId: string, options?: RestoreOptions): Promise<RestoreResult>;
  listBackups(options?: ListBackupsOptions): Promise<BackupInfo[]>;
  deleteBackup(backupId: string): Promise<void>;
}

// StorageProvider: ストレージへの保存・取得を提供
interface StorageProvider {
  upload(file: Buffer, path: string, options?: UploadOptions): Promise<void>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  list(path: string): Promise<FileInfo[]>;
}

// BackupTarget: バックアップ対象を抽象化
interface BackupTarget {
  type: 'database' | 'file' | 'directory' | 'csv' | 'image';
  source: string;
  metadata?: Record<string, unknown>;
  createBackup(): Promise<Buffer>;
}
```

## Milestones

### Milestone 1: 基盤の構築

**目標**: バックアップサービスの基盤となるインターフェースとローカルストレージプロバイダーを実装する。

**作業内容**:
1. インターフェースの定義（`BackupProvider`, `StorageProvider`, `BackupTarget`）
2. `LocalStorageProvider`の実装
3. 基本的なバックアップ対象の実装（`DatabaseBackupTarget`, `FileBackupTarget`, `DirectoryBackupTarget`）
4. `BackupService`の実装
5. 既存のバックアップスクリプトの機能を移行

**検証方法**:
- 単体テストの作成と実行
- 既存のバックアップスクリプトと同じ結果が得られることを確認
- `pnpm test`でテストが通過することを確認

**完了条件**:
- すべてのインターフェースが定義されている
- `LocalStorageProvider`が実装され、テストが通過している
- 基本的なバックアップ対象が実装され、テストが通過している
- `BackupService`が実装され、ローカルストレージへのバックアップが動作している

### Milestone 2: Dropbox統合

**目標**: Dropbox APIを使用したクラウドバックアップ機能を実装する。

**作業内容**:
1. `DropboxStorageProvider`の実装
2. Dropbox API認証の実装（アクセストークン管理）
3. セキュリティ対策の実装（証明書ピニング、TLS検証）
4. リトライロジックの実装（`Retry-After`ヘッダー対応、指数バックオフ）
5. エラーハンドリングの実装

**検証方法**:
- Dropbox APIへの接続テスト
- 証明書ピニングの動作確認
- リトライロジックの動作確認（レート制限エラーのシミュレーション）
- `pnpm test`でテストが通過することを確認

**完了条件**:
- `DropboxStorageProvider`が実装され、テストが通過している
- 証明書ピニングが実装され、動作確認が完了している
- リトライロジックが実装され、レート制限エラーに対応できている
- Dropboxへのバックアップアップロードが動作している

### Milestone 3: CSV・画像バックアップの追加

**目標**: CSVファイルと画像ファイルのバックアップ機能を追加する。

**作業内容**:
1. `CsvBackupTarget`の実装
2. `ImageBackupTarget`の実装
3. 既存の`PhotoStorage`との統合
4. CSVインポート機能（`imports.ts`）との統合
5. バリデーションスキーマの統合

**検証方法**:
- CSVファイルのバックアップテスト
- 画像ファイルのバックアップテスト
- 既存のCSVインポート機能との統合テスト
- `pnpm test`でテストが通過することを確認

**完了条件**:
- `CsvBackupTarget`が実装され、テストが通過している
- `ImageBackupTarget`が実装され、テストが通過している
- 既存の`PhotoStorage`と統合されている
- CSVインポート機能と統合されている

### Milestone 4: 設定・スケジューリング機能

**目標**: 設定ベースのバックアップ対象管理とスケジューリング機能を実装する。

**作業内容**:
1. `BackupConfig`の実装（YAML/JSON設定ファイル対応）
2. 設定ファイルの読み込み機能
3. cron形式のスケジュール設定
4. 自動バックアップの実行機能
5. APIエンドポイントの追加（`/api/backup/execute`, `/api/backup/list`, `/api/backup/restore/:backupId`）

**検証方法**:
- 設定ファイルからの読み込みテスト
- cron形式のスケジュール設定テスト
- 自動バックアップの実行テスト
- APIエンドポイントの動作確認
- `pnpm test`でテストが通過することを確認

**完了条件**:
- `BackupConfig`が実装され、設定ファイルから読み込める
- cron形式のスケジュール設定が動作している
- 自動バックアップが実行されている
- APIエンドポイントが実装され、動作している

## Progress

- [ ] Milestone 1: 基盤の構築
  - [ ] インターフェースの定義
  - [ ] `LocalStorageProvider`の実装
  - [ ] 基本的なバックアップ対象の実装
  - [ ] `BackupService`の実装
  - [ ] 既存のバックアップスクリプトの機能を移行
- [ ] Milestone 2: Dropbox統合
  - [ ] `DropboxStorageProvider`の実装
  - [ ] Dropbox API認証の実装
  - [ ] セキュリティ対策の実装
  - [ ] リトライロジックの実装
- [ ] Milestone 3: CSV・画像バックアップの追加
  - [ ] `CsvBackupTarget`の実装
  - [ ] `ImageBackupTarget`の実装
  - [ ] 既存の`PhotoStorage`との統合
  - [ ] CSVインポート機能との統合
- [ ] Milestone 4: 設定・スケジューリング機能
  - [ ] `BackupConfig`の実装
  - [ ] 設定ファイルの読み込み機能
  - [ ] cron形式のスケジュール設定
  - [ ] 自動バックアップの実行機能
  - [ ] APIエンドポイントの追加

## Surprises & Discoveries

（実装中に発見した内容を記録）

## Decision Log

### 2025-12-14: 改修範囲の明確化

**決定**: バックアップ機能のモジュール化は、`imports.ts`のリファクタリングとは独立した作業として実施する。

**理由**:
- `imports.ts`のリファクタリングは既に完了している（Phase 1-3すべて完了）
- バックアップ機能のモジュール化は評価のみ完了、実装は未着手
- CSVインポート機能とバックアップ機能は統合するが、それぞれ独立したモジュールとして実装

**影響**:
- CSVインポート機能のリファクタリング計画は完了として扱う
- バックアップ機能のモジュール化は新しいExecPlanとして実施
- 両機能の統合はMilestone 3で実施

### 2025-12-14: 実装範囲の決定

**決定**: 本ExecPlanでは、バックアップ機能のモジュール化とDropbox統合に焦点を当てる。

**理由**:
- SharePoint統合、PowerAutomate統合は評価のみ完了、実装は別計画
- バックアップ機能のモジュール化が優先度が高い
- Dropbox統合により、クラウドバックアップの基盤が整う

**影響**:
- SharePoint統合、PowerAutomate統合は範囲外
- バックアップ機能のモジュール化とDropbox統合に集中

## Outcomes & Retrospective

（実装完了後に記録）

## Testing Strategy

### 単体テスト

**対象**:
- `BackupProvider`インターフェースの実装
- `StorageProvider`インターフェースの実装（`LocalStorageProvider`, `DropboxStorageProvider`）
- `BackupTarget`インターフェースの実装（各バックアップ対象）

**テストケース**:
- 正常系: バックアップの作成、リストア、一覧取得、削除
- 異常系: ファイルが見つからない、ネットワークエラー、認証エラー
- エッジケース: 空のファイル、大きなファイル、特殊文字を含むパス

### 統合テスト

**対象**:
- `BackupService`と各コンポーネントの統合
- Dropbox APIとの統合
- CSVインポート機能との統合

**テストケース**:
- ローカルストレージへのバックアップ
- Dropboxへのバックアップアップロード
- CSVファイルのバックアップ
- 画像ファイルのバックアップ
- 設定ファイルからの読み込み

### E2Eテスト

**対象**:
- APIエンドポイント（`/api/backup/execute`, `/api/backup/list`, `/api/backup/restore/:backupId`）
- 管理画面からのバックアップ実行

**テストケース**:
- 管理画面からバックアップを実行
- バックアップ一覧の表示
- バックアップのリストア

## Security Considerations

### Dropbox統合のセキュリティ対策

1. **証明書ピニング**: Dropbox APIの証明書を固定し、中間者攻撃を防止
2. **TLS検証**: `rejectUnauthorized: true`を設定し、証明書検証を有効化
3. **トークン管理**: 環境変数で管理し、Ansible Vaultで暗号化
4. **最小権限の原則**: Dropboxアプリには必要最小限の権限を付与

詳細は`docs/security/sharepoint-dropbox-integration-assessment.md`を参照。

## Dependencies

### 新規依存関係

- `dropbox` (または `@dropbox/dropbox-sdk`): Dropbox API SDK
- `yaml` (または `js-yaml`): YAML設定ファイルの読み込み（オプション）
- `node-cron`: cron形式のスケジュール設定（オプション）

### 既存依存関係

- `@prisma/client`: データベースアクセス
- `fastify`: APIエンドポイント
- `zod`: バリデーションスキーマ

## Related Documents

- `docs/architecture/backup-modularity-assessment.md`: バックアップ機能のモジュール化・スケーラビリティ評価
- `docs/security/sharepoint-dropbox-integration-assessment.md`: Dropbox統合のセキュリティ評価
- `docs/security/sharepoint-dropbox-multi-purpose-assessment.md`: 多目的用途の評価
- `docs/plans/imports-ts-refactoring-plan.md`: CSVインポート機能のリファクタリング計画（完了）
