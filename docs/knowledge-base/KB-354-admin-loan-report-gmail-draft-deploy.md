---
title: 'KB-354: 管理コンソール 貸出レポート（HTML プレビュー・Gmail 下書き・Gmail 送信）'
tags: [管理コンソール, 貸出レポート, Gmail, API, デプロイ]
audience: [開発者, 運用者]
last-verified: 2026-04-18
category: knowledge-base
---

# KB-354: 管理コンソール 貸出レポート（HTML プレビュー・Gmail 下書き・Gmail 送信）

## Context

キオスク「集計」と同系の貸出データを、管理コンソールから **HTML レポート**として確認し、必要なら **Gmail 下書き**として残す。加えて **ADMIN** 権限では **Gmail 即時送信**（`users.messages.send`・raw MIME）も選択できる。

## 仕様（確定）

| 項目 | 内容 |
|------|------|
| 管理 UI | `/admin` 配下の貸出レポートページ（フィルタ・プレビュー iframe・下書き作成・**送信**・**2 ペイン**レイアウト） |
| プレビュー API | `GET /api/reports/loan-report/preview`（`category`: `measuring` / `rigging` / `tools`・期間・月次本数・任意の資産 ID 等） |
| 下書き API | `POST /api/reports/loan-report/gmail-draft`（本文は **HTML**、件名・To 任意） |
| 送信 API | `POST /api/reports/loan-report/gmail-send`（**To 必須**・本文 HTML・件名任意） |
| 認可 | プレビュー: `ADMIN` / `MANAGER` / `VIEWER`。下書き: `ADMIN` / `MANAGER`。**送信: `ADMIN` のみ** |
| Gmail | 既存 OAuth に **`gmail.compose`**（下書き）および **`gmail.send`**（送信）。`users.drafts.create` / `users.messages.send` + **raw MIME**（base64url、**76 桁折り返し**で Gmail 互換）。MIME 組み立ては `loan-report-email-mime` に集約 |
| 集計 | アイテム軸の名寄せ・評価ロジックは `LoanReport*` サービスに集約（Vitest あり）。**2026-04-18 §C**: 推定配分を排除し借用実データへ。各 `loan-analytics` の従業員行に **期限超過件数** |

## 本番デプロイ実績

### A. 下書き初版（2026-04-18）

- **ブランチ**: `feat/admin-loan-report-gmail-draft`（代表コミット **`6bc00a00`**）。
- **対象ホスト**: **`raspberrypi5` のみ**（運用上 Pi5 の `api` + `web`）。**Pi4 / Pi3 は未デプロイ**（今回の指示範囲外。Pi3 はリソース制約のため専用手順を別途）。
- **手順**: [deployment.md](../guides/deployment.md)。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/admin-loan-report-gmail-draft infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **Detach Run ID**: **`20260418-152952-9706`**（`PLAY RECAP` **`failed=0` / `unreachable=0`**・Mac exit `0`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 **59s**）。**WARN**: Pi5 から `raspi4-fjv60-80` への SSH 直確認不可（スクリプト既定・`deploy-status` は PASS）。
- **CI**: GitHub Actions Run **`24598528235`** success（ブランチ push 時）。
- **PR**: [#166](https://github.com/denkoushi/RaspberryPiSystem_002/pull/166)

### B. Gmail 送信・レイアウト（2026-04-18）

- **ブランチ**: `feat/loan-report-gmail-send-and-layout`（代表コミット **`d97bdaa7`**）。
- **対象ホスト**: **`raspberrypi5` のみ**（Pi4/Pi3 未デプロイ・Pi3 は専用手順）。
- **手順**: 上記と同様・`./scripts/update-all-clients.sh feat/loan-report-gmail-send-and-layout infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **Detach Run ID**: **`20260418-183700-7508`**（**`failed=0` / `unreachable=0`**・exit `0`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（WARN は A と同様）。
- **追加スモーク**: 未認証 `GET …/preview?category=rigging` → **`401`**。未認証 `POST …/gmail-send`（空 body）→ **`401`**。
- **`GET /api/system/health`**: デプロイ直後〜数十秒は **memory 高で `degraded` が続く観測**あり。更長の warm-up で `ok` に戻る場合と、負荷次第で持続する場合あり（[deployment.md](../guides/deployment.md) 冒頭ログ参照）。
- **CI**: Run **`24601330617`** success。

### C. 実メトリクス・プレビュー幅（2026-04-18）

- **ブランチ**: `fix/loan-report-real-metrics-wide-preview`（代表コミット **`937be20f`**）。
- **内容（要約）**:
  - **集計**: 計測・吊具・写真持出の各 `loan-analytics` で、従業員行に **期限超過件数**（`employeeOverdueLoanCount` 相当）を追加。レポート評価（`LoanReportEvaluationService`）は **推定配分を使わず**、借用トランザクション由来の実データに寄せた。
  - **管理 UI**: `LoanReportPage` で **`AdminLayout` の `max-w-screen-2xl` を打ち消し**、プレビューを **ビューポート幅まで**使えるようにした（iframe 内レポートは従来の print レイアウト）。
- **対象ホスト**: **`raspberrypi5` のみ**（Pi4/Pi3 未デプロイ・Pi3 は専用手順）。
- **手順**: [deployment.md](../guides/deployment.md) どおり・`./scripts/update-all-clients.sh fix/loan-report-real-metrics-wide-preview infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **Detach Run ID**: **`20260418-204637-27968`**（**`failed=0` / `unreachable=0`**・exit `0`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 **62s**・fjv60-80 SSH WARN はベースライン同型）。
- **デプロイ前（Mac）**: **未追跡のプレビュー HTML** 等があると `update-all-clients.sh` が fail-fast → **`git stash push -u`**（本記録では実施済み）。
- **CI**: Run **`24603756892`** success（コード変更 push 時。docs 追記コミットでは再実行確認を推奨）。
- **PR**: [#168](https://github.com/denkoushi/RaspberryPiSystem_002/pull/168)

## Troubleshooting

| 症状 | 切り分け |
|------|-----------|
| `update-all-clients.sh` が即 exit 2 | **未コミット／未追跡ファイル**で fail-fast。`git status` を確認し、**`git stash push -u`** またはコミットしてから再実行（[deployment.md](../guides/deployment.md)・[KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)）。 |
| 下書き API が 403 / Gmail エラー | **OAuth スコープ**に `gmail.compose` が含まれるか、**接続済み Gmail アカウント**が有効かを確認（`backup.json` / 管理画面バックアップ設定）。 |
| **送信** API が 403 / Gmail **`insufficientPermissions`** 等 | **`gmail.send`** がトークンに含まれていない。**OAuth 再認可**（バックアップ設定から Gmail 再接続）でスコープを更新。 |
| 送信が **403**（ロール） | **送信は `ADMIN` のみ**。`MANAGER` 以下は下書きのみ。 |
| プレビューが 401 | 管理コンソールと同じ **JWT**（またはロール付きセッション）で呼ぶ。匿名 curl では **401 正常**。 |
| Vitest で `vi.mock` が先に評価されて失敗 | モック依存の定数は **`vi.hoisted`** で定義する（`loan-report-gmail-draft.service.test.ts` 参照）。 |
| レポート数値がキオスク集計と「推定」でずれる | **§C 以降**は HTML レポート／プレビューが **借用イベント実データ寄り**。**期限超過**は従業員行の **`employeeOverdueLoanCount`** で確認（API `loan-analytics` と共有）。 |

## References

- **PR（下書き）**: [#166](https://github.com/denkoushi/RaspberryPiSystem_002/pull/166)
- **PR（送信・レイアウト）**: [#167](https://github.com/denkoushi/RaspberryPiSystem_002/pull/167)
- 実装: `apps/api/src/routes/reports/loan-report.ts`、`apps/api/src/services/reports/loan-report/*`
- 管理 UI: `apps/web/src/pages/admin/LoanReportPage.tsx`、`apps/web/src/features/admin/loan-report/*`
- デプロイ標準: [deployment.md](../guides/deployment.md)
