# 計測機器管理モジュール

## 概要

計測機器管理モジュールは、工場内の計測機器の持出・返却を管理し、持ち出し時の点検記録を自動化する機能を提供します。RFIDタグを使用した計測機器識別、点検項目の管理、点検記録の管理を行います。工具管理モジュールと疎結合で併用し、同じ画面で工具と計測機器を統合表示します。

## 責務

- **計測機器マスター管理**: 計測機器の基本情報（名称、管理番号、保管場所、測定範囲、校正期限）のCRUD操作
- **計測機器ジャンル管理**: ジャンル（名称・画像1〜2枚）の定義・管理
- **点検項目マスター管理**: 計測機器ジャンルごとの点検項目の定義・管理
- **RFIDタグ管理**: RFIDタグと計測機器の紐付け管理
- **持ち出し・返却処理**: RFIDタグスキャンによる計測機器識別、持ち出し時の点検記録、持ち出し・返却の登録
- **点検記録管理**: 持ち出し時の点検結果（点検項目ごとの合格/不合格）の記録・管理
- **データ可視化**: 持ち出し・返却履歴の表示、サイネージ表示対応

## データモデル

### 主要エンティティ

- **MeasuringInstrument**: 計測機器情報（name, managementNumber, storageLocation, measurementRange, calibrationExpiryDate, status）
- **MeasuringInstrumentGenre**: 計測機器ジャンル（name, imageUrlPrimary, imageUrlSecondary）
- **InspectionItem**: 点検項目情報（genreId, name, content, criteria, method, order）
- **InspectionRecord**: 点検記録（measuringInstrumentId, loanId, employeeId, inspectionItemId, result, inspectedAt）
- **MeasuringInstrumentTag**: RFIDタグ紐付け（measuringInstrumentId, rfidTagUid）
- **Loan**: 貸出情報（工具管理モジュールと共通、measuringInstrumentIdを追加）
- **TorqueWrenchProfile**: `MeasuringInstrument`と1対1のトルクレンチ固有情報（製造番号、型番モデル）
- **TorqueWrenchSettingHistory**: 物理トルクレンチごとの追記専用設定履歴（下限、規定、上限、単位、N·m換算値）

関連するDB運用知見は[データベース・ナレッジベース](../../knowledge-base/database.md)を参照してください。

## トルクレンチ拡張（2026-07-17）

組立工程のトルクレンチは、保管場所・校正期限・AVAILABLE／IN_USE／MAINTENANCE／RETIRED状態について既存`MeasuringInstrument`を正本として再利用する。メーカー・型番・測定範囲、正規化製造番号、締結対象の適合グループ、設定履歴、組立確認・実績は独立した`torque-wrenches`ドメインへ分離し、汎用計測機器サービスへ組立業務規則を混在させない。

- 管理画面: `/admin/tools/torque-wrenches`
- 組立で選択するもの: 物理製造番号ではなく、呼び径・長さ・材質・強度区分を表す適合グループ
- 作業で記録するもの: 実際の物理製造番号、メーカー・型番、当時の最新設定履歴、入力値・単位、受付／拒否理由
- 校正期限: Asia/Tokyoの当日を含めて有効。未登録・期限切れはREQUIRED作業で拒否
- 設定値: 過去行を更新せず新しい履歴を追加。追加後は既存の現物確認を失効
- 廃止: 参照済み資産は物理削除せずRETIRED、型番・適合グループは利用停止

設計・検証の正本は[組立トルクレンチトレーサビリティExecPlan](../../plans/assembly-torque-wrench-traceability-execplan.md)、端末運用は[torque-agent Runbook](../../runbooks/assembly-torque-agent.md)を参照する。

## 持ち出しフロー

1. **計測機器タグスキャン**
   - RFIDリーダーTS100で計測機器タグをスキャン
   - 計測機器を識別

2. **点検項目表示**
   - 該当する計測機器の所属ジャンルを解決
   - ジャンルに紐づく点検項目を自動表示
   - ジャンル画像（1〜2枚）を同時表示
   - 点検内容、点検基準、点検方法を表示

3. **点検実施**
   - ユーザーが目視で各点検項目を確認
   - すべて合格の場合：氏名タグをスキャン → 自動的に合格として送信
   - いずれかがNGの場合：NGボタンを押下 → 不合格として送信

4. **持ち出し登録**
   - 氏名タグスキャンまたはNGボタン押下で持ち出し登録
   - 点検記録も同時に保存（API: `/api/measuring-instruments/borrow`/`return`）

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

## 実装状況（2026-07-17時点）

### 完成度: 95%（TS100統合を除く）

#### ✅ 実装完了機能

**組立トルクレンチ拡張（ローカル実装・未デプロイ）**
- 型番／物理レンチ／適合グループ／追記専用設定履歴
- REQUIREDテンプレートの構造化締結条件と物理レンチ適合判定
- 実績スナップショット、拒否監査、イベント冪等性、管理者例外入力
- `torque-agent`のHID／SQLite outbox／ローカル監査／配送境界
- CEM3-BTLA正式パーサーは実機fixture取得待ち

**コア機能**
- データベーススキーマ（4エンティティ）
- バックエンドAPI（CRUD、持ち出し/返却API、タグ管理API）
- フロントエンド統合（React Queryフック、型安全性）

**管理コンソールUI**
- 計測機器マスター管理（CRUD）
- 点検項目管理（CRUD）
- RFIDタグ紐付け管理
- 点検記録閲覧
- 統合表示（工具と計測機器の混在一覧、カテゴリフィルタ）

**キオスクUI**
- 計測機器タグ自動遷移（持出タブ/PHOTOモードから自動遷移）
- 持ち出しフロー（タグスキャン/手入力、点検項目表示、OK/NG判定）
- 返却機能（統合持出一覧から返却）
- エラーハンドリング（無限ループ防止、ユーザーフレンドリーなメッセージ）
- タブのアクティブ状態管理

**サイネージ表示**
- 計測機器持出アイテムの識別表示（藍系背景、2行表示）
- 校正期限アラート（色分け表示）

**システム統合**
- 工具管理システムとの疎結合統合
- NFCエージェント連携（Sony RC-S300/S1対応）
- ログ取得の統一（postClientLogs）

#### ⏳ 未実装・改善余地（TS100以外）

**エラーハンドリングの細部**（優先度: 低）
- スキャン失敗時のリトライ表示
- 点検項目未取得時のリカバリボタン

**オフライン対応**（将来検討）
- オフライン時のローカルキュー保存（工具管理と同様の実装が必要）

#### 🔄 TS100統合

**実装状況**: USB HID/BLE HID対応コードは実装済み（`ts100_hid.py`、`AGENT_MODE=ts100-hid`）

**実機検証**: TS100は現場使用中のため未実施。実機が利用可能になったら検証予定。

**詳細**: [TS100統合計画](../../plans/ts100-integration-plan.md) を参照

### 技術的評価

**強み**
- **アーキテクチャ**: 工具管理システムと疎結合で統合
- **型安全性**: TypeScript + Prismaで型整合性を確保
- **ユーザー体験**: タグ自動遷移、エラーメッセージ改善、タブ状態管理
- **保守性**: ナレッジベース（KB-090〜KB-096）で問題解決を記録

**改善点**
- TS100統合: 実機検証待ち
- エラーハンドリング: 細部の改善余地あり（優先度は低い）

### 本番運用状況

**状態**: TS100を除き、本番運用可能な完成度に達している

**2026-04-14 ジャンル化ロールアウト**: Pi5→Pi4×4 を [deployment.md](../../guides/deployment.md) の **1 台ずつ `--limit`** で反映（Pi3 は本機能の必須対象外）。`./scripts/deploy/verify-phase12-real.sh` は **PASS 43/0/0**。手動では管理 **`/admin/tools/measuring-instrument-genres`** とキオスク計測機器持出画面でジャンル画像・点検項目を確認すること。

**実機検証**: TS100以外の機能は実機検証済み

**ナレッジベース**: 
- [KB-090](../../knowledge-base/api.md#kb-090-キオスクから計測機器一覧を取得できない問題client-key認証追加)
- [KB-091](../../knowledge-base/frontend.md#kb-091-キオスク持出フローの改善選択-or-タグuid点検項目なしでも送信)
- [KB-092](../../knowledge-base/infrastructure/miscellaneous.md#kb-092-pi4キオスクのgpuクラッシュ問題)
- [KB-093](../../knowledge-base/infrastructure/miscellaneous.md#kb-093-計測機器apiの401エラー期限切れjwtとx-client-keyの競合)
- [KB-094](../../knowledge-base/api.md#kb-094-サイネージ左ペインで計測機器と工具を視覚的に識別できない)
- [KB-095](../../knowledge-base/frontend.md#kb-095-計測機器タグスキャン時の自動遷移機能)
- [KB-096](../../knowledge-base/frontend.md#kb-096-クライアントログ取得のベストプラクティスpostclientlogsへの統一)

## 関連ドキュメント

- [要件定義書](../../requirements/measuring-instruments-requirements.md) - 詳細な要件定義
- [工具管理モジュール](../tools/README.md) - 工具管理モジュール（併用）
- [モジュール構造設計決定](../../decisions/001-module-structure.md) - モジュール構造の設計決定
- [システムアーキテクチャ概要](../../architecture/overview.md) - システム全体のアーキテクチャ
