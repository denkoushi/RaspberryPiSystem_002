# バックアップスケジュールと履歴の不一致分析

調査実施日: 2026-01-23

## 問題の概要

管理コンソールのバックアップタブの履歴ボタンから履歴を見ると、スケジュールの数と履歴の数が一致しない。

## 調査結果

### 1. スケジュールに登録されているターゲット数

**有効なスケジュールターゲット**: 25個

**内訳**:
- `database`: 1個
- `csv`: 2個（employees, items）
- `image`: 1個（photo-storage）
- `file`: 10個（各種.envファイル、vault.yml、backup.json等）
- `directory`: 3個（certs, pdfs, ssh）
- `client-file`: 3個（raspberrypi4/raspberrypi3/raspberrypi5の設定ファイル）
- `client-directory`: 5個（raspberrypi4/raspberrypi3のSSH、Tailscale設定）

### 2. 履歴に記録されているユニークなターゲット数

**Dropboxへのバックアップ履歴**: 26個のユニークなターゲット

**内訳**:
- `database`: 4個の異なるソース名
  - `postgresql://postgres:postgres@db:5432/borrow_return`（現在の設定、最新実行: 2026-01-23）
  - `postgresql://postgres:postgres@localhost:5432/borrow_return`（過去の設定、最新実行: 2026-01-07）
  - `borrow_return`（古い形式、最新実行: 2025-12-29）
  - `borrow_return.sql.gz`（古い形式、最新実行: 2025-12-29）
- `csv`: 3個の異なるソース名
  - `employees`（現在の設定、最新実行: 2026-01-23）
  - `items`（現在の設定、最新実行: 2026-01-23）
  - `employees.csv`（古い形式、最新実行: 2025-12-29）
- `image`: 2個の異なるソース名
  - `photo-storage`（現在の設定、最新実行: 2026-01-23）
  - `photo-storage.tar.gz`（古い形式、最新実行: 2025-12-29）
- `file`: 5個
- `directory`: 4個
- `client-file`: 3個
- `client-directory`: 5個

### 3. 不一致の原因

**主な原因**:

1. **過去の設定変更による履歴の残存**:
   - データベースの接続文字列が変更された（`localhost` → `db`）
   - 古い形式のソース名（`employees.csv`、`borrow_return.sql.gz`、`photo-storage.tar.gz`）の履歴が残っている

2. **履歴の永続化**:
   - バックアップ履歴は削除されないため、過去に削除されたターゲットや変更された設定の履歴が残り続ける

3. **ソース名の正規化**:
   - 同じターゲットでも、異なる形式のソース名で記録されている場合がある

### 4. 現在のスケジュールと履歴の対応状況

**過去7日間の実行状況**（2026-01-16以降）:
- スケジュールに登録されている25個のターゲットのうち、**8個のターゲット**のみが実行されている
- 実行されたターゲット:
  - `database`: `postgresql://postgres:postgres@db:5432/borrow_return`（2回）
  - `csv`: `employees`（2回）、`items`（2回）
  - `image`: `photo-storage`（3回）
  - `file`: `.env`ファイル3個（各2-3回）
  - `client-directory`: `raspberrypi4:/var/lib/tailscale`（1回）

**実行されていないターゲット**（過去7日間）:
- `client-directory`: `raspberrypi3:/var/lib/tailscale`（スケジュール: 毎週日曜2時）
- `client-directory`: `raspberrypi4:/home/tools03/.ssh`（スケジュール: 毎週日曜2時）
- `client-directory`: `raspberrypi3:/home/signageras3/.ssh`（スケジュール: 毎週日曜2時）
- `file`: `/app/config/backup.json`（スケジュール: 毎日4時）
- `directory`: `/app/host/certs`（スケジュール: 毎週日曜2時）
- `directory`: `/app/storage/pdfs`（スケジュール: 毎日6時）
- `directory`: `/root/.ssh`（スケジュール: 毎日5時）
- `file`: 各種vault.ymlファイル（スケジュール: 毎日3時）
- `file`: `.vault-pass`（スケジュール: 毎日3時）
- `client-file`: 各種設定ファイル（スケジュール: 毎日4時）

## 問題の詳細分析

### スケジュール実行されていない理由

1. **スケジュール時刻がまだ来ていない**:
   - 週次スケジュール（毎週日曜2時）のターゲットは、最後の日曜日以降実行されていない可能性がある
   - 現在は2026-01-23（木曜日）のため、次回の実行は2026-01-26（日曜日）になる

2. **スケジュール実行の失敗**:
   - エラーログを確認する必要がある

3. **スケジュールの登録漏れ**:
   - スケジューラーの起動時にタスクが正しく登録されていない可能性がある

## 推奨される対応

### 1. スケジュール実行の確認

次回のスケジュール実行時刻を監視して、自動実行が正常に動作していることを確認する:

```bash
# 次回のスケジュール実行時刻を確認
# - 毎日4時: database, file (.env)
# - 毎日5時: csv (employees, items), directory (/root/.ssh)
# - 毎日6時: image (photo-storage), directory (/app/storage/pdfs)
# - 毎週日曜2時: client-directory, directory (/app/host/certs)
# - 毎週水曜6時: image (photo-storage)
# - 毎週月〜金5時: csv (employees)

# ログで自動実行を確認
docker logs api | grep "BackupScheduler.*Starting scheduled backup"
```

### 2. 履歴の整理

過去の設定変更による古い形式のソース名の履歴は、以下の方法で整理できます:

1. **古い形式の履歴を無視**: 管理コンソールでフィルタを設定して、現在の設定に一致する履歴のみを表示
2. **履歴のクリーンアップ**: 古い履歴を削除（ただし、これは推奨されません。履歴は監査証跡として重要です）

### 3. スケジュール実行の改善

スケジュール実行が正常に動作していないターゲットについて、以下を確認:

1. **エラーログの確認**: 失敗したバックアップのエラーメッセージを確認
2. **スケジュールの再登録**: APIサーバーを再起動してスケジューラーを再読み込み
3. **手動実行のテスト**: 実行されていないターゲットを手動実行して、エラーがないか確認

## 重要な発見

### スケジュール自動実行が記録されていない

**発見**: ログに「Starting scheduled backup」の記録がありません。

**実行時刻の分析**:
- 2026-01-23 02:19（JST）: 7個のバックアップが実行
- 2026-01-23 00:47（JST）: 7個のバックアップが実行
- 2026-01-22 04:40（JST）: 1個のバックアップが実行

**問題点**:
- スケジュール設定では毎日4時、5時、6時に実行されるはずですが、実際の実行時刻（02:19、00:47）はスケジュール時刻と一致していません
- ログに「Starting scheduled backup」が記録されていないため、**手動実行**の可能性が高いです
- スケジュール自動実行が正常に動作していない可能性があります

### タイムゾーンの確認

- **ホスト（Pi5）**: JST（日本標準時）
- **Dockerコンテナ（API）**: UTC（協定世界時）
- **スケジューラー**: `timezone: 'Asia/Tokyo'` で設定されているため、JSTで実行されるはず

**注意**: コンテナ内の時刻はUTCですが、スケジューラーは`Asia/Tokyo`タイムゾーンを使用しているため、JSTで実行されるはずです。

## 結論

**不一致の原因**:
1. **過去の設定変更による古い形式のソース名の履歴が残っている**（履歴: 26個 > スケジュール: 25個）
   - 古い形式: `employees.csv`、`borrow_return.sql.gz`、`photo-storage.tar.gz`
   - 異なる接続文字列: `localhost` vs `db`
2. **スケジュール自動実行が正常に動作していない可能性**
   - ログに「Starting scheduled backup」が記録されていない
   - 実際の実行時刻がスケジュール時刻と一致していない
   - 手動実行の可能性が高い

**次のステップ**:
1. **スケジュール自動実行の確認**:
   - 次回のスケジュール実行（毎日4時、5時、6時、毎週日曜2時）を監視
   - ログで「Starting scheduled backup」が記録されることを確認
   - 実行時刻がスケジュール時刻と一致することを確認
2. **実行されていないターゲットの確認**:
   - 過去7日間で実行されていない17個のターゲットについて、エラーログを確認
   - 手動実行でテストして問題がないか確認
3. **スケジューラーの再起動**:
   - APIサーバーを再起動してスケジューラーを再読み込み
   - 設定ファイルの変更が反映されていることを確認

## 解決策（2026-01-23実装）

### 問題の根本原因

**発見**: `BackupScheduler.executeBackup`メソッドに履歴作成・更新処理が実装されていなかった。

- 手動実行（`/api/backup`エンドポイント）では`BackupHistoryService.createHistory()`、`completeHistory()`、`failHistory()`を呼び出していた
- スケジュール自動実行ではこれらの処理が呼ばれていなかった
- そのため、スケジュール自動実行のバックアップは実行されていたが、履歴に記録されていなかった

### 修正内容

`BackupScheduler.executeBackup`メソッドに履歴作成・更新処理を追加:

1. **履歴作成**: 各プロバイダーのバックアップ実行前に`historyService.createHistory()`を呼び出し
2. **履歴完了**: 成功時に`historyService.completeHistory()`を呼び出し
3. **履歴失敗**: 失敗時に`historyService.failHistory()`を呼び出し
4. **手動実行と同じロジック**: 手動実行（`/api/backup`）と同じロジックを適用

### 検証結果

- ✅ CIテスト成功（lint、ビルド、テストすべて通過）
- ✅ デプロイ完了（Pi5にデプロイ済み）
- ⏳ 次回のスケジュール実行（毎日4時、5時、6時、毎週日曜2時）で履歴が記録されることを確認予定

### 関連ナレッジ

- [KB-194: スケジュール自動実行時にバックアップ履歴が記録されない問題](../knowledge-base/infrastructure/backup-restore.md#kb-194-スケジュール自動実行時にバックアップ履歴が記録されない問題)
