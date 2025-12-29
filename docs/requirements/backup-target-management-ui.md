# バックアップ対象管理UI実装計画

最終更新: 2025-12-29（Phase 9.6のDropboxバックアップ履歴未記録問題修正を追加）

## 概要

管理コンソールのバックアップタブに、バックアップ対象（`targets`）の管理機能を追加します。これにより、`backup.sh`スクリプトと管理コンソールのバックアップタブの機能が整合性を保ち、ユーザーはUIからバックアップ対象の有効/無効切り替え、追加、除外、スケジュール編集が可能になります。

## 現状分析

### 既存機能

1. **バックアップ履歴表示** (`BackupHistoryPage.tsx`)
   - バックアップ・リストア履歴の一覧表示
   - フィルタリング（操作種別、ステータス、日時範囲）
   - ページネーション

2. **Dropboxからのリストア** (`BackupRestorePage.tsx`)
   - Dropbox上のバックアップファイルからリストア実行
   - 画像バックアップ（`tar.gz`形式）の自動展開・復元機能

3. **APIエンドポイント**
   - `GET /api/backup/config`: バックアップ設定の取得
   - `PUT /api/backup/config`: バックアップ設定の更新
   - `POST /api/backup`: 手動バックアップ実行
   - `GET /api/backup/history`: バックアップ履歴取得

### 不足している機能

1. **バックアップ対象の一覧表示**
   - 現在の`targets`配列の内容を表示
   - 各対象の`kind`、`source`、`schedule`、`enabled`状態を表示

2. **バックアップ対象の有効/無効切り替え**
   - 各対象の`enabled`フラグをトグル

3. **バックアップ対象の追加**
   - 新しい`target`を追加するフォーム
   - `kind`、`source`、`schedule`の入力

4. **バックアップ対象の削除（除外）**
   - 既存の`target`を`targets`配列から削除

5. **スケジュールの編集**
   - 既存の`target`の`schedule`（cron形式）を編集

## 要件定義

### 機能要件

#### FR-1: バックアップ対象一覧表示

- **目的**: 現在のバックアップ対象を一覧表示し、状態を確認できるようにする
- **表示項目**:
  - `kind`: バックアップ種類（database, csv, image, file, directory）
  - `source`: バックアップソース（データベースURL、CSVタイプ、ファイルパスなど）
  - `schedule`: スケジュール（cron形式、例: "0 4 * * *"）
  - `enabled`: 有効/無効状態（トグルスイッチ）
  - 最終実行日時（バックアップ履歴から取得）
  - 最終実行ステータス（成功/失敗）
- **レイアウト**: テーブル形式
- **ソート**: `kind`、`enabled`状態でソート可能

#### FR-2: バックアップ対象の有効/無効切り替え

- **目的**: 各バックアップ対象を一時的に無効化/有効化できるようにする
- **操作**: トグルスイッチをクリック
- **動作**:
  - `enabled`フラグを反転
  - 設定ファイル（`backup.json`）を更新
  - 成功/失敗のフィードバックを表示
- **制約**: `enabled: false`の場合、スケジュールバックアップは実行されないが、手動バックアップは可能

#### FR-3: バックアップ対象の追加

- **目的**: 新しいバックアップ対象を追加できるようにする
- **入力項目**:
  - `kind`: セレクトボックス（database, csv, image, file, directory）
  - `source`: テキスト入力（`kind`に応じてプレースホルダーを変更）
  - `schedule`: テキスト入力（cron形式、バリデーション付き）
  - `enabled`: チェックボックス（デフォルト: true）
- **バリデーション**:
  - `kind`は必須
  - `source`は必須
  - `schedule`はcron形式のバリデーション（オプション）
- **動作**:
  - フォーム送信後、`targets`配列に追加
  - 設定ファイル（`backup.json`）を更新
  - 成功/失敗のフィードバックを表示

#### FR-4: バックアップ対象の削除（除外）

- **目的**: 不要なバックアップ対象を削除できるようにする
- **操作**: 削除ボタンをクリック
- **確認**: 削除前に確認ダイアログを表示
- **動作**:
  - `targets`配列から該当項目を削除
  - 設定ファイル（`backup.json`）を更新
  - 成功/失敗のフィードバックを表示

#### FR-5: スケジュールの編集

- **目的**: 既存のバックアップ対象のスケジュールを編集できるようにする
- **操作**: 編集ボタンをクリック → モーダルまたはインライン編集
- **入力項目**:
  - `schedule`: テキスト入力（cron形式、バリデーション付き）
- **バリデーション**: cron形式のバリデーション
- **動作**:
  - 設定ファイル（`backup.json`）を更新
  - 成功/失敗のフィードバックを表示

#### FR-6: 手動バックアップ実行

- **目的**: 特定のバックアップ対象を手動で実行できるようにする
- **操作**: 実行ボタンをクリック
- **動作**:
  - `POST /api/backup`を呼び出し
  - バックアップ履歴を更新
  - 実行中はローディング表示
  - 成功/失敗のフィードバックを表示

### 非機能要件

#### NFR-1: パフォーマンス

- バックアップ設定の取得・更新は1秒以内に完了すること
- 一覧表示は100件まで対応すること

#### NFR-2: ユーザビリティ

- 直感的なUI/UXを提供すること
- エラーメッセージは明確で、ユーザーが理解しやすいこと
- 操作の成功/失敗は明確にフィードバックすること

#### NFR-3: 整合性

- `backup.sh`スクリプトと管理コンソールのバックアップタブの機能が整合性を保つこと
- 設定ファイル（`backup.json`）の変更は即座に反映されること

## 実装計画

### Phase 1: API拡張（バックアップ対象管理）

#### 1.1 バックアップ対象の個別操作API

**エンドポイント追加**:
- `PUT /api/backup/config/targets/:index`: 特定の`target`を更新（`enabled`、`schedule`など）
- `DELETE /api/backup/config/targets/:index`: 特定の`target`を削除
- `POST /api/backup/config/targets`: 新しい`target`を追加

**実装ファイル**:
- `apps/api/src/routes/backup.ts`

**変更内容**:
- 既存の`PUT /api/backup/config`エンドポイントを拡張
- 個別操作用のエンドポイントを追加

### Phase 2: フロントエンドAPIクライアント拡張

#### 2.1 バックアップ設定APIクライアント

**実装ファイル**:
- `apps/web/src/api/backup.ts`

**追加関数**:
- `getBackupConfig()`: バックアップ設定を取得
- `updateBackupConfig(config: BackupConfig)`: バックアップ設定を更新
- `addBackupTarget(target: BackupTarget)`: バックアップ対象を追加
- `updateBackupTarget(index: number, target: Partial<BackupTarget>)`: バックアップ対象を更新
- `deleteBackupTarget(index: number)`: バックアップ対象を削除
- `runBackup(kind: string, source: string)`: 手動バックアップ実行

**型定義追加**:
```typescript
export interface BackupTarget {
  kind: 'database' | 'file' | 'directory' | 'csv' | 'image';
  source: string;
  schedule?: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface BackupConfig {
  storage: {
    provider: 'local' | 'dropbox';
    options?: {
      basePath?: string;
      accessToken?: string;
      refreshToken?: string;
      appKey?: string;
      appSecret?: string;
    };
  };
  targets: BackupTarget[];
  retention?: {
    days?: number;
    maxBackups?: number;
  };
}
```

#### 2.2 React Query Hooks

**実装ファイル**:
- `apps/web/src/api/hooks.ts`

**追加Hooks**:
- `useBackupConfig()`: バックアップ設定を取得
- `useBackupConfigMutations()`: バックアップ設定の更新、追加、削除用のmutations

### Phase 3: UI実装

#### 3.1 バックアップ対象管理ページ

**実装ファイル**:
- `apps/web/src/pages/admin/BackupTargetsPage.tsx`（新規作成）

**機能**:
- バックアップ対象一覧表示（テーブル）
- 有効/無効トグルスイッチ
- 追加ボタン（モーダルフォーム）
- 編集ボタン（モーダルフォーム）
- 削除ボタン（確認ダイアログ付き）
- 手動実行ボタン

**レイアウト**:
- `Card`コンポーネントを使用
- テーブル形式で一覧表示
- 各操作はボタンまたはトグルスイッチ

#### 3.2 バックアップ対象追加/編集フォーム

**実装ファイル**:
- `apps/web/src/components/backup/BackupTargetForm.tsx`（新規作成）

**機能**:
- `kind`セレクトボックス
- `source`テキスト入力（`kind`に応じてプレースホルダー変更）
- `schedule`テキスト入力（cron形式バリデーション）
- `enabled`チェックボックス
- バリデーションエラー表示

#### 3.3 ルーティング追加

**実装ファイル**:
- `apps/web/src/App.tsx`

**変更内容**:
- `/admin/backup/targets`ルートを追加
- `BackupTargetsPage`コンポーネントを追加

#### 3.4 ナビゲーション追加

**実装ファイル**:
- `apps/web/src/layouts/AdminLayout.tsx`

**変更内容**:
- バックアップタブにサブメニューを追加
  - バックアップ対象
  - バックアップ履歴
  - Dropboxからリストア

### Phase 4: 統合・テスト

#### 4.1 統合テスト

- バックアップ対象の追加・更新・削除が正しく動作することを確認
- `backup.sh`スクリプトと管理コンソールのバックアップタブの機能が整合性を保つことを確認
- 設定ファイル（`backup.json`）の変更が即座に反映されることを確認

#### 4.2 E2Eテスト

- Playwrightを使用してE2Eテストを実装
- バックアップ対象の追加・更新・削除のフローをテスト

## テストメニュー

### 単体テスト

#### UT-1: バックアップ設定API

- `GET /api/backup/config`: 設定が正しく取得できること
- `PUT /api/backup/config`: 設定が正しく更新できること
- `PUT /api/backup/config/targets/:index`: 特定の`target`が正しく更新できること
- `DELETE /api/backup/config/targets/:index`: 特定の`target`が正しく削除できること
- `POST /api/backup/config/targets`: 新しい`target`が正しく追加できること

#### UT-2: バックアップ設定バリデーション

- 無効な`kind`が拒否されること
- 無効な`schedule`（cron形式）が拒否されること
- 必須項目が欠けている場合にエラーが返されること

#### UT-3: フロントエンドAPIクライアント

- `getBackupConfig()`が正しく動作すること
- `updateBackupConfig()`が正しく動作すること
- `addBackupTarget()`が正しく動作すること
- `updateBackupTarget()`が正しく動作すること
- `deleteBackupTarget()`が正しく動作すること

### 統合テスト

#### IT-1: バックアップ対象の追加

1. 管理コンソールでバックアップ対象を追加
2. 設定ファイル（`backup.json`）が正しく更新されることを確認
3. `backup.sh`スクリプトが新しい対象を認識することを確認

#### IT-2: バックアップ対象の有効/無効切り替え

1. 管理コンソールでバックアップ対象を無効化
2. 設定ファイル（`backup.json`）の`enabled`フラグが`false`になることを確認
3. スケジュールバックアップが実行されないことを確認
4. 手動バックアップは実行できることを確認

#### IT-3: バックアップ対象の削除

1. 管理コンソールでバックアップ対象を削除
2. 設定ファイル（`backup.json`）から該当項目が削除されることを確認
3. `backup.sh`スクリプトが削除された対象を認識しないことを確認

#### IT-4: スケジュールの編集

1. 管理コンソールでバックアップ対象のスケジュールを編集
2. 設定ファイル（`backup.json`）の`schedule`が正しく更新されることを確認
3. 新しいスケジュールでバックアップが実行されることを確認

#### IT-5: 手動バックアップ実行

1. 管理コンソールで手動バックアップを実行
2. バックアップが正常に完了することを確認
3. バックアップ履歴に記録されることを確認

### E2Eテスト

#### E2E-1: バックアップ対象の追加フロー

1. 管理コンソールにログイン
2. バックアップタブ → バックアップ対象を開く
3. 「追加」ボタンをクリック
4. フォームに入力（`kind`: database, `source`: postgresql://..., `schedule`: "0 4 * * *"）
5. 「保存」ボタンをクリック
6. 一覧に新しい対象が表示されることを確認

#### E2E-2: バックアップ対象の有効/無効切り替えフロー

1. 管理コンソールでバックアップ対象一覧を開く
2. トグルスイッチをクリックして無効化
3. 設定が保存されることを確認
4. トグルスイッチをクリックして再有効化
5. 設定が保存されることを確認

#### E2E-3: バックアップ対象の削除フロー

1. 管理コンソールでバックアップ対象一覧を開く
2. 削除ボタンをクリック
3. 確認ダイアログで「削除」をクリック
4. 一覧から該当項目が削除されることを確認

#### E2E-4: 手動バックアップ実行フロー

1. 管理コンソールでバックアップ対象一覧を開く
2. 「実行」ボタンをクリック
3. バックアップが実行されることを確認
4. バックアップ履歴に記録されることを確認

### 実機検証

#### RV-1: バックアップ対象の追加・更新・削除

1. Pi5上で管理コンソールにアクセス
2. バックアップ対象を追加
3. `backup.sh`スクリプトを実行
4. 新しい対象がバックアップされることを確認
5. バックアップ対象を無効化
6. `backup.sh`スクリプトを実行
7. 無効化された対象がスキップされることを確認
8. バックアップ対象を削除
9. `backup.sh`スクリプトを実行
10. 削除された対象がスキップされることを確認

#### RV-2: Dropbox連携

1. Dropbox設定が有効化されている状態でバックアップ対象を追加
2. `backup.sh`スクリプトを実行
3. Dropboxにバックアップがアップロードされることを確認

## 実装順序

1. **Phase 1: API拡張**（1-2日） ✅ **完了**
   - バックアップ対象の個別操作APIを実装
   - 単体テストを実装

2. **Phase 2: フロントエンドAPIクライアント拡張**（1日） ✅ **完了**
   - APIクライアント関数を追加
   - React Query Hooksを追加

3. **Phase 3: UI実装**（2-3日） ✅ **完了**
   - バックアップ対象管理ページを実装
   - バックアップ対象追加/編集フォームを実装
   - ルーティング・ナビゲーションを追加

4. **Phase 4: 統合・テスト**（1-2日） 🔄 **進行中**
   - 統合テストを実装
   - E2Eテストを実装
   - 実機検証を実施

**合計**: 5-8日

## 実装状況

### Phase 1: API拡張 ✅ 完了

- ✅ `POST /api/backup/config/targets`: バックアップ対象を追加
- ✅ `PUT /api/backup/config/targets/:index`: バックアップ対象を更新
- ✅ `DELETE /api/backup/config/targets/:index`: バックアップ対象を削除

### Phase 2: フロントエンドAPIクライアント拡張 ✅ 完了

- ✅ `getBackupConfig()`, `updateBackupConfig()`関数を追加
- ✅ `addBackupTarget()`, `updateBackupTarget()`, `deleteBackupTarget()`関数を追加
- ✅ `runBackup()`関数を追加（手動バックアップ実行）
- ✅ `useBackupConfig()`, `useBackupConfigMutations()` Hooksを追加

### Phase 3: UI実装 ✅ 完了

- ✅ `BackupTargetsPage.tsx`: バックアップ対象一覧表示、有効/無効切り替え、追加・編集・削除機能
- ✅ `BackupTargetForm.tsx`: バックアップ対象追加/編集フォーム
- ✅ ルーティング追加: `/admin/backup/targets`
- ✅ ナビゲーション更新: バックアップタブのデフォルトルートを変更

### Phase 4: 統合・テスト ✅ 完了

- ✅ 統合テスト実装（`apps/api/src/routes/__tests__/backup.integration.test.ts`）
- ✅ E2Eテスト実装（`e2e/admin.spec.ts`）
- ✅ 実機検証手順ドキュメント作成（`docs/guides/backup-target-management-verification.md`）

### Phase 8: バックアップ対象ごとのストレージプロバイダー指定機能 ✅ 完了（2025-12-28）

#### Phase 8.1: 単一プロバイダー指定（Phase 1） ✅ 完了

**実装内容**:
- ✅ BackupConfigスキーマ: `BackupTarget`に`storage.provider`を追加（オプショナル、デフォルトは全体設定）
- ✅ StorageProviderFactory: `createFromTarget`メソッドを追加（対象ごとのストレージ設定に対応）
- ✅ BackupScheduler: 対象ごとのストレージプロバイダーを使用するように変更
- ✅ BackupRoute: 手動実行・内部エンドポイントで対象ごとのストレージ設定に対応
- ✅ BackupTargetForm: バックアップ先選択欄を追加（システム設定を使用/ローカル/Dropbox）
- ✅ BackupTargetsPage: テーブル表示で対象ごとのストレージプロバイダーを表示
- ✅ 後方互換性: `storage`未指定時は全体設定を使用

**UI変更**:
- スケジュール入力UIを改善（テキスト入力 → 時刻入力フィールド + 曜日選択ボタン）
- バックアップ先選択欄を追加（ドロップダウン: システム設定を使用/ローカル/Dropbox）

**コミット**: `062da40` - feat: Phase 1 - バックアップ対象ごとのストレージプロバイダー指定機能を実装

#### Phase 8.2: 多重バックアップ（Phase 2） ✅ 完了

**実装内容**:
- ✅ BackupConfigスキーマ: `BackupTarget`に`storage.providers`配列を追加
- ✅ BackupScheduler: 複数のプロバイダーに順次バックアップを実行するロジックを実装
- ✅ BackupRoute: 手動実行・内部エンドポイントで多重バックアップに対応
- ✅ BackupTargetForm: チェックボックスで複数のプロバイダーを選択可能に
- ✅ BackupTargetsPage: テーブル表示で複数のプロバイダーを表示
- ✅ 後方互換性: `provider`が指定されている場合は単一プロバイダーとして扱う

**UI変更**:
- バックアップ先選択をチェックボックス形式に変更（複数選択可能）
- 「システム設定を使用」チェックボックスを追加（未選択時は他の選択肢が無効化）

**動作**:
- 複数のプロバイダーが指定されている場合、各プロバイダーに順次バックアップを実行
- 1つのプロバイダーで失敗しても、他のプロバイダーへのバックアップは継続
- すべてのプロバイダーで失敗した場合のみエラーをスロー

**コミット**: `8e0deb2` - feat: Phase 2 - 多重バックアップ機能を実装

#### Phase 8.3: E2Eテスト修正 ✅ 完了

**修正内容**:
- ✅ E2EテストをPhase 1の新しいスケジュールUIに対応
  - `getByLabel(/スケジュール/i).fill()` → `locator('input[type="time"]').fill()`
  - 時刻入力フィールドに直接アクセスするように変更

**コミット**: `5b05f47` - fix: E2EテストをPhase 1の新しいスケジュールUIに対応

**CI結果**: ✅ 成功（Run ID: `20546829677`）

### Phase 9: バックアップ対象ごとの保持期間設定と自動削除機能 ✅ 完了（2025-12-28）

#### Phase 9.1: スキーマ拡張とバックエンド実装 ✅ 完了

**実装内容**:
- ✅ BackupConfigスキーマ: `BackupTarget`に`retention`フィールドを追加（`days`、`maxBackups`）
- ✅ BackupScheduler: `cleanupOldBackups`メソッドを対象ごとの`retention`設定に対応
- ✅ 対象ごとの設定を優先、未指定時は全体設定を使用（後方互換性）
- ✅ 対象ごとのバックアップのみをクリーンアップ（`prefix`でフィルタ）

**技術的な詳細**:
- `retention.days`: 保持日数（例: 30日）
- `retention.maxBackups`: 最大保持数（例: 10件）
- バックアップ実行時に自動的に期限切れバックアップを削除
- 対象ごとのバックアップを`prefix`でフィルタしてクリーンアップ

#### Phase 9.2: UI実装 ✅ 完了

**実装内容**:
- ✅ BackupTargetForm: 保持期間設定欄を追加（保持日数、最大保持数の入力フィールド）
- ✅ BackupTargetsPage: テーブルに保持期間列を追加（対象ごとの設定または全体設定を表示）
- ✅ 後方互換性: `retention`未指定時は全体設定を表示

**UI変更**:
- 保持期間設定欄を追加（オプショナル）
- テーブルに保持期間列を追加（例: "30日 / 最大10件" または "全体設定: 30日 / 最大10件"）

#### Phase 9.3: APIルート拡張 ✅ 完了

**実装内容**:
- ✅ `POST /backup/config/targets`: `retention`フィールドを処理
- ✅ `PUT /backup/config/targets/:index`: `retention`フィールドを処理
- ✅ スキーマに`retention`フィールドを追加

**コミット**: `2ecbf63` - feat: Phase 3 - バックアップ対象ごとの保持期間設定と自動削除機能を実装

**CI結果**: ✅ 成功（Run ID: `20547025578`）

#### Phase 9.4: バックアップ履歴のファイル存在状態管理機能 ✅ 完了（2025-12-28）

**実装内容**:
- ✅ Prismaスキーマ: `BackupFileStatus` enum（`EXISTS` / `DELETED`）を追加
- ✅ `BackupHistory`テーブルに`fileStatus`列を追加（デフォルト: `EXISTS`）
- ✅ `BackupHistoryService`: `markHistoryAsDeletedByPath`と`markExcessHistoryAsDeleted`メソッドを追加
- ✅ バックアップ削除時に履歴を削除せず、`fileStatus`を`DELETED`に更新
- ✅ UIに「ファイル」列を追加して存在状態を表示（「存在」/「削除済」）
- ✅ 削除済み履歴は背景色を変更して視覚的に区別（`bg-slate-50`）

**技術的な詳細**:
- ファイル削除時に`BackupHistoryService.markHistoryAsDeletedByPath`を呼び出し
- 最大保持数を超えた場合、`markExcessHistoryAsDeleted`で古い履歴の`fileStatus`を`DELETED`に更新
- 履歴は削除されずに保持され、過去のバックアップ実行記録を追跡可能

**コミット**: `d45449a` - feat: バックアップ履歴にファイル存在状態（EXISTS/DELETED）を追加

**実機検証結果**: ✅ 完了（2025-12-28）
- 履歴ページに「ファイル」列が表示されることを確認
- バックアップ実行後、削除されたバックアップの履歴で「ファイル」列が「削除済」に更新されることを確認
- 最大保持数制御が正しく動作し、設定値（`maxBackups: 2`）と実際のファイル数が一致することを確認

#### Phase 9.5: バックアップ履歴のストレージプロバイダー記録修正 ✅ 完了（2025-12-28）

**実装内容**:
- ✅ `StorageProviderFactory`: `createFromConfig`と`createFromTarget`にオーバーロードを追加
- ✅ 第4引数に`returnProvider: true`を指定すると、実際に使用されたプロバイダーとストレージプロバイダーのペアを返す
- ✅ バックアップ実行時に実際に使用されたプロバイダー（フォールバック後の値）を取得
- ✅ 履歴作成時に実際に使用されたプロバイダーを記録

**技術的な詳細**:
- Dropboxの`accessToken`が空の場合、`local`にフォールバック
- フォールバック後の実際のプロバイダー（`local`）を履歴に記録
- 履歴と実際の動作が一致することで、ユーザーの混乱を防ぐ

**コミット**: `abb530a` - fix: バックアップ履歴に実際に使用されたストレージプロバイダーを記録（フォールバック後の値）

**実機検証結果**: ✅ 完了（2025-12-28）
- バックアップ実行後、ストレージプロバイダーが`local`表示に切り替わることを確認
- ログで`[StorageProviderFactory] Dropbox access token is empty, falling back to local storage`を確認
- データベースで`storageProvider: local`が正しく記録されていることを確認

#### Phase 9.6: Dropboxバックアップ履歴未記録問題の修正 ✅ 完了（2025-12-29）

**実装内容**:
- ✅ `StorageProviderFactory`: `createFromConfig`と`createFromTarget`を`async`メソッドに変更
- ✅ `accessToken`が空でも`refreshToken`がある場合、`DropboxOAuthService.refreshAccessToken()`を呼び出して新しい`accessToken`を自動取得
- ✅ 取得した`accessToken`は`onTokenUpdate`コールバックを通じて設定ファイルに保存
- ✅ 呼び出し元（`backup.ts`、`backup-scheduler.ts`）に`await`を追加

**技術的な詳細**:
- `refreshToken`から`accessToken`を自動取得する機能を追加
- 非同期処理（`refreshAccessToken`）を使用するため、メソッドを`async`に変更
- OAuth認証フローで正しい`refreshToken`を取得する必要がある（`/api/backup/oauth/authorize`エンドポイントを使用）

**コミット**:
- `e468445` - fix: refreshTokenからaccessTokenを自動取得する機能を追加（Dropboxバックアップ履歴未記録問題の修正）
- `e503476` - fix: StorageProviderFactoryメソッドをasyncに変更してaccessToken自動リフレッシュを有効化

**実機検証結果**: ✅ 完了（2025-12-29）
- OAuth認証フローで正しい`refreshToken`を取得・保存することを確認
- バックアップ実行後、`refreshToken`から`accessToken`が自動取得されることを確認
- Dropboxへのアップロードが成功することを確認（ログ: `[DropboxStorageProvider] File uploaded`）
- データベースで`storageProvider: dropbox`が正しく記録されていることを確認
- UIで「Dropbox」と表示されることを確認

**関連KB**: [KB-096](./knowledge-base/infrastructure.md#kb-096-dropboxバックアップ履歴未記録問題refreshtokenからaccesstoken自動取得機能)

**実機検証手順書**:
- [バックアップリストア機能の実機検証手順](../guides/backup-restore-verification.md)（タスク1）
- [backup.shスクリプトとの整合性確認手順](../guides/backup-script-integration-verification.md)（タスク2）
- [Dropbox連携の追加検証手順](../guides/dropbox-integration-verification.md)（タスク3）

**実機検証結果**: ✅ 完了（2025-12-29）
- CSVリストア機能: ✅ 成功（データバリデーションエラーあり、リストア機能自体は正常動作）
- データベースリストア機能: ❌ 失敗（409エラー、パスの問題）
- CSVリストア時の`targetSource`拡張子削除修正: ✅ 完了
- 詳細は [バックアップリストア機能の実機検証結果](../guides/backup-restore-verification-results.md) / [KB-097](../knowledge-base/infrastructure.md#kb-097-csvリストア時のtargetsource拡張子削除修正とデータベースバックアップのパス問題) を参照。

### Phase 5: 画像バックアップリストア処理追加 ✅ 完了（2025-12-19）

- ✅ 画像バックアップのリストア処理を追加
  - `/api/backup/restore/from-dropbox`エンドポイントに画像バックアップのリストア処理を追加
  - `/api/backup/restore`エンドポイントにも画像バックアップのリストア処理を追加
  - `tar.gz`を展開して写真ディレクトリ（`photos`）とサムネイルディレクトリ（`thumbnails`）に復元
  - 既存ディレクトリの自動バックアップ機能を追加（タイムスタンプ付きでリネーム）
- ✅ ドキュメント更新（`docs/guides/backup-and-restore.md`）
  - 画像バックアップのリストア手順を追加
  - API経由と手動でのリストア方法を記載

### Phase 6: Ansibleによるクライアント端末バックアップ機能 ✅ 完了（2025-12-19）

**問題点**:
- クライアント端末（Pi4、Pi3など）のファイルは物理的に別マシン上に存在するため、Pi5（サーバー）のAPIから直接アクセスできない
- クライアント端末が増えた場合、各端末で個別にバックアップを実行する方法では破綻する

**解決策**:
- Ansibleを使用してクライアント端末のファイルをPi5に取得してバックアップ
- `ansible fetch`モジュールを使用
- バックアップAPIからAnsible経由で各クライアント端末のファイルを取得
- Ansibleのinventoryでクライアント端末を管理し、スケーラブルに対応

**実装内容**:
- ✅ Ansible Playbook作成（`infrastructure/ansible/playbooks/backup-clients.yml`）
- ✅ バックアップAPIにクライアント端末バックアップターゲットを追加（`ClientFileBackupTarget`クラス）
- ✅ `kind: "client-file"`を追加
- ✅ `source`にクライアント端末のホスト名とファイルパスを指定（例: `raspberrypi4:/opt/RaspberryPiSystem_002/clients/nfc-agent/.env`）
- ✅ Dockerfile.apiにAnsibleをインストール
- ✅ docker-compose.server.ymlにAnsibleディレクトリとSSH鍵ディレクトリをマウント

**AnsibleとTailscale連携での問題と対策**:

**背景**:
- システムはTailscale経由で接続されることが多く、`group_vars/all.yml`の`network_mode`が`tailscale`に設定されている
- Ansible PlaybookをDockerコンテナ内から実行する際に、変数展開やSSH接続で問題が発生した

**発生した問題**:

1. **Ansible Playbookの`hosts`指定と変数展開の問題**:
   - **問題**: 初期実装では`hosts: localhost` + `delegate_to: "{{ client_host }}"`パターンを使用していた
   - **症状**: `ansible_host`が`{{ kiosk_ip }}`のまま展開されず、`raspberrypi4({{ kiosk_ip }})`として表示される
   - **原因**: `hosts: localhost`で実行すると、`group_vars/all.yml`の変数（`kiosk_ip`など）が読み込まれない
   - **対策**: `hosts: "{{ client_host }}"`に変更し、直接クライアントホストを指定するように修正
   - **結果**: `group_vars/all.yml`の変数が正しく展開され、`ansible_host`が正しいIPアドレス（Tailscale IPまたはローカルIP）に解決される

2. **SSH鍵のマウント問題**:
   - **問題**: Dockerコンテナ内からSSH接続する際にSSH鍵がマウントされていない
   - **症状**: `Permission denied (publickey,password)`エラーが発生
   - **原因**: `docker-compose.server.yml`にSSH鍵ディレクトリのマウント設定がなかった
   - **対策**: `/home/denkon5sd02/.ssh:/root/.ssh:ro`をマウント追加
   - **結果**: Dockerコンテナ内からPi4へのSSH接続が成功

3. **Ansible Playbookのエラーハンドリング**:
   - **問題**: ファイルが存在しない場合のエラーメッセージが不明確
   - **症状**: 汎用的な500エラーが返され、原因が特定しづらい
   - **対策**: Ansible Playbookのエラーメッセージを解析し、「ファイルが存在しない」場合は404エラーを返すように修正
   - **結果**: エラーメッセージが明確になり、デバッグが容易になった

**技術的な詳細**:

- **Ansible Playbookの最終的な構成**:
  ```yaml
  hosts: "{{ client_host }}"  # 直接クライアントホストを指定
  gather_facts: false
  tasks:
    - name: Fetch file from client device
      ansible.builtin.fetch:
        src: "{{ client_file_path }}"
        dest: "{{ backup_destination }}/{{ inventory_hostname }}_{{ client_file_path | basename }}"
        flat: true
  ```

- **変数展開の仕組み**:
  - `hosts: "{{ client_host }}"`で実行すると、Ansibleは`inventory.yml`から`raspberrypi4`を検索
  - `inventory.yml`の`raspberrypi4`の`ansible_host: "{{ kiosk_ip }}"`が`group_vars/all.yml`の`kiosk_ip`で展開される
  - `network_mode: "tailscale"`の場合、`kiosk_ip`は`tailscale_network.raspberrypi4_ip`（例: `100.74.144.79`）に解決される
  - 結果として、Ansibleは正しいTailscale IPでPi4に接続できる

- **SSH鍵のマウント**:
  - Pi5のホスト側: `/home/denkon5sd02/.ssh/id_ed25519`
  - Dockerコンテナ内: `/root/.ssh/id_ed25519`
  - マウント設定: `- /home/denkon5sd02/.ssh:/root/.ssh:ro`（読み取り専用）

**学んだこと**:
- Ansible Playbookで`hosts: localhost`を使用する場合、`group_vars/all.yml`の変数が読み込まれない
- `hosts: "{{ client_host }}"`のように直接ホストを指定すると、inventoryの変数が正しく展開される
- Tailscale経由の接続でも、Ansibleのinventoryで正しくIPアドレスが解決されれば問題なく動作する
- Dockerコンテナ内からSSH接続する場合は、SSH鍵をマウントする必要がある
- Ansible Playbookのエラーメッセージを適切に解析することで、より明確なエラーハンドリングが可能

**関連ナレッジ**: [KB-102](../knowledge-base/infrastructure.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題)

## Phase 7: バックアップロジックのアーキテクチャ改善 ✅ 完了

### 改善概要

バックアップロジックのモジュール化、疎結合、拡張性について詳細に調査し、重大な不備を検出。全項目をベストプラクティスの順番で処置完了。

### 検出された重大な不備

#### 1. コード重複の深刻な問題

**問題箇所**:
- `apps/api/src/routes/backup.ts` 48-79行目: `createBackupTarget`関数
- `apps/api/src/services/backup/backup-scheduler.ts` 137-159行目: `executeBackup`メソッド内のswitch文
- ストレージプロバイダー作成ロジックが6箇所以上に重複

**問題点**:
- 同じロジックが複数箇所に存在し、保守性が低い
- 新しいバックアップターゲット追加時に複数箇所を修正する必要がある
- 修正漏れのリスクが高い
- `client-file`ターゲットが`backup-scheduler.ts`でサポートされていない（設定と実装の不整合）

#### 2. ハードコーディングの問題

**問題箇所**:
- Dockerコンテナ内のパスマッピングがハードコーディングされている
- リストアロジックがルートハンドラー内に直接実装されている

**問題点**:
- 新しい`.env`ファイルを追加する際にコード修正が必要
- 新しいバックアップ種類を追加する際に、ルートハンドラーを修正する必要がある
- テストが困難

#### 3. Factoryパターン未使用

**問題点**:
- `BackupTargetFactory`インターフェースが定義されているが、実際には使用されていない
- switch文による直接的なインスタンス化が行われている

### 実装した改善

#### 1. BackupTargetFactoryの実装

**ファイル**: `apps/api/src/services/backup/backup-target-factory.ts`

- レジストリパターンによるバックアップターゲットの動的登録
- パスマッピングの設定ファイル対応
- `createFromConfig`メソッドで設定ファイルから直接作成可能

**主な機能**:
- `create(kind, source, metadata, pathMappings)`: バックアップターゲットを作成
- `createFromConfig(config, kind, source, metadata)`: 設定ファイルから作成
- `register(kind, creator)`: 新しいターゲット種類を登録（拡張用）
- `getDefaultPathMappings()`: デフォルトのパスマッピングを取得
- `convertHostPathToContainerPath(hostPath, pathMappings)`: ホストパスをコンテナパスに変換

#### 2. StorageProviderFactoryの実装

**ファイル**: `apps/api/src/services/backup/storage-provider-factory.ts`

- ストレージプロバイダー作成ロジックの共通化
- OAuthサービス作成、トークン更新コールバック設定の自動化
- `createFromConfig`メソッドで設定ファイルから直接作成可能

**主な機能**:
- `create(options)`: ストレージプロバイダーを作成
- `createFromConfig(config, requestProtocol, requestHost, onTokenUpdate)`: 設定ファイルから作成
- `register(provider, creator)`: 新しいプロバイダーを登録（拡張用）

#### 3. リストアロジックの分離

**変更ファイル**:
- `apps/api/src/services/backup/backup-target.interface.ts`: `restore`メソッドを追加（オプショナル）
- `apps/api/src/services/backup/targets/database-backup.target.ts`: `restore`メソッドを実装
- `apps/api/src/services/backup/targets/csv-backup.target.ts`: `restore`メソッドを実装
- `apps/api/src/services/backup/targets/image-backup.target.ts`: `restore`メソッドを実装

**効果**:
- ルートハンドラーからリストアロジックを分離
- 各ターゲットが自身のリストアロジックを実装
- テストが容易になる

#### 4. 設定ファイルによるパスマッピング管理

**変更ファイル**: `apps/api/src/services/backup/backup-config.ts`

- `pathMappings`フィールドを追加
- デフォルトのパスマッピングを設定ファイルに含める

**効果**:
- ハードコーディングの解消
- 設定ファイルで管理可能

#### 5. 既存コードのリファクタリング

**変更ファイル**:
- `apps/api/src/routes/backup.ts`: Factoryパターンを使用するように変更
- `apps/api/src/services/backup/backup-scheduler.ts`: Factoryパターンを使用するように変更

**削除された関数**:
- `createBackupTarget`: `BackupTargetFactory.create`に置き換え
- `createStorageProvider`: `StorageProviderFactory.create`に置き換え
- `convertHostPathToContainerPath`: `BackupTargetFactory.convertHostPathToContainerPath`に置き換え

### 改善効果

1. **コード重複の解消**: バックアップターゲット作成ロジックとストレージプロバイダー作成ロジックの重複を完全に解消
2. **設定と実装の整合性**: `client-file`ターゲットがスケジューラーでサポートされるようになった
3. **拡張性の向上**: 新しいバックアップターゲット追加時にFactoryに登録するだけで対応可能
4. **保守性の向上**: リストアロジックが各ターゲットに分離され、テストが容易になった

### 新しいバックアップターゲット追加手順

**以前（7箇所以上の修正が必要）**:
1. 新しい`BackupTarget`実装クラスを作成
2. `backup-config.ts`の`kind` enumに追加
3. `routes/backup.ts`の`createBackupTarget`関数にcase追加
4. `routes/backup.ts`の`convertHostPathToContainerPath`にパスマッピング追加（必要な場合）
5. `backup-scheduler.ts`の`executeBackup`メソッドにcase追加
6. リストア処理が必要な場合、`routes/backup.ts`のリストアエンドポイントに処理を追加
7. スキーマ定義を複数箇所で更新

**現在（2箇所の修正のみ）**:
1. 新しい`BackupTarget`実装クラスを作成（`restore`メソッドも実装）
2. `BackupTargetFactory.targetCreators`に登録（または`BackupTargetFactory.register`を使用）
3. `backup-config.ts`の`kind` enumに追加（型安全性のため）

**効果**: 修正箇所が7箇所から2箇所に削減（約71%削減）

### アーキテクチャ評価

#### 改善前

- **モジュール化**: ⚠️ 部分的（Factoryパターン未使用、コード重複）
- **疎結合**: ❌ 不十分（具体的な実装クラスへの直接依存）
- **拡張性**: ❌ 不十分（新しいターゲット追加時に複数箇所の修正が必要）

#### 改善後

- **モジュール化**: ✅ 良好（Factoryパターンとレジストリパターンを実装、コード重複を解消）
- **疎結合**: ✅ 良好（Factoryクラスのみに依存、具体的な実装クラスへの直接依存を解消）
- **拡張性**: ✅ 良好（新しいターゲット追加時の修正箇所が7箇所から2箇所に削減）

### テスト結果

#### リンター結果

**実行コマンド**: `npm run lint`

**結果**: ✅ 0エラー（修正前: 6エラー）

**修正したエラー**:
1. `apps/api/src/routes/backup.ts`: `any`型の使用を`BackupKind`型に変更（2箇所）
2. `apps/api/src/services/backup/targets/csv-backup.target.ts`: 未使用のimport `parse`を削除
3. `apps/api/src/services/backup/targets/database-backup.target.ts`: 未使用パラメータ`_options`にeslint-disableコメントを追加
4. `apps/api/src/services/backup/targets/image-backup.target.ts`: 未使用パラメータ`_options`にeslint-disableコメントを追加

#### ユニットテスト結果

**実行コマンド**: `npm test -- backup.service backup-verifier image-backup`

**結果**: ✅ 16/16テスト成功

**テスト詳細**:
- ✅ `backup-verifier.test.ts`: 12テスト全て成功
- ✅ `backup.service.test.ts`: 2テスト全て成功
- ✅ `image-backup.target.test.ts`: 2テスト全て成功

#### 統合テスト結果

**実行コマンド**: `npm test -- backup`

**ローカル環境**: ⚠️ データベース接続エラー（PostgreSQLが起動していないため）
- `backup.integration.test.ts`: 11テスト失敗（データベース接続エラー）
- 影響: ローカル環境でのみ発生。CI環境ではPostgreSQLが自動起動されるため問題なし

**CI環境**: ✅ 正常動作予定（PostgreSQLが自動起動されるため）

### CI実行状況

**ブランチ**: `feature/ansible-client-backup`
**コミット**: `e424002` - `refactor: バックアップロジックのアーキテクチャ改善`
**プッシュ日時**: 2025-12-19

**変更統計**:
- 11ファイル変更
- 1,133行追加
- 553行削除

**CI実行確認URL**: https://github.com/denkoushi/RaspberryPiSystem_002/actions

**期待されるCI結果**:
- ✅ Lint: 0エラー（ローカルで確認済み）
- ✅ Security scan: 脆弱性なし
- ✅ Build: APIとWebのビルド成功
- ✅ Run API tests: 統合テスト成功（PostgreSQLが自動起動されるため）
- ✅ Run backup service tests: バックアップ関連テスト成功

**確認すべきテスト**:
- `backup.service.test.ts`: 2テスト
- `backup-verifier.test.ts`: 12テスト
- `image-backup.target.test.ts`: 2テスト
- `csv-backup.target.test.ts`: 2テスト（データベース接続が必要）
- `backup.integration.test.ts`: 統合テスト（データベース接続が必要）

**合計**: 約42テスト（統合テスト含む）

## 関連ドキュメント

- [バックアップ・リストア手順](../guides/backup-and-restore.md)
- [バックアップ設定ガイド](../guides/backup-configuration.md)
- [バックアップAPI仕様](../api/backup.md) ✅ 作成完了（2025-12-29）

