---
title: 写真撮影持出機能 - モジュール仕様
tags: [工具管理, 写真撮影, カメラ, 持出機能]
audience: [開発者, アーキテクト]
last-verified: 2026-03-29
related: [../requirements/system-requirements.md, ../../decisions/003-camera-module.md, ./README.md]
category: modules
update-frequency: medium
---

# 写真撮影持出機能 - モジュール仕様

## 概要

写真撮影持出機能は、従業員タグのみスキャンで撮影＋持出を記録する機能です。既存の2タグスキャン機能（FR-004）は維持され、新しい持出方法として追加されます。

## 責務

- **写真撮影**: 従業員タグスキャン時にカメラでItemを撮影
- **持出記録**: 従業員IDと写真を保存（Item情報は保存しない）
- **写真管理**: 写真の保存・配信・自動削除
- **表示名付与**: 元画像（既定）またはサムネイルを JPEG 化したうえで非同期 VLM 推論し、短い工具名を `photoToolDisplayName` に保存
- **人レビュー**: ADMIN/MANAGER が VLM 結果を品質（GOOD/MARGINAL/BAD）と任意の表示名で上書き・記録（`photoToolHuman*` 列）
- **類似候補（任意）**: 人レビュー **GOOD** の貸出のみ、pgvector ギャラリーへ埋め込みを非同期インデックス。管理画面で類似候補を参照表示（確定ラベルは自動変更しない）
- **UI表示**: 持出一覧・返却画面で写真サムネイルを表示。1行目の工具名は **人レビュー > VLM > `撮影mode`**

## 機能要件（FR-009）

詳細は [システム要件定義](../../requirements/system-requirements.md#fr-009-写真撮影持出機能新規追加) を参照してください。

### 主要機能

1. **従業員タグスキャンで撮影＋持出**
   - 従業員タグスキャンがシャッターを押す役割も兼ねる
   - スキャン前にItemをカメラの前に置く
   - 撮影失敗時は3回までリトライ、それでも失敗したらエラー（写真は必須）

2. **写真の保存・配信**
   - 写真サイズ: 元画像800x600px（JPEG品質80%）、サムネイル150x150px（JPEG品質70%）
   - 保存先: ラズパイ5の1TB SSD（`/opt/RaspberryPiSystem_002/storage/photos/`）
   - サムネイル: Caddyで静的ファイル配信
   - 元画像: API経由で認証制御

3. **写真の自動削除**
   - 保存期間: 撮影年の2年後の1月中に削除
   - 実行タイミング: 1月中に毎日チェック（cronジョブ）

4. **クライアント端末ごとの初期表示設定**
   - データベース + 管理画面で設定変更可能
   - `ClientDevice`テーブルに`defaultMode`カラムを追加（PHOTO/TAG）

5. **撮影品質の自動検証**
   - フロントエンドで500ms待機＋5フレーム試行（各100ms間隔）を行い、最も明るいフレームを選択
   - **閾値チェックは削除**（2026-02-11、KB-248参照）: 雨天・照明なし環境でも撮影可能にするため、フロントエンド・バックエンドの両方で閾値チェックを削除
   - ストリーム保持によるPi4の負荷問題を回避するため、どんな明るさでも撮影可能にした

6. **非同期 VLM 表示名**
   - 新規の写真持出のみ `Loan.photoToolLabelRequested=true` としてキュー投入
   - Pi5 API の定期ジョブが **Vision 用画像ソース**（既定: 元画像から長辺リサイズした JPEG）を読み、LocalLLM のマルチモーダル推論で**最も目立つ 1 つ**の工具名を短い日本語で取得
   - 取得した表示名は `Loan.photoToolDisplayName` に保存し、**Itemマスタには紐づけない**
   - 推論失敗時はカード表示を従来どおり **`撮影mode`** のままにし、後続ジョブで再試行できるよう claim を解放する

7. **人レビュー（フェーズ1）**
   - 管理画面 **`/admin/photo-loan-label-reviews`**（ルート名 `photo-loan-label-reviews`）から、VLM 済みの写真持出を一覧し、品質と任意の人間表示名を送信する
   - `PATCH /api/tools/loans/:loanId/photo-label-review`（ADMIN/MANAGER）で `photoToolHumanQuality` / `photoToolHumanReviewedAt` / `photoToolHumanReviewedByUserId` / 任意で `photoToolHumanDisplayName` を更新

## データ構造

### Loanテーブルの拡張

（`PhotoToolHumanLabelQuality` は enum: `GOOD` \| `MARGINAL` \| `BAD`）

```prisma
model Loan {
  // ... 既存のカラム
  photoUrl                String?   // 写真のURL（例: /api/storage/photos/2025/11/20251127_123456_employee-uuid.jpg）
  photoTakenAt            DateTime? // 撮影日時
  photoToolDisplayName    String?   // VLM が付与した表示用工具名（Item 非紐づけ）
  photoToolLabelRequested Boolean   @default(false)
  photoToolLabelClaimedAt DateTime? // バッチの claim 時刻（重複実行緩和）
  photoToolHumanDisplayName     String?   // 人レビューで確定した表示名（任意）
  photoToolHumanQuality         PhotoToolHumanLabelQuality? // GOOD | MARGINAL | BAD
  photoToolHumanReviewedAt      DateTime?
  photoToolHumanReviewedByUserId String?
}
```

### ClientDeviceテーブルの拡張

```prisma
model ClientDevice {
  // ... 既存のカラム
  defaultMode  String?   // 'PHOTO' | 'TAG'（デフォルト: 'TAG'）
}
```

## APIエンドポイント

### 写真撮影持出

- `POST /api/tools/loans/photo-borrow` - 従業員タグのみスキャンで撮影＋持出登録
  - **リクエスト**: `{ employeeTagUid: string }`
  - **レスポンス**: `{ loanId: string, employeeId: string, photoUrl: string, photoTakenAt: string }`
  - **エラー**: 撮影失敗時は3回までリトライ、それでも失敗したらエラー

### 写真ラベル・レビュー API（管理者）

- `GET /api/tools/loans/photo-label-reviews` — レビュー待ち一覧（**ADMIN/MANAGER**）
- `PATCH /api/tools/loans/:id/photo-label-review` — 人レビュー送信（**ADMIN/MANAGER**、JWT 必須）
- `GET /api/tools/loans/:id/photo-similar-candidates` — **類似候補（参考表示のみ）**（**ADMIN/MANAGER**）。`PHOTO_TOOL_EMBEDDING_ENABLED=true` かつ埋め込みサービス接続時のみ候補を返し、それ以外は空配列。キオスク・確定ラベルは変更しない。未認証は **401**。
  - **実機スモーク（2026-03-29）**: `./scripts/deploy/verify-phase12-real.sh` が **PASS 34 / WARN 0 / FAIL 0**、上記 GET をトークンなしで叩くと **401**（[KB-319](../../knowledge-base/KB-319-photo-loan-vlm-tool-label.md)）。

### 内部ジョブ（VLM は公開ジョブ API なし）

- 写真持出 VLM ラベル付与は **Pi5 API 内部の定期ジョブ**として実行する
- LocalLLM への接続は既存の `LOCAL_LLM_*` 設定を再利用する

### 写真配信

- `GET /api/storage/photos/:path` - 元画像の配信（認証必要）
  - **パス**: `/api/storage/photos/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}.jpg`
  - **認証**: JWTトークンまたはAPIキーが必要

- `GET /storage/thumbnails/:path` - サムネイルの配信（認証不要、Caddy経由）
  - **パス**: `/storage/thumbnails/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}_thumb.jpg`
  - **配信**: Caddyで静的ファイル配信

### クライアント端末設定

- `GET /api/tools/clients/:id` - クライアント端末情報取得（`defaultMode`を含む）
- `PUT /api/tools/clients/:id` - クライアント端末設定更新（`defaultMode`を変更可能）

## ディレクトリ構造

```
apps/api/src/
├── routes/tools/
│   ├── loans/
│   │   ├── photo-borrow.ts      # POST /api/tools/loans/photo-borrow
│   │   └── ...
│   ├── storage/
│   │   └── photos.ts            # GET /api/storage/photos/:path
│   └── clients/
│       └── update.ts            # PUT /api/tools/clients/:id（defaultMode更新）
├── services/tools/
│   ├── loans/
│   │   └── photo-loan.service.ts  # 写真撮影持出のビジネスロジック
│   ├── photo-tool-label/          # 写真持出 VLM 表示名のジョブ/リポジトリ/正規化
│   └── clients/
│       └── client.service.ts    # クライアント端末設定のビジネスロジック
├── services/camera/
│   ├── camera.service.ts        # 共通カメラサービス
│   └── drivers/                 # カメラドライバー（ADR 003参照）
├── services/vision/
│   └── llama-server-vision-completion.adapter.ts  # LocalLLM VLM アダプタ
└── lib/
    └── photo-storage.ts         # 写真保存・削除のユーティリティ

apps/web/src/
├── pages/
│   ├── photo-borrow/            # 写真撮影持出画面（新規）
│   │   ├── PhotoBorrowPage.tsx
│   │   └── ...
│   └── tools/
│       └── return/
│           └── ReturnPage.tsx   # 返却画面（写真サムネイル表示を追加）
└── api/
    └── photo-loan.ts            # 写真撮影持出APIクライアント
```

## 実装の詳細

### 写真撮影持出フロー

1. **従業員タグスキャン**
   - NFCエージェントから従業員タグUIDを受信
   - WebSocket経由でフロントエンドに送信

2. **写真撮影**
   - フロントエンドが`POST /api/tools/loans/photo-borrow`を呼び出し
   - APIサーバーがカメラサービスを呼び出して撮影（3回までリトライ）
   - 撮影した画像をリサイズ・サムネイル生成

3. **写真保存**
   - 元画像: `/opt/RaspberryPiSystem_002/storage/photos/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}.jpg`
   - サムネイル: `/opt/RaspberryPiSystem_002/storage/thumbnails/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}_thumb.jpg`

4. **持出記録作成**
   - `Loan`テーブルにレコードを作成（`itemId=NULL`, `employeeId=特定した従業員ID`, `photoUrl=写真URL`）
   - 新規行は `photoToolLabelRequested=true` とし、非同期 VLM ラベル対象にする

### 非同期 VLM ラベル付与フロー

1. **定期ジョブ**
   - `PHOTO_TOOL_LABEL_CRON`（既定 `*/5 * * * *`）で起動
   - 1回あたり `PHOTO_TOOL_LABEL_BATCH_SIZE`（既定 3）件までを**直列**処理

2. **対象の取得**
   - `photoToolLabelRequested=true`
   - `photoToolDisplayName IS NULL`
   - `photoToolLabelClaimedAt IS NULL`

3. **推論**
   - `photoUrl` から Vision 用バイト列を読み込む（`PhotoToolVisionImageSourcePort`。**既定**は元画像を長辺 `PHOTO_TOOL_LABEL_VISION_MAX_LONG_EDGE` 程度に縮小した JPEG。`PHOTO_TOOL_LABEL_VISION_SOURCE=thumbnail` のときのみ従来どおりサムネのみ）
   - LocalLLM の OpenAI 互換 `/v1/chat/completions` に `image_url + text` のマルチモーダル payload を送る
   - プロンプトは環境変数 `PHOTO_TOOL_LABEL_USER_PROMPT` があればそれを使用、なければ既定（最も目立つ工具を 1 つ、日本語の短い工具名）

4. **保存と失敗時の扱い**
   - 応答は前後空白・改行除去、最大48文字に正規化して `photoToolDisplayName` に保存
   - 空応答や推論失敗時は表示名を保存せず `photoToolLabelClaimedAt` を解除する
   - 一定時間スタックした claim は `PHOTO_TOOL_LABEL_STALE_MINUTES`（既定 30）超で次回ジョブが解放する

### 表示優先順位

- キオスク持出一覧・サイネージの写真持出カードの1行目は、共有関数 **`resolvePhotoLoanToolDisplayLabel`**（`@raspi-system/shared-types`）に従う
- **優先順**: `photoToolHumanDisplayName`（非空） → `photoToolDisplayName`（VLM） → **`撮影mode`**

### 環境変数

- LocalLLM 共有設定: `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_SHARED_TOKEN` / `LOCAL_LLM_MODEL` / `LOCAL_LLM_TIMEOUT_MS`
- 写真持出 VLM ジョブ設定:
  - `PHOTO_TOOL_LABEL_CRON`
  - `PHOTO_TOOL_LABEL_BATCH_SIZE`
  - `PHOTO_TOOL_LABEL_STALE_MINUTES`
  - `PHOTO_TOOL_LABEL_VISION_SOURCE`（`original` | `thumbnail`、既定 `original`）
  - `PHOTO_TOOL_LABEL_VISION_MAX_LONG_EDGE`（既定 768）
  - `PHOTO_TOOL_LABEL_VISION_JPEG_QUALITY`（既定 85）
  - `PHOTO_TOOL_LABEL_USER_PROMPT`（任意・未設定時はサーバー既定プロンプト）

### 写真自動削除フロー

1. **cronジョブ設定**
   - 毎日深夜に実行（例: `0 2 * * *`）
   - 1月中のみ実行（例: `0 2 * 1 *`）

2. **削除対象の判定**
   - 撮影年の2年後のデータを削除
   - 例: 2025年のデータは2027年1月中に削除

3. **削除処理**
   - ファイルシステムから写真ファイルを削除
   - データベースの`Loan`テーブルの`photoUrl`をNULLに更新（またはレコードを削除）

### クライアント端末の初期表示設定

1. **データベース設定**
   - `ClientDevice`テーブルの`defaultMode`カラムで設定
   - `PHOTO`: 写真撮影持出画面を初期表示
   - `TAG`: 既存の2タグスキャン画面を初期表示（デフォルト）

2. **管理画面での設定変更**
   - 管理コンソールから各クライアント端末の`defaultMode`を変更可能
   - `PUT /api/tools/clients/:id`エンドポイントを使用

3. **フロントエンドでの初期表示**
   - クライアント端末の`defaultMode`に応じて初期画面を決定
   - `/api/kiosk/config`エンドポイントから`defaultMode`を取得

## カメラ機能のモジュール化

カメラ機能のモジュール化については [ADR 003](../../decisions/003-camera-module.md) を参照してください。

## テスト計画

詳細なテスト計画は [写真撮影持出機能 テスト計画](../../guides/photo-loan-test-plan.md) を参照してください。

## 関連ドキュメント

- [システム要件定義](../../requirements/system-requirements.md): FR-009（写真撮影持出機能）
- [ADR 003: カメラ機能のモジュール化](../../decisions/003-camera-module.md)
- [工具管理モジュール](./README.md): モジュール全体の概要
- [写真撮影持出機能 テスト計画](../../guides/photo-loan-test-plan.md): 詳細なテスト計画
- [検証チェックリスト](../../guides/verification-checklist.md): Validation 9（写真撮影持出）
- [KB-319](../../knowledge-base/KB-319-photo-loan-vlm-tool-label.md): 写真持出 VLM ラベルの運用・実機確認
- [LocalLLM Runbook](../../runbooks/local-llm-tailscale-sidecar.md): LocalLLM 側の疎通確認・運用

## 実装ステータス

- ✅ **実装完了**: 写真撮影持出の基本機能は 2025-11-27 完了、VLM 表示名（初版）は 2026-03-28 に実装完了
- ✅ **実機検証完了**: Raspberry Pi 5 + Raspberry Pi 4での統合動作確認完了（2025-12-01）
- ✅ **VLM 実機確認**: Pi5 本番で `Loan.photoToolDisplayName` への保存を確認済み（詳細は KB-319）
- ✅ **フェーズ1（2026-03-29）**: 人レビュー列・管理 API・Vision 高解像入力・表示統一を本番にデプロイし、DB 列・`health`・未認証 401・Phase12 実機スクリプト **PASS 34/0/0** を確認（KB-319 フェーズ1節）
- ⏳ **既知の問題**: スキャン重複と黒画像の問題が報告されており、詳細調査・対策計画を作成中
  - 詳細は [キオスク工具スキャン重複＆黒画像対策 ExecPlan](../../plans/tool-management-debug-execplan.md) を参照

