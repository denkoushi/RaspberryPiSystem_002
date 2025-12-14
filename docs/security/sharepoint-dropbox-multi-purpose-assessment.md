# SharePoint → Dropbox → Pi5 多用途CSVデータ連携の適用可能性評価

最終更新: 2025-12-14

## 概要

SharePointリストからPowerAutomateでCSV出力し、DropboxにCSV保存して、Pi5がDropboxからCSVデータを取得するスキームについて、**計測機器点検、加工機点検、吊具点検、生産計画日程、各種監視データ**など、様々な用途のCSVデータを既存システムに適用可能かどうかを評価します。

## 想定されるCSVデータの種類

1. **計測機器点検データ**: 点検記録、点検項目、点検結果
2. **加工機点検データ**: 加工機の点検記録、メンテナンス履歴
3. **吊具点検データ**: 吊具の点検記録、点検結果
4. **生産計画日程**: 生産スケジュール、工程計画
5. **各種監視データ**: 温度、湿度、電力消費、稼働率など

## 既存システムへの適用可能性：所見

### ✅ 適用可能（拡張実装により対応可能）

**結論**: 既存システムのアーキテクチャとデータモデルを活用して、多用途のCSVデータ連携に対応可能です。

### 詳細評価

#### 1. 既存のCSVインポート機能の拡張性

**現状**:
- ✅ **実装済み**: 従業員（Employee）と工具（Item）のCSVインポート機能
- ✅ **アーキテクチャ**: 汎用的なCSVパーサーとバリデーション機能（Zodスキーマ）
- ✅ **エラーハンドリング**: トランザクション処理、エラーログ、アラート機能

**拡張可能性**:
- ✅ **計測機器点検データ**: 既存の`InspectionRecord`モデルに対応可能
  - CSVスキーマを追加（`measuringInstrumentId`, `inspectionItemId`, `result`, `inspectedAt`など）
  - 既存の`imports.ts`を拡張して`importInspectionRecords`関数を追加
- ✅ **吊具点検データ**: 既存の`RiggingInspectionRecord`モデルに対応可能
  - CSVスキーマを追加（`riggingGearId`, `result`, `inspectedAt`など）
  - 既存の`imports.ts`を拡張して`importRiggingInspectionRecords`関数を追加
- ⚠️ **加工機点検データ**: 新規モデルが必要（`MachineInspection`など）
  - Prismaスキーマに新規モデルを追加
  - CSVインポート機能を新規実装
- ⚠️ **生産計画日程**: 新規モデルが必要（`ProductionSchedule`など）
  - Prismaスキーマに新規モデルを追加
  - CSVインポート機能を新規実装
- ⚠️ **各種監視データ**: 新規モデルが必要（`MonitoringData`など）
  - Prismaスキーマに新規モデルを追加
  - CSVインポート機能を新規実装

#### 2. データモデルの拡張性

**既存のデータモデル**:
- ✅ **計測機器**: `MeasuringInstrument`, `InspectionItem`, `InspectionRecord`
- ✅ **吊具**: `RiggingGear`, `RiggingInspectionRecord`
- ⚠️ **加工機**: 未実装（新規モデルが必要）
- ⚠️ **生産計画**: 未実装（新規モデルが必要）
- ⚠️ **監視データ**: 未実装（新規モデルが必要）

**拡張の容易性**:
- ✅ **Prismaスキーマ**: 新規モデルの追加が容易
- ✅ **マイグレーション**: Prismaマイグレーションで自動生成可能
- ✅ **既存パターン**: 計測機器・吊具の実装パターンを流用可能

#### 3. APIエンドポイントの拡張性

**現状**:
- ✅ **CSVインポートAPI**: `/api/imports/master`（従業員・工具のみ）
- ✅ **CRUD API**: 各モデルごとにCRUD APIが実装済み

**拡張可能性**:
- ✅ **CSVインポートAPIの拡張**: 既存の`/api/imports/master`を拡張して、複数のCSVタイプに対応
  - 例: `/api/imports/inspection-records`, `/api/imports/production-schedules`など
- ✅ **新規APIエンドポイント**: 用途ごとに新規エンドポイントを追加可能
- ✅ **認証・認可**: 既存の`authorizeRoles`を活用してアクセス制御可能

#### 4. 可視化機能の拡張性

**現状**:
- ✅ **管理画面**: Reactベースの管理コンソール
- ✅ **ダッシュボード**: 基本的なダッシュボード機能（実装済み）
- ⚠️ **グラフ・チャート**: 限定的（基本的な一覧表示のみ）

**拡張可能性**:
- ✅ **Reactコンポーネント**: 新規の可視化コンポーネントを追加可能
- ⚠️ **グラフライブラリ**: 必要に応じてChart.js、Rechartsなどを追加
- ✅ **データ取得**: 既存のAPIクライアント（`apps/web/src/api/client.ts`）を拡張可能

#### 5. Dropbox連携の拡張性

**現状**:
- ⚠️ **未実装**: Dropbox連携機能は未実装

**実装方針**:
- ✅ **汎用的なCSV取得機能**: DropboxからCSVを取得する汎用的な機能を実装
- ✅ **用途別の処理**: 取得したCSVを用途に応じて処理（計測機器点検、吊具点検、生産計画など）
- ✅ **スケジューラー**: systemd timerまたはcronで定期的にDropboxからCSVを取得

**実装例**:
```typescript
// scripts/dropbox-csv-fetch.ts
async function fetchCsvFromDropbox(filePath: string): Promise<Buffer> {
  // Dropbox APIからCSVファイルを取得
  // 証明書ピニング、TLS検証などセキュリティ対策を実装
}

// 用途別の処理
async function processInspectionRecords(csv: Buffer) {
  // 計測機器点検データの処理
}

async function processProductionSchedules(csv: Buffer) {
  // 生産計画日程の処理
}
```

### 適用可能性の評価

| CSVデータの種類 | 既存モデル | 適用可能性 | 実装難易度 |
|----------------|-----------|-----------|-----------|
| **計測機器点検** | ✅ `InspectionRecord` | ✅ **高** | 🟢 **低**（既存モデルを活用） |
| **吊具点検** | ✅ `RiggingInspectionRecord` | ✅ **高** | 🟢 **低**（既存モデルを活用） |
| **加工機点検** | ❌ 未実装 | ⚠️ **中** | 🟡 **中**（新規モデルが必要） |
| **生産計画日程** | ❌ 未実装 | ⚠️ **中** | 🟡 **中**（新規モデルが必要） |
| **各種監視データ** | ❌ 未実装 | ⚠️ **中** | 🟡 **中**（新規モデルが必要） |

### 実装上の推奨事項

#### 1. 段階的な実装

**Phase 1: 既存モデルへの対応**（優先度: 高）
- ✅ 計測機器点検データのCSVインポート機能を追加
- ✅ 吊具点検データのCSVインポート機能を追加
- ✅ Dropbox連携機能の基本実装

**Phase 2: 新規モデルの実装**（優先度: 中）
- ⚠️ 加工機点検データモデルとCSVインポート機能を追加
- ⚠️ 生産計画日程データモデルとCSVインポート機能を追加
- ⚠️ 各種監視データモデルとCSVインポート機能を追加

**Phase 3: 可視化機能の拡張**（優先度: 中）
- ⚠️ グラフ・チャートライブラリの追加
- ⚠️ ダッシュボード機能の拡張

#### 2. 共通化とモジュール化

**推奨アーキテクチャ**:
- ✅ **CSVパーサー**: 汎用的なCSVパーサーを共通化（既存の`parseCsvRows`を活用）
- ✅ **バリデーション**: Zodスキーマを用途ごとに定義（既存パターンを流用）
- ✅ **Dropbox連携**: 汎用的なDropbox CSV取得機能を実装
- ✅ **インポート処理**: 用途ごとにインポート処理をモジュール化

**実装例**:
```typescript
// apps/api/src/lib/csv-importer.ts
export class CsvImporter<T> {
  constructor(
    private schema: z.ZodSchema<T>,
    private importFn: (rows: T[]) => Promise<void>
  ) {}
  
  async import(csvBuffer: Buffer): Promise<ImportResult> {
    const rows = parseCsvRows(csvBuffer);
    const validatedRows = rows.map(row => this.schema.parse(row));
    await this.importFn(validatedRows);
    return { created: validatedRows.length, updated: 0 };
  }
}

// 用途ごとの使用例
const inspectionImporter = new CsvImporter(
  inspectionRecordSchema,
  async (rows) => {
    await prisma.inspectionRecord.createMany({ data: rows });
  }
);
```

#### 3. セキュリティ対策の統一

**既存のセキュリティ機能を活用**:
- ✅ **認証・認可**: 既存の`authorizeRoles`を活用
- ✅ **レート制限**: 既存の`rate-limit.ts`を拡張
- ✅ **ログ・アラート**: 既存のログ・アラート機能を活用
- ✅ **Dropbox連携**: 証明書ピニング、TLS検証などセキュリティ対策を実装

### 結論

**既存システムへの適用可能性**: ✅ **はい、適用可能です**

**条件**:
1. **既存モデルを活用**: 計測機器点検、吊具点検は既存モデルを活用可能
2. **新規モデルの追加**: 加工機点検、生産計画、監視データは新規モデルが必要
3. **CSVインポート機能の拡張**: 既存のCSVインポート機能を拡張して対応可能
4. **Dropbox連携機能の実装**: 汎用的なDropbox CSV取得機能を実装
5. **可視化機能の拡張**: 必要に応じてグラフ・チャートライブラリを追加

**実装の優先順位**:
1. **最優先**: 計測機器点検、吊具点検（既存モデルを活用）
2. **中優先**: 加工機点検、生産計画、監視データ（新規モデルが必要）
3. **低優先**: 可視化機能の拡張（グラフ・チャートライブラリの追加）

**推奨される実装方針**:
- 既存のCSVインポート機能のアーキテクチャを活用
- 用途ごとにモジュール化して実装
- 段階的に実装（既存モデル → 新規モデル → 可視化機能）

## 関連ドキュメント

- [SharePoint → Dropbox → Pi5 データ連携スキームのセキュリティ評価](./sharepoint-dropbox-integration-assessment.md)
- [CSVインポート機能](../api/imports.md)
- [計測機器管理モジュール](../modules/measuring-instruments/README.md)
- [吊具管理モジュール](../modules/rigging-gears/README.md)
