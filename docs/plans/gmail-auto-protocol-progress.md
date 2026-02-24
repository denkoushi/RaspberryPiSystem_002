# Gmail自動運用プロトコル 解決策1〜4 進捗

段階的に開発しシステムを破壊しないため、以下の4案を優先順位どおりに実装する方針で進めた。**現時点で4つとも実装済み・実機デプロイ済み**。

---

## 解決策1: スケジュールの開始時刻をずらす（同時発火回避）

| 項目 | 状態 | 備考 |
|------|------|------|
| 実装 | ✅ 完了 | 2026-02-16 復旧作業で適用、以降維持 |
| デプロイ | ✅ 完了 | 2026-02-16 復旧時デプロイ（Pi5+Pi4）。cron分散設定を backup.json に反映しデプロイ済み |
| 運用 | 設定ファイル/管理画面でcronを分散 |

**内容**:
- `csv-import-measuringinstrumentloans`: `15,25,35,45,55` 分
- `csv-import-productionschedule_mishima_grinding`: `18,28,38,48,58` 分
- `csv-import-加工機_日常点検結果`: `21,31,41,51` 分（日曜含む `0,1,2,3,4,5,6`）

**参照**: [KB-216（Gmail API 429）](../knowledge-base/api.md#kb-216-gmail-apiレート制限エラー429の対処方法)、[CSVインポートガイド](../guides/csv-import-export.md)

---

## 解決策2: 429を踏んだら自動的に待機時間を延長（再突入防止）

| 項目 | 状態 | 備考 |
|------|------|------|
| 実装 | ✅ 完了 | フェーズ1で実装・実機検証済み |
| デプロイ | ✅ 完了 | フェーズ1としてPi5にデプロイ済み。2026-02-24 実機検証で429クールダウン・GmailRateLimitState 動作確認 |

**内容**:
- 1回目: 15分待機
- 2回目（解除直後30分以内に再429）: 60分待機
- 3回目: 180分待機
- 4回目: 720分待機

**実装**:
- `GmailCooldownStateMachine`: `LEVEL_WINDOWS_MS = [15min, 60min, 180min, 720min]`、`ESCALATE_WINDOW_MS = 30min`
- `GmailRequestGateService`: 429時に上記状態機械で `effectiveRetryAfterMs` を決定し、`GmailRateLimitState` に `cooldownUntil` を永続化。cooldown中は実リクエストを投げず defer

**参照**: [gmail-cooldown-state-machine.ts](../../apps/api/src/services/backup/gmail-cooldown-state-machine.ts)、[フェーズ1実機検証](../guides/gmail-auto-protocol-phase1-verification.md)

---

## 解決策3: メッセージ検索を1回に統合（処理能力向上）

| 項目 | 状態 | 備考 |
|------|------|------|
| 実装 | ✅ 完了 | フェーズ2で実装・テスト追加・デプロイ済み |
| デプロイ | ✅ 完了 | 2026-02-24 Pi5デプロイ（Run ID `20260224-084216-12664`）に含まれる |

**内容**:
- 3つのスケジュールが個別に `messages.list` を呼ぶのではなく、**1回の検索で複数件名をまとめて取得**（OR条件）
- 取得したメッセージを**件名で振り分け**

**実装**:
- `GmailStorageProvider.downloadAllBySubjectPatterns(subjectPatterns)`: 1回の `searchMessagesLimited(query, effectiveBatchSize)` で取得し、件名パターンごとにグループ化して返す
- `GmailUnifiedMailboxFetcher.fetchBySubjectPatterns(provider, subjectPatterns)`: 上記をラップ
- `CsvDashboardImportService.ingestTargets`: Gmail かつ `downloadAllBySubjectPatterns` 対応プロバイダの場合、全ダッシュボードの件名パターンを集約して `fetchBySubjectPatterns` を1回だけ呼び、`unifiedResultsByPattern` を各ダッシュボードで再利用

**参照**: [gmail-storage.provider.ts](../../apps/api/src/services/backup/storage/gmail-storage.provider.ts)、[csv-dashboard-import.service.ts](../../apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts)

---

## 解決策4: 処理件数を自動調整（バックログ対応）

| 項目 | 状態 | 備考 |
|------|------|------|
| 実装 | ✅ 完了 | AIMD方式で429時半減・成功時緩やかに増加 |
| デプロイ | ✅ 完了 | 2026-02-22 Pi5デプロイ（runId `20260222-111603-30625`）以降のAPIイメージに含まれる（gmail-storage.provider 経由） |

**内容（当初案）**:
- 未読が少ない時: 10件/回
- 未読が多い時: 20件/回（429を踏まない範囲で）
- 429を踏んだら: 処理件数を50%減らす

**実装（AdaptiveRateController）**:
- 初期: `GMAIL_MAX_MESSAGES_PER_BATCH` または 10、最大 20
- **成功が3回続く**ごとにバッチサイズ +1（Additive Increase）
- **429時**はバッチサイズを半減（Multiplicative Decrease）、最小1
- 未読数は直接参照せず、成功/429の履歴で間接的にバックログ対応

**参照**: [adaptive-rate-controller.ts](../../apps/api/src/services/backup/adaptive-rate-controller.ts)、[gmail-storage.provider.ts](../../apps/api/src/services/backup/storage/gmail-storage.provider.ts)（`effectiveBatchSize`）

---

## まとめ

| 解決策 | 優先順位 | 実装 | デプロイ | 主な実装箇所 |
|--------|----------|------|----------|--------------|
| 1. 開始時刻ずらし | 1 | ✅ 完了 | ✅ 完了（2026-02-16 Pi5+Pi4） | backup.json / スケジュール設定 |
| 2. 429時待機延長 | 2 | ✅ 完了 | ✅ 完了（フェーズ1・2026-02-24実機検証済み） | GmailCooldownStateMachine, GmailRequestGateService |
| 3. 検索1回統合 | 3 | ✅ 完了 | ✅ 完了（2026-02-24 Pi5） | downloadAllBySubjectPatterns, CsvDashboardImportService |
| 4. 処理件数自動調整 | 4 | ✅ 完了 | ✅ 完了（2026-02-22 以降 Pi5） | AdaptiveRateController |

**次のフォローアップ**（任意）: [EXEC_PLAN.md](../../EXEC_PLAN.md) の「Gmail自動運用プロトコル（フェーズ2以降の検証・改善）」を参照（429解消後の正常系確認、統合フェッチの実機確認、SSHによる詳細検証など）。
