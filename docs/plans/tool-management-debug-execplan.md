# キオスク工具スキャン重複＆黒画像対策 ExecPlan

このExecPlanは `.agent/PLANS.md` の方針に従い、実装前の調査・設計・検証手順を完全自走できるよう自律的に更新される生きたドキュメントとして維持する。

**役割**: このExecPlanは、[EXEC_PLAN.md](../../EXEC_PLAN.md) で記録されている「既知の問題」（スキャン重複と黒画像）の詳細調査・対策設計を担当する。EXEC_PLAN.mdはプロジェクト全体の進捗管理とマイルストーン記録を、このExecPlanは特定問題の技術的深掘りと実装前設計を担当する。

## Purpose / Big Picture

ラズパイ4キオスクで発生している  
1. **NFCタグを1回しか読んでいないのに1〜2件の貸出が勝手に追加される**  
2. **写真撮影持出のサムネイルが真っ黒になる**  
という運用上の致命的不具合を根治させる。  
この計画が完了すると、WebSocket瞬断やカメラの不安定さに左右されず、1スキャン=1記録、かつ視認可能なサムネイルが保証される。ユーザーは `/kiosk/photo` で通常通りスキャンすれば、同一イベントが重複登録されず、暗転写真も自動再撮影または即時エラー表示されることを確認できる。

## Progress

- [x] (2025-12-04T02:40Z) 現状調査：NFCエージェントのキュー処理とフロント重複判定、カメラ撮影フローの実装を分析して問題点を整理。
- [x] (2025-12-04T03:05Z) 調査タスクA：イベントIDをSQLiteの挿入IDとしてpayloadに含め、ブラウザは`sessionStorage`に最新IDを保持して再接続時も重複排除できる設計を確定。
- [x] (2025-12-04T03:15Z) 調査タスクB：平均輝度しきい値（デフォルト18）を前後双方で検証する設計とテスト手順（明示的に暗所で撮影→422が返ることを確認）を策定。
- [x] (2025-12-04T03:50Z) 実装ステップ1-2：ローカル環境でNFCエージェント・フロント・APIを実装、テスト、コミット（実機デプロイは未実施）。
- [x] (2025-12-04T10:16Z) ローカル検証: `PHOTO_STORAGE_DIR=/tmp/test-photo-storage ... pnpm --filter api test -- photo-borrow.integration.test.ts` がパス。`apps/web/src/hooks/useNfcStream.ts`, `src/utils/camera.ts` への ESLint も通過を確認。
- [ ] 実装ステップ3：Ansibleデプロイと実機検証（ユーザー許可後に実施）。

## Surprises & Discoveries

- 観測: `sharp().stats()` の `channel.mean` は0-255スケールで提供されるため、閾値18前後で暗転画像を確実に識別できる。  
  エビデンス: 真っ黒な10x10 JPEGを生成してAPIへ送る統合テストを追加したところ、平均輝度 ≈0.0 で422が返却されることを確認。
- 観測: JPEG生成時の `stats.channels` は `name` プロパティを持たないことがあり、単純に `['red','green','blue']` フィルタをかけると配列が空になり平均輝度が0と判定される。  
  対応: RGBチャネルが特定できない場合は `stats.channels.slice(0,3)` を用いて平均値を算出するフォールバックを実装。

## Decision Log

- Decision: 調査と設計を「重複スキャン対策」「黒画像対策」の2本立てで進め、実装はユーザー承認後に着手する。
  Rationale: それぞれ原因系統が独立しており、検証観点も別で整理した方が再現確認と将来の調整が容易なため。
  Date/Author: 2025-12-04 / GPT-5.1 Codex

## Outcomes & Retrospective

- (未記入) — 調査完了時や実装完了時に成果・残課題を記載。

## Context and Orientation

- **NFCイベント経路**: `clients/nfc-agent` がタグを検出 → SQLiteキューへ保存 → `/stream` WebSocket経由で `apps/web` の `useNfcStream` に配送。キュー削除は配送成功フラグ頼り。
- **フロント処理**: `/kiosk/photo` では `KioskPhotoBorrowPage` が `useNfcStream` を購読し、3秒以内の同一UIDを `processedUidsRef` で排除するが、WebSocket再接続時にリセットされるため再送イベントを弾けない。
- **写真撮影**: `captureAndCompressPhoto` がストリーム取得→100ms待機→`canvas.toBlob`→Base64化→POST `/api/tools/loans/photo-borrow`。露光失敗やレンズキャップなどの真っ黒画像でもそのまま保存される。
- **サーバ側処理**: `LoanService.photoBorrow` が Sharp で再圧縮＆サムネ生成。画像の内容チェックなし。

**関連ドキュメント**:
- [工具管理モジュール概要](../modules/tools/README.md) - モジュール全体の概要と責務
- [写真撮影持出機能 モジュール仕様](../modules/tools/photo-loan.md) - 写真撮影持出機能の詳細仕様
- [工具管理運用・保守ガイド](../modules/tools/operations.md) - 運用上の問題と対処方法（既知の問題として本ExecPlanへの参照あり）
- [EXEC_PLAN.md](../../EXEC_PLAN.md) - プロジェクト全体の進捗管理（既知の問題として本ExecPlanへの参照あり）

## Plan of Work

1. **イベント重複対策の詳細設計**
   - (A1) NFCエージェント送出イベントに一意IDを含める（SQLite `id` を payload の `eventId` として付与）＋ブラウザは `sessionStorage` に最新IDを永続化する方式を採用。  
   - (A2) タイムスタンプ鮮度チェックは補助的とし、主要な重複排除は `eventId` の単調増加比較で実装。  
   - (A3) イベントキュー監視・可視化（`queueSize` を status-agent で収集、または管理画面に警告）を行う際のログ仕様を定義。
2. **黒画像対策の詳細設計**
   - (B1) フロント側：`capturePhotoFromStream` で `ImageData` の平均輝度を測定し、閾値未満ならエラーを投げて `captureAndCompressPhoto` のリトライを活用。  
   - (B2) サーバ側：`LoanService.photoBorrow` 内で `sharp(image).stats()` を用いた輝度検証と 422 エラー応答の仕様化（しきい値は `CAMERA_MIN_MEAN_LUMA` で調整）。  
   - (B3) UI・APIエラーメッセージでユーザー／運用者に明示し、ログにも残す。
3. **検証計画**
   - (C1) NFCエージェントを手動で再起動・WebSocketを切断し、同一UIDが二度処理されないことを実機で記録するシナリオを作成。  
   - (C2) 暗室やレンズ隠しで黒画像を再現し、フロントリトライとサーバ側バリデーションが期待通り動作することを確認するシナリオを定義。
4. **ユーザー承認待ち**: 実機デプロイ（Ansible実行）はユーザー許可後に実施。

## Concrete Steps

1. **イベント重複調査**  
   - `cd /opt/RaspberryPiSystem_002/clients/nfc-agent && sqlite3 data/nfc-agent-queue.db "select * from queued_events"` でキュー残量を確認。  
   - `curl http://localhost:7071/api/agent/status` で `queueSize` と `lastEvent` を取得し、WebSocket切断→再接続時の挙動を記録。
2. **黒画像再現試験**  
   - `/kiosk/photo` で従業員タグをスキャンし、カメラ前を遮光して撮影。`storage/photos` に生成された JPEG をダウンロードし、ヒストグラムを確認（平均輝度が閾値未満か測定）。
3. **設計レビュー資料化**  
   - 調査ログ・スクリーンショット・`console.log` 出力・APIレスポンスを `docs/progress/` か該当KBに追記する草案を作成し、ユーザーへ説明。

※ 現段階はローカル実装・テストまで完了。Ansibleによる実機更新はユーザーの最終許可後に実施する。

## Validation and Acceptance

- **重複対策**: WebSocketを数回切断（ブラウザF12 → Disable/Enable network、または簡易プロキシで遮断）しても、同じUIDで `photoBorrow` API が複数回呼ばれないことを `apps/web` の console log と API ログで確認。  
- **黒画像対策**: 1) 暗室撮影時にフロントが自動リトライし、最終的に成功 or 明示的エラー表示となる。2) それでも真っ黒データが送られた場合にAPIが422で拒否するログが記録される。  
- **ログ証跡**: `clients/nfc-agent` ログと `apps/api` ログに、各新ロジックが動作した旨のメッセージが残ること。

## Idempotence and Recovery

- 調査で実行するコマンドは情報取得のみ（SELECT / curl / ログ閲覧）で副作用はない。  
- WebSocket切断テストはブラウザ側操作のみで再試行可能。  
- 写真撮影テストで生成された黒画像は `storage/photos` から削除してクリーンアップする手順を必ず実施。

## Artifacts and Notes

- 取得予定の証跡:  
  - `curl /api/agent/status` 出力  
  - `sqlite3 queued_events` ダンプ  
  - `apps/web` console log（イベントID/鮮度判定の挙動）  
  - 黒画像のヒストグラム結果  
  - 422 応答例（設計後に期待されるフォーマットのドラフト）

## Interfaces and Dependencies

- **NFCエージェント** (`clients/nfc-agent`):  
  - 主要クラス: `QueueStore`, `WebSocketManager`, `ResendWorker`, `ReaderService`.  
  - 追加予定フィールド: `event_id`（SQLite `queued_events.id`）を WebSocket payload に含める。  
  - 依存: `sqlite3`, `fastapi`, `uvicorn`, `smartcard`.
- **フロントエンド** (`apps/web`):  
  - 関連ファイル: `hooks/useNfcStream.ts`, `pages/kiosk/KioskPhotoBorrowPage.tsx`, `pages/kiosk/KioskBorrowPage.tsx`, `utils/camera.ts`.  
  - 追加予定: イベント鮮度判定・`sessionStorage` 永続化・フレーム輝度チェック。
- **バックエンドAPI** (`apps/api`):  
  - 関連ファイル: `services/tools/loan.service.ts`, `lib/photo-storage.ts`.  
  - 追加予定: Sharp `stats()` による輝度判定と 422 レスポンス、ログ出力追加。

---

### 更新履歴
- 2025-12-04: 新規作成（調査開始のため）。理由: ユーザー要望により実装前の詳細計画を提示する必要があるため。

