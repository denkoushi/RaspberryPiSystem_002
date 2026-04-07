# ADR-20260407: サイネージスケジュールの端末別出し分け（targetClientKeys）

**Status**: accepted  
**Context**: 同一時間帯でも端末（`ClientDevice.apiKey`）ごとに異なるサイネージを自動配信したい。既存スケジュールはフィールド未設定相当として全端末向けのまま動かす必要がある。  
**Decision**:
- `SignageSchedule` に `targetClientKeys String[]`（DB 既定: 空配列）を追加する。
- **空配列または未設定 = 全端末向け**。値があるときは列挙された `apiKey` のみ対象。
- `SignageService.getContent({ clientKey })` で、時刻窓・優先度・ローテーションの**前**に上記ルールでスケジュールを絞り込む。`clientKey` 未送信のリクエストでは、端末限定スケジュールは**マッチしない**（匿名はグローバルスケジュールのみ評価）。
- 緊急表示（`SignageEmergency`）は第1段階では従来どおりグローバル（端末別拡張は行わない）。
- レンダリング結果は単一 `current.jpg` に依存せず、`ClientDevice` 一覧の `apiKey` ごとに JPEG を保存する。`ClientDevice` が0件のときのみレガシー `current.jpg` を更新する。
- HTTP: `GET /api/signage/content` は `x-client-key` またはクエリ `clientKey` を受け取る。`GET /api/signage/current-image` は既存の `x-client-key` / `key` で端末別キャッシュを読む。
**Alternatives**: アプリ側のみ出し分け（サーバは単一コンテンツ）→ レンダJPEGが共有できないため却下。スケジュール複製で端末毎にレコードを分ける → 運用負荷が高いため却下。  
**Consequences**:
- マイグレーション必須。管理UIは後続で `targetClientKeys` 編集を載せるまで API/直SQLで設定する運用になり得る。
- `POST /api/signage/render` の応答に `clientKeysRendered` が追加される（後方互換で追加フィールドのみ）。
**References**: `apps/api/prisma/schema.prisma`, `apps/api/src/services/signage/signage.service.ts`, `apps/api/src/lib/signage-render-storage.ts`, `apps/api/src/routes/signage/content.ts`, `apps/api/src/routes/signage/render.ts`
