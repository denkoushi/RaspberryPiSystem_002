# バックアップ対象管理UI実装計画

最終更新: 2025-12-19

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

### Phase 5: 画像バックアップリストア処理追加 ✅ 完了（2025-12-19）

- ✅ 画像バックアップのリストア処理を追加
  - `/api/backup/restore/from-dropbox`エンドポイントに画像バックアップのリストア処理を追加
  - `/api/backup/restore`エンドポイントにも画像バックアップのリストア処理を追加
  - `tar.gz`を展開して写真ディレクトリ（`photos`）とサムネイルディレクトリ（`thumbnails`）に復元
  - 既存ディレクトリの自動バックアップ機能を追加（タイムスタンプ付きでリネーム）
- ✅ ドキュメント更新（`docs/guides/backup-and-restore.md`）
  - 画像バックアップのリストア手順を追加
  - API経由と手動でのリストア方法を記載

## 関連ドキュメント

- [バックアップ・リストア手順](../guides/backup-and-restore.md)
- [バックアップ設定ガイド](../guides/backup-configuration.md)
- [バックアップAPI仕様](../api/backup.md)（作成予定）

