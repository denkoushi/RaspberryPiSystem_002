# バックアップ機能のモジュール化・スケーラビリティ評価

最終更新: 2025-12-14

## 概要

Dropbox経由でのバックアップ機能拡張を前提に、現在のシステム構造がモジュール化・疎結合・スケール可能な構造になっているかを評価します。

## 評価対象

- **バックアップ対象の多様化**: CSV、画像ファイル、その他のデータ形式
- **バックアップ先の拡張**: ローカルファイルシステム → Dropbox → その他のクラウドストレージ
- **モジュール化**: 機能の独立性と再利用性
- **疎結合**: コンポーネント間の依存関係の最小化
- **スケーラビリティ**: 新しいバックアップ対象・先を追加する際の容易さ

## 現状の構造分析

### 1. バックアップ実装の現状

#### 1.1 バックアップスクリプト (`scripts/server/backup.sh`)

**構造**:
```bash
# モノリシックなスクリプト
- PostgreSQLデータベースのバックアップ（ハードコード）
- 環境変数ファイルのバックアップ（ハードコード）
- 写真ディレクトリのバックアップ（ハードコード）
- 古いバックアップの削除（ハードコード）
```

**問題点**:
- ❌ **モジュール化されていない**: すべての処理が1つのスクリプトに集約
- ❌ **拡張性が低い**: 新しいバックアップ対象を追加する際に、スクリプトを直接編集する必要がある
- ❌ **テストが困難**: スクリプトベースのため、単体テストが書きにくい
- ❌ **設定がハードコード**: バックアップ先、保持期間などがスクリプト内に直接記述
- ❌ **エラーハンドリングが不十分**: 一部の処理が失敗しても続行されるが、ログが不十分

#### 1.2 ストレージサービス (`apps/api/src/lib/`)

**既存のモジュール**:
- ✅ `PhotoStorage`: 写真ストレージの管理（モジュール化されている）
- ✅ `PdfStorage`: PDFストレージの管理（モジュール化されている）
- ✅ `SignageRenderStorage`: サイネージレンダリングストレージの管理

**良い点**:
- ✅ 各ストレージタイプが独立したクラスとして実装されている
- ✅ インターフェースが明確（`PhotoPathInfo`, `PdfPathInfo`など）
- ✅ 環境変数による設定が可能

**問題点**:
- ❌ **バックアップ機能との統合がない**: ストレージサービスとバックアップ機能が分離されている
- ❌ **共通インターフェースがない**: 各ストレージサービスが独立しており、統一的な操作ができない
- ❌ **外部ストレージプロバイダーへの対応がない**: ローカルファイルシステムのみを想定

### 2. Dropbox統合の現状

**実装状況**: ❌ **未実装**

**評価ドキュメント**:
- ✅ `docs/security/sharepoint-dropbox-integration-assessment.md`: セキュリティ評価は完了
- ✅ `docs/security/sharepoint-dropbox-multi-purpose-assessment.md`: 多目的用途の評価は完了
- ❌ 実際の実装コードは存在しない

### 3. CSVインポート機能の現状

**実装**: `apps/api/src/routes/imports.ts`

**構造**:
- ✅ CSVパース機能がモジュール化されている（`parseCsvRows`関数）
- ✅ バリデーションスキーマが分離されている（`employeeCsvSchema`, `itemCsvSchema`）
- ✅ エラーハンドリングが統一されている

**問題点**:
- ❌ **Dropbox統合がない**: 現在はマルチパートフォームデータからのアップロードのみ
- ❌ **バックアップ機能との統合がない**: CSVインポートとバックアップが独立している

## 評価結果

### モジュール化の評価: ⚠️ **部分的**

**良い点**:
- ✅ ストレージサービス（PhotoStorage, PdfStorage）がモジュール化されている
- ✅ サービス層がドメイン別に分離されている（`apps/api/src/services/`）

**問題点**:
- ❌ バックアップ機能がスクリプトベースでモジュール化されていない
- ❌ バックアップ対象の追加が容易ではない
- ❌ ストレージプロバイダー（ローカル、Dropbox等）の抽象化がない

### 疎結合の評価: ⚠️ **部分的**

**良い点**:
- ✅ ストレージサービスが独立している
- ✅ サービス層がドメイン別に分離されている

**問題点**:
- ❌ バックアップスクリプトがDocker Compose、ファイルパスに強く依存
- ❌ バックアップ対象がハードコードされている
- ❌ ストレージプロバイダーが固定されている（ローカルのみ）

### スケーラビリティの評価: ❌ **不十分**

**問題点**:
- ❌ 新しいバックアップ対象を追加する際に、スクリプトを直接編集する必要がある
- ❌ 新しいバックアップ先（Dropbox等）を追加する際に、大幅な変更が必要
- ❌ 設定がハードコードされており、柔軟性が低い
- ❌ バックアップ対象の追加・削除が容易ではない

## 改善提案

### 提案1: バックアップサービスのモジュール化

#### 1.1 バックアップサービスインターフェースの作成

```typescript
// apps/api/src/services/backup/backup-provider.interface.ts
export interface BackupProvider {
  /**
   * バックアップを実行する
   */
  backup(target: BackupTarget, options?: BackupOptions): Promise<BackupResult>;
  
  /**
   * リストアを実行する
   */
  restore(backupId: string, options?: RestoreOptions): Promise<RestoreResult>;
  
  /**
   * バックアップ一覧を取得する
   */
  listBackups(options?: ListBackupsOptions): Promise<BackupInfo[]>;
  
  /**
   * バックアップを削除する
   */
  deleteBackup(backupId: string): Promise<void>;
}

// apps/api/src/services/backup/backup-target.interface.ts
export interface BackupTarget {
  type: 'database' | 'file' | 'directory' | 'csv' | 'image';
  source: string; // データソースのパスまたは識別子
  metadata?: Record<string, unknown>;
}

// apps/api/src/services/backup/storage-provider.interface.ts
export interface StorageProvider {
  /**
   * ファイルをアップロードする
   */
  upload(file: Buffer, path: string, options?: UploadOptions): Promise<void>;
  
  /**
   * ファイルをダウンロードする
   */
  download(path: string): Promise<Buffer>;
  
  /**
   * ファイルを削除する
   */
  delete(path: string): Promise<void>;
  
  /**
   * ファイル一覧を取得する
   */
  list(path: string): Promise<FileInfo[]>;
}
```

#### 1.2 ストレージプロバイダーの実装

```typescript
// apps/api/src/services/backup/storage/local-storage.provider.ts
export class LocalStorageProvider implements StorageProvider {
  // ローカルファイルシステムへの実装
}

// apps/api/src/services/backup/storage/dropbox-storage.provider.ts
export class DropboxStorageProvider implements StorageProvider {
  // Dropbox APIへの実装
  // - 証明書ピニング
  // - TLS検証
  // - リトライロジック
}
```

#### 1.3 バックアップ対象のプラグイン化

```typescript
// apps/api/src/services/backup/targets/database-backup.target.ts
export class DatabaseBackupTarget implements BackupTarget {
  type = 'database' as const;
  
  async createBackup(): Promise<Buffer> {
    // PostgreSQLダンプの実行
  }
}

// apps/api/src/services/backup/targets/csv-backup.target.ts
export class CsvBackupTarget implements BackupTarget {
  type = 'csv' as const;
  
  constructor(
    private source: string, // CSVファイルのパスまたは識別子
    private schema?: z.ZodSchema // バリデーションスキーマ（オプション）
  ) {}
  
  async createBackup(): Promise<Buffer> {
    // CSVファイルの読み込みとバリデーション
  }
}

// apps/api/src/services/backup/targets/image-backup.target.ts
export class ImageBackupTarget implements BackupTarget {
  type = 'image' as const;
  
  constructor(
    private source: string, // 画像ディレクトリのパス
    private pattern?: string // ファイルパターン（例: "*.jpg"）
  ) {}
  
  async createBackup(): Promise<Buffer> {
    // 画像ファイルのアーカイブ作成
  }
}
```

#### 1.4 バックアップサービスの実装

```typescript
// apps/api/src/services/backup/backup.service.ts
export class BackupService {
  constructor(
    private storageProvider: StorageProvider,
    private targets: BackupTarget[]
  ) {}
  
  async executeBackup(options?: BackupOptions): Promise<BackupResult[]> {
    const results: BackupResult[] = [];
    
    for (const target of this.targets) {
      try {
        const backupData = await target.createBackup();
        const backupPath = this.generateBackupPath(target);
        await this.storageProvider.upload(backupData, backupPath);
        
        results.push({
          target: target.type,
          success: true,
          path: backupPath,
          size: backupData.length,
          timestamp: new Date()
        });
      } catch (error) {
        results.push({
          target: target.type,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date()
        });
      }
    }
    
    return results;
  }
  
  private generateBackupPath(target: BackupTarget): string {
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    return `backups/${target.type}/${date}/${target.source}`;
  }
}
```

### 提案2: 設定ベースのバックアップ対象管理

```typescript
// apps/api/src/services/backup/backup.config.ts
export interface BackupConfig {
  storage: {
    provider: 'local' | 'dropbox';
    options: {
      local?: { path: string };
      dropbox?: { 
        accessToken: string;
        basePath: string;
      };
    };
  };
  targets: Array<{
    type: 'database' | 'file' | 'directory' | 'csv' | 'image';
    source: string;
    enabled: boolean;
    schedule?: string; // cron形式
    retention?: {
      days: number;
      maxCount?: number;
    };
  }>;
  retention: {
    defaultDays: number;
    cleanupSchedule: string; // cron形式
  };
}

// apps/api/src/services/backup/backup-config.loader.ts
export class BackupConfigLoader {
  static load(configPath: string): BackupConfig {
    // 設定ファイル（YAML/JSON）から読み込み
  }
  
  static fromEnv(): BackupConfig {
    // 環境変数から読み込み
  }
}
```

### 提案3: APIエンドポイントの追加

```typescript
// apps/api/src/routes/backup.ts
export async function registerBackupRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');
  
  // バックアップの実行
  app.post('/api/backup/execute', { preHandler: mustBeAdmin }, async (request, reply) => {
    const backupService = app.diContainer.resolve<BackupService>('backupService');
    const results = await backupService.executeBackup();
    return { results };
  });
  
  // バックアップ一覧の取得
  app.get('/api/backup/list', { preHandler: mustBeAdmin }, async (request, reply) => {
    const backupService = app.diContainer.resolve<BackupService>('backupService');
    const backups = await backupService.listBackups();
    return { backups };
  });
  
  // バックアップのリストア
  app.post('/api/backup/restore/:backupId', { preHandler: mustBeAdmin }, async (request, reply) => {
    const { backupId } = request.params as { backupId: string };
    const backupService = app.diContainer.resolve<BackupService>('backupService');
    await backupService.restore(backupId);
    return { success: true };
  });
}
```

## 実装ロードマップ

### Phase 1: 基盤の構築（1-2週間）

1. **インターフェースの定義**
   - `BackupProvider`インターフェース
   - `StorageProvider`インターフェース
   - `BackupTarget`インターフェース

2. **ローカルストレージプロバイダーの実装**
   - `LocalStorageProvider`の実装
   - 既存のバックアップスクリプトの機能を移行

3. **基本的なバックアップ対象の実装**
   - `DatabaseBackupTarget`
   - `FileBackupTarget`
   - `DirectoryBackupTarget`

### Phase 2: Dropbox統合（2-3週間）

1. **Dropboxストレージプロバイダーの実装**
   - `DropboxStorageProvider`の実装
   - 証明書ピニング、TLS検証の実装
   - リトライロジックの実装

2. **セキュリティ対策の実装**
   - 証明書ピニング
   - DNS over HTTPS（オプション）
   - トークン管理の改善

### Phase 3: CSV・画像バックアップの追加（1-2週間）

1. **CSVバックアップ対象の実装**
   - `CsvBackupTarget`の実装
   - バリデーションスキーマの統合

2. **画像バックアップ対象の実装**
   - `ImageBackupTarget`の実装
   - 既存の`PhotoStorage`との統合

### Phase 4: 設定・スケジューリング機能（1週間）

1. **設定ベースの管理**
   - `BackupConfig`の実装
   - 設定ファイルの読み込み機能

2. **スケジューリング機能**
   - cron形式のスケジュール設定
   - 自動バックアップの実行

## 結論

### 現状の評価

- **モジュール化**: ⚠️ 部分的（ストレージサービスはモジュール化されているが、バックアップ機能は未モジュール化）
- **疎結合**: ⚠️ 部分的（サービス層は疎結合だが、バックアップスクリプトは密結合）
- **スケーラビリティ**: ❌ 不十分（新しいバックアップ対象・先の追加が困難）

### 推奨事項

1. **即座に実施すべき**: バックアップサービスのモジュール化（Phase 1）
2. **短期（1-2ヶ月）**: Dropbox統合の実装（Phase 2）
3. **中期（2-3ヶ月）**: CSV・画像バックアップの追加（Phase 3）
4. **長期（3-6ヶ月）**: 設定・スケジューリング機能の実装（Phase 4）

### 期待される効果

- ✅ **拡張性の向上**: 新しいバックアップ対象・先を追加する際の工数削減
- ✅ **保守性の向上**: モジュール化により、各機能のテスト・デバッグが容易に
- ✅ **柔軟性の向上**: 設定ベースの管理により、コード変更なしでバックアップ対象を変更可能
- ✅ **信頼性の向上**: 統一的なエラーハンドリングとログ機能
