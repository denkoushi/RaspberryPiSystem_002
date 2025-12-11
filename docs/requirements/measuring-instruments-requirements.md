---
title: 計測機器管理システム要件定義
tags: [要件定義, 機能要件, 非機能要件, 計測機器, 点検]
audience: [開発者, アーキテクト, 新規参加者]
last-verified: 2025-12-12
related: [../modules/measuring-instruments/README.md, ../modules/tools/README.md, system-requirements.md]
category: requirements
update-frequency: medium
---

# 計測機器管理システム要件定義

## 概要

計測機器の持ち出し返却を管理し、持ち出し時の点検記録を自動化するシステムの要件定義書。工具管理システムと疎結合で併用し、RFIDリーダーTS100を使用した計測機器管理機能を実装する。

## システム目的

工場で計測機器の持出状況を正確に把握し、持ち出し時の点検記録を自動化する。Raspberry Pi 5 上で API・DB・Web UI を提供し、Raspberry Pi 4 クライアントがブラウザキオスクとして接続する。工具管理システムと統合して、同じ画面で工具と計測機器を管理できるようにする。

## 機能要件

### FR-MI-001: 計測機器マスター管理機能

- **説明**: 計測機器の基本情報を登録・編集・削除・一覧表示できる
- **詳細**:
  - 計測機器名称（必須）
  - 計測機器管理番号（必須、ユニーク）
  - 計測機器保管場所（オプション）
  - 計測機器測定範囲（オプション）
  - 校正期限（オプション）
  - ステータス管理（AVAILABLE, IN_USE, MAINTENANCE, RETIRED）
- **拡張**: 登録/編集フォームで **NFC/RFIDタグUID** を入力すると、保存時にRFIDタグ紐付けを自動作成・更新（重複UIDは409で拒否）
- **検証**: 計測機器のCRUD操作が正常に動作することを確認

### FR-MI-002: 点検項目マスター管理機能

- **説明**: 計測機器ごとの点検項目を定義・管理できる
- **詳細**:
  - 計測機器への紐付け（必須）
  - 点検項目名称（必須）
  - 計測機器点検内容（必須）
  - 点検基準（必須、テキスト形式または数値範囲形式）
  - 点検方法（必須）
  - 表示順序（必須）
- **検証**: 点検項目のCRUD操作が正常に動作し、計測機器ごとに点検項目が表示されることを確認

### FR-MI-003: RFIDタグ紐付け管理機能

- **説明**: RFIDタグと計測機器の紐付けを管理できる
- **詳細**:
  - 計測機器への紐付け（必須）
  - RFIDタグUID（必須、ユニーク）
  - 複数のRFIDタグを1つの計測機器に紐付け可能
- **実装状況**: ✅ 管理コンソールの計測機器登録/編集フォームにタグUID入力欄を追加し、保存時に紐付けを自動作成・更新（既存UIDは409で拒否）。既存のRFIDタグ管理ページ（`/admin/tools/instrument-tags`）も併用可。
- **検証**: RFIDタグの紐付け・解除が正常に動作することを確認

### FR-MI-004: 計測機器持ち出し機能

- **説明**: RFIDタグスキャンで計測機器を識別し、持ち出しを記録できる
- **詳細**:
  - RFIDリーダーTS100で計測機器タグをスキャン
  - 計測機器を識別
  - 該当する点検項目を自動表示
  - 点検実施後、氏名タグスキャンまたはNGボタン押下で持ち出し登録
  - 点検記録も同時に保存
- **検証**: RFIDタグスキャンで計測機器が識別され、持ち出しが記録されることを確認
- **実装状況**: ✅ バックエンドAPI実装完了（`/measuring-instruments/borrow`）。キオスク持出ページ（`/kiosk/instruments/borrow`）実装完了（手入力対応、TS100統合は未実装）。点検項目表示・NGボタンは未実装。

### FR-MI-005: 点検記録機能

- **説明**: 持ち出し時の点検結果を記録できる
- **詳細**:
  - 計測機器への紐付け（必須）
  - 貸出IDへの紐付け（オプション、Loanテーブルと紐付け）
  - 持ち出し者ID（必須）
  - 点検項目ID（必須）
  - 点検結果（PASS, FAIL）
  - 点検実施日時（必須）
  - 点検項目ごとに個別に結果を記録
- **検証**: 点検記録が正常に保存され、点検項目ごとの結果が記録されることを確認

### FR-MI-006: 点検項目表示機能

- **説明**: 計測機器タグスキャン後、該当する点検項目を自動表示できる
- **詳細**:
  - 計測機器識別後、該当する点検項目を自動取得
  - 点検内容、点検基準、点検方法を表示
  - ユーザーが目視で各点検項目を確認
- **検証**: 計測機器タグスキャン後、正しい点検項目が表示されることを確認
- **実装状況**: ✅ キオスク持出画面で計測機器選択→点検項目自動表示を実装（手入力選択ベース、TS100連携未実装）

### FR-MI-007: 点検結果入力機能

- **説明**: 点検結果を入力できる
- **詳細**:
  - すべて合格の場合：氏名タグをスキャン → 自動的に合格として送信（ボタン不要）
  - いずれかがNGの場合：NGボタンを押下 → 不合格として送信（個別項目の記録は不要）
  - 計測機器全体で1つのNGボタンのみ
- **検証**: 合格/不合格の入力が正常に動作することを確認
- **実装状況**: ✅ キオスク持出画面で実装完了。OKの場合は氏名タグUID入力で自動送信（500msデバウンス）、NGの場合は「NGにする」ボタン押下で送信。OKの場合は全項目PASSとしてInspectionRecordを作成、NGの場合は点検記録を作成しない。エラー時の無限ループ防止とエラーメッセージ改善を実装（2025-12-11）。TS100連携未実装。

### FR-MI-008: 計測機器返却機能

- **説明**: 計測機器の返却を記録できる
- **詳細**:
  - 貸出IDを指定して返却
  - 返却日時を記録
  - 計測機器ステータスをAVAILABLEに更新
- **検証**: 返却処理が正常に動作することを確認
- **実装状況**: ✅ バックエンドAPI実装完了（`/measuring-instruments/return`）。キオスク返却ページ（`/kiosk/instruments/return`）実装完了（手入力対応、TS100統合は未実装）。貸出中計測機器の一覧表示から返却操作可能。

### FR-MI-009: 統合表示機能

- **説明**: 工具と計測機器を同じ一覧画面に混在表示できる
- **詳細**:
  - カテゴリで区別（工具/計測機器）
  - 検索・フィルタ機能で両方を検索可能
  - 同じ画面で管理可能
- **検証**: 工具と計測機器が同じ画面に表示され、検索・フィルタが正常に動作することを確認
- **実装状況**: ✅ 統合一覧API（`/api/tools/unified`）とUIページ（`/admin/tools/unified`）を実装完了。カテゴリフィルタ（すべて/工具のみ/計測機器のみ）と検索機能を実装。計測機器のRFIDタグUIDも表示。

### FR-MI-010: 履歴表示機能

- **説明**: 持ち出し・返却履歴を表示できる
- **詳細**:
  - 誰が、いつ、何を、持ち出したか、返却したかを表示
  - 点検記録も同時に表示
  - ページネーション対応
  - フィルタ機能（日付、従業員、計測機器など）
- **検証**: 履歴が正常に表示され、フィルタが正常に動作することを確認

### FR-MI-011: サイネージ表示機能（将来）

- **説明**: ラズパイ3のサイネージで計測機器情報を表示できる
- **詳細**:
  - PowerBIのデザインを参考にした表示
  - 計測機器の状態、点検状況などを表示
  - 校正期限アラート（期限切れ/間近/正常）をバッジで表示
- **検証**: サイネージで計測機器情報が正常に表示されることを確認
- **実装状況**: ✅ サイネージAPIに計測機器データ追加、InstrumentCardコンポーネント実装完了。校正期限アラート（期限切れ=赤、期限間近=黄、正常=緑）を実装。実機検証準備完了（[実機検証手順](../guides/measuring-instruments-verification.md)）。

### FR-MI-012: キオスク専用画面（将来）

- **説明**: ラズパイ4のキオスクで計測機器専用画面を表示できる
- **詳細**:
  - 計測機器持ち出し専用の画面
  - 点検項目表示、点検結果入力に特化
- **検証**: キオスクで計測機器専用画面が正常に表示されることを確認

## 非機能要件

### NFR-MI-001: パフォーマンス

- RFIDタグスキャンから計測機器識別まで1秒以内
- 点検項目表示まで2秒以内
- 持ち出し登録処理は3秒以内

### NFR-MI-002: 可用性

- システム稼働率99%以上
- オフライン時のキュー機能（将来実装）

### NFR-MI-003: セキュリティ

- JWT認証によるアクセス制御
- RFIDタグUIDの検証
- SQLインジェクション対策

### NFR-MI-004: 拡張性

- 工具管理システムと疎結合で併用可能
- 新しい点検項目の追加が容易
- 新しい計測機器タイプの追加が容易

## データモデル

### 計測機器マスターテーブル（MeasuringInstrument）

| カラム名 | 型 | 制約 | 説明 |
|---------|-----|------|------|
| id | UUID | PK | 主キー |
| name | String | NOT NULL | 計測機器名称 |
| managementNumber | String | NOT NULL, UNIQUE | 計測機器管理番号 |
| storageLocation | String? | | 計測機器保管場所 |
| measurementRange | String? | | 計測機器測定範囲 |
| calibrationExpiryDate | DateTime? | | 校正期限 |
| status | Enum | NOT NULL, DEFAULT AVAILABLE | ステータス（AVAILABLE, IN_USE, MAINTENANCE, RETIRED） |
| createdAt | DateTime | NOT NULL | 作成日時 |
| updatedAt | DateTime | NOT NULL | 更新日時 |

### 計測機器点検項目マスターテーブル（InspectionItem）

| カラム名 | 型 | 制約 | 説明 |
|---------|-----|------|------|
| id | UUID | PK | 主キー |
| measuringInstrumentId | UUID | FK, NOT NULL | 計測機器ID |
| name | String | NOT NULL | 点検項目名称 |
| content | String | NOT NULL | 計測機器点検内容 |
| criteria | String | NOT NULL | 点検基準（テキスト形式または数値範囲形式） |
| method | String | NOT NULL | 点検方法 |
| order | Int | NOT NULL | 表示順序 |
| createdAt | DateTime | NOT NULL | 作成日時 |
| updatedAt | DateTime | NOT NULL | 更新日時 |

### 計測機器点検記録ファクトテーブル（InspectionRecord）

| カラム名 | 型 | 制約 | 説明 |
|---------|-----|------|------|
| id | UUID | PK | 主キー |
| measuringInstrumentId | UUID | FK, NOT NULL | 計測機器ID |
| loanId | UUID? | FK | 貸出ID（Loanテーブルと紐付け） |
| employeeId | UUID | FK, NOT NULL | 持ち出し者ID |
| inspectionItemId | UUID | FK, NOT NULL | 点検項目ID |
| result | Enum | NOT NULL | 点検結果（PASS, FAIL） |
| inspectedAt | DateTime | NOT NULL | 点検実施日時 |
| createdAt | DateTime | NOT NULL | 作成日時 |
| updatedAt | DateTime | NOT NULL | 更新日時 |

### RFIDタグ紐付けテーブル（MeasuringInstrumentTag）

| カラム名 | 型 | 制約 | 説明 |
|---------|-----|------|------|
| id | UUID | PK | 主キー |
| measuringInstrumentId | UUID | FK, NOT NULL | 計測機器ID |
| rfidTagUid | String | NOT NULL, UNIQUE | RFIDタグUID |
| createdAt | DateTime | NOT NULL | 作成日時 |
| updatedAt | DateTime | NOT NULL | 更新日時 |

### 貸出テーブル（Loan）の拡張

既存のLoanテーブルに以下のカラムを追加：

| カラム名 | 型 | 制約 | 説明 |
|---------|-----|------|------|
| measuringInstrumentId | UUID? | FK | 計測機器ID（計測機器持ち出しの場合） |

## ユーザーインターフェース

### 持ち出しフロー

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

### 一覧表示

- 工具と計測機器を同じ一覧画面に混在表示
- カテゴリで区別（工具/計測機器）
- 検索・フィルタ機能で両方を検索可能

## 技術要件

### RFIDリーダーTS100

- **接続方式**: USB HIDキーボードエミュレーションを優先（Linuxでドライバ不要）。BLEはHID想定、SPP対応は未確認。
- **SDK**: 公式SDKは Android/iOS/Windows のみ。Linux版なし → エッジ側でHIDイベントを読み取り、`nfc-agent`拡張でWebSocket配信する方針。
- **Raspberry Pi対応**: HIDデバイスを`evdev`等で読み取り、`{ uid, reader: 'ts100', type: 'rfid-tag' }`でキオスクへ配信する実装を予定。
- **参考URL**: https://rfid.tss21.co.jp/product/ts100/sdk.html / [TS100統合計画](../plans/ts100-integration-plan.md)

### データベース

- PostgreSQL 15を使用（工具管理システムと共通）
- Prisma ORMを使用

### モジュール構造

- 新しいモジュール（measuring-instruments）を作成
- 工具管理モジュール（tools）と併用
- 疎結合設計

## 未確定事項

1. **RFIDリーダーTS100**（技術実装課題）
   - **決定**: USB HIDを優先し、`nfc-agent`をHID読み取り対応に拡張する。BLEはHID前提でSPPは未確認。
   - **残課題**: 実機でUID出力フォーマット・デバウンス挙動を確認し、HIDデバイスパスを特定する。
   - **参考**: [TS100統合計画](../plans/ts100-integration-plan.md)

2. **NG項目の記録方法** ✅ 解決済み（2025-12-08）
   - **決定**: 計測機器全体で1つのNGボタンのみ。NGの場合は点検記録を作成しない（個別項目の記録は不要）
   - **実装**: キオスク持出画面で「NGにする」ボタンを実装。NGの場合はLoanのみ作成し、InspectionRecordは作成しない

3. **校正期限アラート**（将来の機能拡張）
   - アラート表示・通知機能の要否
   - **状態**: 将来の機能拡張として検討

4. **可視化**（将来の機能拡張）
   - PowerBIデザインの提示待ち
   - サイネージ表示の詳細仕様
   - キオスク専用画面の要否
   - **状態**: 将来の機能拡張として検討

## 実装進捗状況（2025-12-08時点）

### Phase 1-3: 基盤実装完了 ✅

- ✅ **データベーススキーマ**: MeasuringInstrument, InspectionItem, InspectionRecord, MeasuringInstrumentTagモデル実装完了
- ✅ **バックエンドAPI**: CRUD、持ち出し/返却API（`/measuring-instruments/borrow`, `/measuring-instruments/return`）実装完了
- ✅ **フロントエンドAPI統合**: React Queryフック（`useBorrowMeasuringInstrument`, `useReturnMeasuringInstrument`）実装完了
- ✅ **管理コンソールUI**: 計測機器・点検項目・RFIDタグ・点検記録のCRUDページ実装完了
- ✅ **キオスクUI**: 持出・返却ページ実装完了（手入力対応、NFCエージェント連携実装済み、TS100統合は未実装）

### 未実装機能

- ⏳ **RFIDリーダーTS100統合**: USB/BLE HIDでのエージェント連携実装（計画: [ts100-integration-plan](../plans/ts100-integration-plan.md)）
- ✅ **サイネージ表示**: 計測機器ステータス・校正期限アラート表示実装完了（FR-MI-011）

## 関連ドキュメント

- [計測機器管理モジュール](../modules/measuring-instruments/README.md) - モジュール概要
- [計測機器管理UI設計](../modules/measuring-instruments/ui.md) - UI設計メモ
- [計測機器管理API仕様](../modules/measuring-instruments/api.md) - API仕様
- [工具管理モジュール](../modules/tools/README.md) - 工具管理モジュール（併用）
- [システム要件定義](./system-requirements.md) - システム全体の要件定義
- [モジュール構造設計決定](../decisions/001-module-structure.md) - モジュール構造の設計決定
