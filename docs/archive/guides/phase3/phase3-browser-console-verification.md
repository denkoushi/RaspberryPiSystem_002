# Phase 3ブラウザコンソール検証手順

最終更新: 2025-12-17

## 概要

このドキュメントでは、ブラウザの開発者ツール（コンソール）を使用して、Phase 3の機能を検証する方法を説明します。

## 前提条件

1. 管理画面にログイン済み（`https://100.106.158.2/admin`）
2. ブラウザの開発者ツールを開く（F12キー）
3. コンソールタブを開く

## 検証手順

### 1. バックアップ履歴APIの検証

#### 1.1 バックアップ履歴一覧の取得

ブラウザのコンソールで以下を実行：

```javascript
// apiClientを使用してバックアップ履歴を取得
const response = await window.apiClient.get('/api/backup/history');
console.log('バックアップ履歴:', response.data);
```

**期待結果**:
- ステータスコード: 200
- レスポンス: `{ history: [], total: 0, offset: 0, limit: 20 }`（現在0件のため）

#### 1.2 フィルタ付きバックアップ履歴の取得

```javascript
// 操作種別でフィルタ
const response = await window.apiClient.get('/api/backup/history?operationType=BACKUP');
console.log('バックアップ履歴（フィルタ）:', response.data);
```

**期待結果**:
- ステータスコード: 200
- フィルタ条件に一致する履歴のみが返される

#### 1.3 ページングの確認

```javascript
// 2ページ目を取得
const response = await window.apiClient.get('/api/backup/history?offset=20&limit=20');
console.log('バックアップ履歴（ページ2）:', response.data);
```

**期待結果**:
- ステータスコード: 200
- オフセットとリミットが正しく適用される

### 2. CSVインポートスケジュールAPIの検証

#### 2.1 スケジュール一覧の取得

```javascript
// スケジュール一覧を取得
const response = await window.apiClient.get('/api/imports/schedule');
console.log('CSVインポートスケジュール:', response.data);
```

**期待結果**:
- ステータスコード: 200
- レスポンス: `{ schedules: [] }`（現在0件のため）

#### 2.2 スケジュールの作成

```javascript
// 新しいスケジュールを作成
const newSchedule = {
  id: 'test-schedule-001',
  name: 'テストスケジュール',
  employeesPath: '/test/employees.csv',
  schedule: '0 0 * * *',
  enabled: true,
  replaceExisting: false,
  autoBackupAfterImport: {
    enabled: true,
    targets: ['csv']
  }
};

const response = await window.apiClient.post('/api/imports/schedule', newSchedule);
console.log('スケジュール作成結果:', response.data);
```

**期待結果**:
- ステータスコード: 200
- レスポンス: `{ schedule: { ... } }`
- `config/backup.json`にスケジュールが追加される

#### 2.3 スケジュールの更新

```javascript
// スケジュールを更新
const updateData = {
  name: '更新されたテストスケジュール',
  enabled: false
};

const response = await window.apiClient.put('/api/imports/schedule/test-schedule-001', updateData);
console.log('スケジュール更新結果:', response.data);
```

**期待結果**:
- ステータスコード: 200
- レスポンス: `{ schedule: { ... } }`
- `config/backup.json`のスケジュールが更新される

#### 2.4 スケジュールの削除

```javascript
// スケジュールを削除
const response = await window.apiClient.delete('/api/imports/schedule/test-schedule-001');
console.log('スケジュール削除結果:', response.data);
```

**期待結果**:
- ステータスコード: 200
- レスポンス: `{ message: '...' }`
- `config/backup.json`からスケジュールが削除される

#### 2.5 スケジュールの手動実行

```javascript
// スケジュールを手動実行
const response = await window.apiClient.post('/api/imports/schedule/test-schedule-001/run', {});
console.log('スケジュール実行結果:', response.data);
```

**期待結果**:
- ステータスコード: 200
- レスポンス: `{ message: '...' }`
- CSVインポートが実行される（CSVファイルが存在する場合）

### 3. DropboxからのリストアAPIの検証

#### 3.1 リストアの実行

```javascript
// Dropboxからリストアを実行
const restoreRequest = {
  backupPath: '/backups/2025-12-17/backup.tar.gz',
  targetKind: 'csv',
  verifyIntegrity: true
};

const response = await window.apiClient.post('/api/backup/restore/from-dropbox', restoreRequest);
console.log('リストア結果:', response.data);
```

**期待結果**:
- ステータスコード: 200
- レスポンス: `{ success: true, message: '...', historyId: '...' }`
- バックアップ履歴に記録される

**注意**: 実際のバックアップファイルが存在する場合のみ成功します。

### 4. エラーハンドリングの確認

#### 4.1 存在しないスケジュールの取得

```javascript
// 存在しないスケジュールを取得（404エラー）
try {
  const response = await window.apiClient.get('/api/imports/schedule/non-existent-id');
  console.log('結果:', response.data);
} catch (error) {
  console.log('エラー:', error.response?.status, error.response?.data);
}
```

**期待結果**:
- ステータスコード: 404
- エラーメッセージが返される

#### 4.2 無効なスケジュールデータの作成

```javascript
// 無効なデータでスケジュールを作成（400エラー）
try {
  const invalidSchedule = {
    id: '', // 空のID（無効）
    schedule: '' // 空のスケジュール（無効）
  };
  const response = await window.apiClient.post('/api/imports/schedule', invalidSchedule);
  console.log('結果:', response.data);
} catch (error) {
  console.log('エラー:', error.response?.status, error.response?.data);
}
```

**期待結果**:
- ステータスコード: 400
- バリデーションエラーメッセージが返される

### 5. 自動バックアップ機能の確認

#### 5.1 スケジュール実行後のバックアップ履歴確認

```javascript
// 1. スケジュールを作成（自動バックアップ有効）
const schedule = {
  id: 'test-auto-backup',
  employeesPath: '/test/employees.csv',
  schedule: '0 0 * * *',
  enabled: true,
  autoBackupAfterImport: {
    enabled: true,
    targets: ['csv']
  }
};

await window.apiClient.post('/api/imports/schedule', schedule);

// 2. スケジュールを手動実行
await window.apiClient.post('/api/imports/schedule/test-auto-backup/run', {});

// 3. 少し待ってからバックアップ履歴を確認
setTimeout(async () => {
  const history = await window.apiClient.get('/api/backup/history?operationType=BACKUP');
  console.log('バックアップ履歴:', history.data);
}, 5000); // 5秒待機
```

**期待結果**:
- スケジュール実行後、バックアップ履歴に新しいレコードが追加される
- 操作種別: `BACKUP`
- ターゲット種別: `csv`（設定した対象）

## 検証結果の記録

各検証項目について、以下を記録してください：

- **検証日時**: 
- **検証項目**: 
- **実行したコマンド**: 
- **期待結果**: 
- **実際の結果**: 
- **問題**: （問題があれば記録）

## トラブルシューティング

### apiClientが定義されていない

`window.apiClient`が定義されていない場合は、以下の方法で確認してください：

```javascript
// apiClientの確認
console.log('apiClient:', window.apiClient);

// または、直接fetchを使用
const response = await fetch('/api/backup/history', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
});
const data = await response.json();
console.log('バックアップ履歴:', data);
```

### 認証トークンの取得

認証トークンが必要な場合は、以下で取得できます：

```javascript
// トークンの確認
const token = localStorage.getItem('token');
console.log('トークン:', token);
```

### エラーレスポンスの確認

エラーが発生した場合、詳細を確認：

```javascript
try {
  const response = await window.apiClient.get('/api/backup/history');
  console.log('成功:', response.data);
} catch (error) {
  console.error('エラー詳細:', {
    status: error.response?.status,
    statusText: error.response?.statusText,
    data: error.response?.data,
    headers: error.response?.headers
  });
}
```
