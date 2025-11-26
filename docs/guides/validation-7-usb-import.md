# Validation 7: USB一括登録の実機検証ガイド

## 概要

本ドキュメントでは、USBメモリ経由でのCSV一括登録機能（Validation 7）の実機検証手順を説明します。

## 前提条件

- Phase 3（インポート機能の修正）が完了していること
- ラズパイ5でAPI/Web/DBが起動していること
- 管理画面にアクセスできること

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **ブラウザ**: ラズパイ5またはPCから管理画面にアクセス

## 検証用CSVファイル

検証用のサンプルCSVファイルは `test-data/validation-7/` に用意されています。

### employees.csv

```csv
employeeCode,displayName,nfcTagUid,department,contact,status
0001,山田太郎,04C362E1330289,製造部,内線1234,ACTIVE
0002,佐藤花子,04B34411340289,品質管理部,内線5678,ACTIVE
0003,鈴木一郎,04DE8366BC2A81,製造部,内線9012,ACTIVE
0004,田中次郎,,総務部,内線3456,INACTIVE
```

### items.csv

```csv
itemCode,name,nfcTagUid,category,storageLocation,status,notes
TO0001,ドライバーセット,04C362E1330289,工具,工具庫A,AVAILABLE,常用工具
TO0002,メジャー,04C393C1330289,測定器具,工具庫B,AVAILABLE,
TO0003,ハンマー,04DE8366BC2A81,工具,工具庫A,AVAILABLE,大型工具
TO0004,ペンチ,,工具,工具庫C,AVAILABLE,
```

## 検証手順

### ステップ1: CSVファイルの準備

1. `test-data/validation-7/employees.csv` と `test-data/validation-7/items.csv` をUSBメモリにコピー
2. USBメモリをラズパイ5に接続（または、PCからブラウザ経由でアップロード）

### ステップ2: 管理画面にアクセス

1. ブラウザで管理画面にアクセス:
   ```
   http://<ラズパイ5のIP>:4173/login
   ```

2. ログイン情報を入力:
   - ユーザー名: `admin`
   - パスワード: `admin1234`

3. 一括登録ページにアクセス:
   ```
   http://<ラズパイ5のIP>:4173/admin/import
   ```

### ステップ3: CSVファイルをアップロード

1. 「従業員CSV（任意）」から `employees.csv` を選択
2. 「アイテムCSV（任意）」から `items.csv` を選択
3. 「既存データをクリアしてから取り込み」のチェックボックスを選択（必要に応じて）
4. 「取り込み開始」ボタンをクリック

### ステップ4: 取り込み結果の確認

1. **成功メッセージの確認**
   - 「取り込み完了」ダイアログが表示される
   - 最新ジョブIDが表示される
   - 処理件数が表示される（例: `{ "employees": { "processed": 4, "created": 4, "updated": 0 } }`）

2. **取込履歴の確認**
   - 取込履歴テーブルにジョブが記録される
   - ステータスが「COMPLETED」であることを確認

3. **データの確認**
   - 従業員一覧ページ（`/admin/tools/employees`）で4件の従業員が表示されることを確認
   - アイテム一覧ページ（`/admin/tools/items`）で4件のアイテムが表示されることを確認

### ステップ5: データベースでの確認（オプション）

ラズパイ5で以下のコマンドを実行して、データベースを直接確認できます:

```bash
# import_jobsテーブルの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return \
  -c "SELECT id, file_name, status, created_at FROM import_jobs ORDER BY created_at DESC LIMIT 5;"

# 従業員テーブルの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return \
  -c "SELECT employee_code, display_name, department FROM employees ORDER BY employee_code LIMIT 10;"

# アイテムテーブルの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return \
  -c "SELECT item_code, name, category FROM items ORDER BY item_code LIMIT 10;"
```

### ステップ6: 検証スクリプトの実行（オプション）

検証スクリプトを使用して、インポート前後のデータ件数を確認できます:

```bash
# インポート前の確認
cd /opt/RaspberryPiSystem_002
./scripts/validation/validate-import.sh

# インポート後の確認
./scripts/validation/validate-import.sh --check-only
```

## 期待される結果

- ✅ CSVファイルが正常にアップロードされる
- ✅ 取り込みが完了する（エラーが発生しない）
- ✅ データが正しく登録される（従業員4件、アイテム4件）
- ✅ 取込履歴にジョブが記録される（ステータス: COMPLETED）
- ✅ バリデーションが正しく動作する（employeeCode: 4桁数字、itemCode: TO + 4桁数字）

## トラブルシューティング

### CSVファイルがアップロードされない

- **原因**: ファイルサイズ、エンコーディング、ヘッダー行の問題
- **対応**: 
  - ファイルサイズを確認（10MB以下推奨）
  - UTF-8エンコーディングで保存されているか確認
  - ヘッダー行が1行目にあるか確認

### 取り込みが失敗する

- **原因**: バリデーションエラー、データベースエラー
- **対応**:
  - ブラウザのコンソール（F12）でエラーメッセージを確認
  - APIログを確認: `docker compose -f infrastructure/docker/docker-compose.server.yml logs api`
  - エラーメッセージに従ってCSVファイルを修正

### データが登録されない

- **原因**: インポートジョブが失敗している
- **対応**:
  - 取込履歴でジョブのステータスを確認
  - エラーメッセージを確認
  - データベースのログを確認

### バリデーションエラーが発生する

- **原因**: CSV形式が仕様に合っていない
- **対応**:
  - `employeeCode`が4桁数字であることを確認（例: `0001`）
  - `itemCode`がTO + 4桁数字であることを確認（例: `TO0001`）
  - 必須項目（`displayName`, `name`）が空でないことを確認

## 検証結果の記録

検証が完了したら、以下の情報を記録してください:

- **検証日時**: YYYY-MM-DD HH:MM
- **検証環境**: ラズパイ5のIPアドレス、OSバージョン、Dockerバージョン
- **検証結果**: 成功/失敗、処理件数、エラーメッセージ
- **問題点と対応方法**: 発生した問題とその解決方法

## 関連ドキュメント

- [CSVインポート・エクスポート仕様](./csv-import-export.md)
- [検証チェックリスト](./verification-checklist.md)
- [システム要件定義](../requirements/system-requirements.md)
- [EXEC_PLAN.md](../../EXEC_PLAN.md)

