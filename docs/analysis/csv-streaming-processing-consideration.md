# CSVストリーミング処理の検討

最終更新: 2025-12-16

## 概要

本ドキュメントでは、CSVインポート機能におけるストリーミング処理の必要性を評価し、現時点での実装判断を記録します。

## 現状の実装

### 現在の処理方式

- **ライブラリ**: `csv-parse/sync`（同期処理）
- **処理方式**: ファイル全体をメモリに読み込んでからパース
- **データベース処理**: トランザクション内で一括処理

### 実装コード

```typescript
// apps/api/src/routes/imports.ts
function parseCsvRows(buffer: Buffer): Record<string, string>[] {
  return parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];
}
```

## 性能検証結果

### 1000行CSV

- **処理時間**: 589ms
- **メモリ使用量**: 8.64MB
- **結果**: ✅ 問題なし

### 10000行CSV

- **処理時間**: 4132ms（約4秒）
- **メモリ使用量**: -2.73MB（ガベージコレクション後）
- **ヒープ使用率**: 60.58%（ガベージコレクション後は減少）
- **結果**: ✅ 問題なし

## ストリーミング処理の必要性評価

### 現時点での判断: **実装不要**

**理由**:
1. **10000行で問題なし**: メモリ使用量、処理時間ともに問題なし
2. **実際の使用ケース**: 従業員・工具マスタは通常1000行以下
3. **メモリ効率**: Node.jsのガベージコレクションが適切に動作
4. **実装コスト**: ストリーミング処理の実装は複雑で、現時点ではROIが低い

### ストリーミング処理が必要になる条件

以下の条件が満たされた場合、ストリーミング処理の実装を検討すべき：

1. **データ量**: 10万行以上のCSVを処理する必要がある
2. **メモリ制約**: APIコンテナのメモリ制限が厳しい（例: 512MB以下）
3. **処理時間**: 現在の処理時間が許容範囲を超える（例: 5分以上）
4. **同時実行**: 複数の大規模CSVインポートを同時に実行する必要がある

## 将来の拡張案

### ストリーミング処理の実装方針（将来）

もしストリーミング処理が必要になった場合の実装方針：

#### 1. ライブラリの変更

```typescript
// csv-parse/sync から csv-parse に変更
import { parse } from 'csv-parse';

// ストリーミング処理の実装例
async function parseCsvRowsStreaming(
  buffer: Buffer,
  onRow: (row: Record<string, string>) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    parser.on('readable', async () => {
      let record;
      while ((record = parser.read()) !== null) {
        try {
          await onRow(record);
        } catch (error) {
          parser.destroy();
          reject(error);
          return;
        }
      }
    });

    parser.on('error', reject);
    parser.on('end', resolve);

    parser.write(buffer);
    parser.end();
  });
}
```

#### 2. バッチ処理の導入

- 一定行数（例: 1000行）ごとにデータベースにコミット
- メモリ使用量を一定範囲に抑制
- エラー時のロールバック範囲を限定

#### 3. メモリ監視の追加

- 処理中のメモリ使用量を監視
- 閾値を超えた場合に警告またはエラーを発火
- メトリクスとして記録

## 推奨事項

### 現時点での推奨

1. **現状維持**: 現在の実装（`csv-parse/sync`）を継続使用
2. **監視強化**: メモリ使用量と処理時間の監視を継続
3. **ドキュメント化**: この検討結果をドキュメントとして残す

### 将来の検討タイミング

以下のいずれかが発生した場合、ストリーミング処理の実装を検討：

1. **10万行以上のCSV処理が必要になった場合**
2. **メモリ不足エラーが発生した場合**
3. **処理時間が許容範囲を超えた場合**
4. **同時実行時のメモリ競合が発生した場合**

## 関連ドキュメント

- [Dropbox CSV統合機能の現状分析](./dropbox-csv-integration-status.md)
- [CSVインポート・エクスポート仕様](../guides/csv-import-export.md)

## 更新履歴

- 2025-12-16: 初版作成（ストリーミング処理の必要性評価）
