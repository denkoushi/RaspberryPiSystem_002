# 計測機器管理モジュール

## 概要

計測機器管理モジュールは、工場内の計測機器の持出・返却を管理し、持ち出し時の点検記録を自動化する機能を提供します。RFIDタグを使用した計測機器識別、点検項目の管理、点検記録の管理を行います。工具管理モジュールと疎結合で併用し、同じ画面で工具と計測機器を統合表示します。

## 責務

- **計測機器マスター管理**: 計測機器の基本情報（名称、管理番号、保管場所、測定範囲、校正期限）のCRUD操作
- **点検項目マスター管理**: 計測機器ごとの点検項目の定義・管理
- **RFIDタグ管理**: RFIDタグと計測機器の紐付け管理
- **持ち出し・返却処理**: RFIDタグスキャンによる計測機器識別、持ち出し時の点検記録、持ち出し・返却の登録
- **点検記録管理**: 持ち出し時の点検結果（点検項目ごとの合格/不合格）の記録・管理
- **データ可視化**: 持ち出し・返却履歴の表示、サイネージ表示対応

## データモデル

### 主要エンティティ

- **MeasuringInstrument**: 計測機器情報（name, managementNumber, storageLocation, measurementRange, calibrationExpiryDate, status）
- **InspectionItem**: 点検項目情報（measuringInstrumentId, name, content, criteria, method, order）
- **InspectionRecord**: 点検記録（measuringInstrumentId, loanId, employeeId, inspectionItemId, result, inspectedAt）
- **MeasuringInstrumentTag**: RFIDタグ紐付け（measuringInstrumentId, rfidTagUid）
- **Loan**: 貸出情報（工具管理モジュールと共通、measuringInstrumentIdを追加）

詳細は [データベース設計](../../architecture/database.md#measuring-instruments-module) を参照してください。

## 持ち出しフロー

1. **計測機器タグスキャン**
   - RFIDリーダーTS100で計測機器タグをスキャン
   - 計測機器を識別

2. **点検項目表示**
   - 該当する計測機器の点検項目を自動表示
   - 点検内容、点検基準、点検方法を表示

3. **点検実施**
   - ユーザーが目視で各点検項目を確認
   - すべて合格の場合：氏名タグをスキャン → 自動的に合格として送信
   - いずれかがNGの場合：NGボタンを押下 → 不合格として送信

4. **持ち出し登録**
   - 氏名タグスキャンまたはNGボタン押下で持ち出し登録
   - 点検記録も同時に保存

## 工具管理システムとの統合

- **疎結合設計**: 計測機器管理モジュールは独立したモジュールとして実装
- **統合表示**: 工具と計測機器を同じ一覧画面に混在表示（カテゴリで区別）
- **共通機能の活用**: 貸出テーブル（Loan）を拡張して計測機器も管理
- **従業員管理**: 工具管理モジュールの従業員管理機能を共用

## 技術要件

### RFIDリーダーTS100

- **接続方式**: Bluetooth接続（調査が必要）
- **SDK**: 公式SDKは Android/iOS/Windows のみ。Linux版はなし → Raspberry Pi では Bluetooth HID/シリアル（SPP など）での動作検証が必要
- **Raspberry Pi対応**: Raspberry Piでの動作確認が必要（HID/シリアルモードの有無確認、サンプル実装検証）

### データベース

- PostgreSQL 15を使用（工具管理システムと共通）
- Prisma ORMを使用

## ディレクトリ構造

```
apps/api/src/
├── routes/measuring-instruments/
│   ├── instruments/
│   │   ├── index.ts      # ルート登録
│   │   ├── list.ts       # GET /instruments
│   │   ├── get.ts        # GET /instruments/:id
│   │   ├── create.ts     # POST /instruments
│   │   ├── update.ts     # PUT /instruments/:id
│   │   ├── delete.ts     # DELETE /instruments/:id
│   │   └── schemas.ts    # バリデーションスキーマ
│   ├── inspection-items/
│   │   ├── index.ts      # ルート登録
│   │   ├── list.ts       # GET /inspection-items
│   │   ├── get.ts        # GET /inspection-items/:id
│   │   ├── create.ts     # POST /inspection-items
│   │   ├── update.ts     # PUT /inspection-items/:id
│   │   ├── delete.ts     # DELETE /inspection-items/:id
│   │   └── schemas.ts    # バリデーションスキーマ
│   ├── inspection-records/
│   │   ├── index.ts      # ルート登録
│   │   ├── list.ts       # GET /inspection-records
│   │   ├── create.ts     # POST /inspection-records
│   │   └── schemas.ts    # バリデーションスキーマ
│   ├── tags/
│   │   ├── index.ts      # ルート登録
│   │   ├── list.ts       # GET /tags
│   │   ├── create.ts     # POST /tags
│   │   ├── delete.ts     # DELETE /tags/:id
│   │   └── schemas.ts    # バリデーションスキーマ
│   └── index.ts          # モジュールルート登録
└── services/measuring-instruments/
    ├── instrument.service.ts
    ├── inspection-item.service.ts
    ├── inspection-record.service.ts
    ├── tag.service.ts
    └── index.ts
```

## 設計方針

- **機能ごとのサブディレクトリ**: 各リソース（instruments, inspection-items, inspection-records, tags）を独立したディレクトリに分割
- **バリデーションスキーマの分離**: 各サブディレクトリに`schemas.ts`を配置し、バリデーションロジックを集約
- **ファイルサイズの抑制**: 1ファイルあたり50-100行程度に収まり、可読性を向上

## 関連ドキュメント

- [要件定義書](../../requirements/measuring-instruments-requirements.md) - 詳細な要件定義
- [工具管理モジュール](../tools/README.md) - 工具管理モジュール（併用）
- [モジュール構造設計決定](../../decisions/001-module-structure.md) - モジュール構造の設計決定
- [システムアーキテクチャ概要](../../architecture/overview.md) - システム全体のアーキテクチャ
