---
title: Alerts Platform Phase2（DB化・配送状態・重複抑制・再送）
tags: [alerts, slack, 通知, 運用, 設計]
audience: [運用者, 開発者]
last-updated: 2026-01-18
category: plans
---

# Alerts Platform Phase2（DB化・配送状態・重複抑制・再送）

## 背景 / 目的

Phase1（実装済み）で、`alerts/alert-*.json` を一次情報として残しつつ、API側の `AlertsDispatcher` が Slackへ配送する「B1」方針を導入した。

Phase2では以下を満たすために、**配送状態・重複抑制・再送**をDB中心に堅牢化する。

- Slackは「通知」に専念し、一次情報（証跡/検索）はDBに残す
- 通知用途が増えても、設定とルーティングの追加だけでスケールする
- Slack障害/ネットワーク障害時でも、確実に再送できる
- 同一事象の連続通知を抑制（dedupe）し、運用ノイズを減らす

## 現状（Phase1の構造）

- scripts（Producer）:
  - `scripts/generate-alert.sh` が `alerts/alert-*.json` を生成（一次情報）
- API（Dispatcher）:
  - `apps/api/src/services/alerts/alerts-dispatcher.ts` が `alerts/` を走査し Slackへ送信
  - 送達状態は alert JSON に `deliveries.slack.<routeKey>` として書き戻す（暫定）

Phase2では「送達状態をファイルに書く」のをやめ、DBに集約する。

## Phase2のゴール

- **Alertイベント**をDBに永続化（検索/可視化/相関が可能）
- **Delivery（配送状態）**をDBで管理（pending/sent/failed/suppressed）
- **dedupe（重複抑制）**をDBで実装（fingerprint + window）
- **再送（retry/backoff）**をDispatcherがDBキューとして処理
- 既存の管理画面・既存のalertsファイル運用を壊さない（段階移行）

## Phase2初回実装スコープ（2026-01-18実装完了）

Phase2の初回実装では、以下の範囲で実装を完了：

- ✅ **Ingest（ファイル→DB取り込み）**: `alerts/alert-*.json` をDBへ永続化する機能を追加
- ✅ **Prismaスキーマ追加**: `Alert`/`AlertDelivery`モデルとenumを追加
- ✅ **API互換性**: `GET /clients/alerts` にDB alertsを追加、`POST /clients/alerts/:id/acknowledge` でDB側もack対応
- ⏳ **dedupe**: 初期は無し（まずDB永続化・互換を安定化）
- ⏳ **Slack配送**: Phase1のファイルベースDispatcherを継続（DB版Dispatcherは後続実装）

**環境変数**:
- `ALERTS_DB_INGEST_ENABLED` (default: false) - DB取り込みを有効化
- `ALERTS_DB_INGEST_INTERVAL_SECONDS` (default: 60) - 取り込み間隔
- `ALERTS_DB_INGEST_LIMIT` (default: 50) - 1回の取り込み上限

**注意事項**:
- DB取り込み機能はデフォルトOFF（明示的に有効化した場合のみ動作）
- 既存のファイルベースアラート取得/ack機能は維持（移行期の互換性）

## 実機検証結果（2026-01-18）

Phase2初回実装の実機検証をPi5で実施し、以下の結果を確認：

### ✅ 検証完了項目

1. **DB取り込み（Ingest）**
   - 52件のアラートがDBに取り込まれていることを確認
   - AlertsIngestorが60秒間隔で正常に動作していることを確認
   - テストアラート（`20260118-test-001`）がDBに取り込まれることを確認

2. **AlertDelivery作成**
   - 49件のAlertDeliveryがPENDING状態で作成されていることを確認
   - テストアラートのAlertDeliveryも正常に作成されることを確認

3. **ファイル→DBのack更新**
   - ファイル側の`acknowledged=true`がDB側にも反映されることを確認
   - 次の取り込みサイクルで`acknowledgedAt`が更新されることを確認

4. **エラーログ改善**
   - 空ファイル（0バイト）や壊れたJSONを`errors`ではなく`skipped`として扱う改善を実装
   - デプロイ後、`errors:2` → `errors:0`、`skipped:2` に改善されることを確認
   - ログノイズが削減され、安定性が向上

5. **API実装確認**
   - `GET /api/clients/alerts` でDBアラート取得の実装を確認
   - `POST /api/clients/alerts/:id/acknowledge` でDB側ack更新の実装を確認
   - 認証が必要なエンドポイントのため、実機でのHTTP検証は未実施（実装コードは確認済み）

### ⏳ 未検証項目（後続実装）

- **API経由のHTTP検証**: 認証トークンが必要なため、実機でのHTTP検証は未実施（実装コードは確認済み）
- **dedupe（重複抑制）**: Phase2初期では未実装
- **DB版Slack配送**: Phase1のファイルベースDispatcherを継続（DB版Dispatcherは後続実装）

## Phase2後続実装スコープ（DB→Slack配送 + dedupe + retry/backoff）

Phase2後続では、Slack配送を **DB中心**（`AlertDelivery`キュー）へ移行し、配送状態・重複抑制・再送を堅牢化する。

### ✅ 実装内容（後続）

- **DB版Dispatcher**: `AlertDelivery(status=pending|failed, nextAttemptAt<=now)` を取得してSlackへ配送
- **dedupe**: `fingerprint + routeKey + windowSeconds` により連続通知を抑制し、`suppressed` に遷移
  - windowSecondsは **routeKey別**（未設定はデフォルト10分）
- **retry/backoff**: 失敗時は `failed` にし、指数バックオフで `nextAttemptAt` を設定（上限あり）
- **Phase1停止（full switch）**: `alerts/` 走査＋ファイルへのdelivery書き戻しは停止し、DB中心へ完全移行
  - ロールバック用に `ALERTS_DISPATCHER_MODE=file|db` を用意（安全策）

### 設定（env / JSON config）

- **切替モード**: `ALERTS_DISPATCHER_MODE`（`file` or `db`）
- **DB版Dispatcher**:
  - `ALERTS_DB_DISPATCHER_ENABLED`（default: false）
  - `ALERTS_DB_DISPATCHER_INTERVAL_SECONDS`（default: 30）
  - `ALERTS_DB_DISPATCHER_BATCH_SIZE`（default: 50）
  - `ALERTS_DB_DISPATCHER_CLAIM_LEASE_SECONDS`（default: 120）
- **dedupe**:
  - `ALERTS_DEDUPE_ENABLED`（default: true）
  - `ALERTS_DEDUPE_DEFAULT_WINDOW_SECONDS`（default: 600）
  - `ALERTS_DEDUPE_WINDOW_SECONDS_DEPLOY|OPS|SUPPORT|SECURITY`（routeKey別window）

### 実機検証結果（2026-01-18）

Phase2後続実装の実機検証をPi5で実施し、以下の結果を確認：

#### ✅ 検証完了項目

1. **DB版Dispatcher起動**
   - `AlertsDbDispatcher`が正常に起動（intervalSeconds: 30, batchSize: 50）
   - Phase1（file）Dispatcherは停止（mode=dbのため）

2. **配送処理**
   - 1回目: 50件処理 → 10件SENT、40件SUPPRESSED
   - 2回目: 5件処理 → 0件SENT、5件SUPPRESSED（dedupeで抑制）

3. **dedupe動作**
   - 同一fingerprintのアラートが正しく抑制されている
   - 同一fingerprint（`587fef4fe...`）が45件あり、すべてSUPPRESSED
   - windowSeconds（600秒）が正しく機能

4. **fingerprint自動計算**
   - 55件中54件にfingerprintが設定されている
   - 未設定のアラートも自動計算されている

5. **状態遷移**
   - `PENDING` → `SENT`（10件）
   - `PENDING` → `SUPPRESSED`（45件、dedupe/acknowledged/too old）

6. **Phase1停止確認**
   - Phase1（file）Dispatcherは動作していない（mode=dbのため）

#### 検証結果サマリー

```
DB版Dispatcher: ✅ 正常動作
配送処理: ✅ 10件SENT、45件SUPPRESSED
dedupe: ✅ 同一fingerprintで正しく抑制
fingerprint計算: ✅ 54/55件に設定済み
Phase1停止: ✅ fileモードは動作していない
```

詳細は [`docs/knowledge-base/infrastructure/ansible-deployment.md#kb-174`](../knowledge-base/infrastructure/ansible-deployment.md#kb-174-alerts-platform-phase2後続実装db版dispatcher-dedupe-retrybackoffの実機検証完了) を参照。

## Phase2完全移行（DB中心運用）

Phase2後続実装完了後、API/UIをDBのみ参照に完全移行した（2026-01-18実装完了）。

### 完全移行の定義

- **API/UIはDBのみを参照**: `alerts/alert-*.json` を `apps/api` のHTTPルートや `apps/web` が直接読まない
- **ackはDBのみ**: `/clients/alerts/:id/acknowledge` はDB更新のみ実施し、ファイルは変更しない
- **Slack配送はDBキューのみ（通常運用）**: `AlertsDbDispatcher` が `AlertDelivery` を処理する
- **Phase1はロールバック手段としてコードは残す**（ただし通常は使わない）

### 実装内容（完全移行）

1. **API: `/clients/alerts` をDBのみ参照に切替**
   - ファイル走査（`fs.readdir/readFile`）ブロックを撤去
   - `prisma.alert.findMany(...)` の結果（`dbAlerts`）を一次表示対象にする
   - `alerts.fileAlerts` と `details.fileAlerts` は **常に 0 / []** を返す（互換フィールドとして残す・deprecated扱い）
   - `hasAlerts` は `staleClients || errorLogs || dbAlerts.length` で判定

2. **API: `/clients/alerts/:id/acknowledge` をDBのみ更新に切替**
   - ファイル探索・`acknowledged=true` 書き込み処理を撤去
   - DB側のみ `Alert.acknowledged=true, acknowledgedAt=now` を更新
   - レスポンスは `acknowledgedInDb:true` のみ返す（`acknowledgedInFile` フィールドは削除）

3. **Web: 管理ダッシュボードの表示をDB alertsへ切替**
   - `ClientAlerts` 型に `dbAlerts`（配列）を追加し、`fileAlerts` はdeprecated（空）として扱う
   - `DashboardPage` は `details.dbAlerts` を表示（severity表示など必要最小限）
   - 「確認済み」ボタンは既存の `acknowledgeAlert` を継続利用

4. **Ansible環境変数の永続化**
   - `infrastructure/ansible/templates/docker.env.j2` に以下を追加:
     - `ALERTS_DISPATCHER_MODE`（通常: `db`）
     - `ALERTS_DB_DISPATCHER_ENABLED`（通常: `true`）
     - `ALERTS_DB_INGEST_ENABLED`（通常: `true`）
   - 変数は `group_vars` / `host_vars` / `vault` で管理（機密はvault）

### ロールバック方針

- Slack配送だけを戻したい場合:
  - `ALERTS_DISPATCHER_MODE=file` + `ALERTS_DISPATCHER_ENABLED=true`（Phase1）
- 注意:
  - **UI/APIはDB参照のまま**（今回の完全移行の定義）
  - Phase1 dispatcher はファイルへ delivery 状態を書き戻す挙動が残る点は「非常時のみ許容」として明記

### ファイルの役割（完全移行後）

- **一次入力（Producer）**: scriptsが `alerts/alert-*.json` を生成（従来通り）
- **Ingest専用**: `AlertsIngestor` が `alerts/` → DB に取り込み（Phase2継続）
- **API/UIは参照しない**: HTTPルートやWeb UIはDBのみ参照

## データモデル案（Prisma）

### 1) Alert（一次情報）

- `id`: string（uuid 推奨。既存ファイルIDは互換として保持）
- `type`: string（例: `ansible-update-failed`）
- `severity`: enum（info/warning/error/critical）
- `message`: string
- `details`: Json?（stringも許容して良いが、Json推奨）
- `source`: Json?（service/host/location 等）
- `context`: Json?（branch/inventory/requestId/hosts 等）
- `fingerprint`: string?（dedupe用。無ければ type+message+host 等から計算）
- `timestamp`: DateTime（発生時刻）
- `acknowledged`: boolean（既存仕様互換）
- `acknowledgedAt`: DateTime?

### 2) AlertDelivery（配送状態）

- `id`: string（uuid）
- `alertId`: FK
- `channel`: enum（slack/email/http… 将来拡張）
- `routeKey`: string（deploy/ops/support/security…）
- `status`: enum（pending/sent/failed/suppressed）
- `attemptCount`: int
- `nextAttemptAt`: DateTime?（バックオフ）
- `lastAttemptAt`: DateTime?
- `sentAt`: DateTime?
- `lastError`: string?

### 3) AlertDedupe（重複抑制）

運用上は「同一fingerprintをwindow内は抑制」が多い。

案A（AlertDeliveryに内包）:
- Dispatcherが `fingerprint` + `routeKey` で直近sentを検索し、window内なら suppressed とする

案B（専用テーブル）:
- `fingerprint`, `routeKey`, `lastSentAt` を保持して高速判定

Phase2初期は **案A** が実装簡単で十分。

## ルーティング/設定（継続）

Phase1の `ALERTS_CONFIG_PATH` を拡張して、DB運用時も同一設定でルーティングできるようにする。

- `routes`: typePrefix/severity/source → routeKey
- `sinks.slack.webhooks`: routeKey → webhookUrl（Vault管理）
- `dedupe.windowSeconds`: routeKey別に持てると理想

## Dispatcherの動作（DB中心）

### 1) Ingest（ファイル→DB）

移行期間は alertsファイルも発生源として残るため、API側で以下を行う：

- `alerts/` を走査し、未取り込みのファイルをDBへ取り込む
  - 取り込み済み判定: `id` で一意化（既存ファイルIDを `Alert.id` として採用するのが簡単）
- 取り込み時に `AlertDelivery(status=pending)` を作る

最終的には scriptsもAPI経由でAlert作成に寄せる（Phase3候補）が、Phase2では「ファイル取り込み」で十分。

### 2) Dispatch（DB→Slack）

- `AlertDelivery.status=pending` かつ `nextAttemptAt <= now` を取得
- `dedupe` 判定（fingerprint + window）で抑制する場合は `suppressed` にする
- Slack送信成功 → `sent`
- 失敗 → `failed` + `nextAttemptAt` をバックオフで設定

## 既存API/UIとの互換（重要）

現在 `/clients/alerts` は `alerts/` を読んで返している。

Phase2では段階的に：

1. `/clients/alerts` の結果に「DB alerts」を追加（またはDB優先）
2. `acknowledge` はDBを正とし、必要ならファイルにも反映（移行期のみ）
3. 最終的にファイル読み取りを削除（十分に移行できた後）

## 移行手順（安全優先）

1. Prisma schema追加（Alert/AlertDelivery）
2. migrate deploy（Pi5）
3. APIに Ingest + Dispatch（DB版）を追加（ただし “read-only mode” でログだけ出すオプションを最初に用意しても良い）
4. 既存 `alerts/` をバックフィル（最新N件から）
5. 本番で Slack配送をDB版へ切替（段階的に routeKey 単位で有効化可能に）
6. 安定後、Phase1の「ファイルへdeliveriesを書き戻し」を停止（互換不要になったら）

## テスト計画（Phase2）

- Unit:
  - fingerprint生成、dedupe判定、backoff計算
- Integration:
  - Ingest（alertsファイル→DB）
  - Dispatch（DB→Slack、成功/失敗/再送）
- 運用試験:
  - Slack webhookを無効にしてもAlertはDBに残ること
  - webhook復旧後に再送されること

## 期待効果

- Slackの有無に関係なく「起きたこと」はDBに残る
- 通知の増加に対して、設定追加でスケール
- 同一障害の通知連発を抑え、運用ノイズを減らす

