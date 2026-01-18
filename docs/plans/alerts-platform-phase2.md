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

