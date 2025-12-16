# Phase 3実機検証手順（ブラウザコンソールから操作）

最終更新: 2025-12-16

## 概要

このドキュメントでは、Phase 3の機能を管理画面にログインした状態で、ブラウザの開発者ツール（コンソール）からAPIを直接呼び出して検証する手順を説明します。

**認証トークンは自動的に管理されるため、手動で取得する必要はありません。**

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **IPアドレス**: `100.106.158.2`（Tailscale経由）
- **管理画面URL**: `https://100.106.158.2/admin`

---

## ステップ1: 管理画面へのアクセスとログイン

### 1.1 管理画面にアクセス

1. ブラウザで以下のURLにアクセス：
   ```
   https://100.106.158.2/admin
   ```

2. ログイン画面が表示されることを確認

### 1.2 ログイン

- **ユーザー名**: `admin`
- **パスワード**: （実機環境のパスワードを使用）

ログインが成功すると、管理画面のダッシュボードが表示されます。

---

## ステップ2: ブラウザの開発者ツールを開く

### 2.1 開発者ツールを開く

1. ブラウザの開発者ツールを開く（F12キー、または右クリック → 「検証」）
2. 「Console」タブを開く

### 2.2 APIクライアントの準備

コンソールに以下のコードを貼り付けて実行します。これにより、認証トークンが自動的に含まれたAPIリクエストを簡単に送信できるようになります。

```javascript
// APIクライアントの準備
const apiClient = {
  baseURL: 'https://100.106.158.2/api',
  
  async request(method, path, body = null) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const options = {
      method,
      headers,
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${this.baseURL}${path}`, options);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} - ${data.message || JSON.stringify(data)}`);
    }
    
    return data;
  },
  
  async get(path) {
    return this.request('GET', path);
  },
  
  async post(path, body) {
    return this.request('POST', path, body);
  }
};

console.log('APIクライアントが準備されました。apiClient.get() と apiClient.post() を使用できます。');
```

---

## ステップ3: バックアップ履歴APIの確認

### 3.1 バックアップ履歴の取得

コンソールで以下のコマンドを実行：

```javascript
// バックアップ履歴を取得（最新5件）
const history = await apiClient.get('/backup/history?limit=5');
console.log('バックアップ履歴:', history);
```

**期待される結果**:
```json
{
  "history": [],
  "total": 0,
  "offset": 0,
  "limit": 5
}
```

現在は履歴が0件なので、空の配列が返されます。

### 3.2 フィルタ機能の確認

```javascript
// バックアップ操作のみを取得
const backupHistory = await apiClient.get('/backup/history?operationType=BACKUP&limit=10');
console.log('バックアップ履歴（フィルタ）:', backupHistory);

// 特定のステータスでフィルタ
const completedHistory = await apiClient.get('/backup/history?status=COMPLETED&limit=10');
console.log('完了したバックアップ履歴:', completedHistory);
```

---

## ステップ4: CSVインポート後の自動バックアップ機能の検証

### 4.1 テスト用CSVファイルの準備

まず、テスト用のCSVファイルを準備します。Dropboxにアップロードするか、またはUSBメモリ経由でインポートします。

**テスト用CSVファイル（employees-test.csv）**:
```csv
employeeCode,displayName,nfcTagUid,department,contact,status
9999,テストユーザー,,テスト部,内線9999,ACTIVE
```

### 4.2 CSVインポートスケジュールの作成

`backup.json`にCSVインポートスケジュールを追加する必要があります。Pi5にSSH接続して設定ファイルを編集します。

**または、API経由でスケジュールを作成**（APIが実装されている場合）:

```javascript
// CSVインポートスケジュールを作成
const schedule = await apiClient.post('/imports/schedule', {
  id: 'test-import',
  name: 'テスト用CSVインポート',
  schedule: '0 2 * * *',
  timezone: 'Asia/Tokyo',
  employeesPath: '/backups/csv/employees-test.csv',
  replaceExisting: false,
  autoBackupAfterImport: {
    enabled: true,
    targets: ['csv']
  },
  enabled: true
});
console.log('スケジュール作成:', schedule);
```

### 4.3 手動実行でCSVインポートをテスト

```javascript
// CSVインポートを手動実行
const result = await apiClient.post('/imports/schedule/test-import/run', {});
console.log('CSVインポート結果:', result);
```

### 4.4 自動バックアップの確認

CSVインポートが成功すると、自動的にバックアップが実行されます。バックアップ履歴を確認：

```javascript
// バックアップ履歴を再取得
const updatedHistory = await apiClient.get('/backup/history?operationType=BACKUP&limit=5');
console.log('更新後のバックアップ履歴:', updatedHistory);
```

**期待される結果**:
- `BackupHistory`テーブルに新しい履歴が記録されている
- `operationType`が`BACKUP`である
- `status`が`COMPLETED`である

---

## ステップ5: Dropboxからのリストア機能の検証

### 5.1 事前準備：バックアップの作成

まず、リストア用のバックアップを作成します。

```javascript
// 手動バックアップを実行
const backupResult = await apiClient.post('/backup', {
  kind: 'csv',
  source: 'employees',
  storage: {
    provider: 'dropbox'
  }
});
console.log('バックアップ結果:', backupResult);
```

### 5.2 Dropboxからのリストア実行

```javascript
// Dropboxからバックアップをリストア
const restoreResult = await apiClient.post('/backup/restore/from-dropbox', {
  backupPath: '/backups/csv/2025-12-16T04-00-00-000Z/employees.csv',
  targetKind: 'csv',
  verifyIntegrity: true
});
console.log('リストア結果:', restoreResult);
```

**注意**: `backupPath`は実際のDropbox上のパスに置き換えてください。

### 5.3 リストア履歴の確認

```javascript
// リストア履歴を確認
const restoreHistory = await apiClient.get('/backup/history?operationType=RESTORE&limit=5');
console.log('リストア履歴:', restoreHistory);
```

**期待される結果**:
- `BackupHistory`テーブルにリストア履歴が記録されている
- `operationType`が`RESTORE`である
- `status`が`COMPLETED`である

---

## トラブルシューティング

### 認証エラー（401）が発生する

- 管理画面に正しくログインできているか確認
- ブラウザのコンソールで `localStorage.getItem('token')` を実行して、トークンが存在するか確認
- トークンが存在しない場合は、管理画面を再読み込み（F5）してから再度試す

### APIが404エラーを返す

- APIエンドポイントのパスが正しいか確認
- APIコンテナが最新のコードで再ビルドされているか確認

### CSVインポートが失敗する

- DropboxにCSVファイルが存在するか確認
- CSVファイルのパスが正しいか確認（`backup.json`の`employeesPath`）
- CSVファイルの形式が正しいか確認（UTF-8エンコーディング、ヘッダー行）

### 自動バックアップが実行されない

- `backup.json`の`autoBackupAfterImport.enabled`が`true`になっているか確認
- CSVインポートが成功しているか確認（自動バックアップはインポート成功時にのみ実行される）
- APIログを確認してエラーがないか確認

---

## 検証結果の記録

各ステップの検証結果を記録してください：

- [ ] ステップ1: 管理画面へのアクセスとログイン
- [ ] ステップ2: ブラウザの開発者ツールを開く
- [ ] ステップ3: バックアップ履歴APIの確認
- [ ] ステップ4: CSVインポート後の自動バックアップ機能の検証
- [ ] ステップ5: Dropboxからのリストア機能の検証

**検証日時**: _______________
**検証者**: _______________
**検証結果**: _______________

---

## 次のステップ

検証が完了したら、以下のドキュメントを更新してください：

- `docs/guides/phase3-verification-checklist.md`: 検証結果を記録
- `docs/analysis/dropbox-csv-integration-status.md`: Phase 3の実機検証完了を記録
