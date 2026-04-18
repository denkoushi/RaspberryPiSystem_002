---
title: 'KB-354: 管理コンソール 貸出レポート（HTML プレビュー・Gmail 下書き）'
tags: [管理コンソール, 貸出レポート, Gmail, API, デプロイ]
audience: [開発者, 運用者]
last-verified: 2026-04-18
category: knowledge-base
---

# KB-354: 管理コンソール 貸出レポート（HTML プレビュー・Gmail 下書き）

## Context

キオスク「集計」と同系の貸出データを、管理コンソールから **HTML レポート**として確認し、必要なら **Gmail 下書き**として残せるようにする（メール送信は行わない）。

## 仕様（確定）

| 項目 | 内容 |
|------|------|
| 管理 UI | `/admin` 配下の貸出レポートページ（フィルタ・プレビュー iframe・下書き作成） |
| プレビュー API | `GET /api/reports/loan-report/preview`（`category`: `measuring` / `rigging` / `tools`・期間・月次本数・任意の資産 ID 等） |
| 下書き API | `POST /api/reports/loan-report/gmail-draft`（本文は **HTML**、件名・To 任意） |
| 認可 | プレビュー: `ADMIN` / `MANAGER` / `VIEWER`。下書き: `ADMIN` / `MANAGER` |
| Gmail | 既存 OAuth クライアントに **`gmail.compose`** を付与。`users.drafts.create` + **raw MIME**（base64url、**76 桁折り返し**で Gmail 互換） |
| 集計 | アイテム軸の名寄せ・評価ロジックは `LoanReport*` サービスに集約（Vitest あり） |

## 本番デプロイ実績（2026-04-18）

- **ブランチ**: `feat/admin-loan-report-gmail-draft`（代表コミット **`6bc00a00`**）。
- **対象ホスト**: **`raspberrypi5` のみ**（運用上 Pi5 の `api` + `web`）。**Pi4 / Pi3 は未デプロイ**（今回の指示範囲外。Pi3 はリソース制約のため専用手順を別途）。
- **手順**: [deployment.md](../guides/deployment.md)。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/admin-loan-report-gmail-draft infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **Detach Run ID**: **`20260418-152952-9706`**（`PLAY RECAP` **`failed=0` / `unreachable=0`**・Mac exit `0`）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 **59s**）。**WARN**: Pi5 から `raspi4-fjv60-80` への SSH 直確認不可（スクリプト既定・`deploy-status` は PASS）。
- **追加スモーク**: デプロイ直後 `GET https://100.106.158.2/api/system/health` は **メモリ高負荷で `degraded`** になり得るが、**数十秒 warm-up 後 `ok`**。未認証 `GET /api/reports/loan-report/preview?category=rigging` → **`401`**（認可ゲート生存確認）。
- **CI**: GitHub Actions Run **`24598528235`** success（ブランチ push 時）。

## Troubleshooting

| 症状 | 切り分け |
|------|-----------|
| `update-all-clients.sh` が即 exit 2 | **未コミット／未追跡ファイル**で fail-fast。`git status` を確認し、**`git stash push -u`** またはコミットしてから再実行（[deployment.md](../guides/deployment.md)・[KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)）。 |
| 下書き API が 403 / Gmail エラー | **OAuth スコープ**に `gmail.compose` が含まれるか、**接続済み Gmail アカウント**が有効かを確認（`backup.json` / 管理画面バックアップ設定）。 |
| プレビューが 401 | 管理コンソールと同じ **JWT**（またはロール付きセッション）で呼ぶ。匿名 curl では **401 正常**。 |
| Vitest で `vi.mock` が先に評価されて失敗 | モック依存の定数は **`vi.hoisted`** で定義する（`loan-report-gmail-draft.service.test.ts` 参照）。 |

## References

- 実装: `apps/api/src/routes/reports/loan-report.ts`、`apps/api/src/services/reports/loan-report/*`
- 管理 UI: `apps/web/src/pages/admin/LoanReportPage.tsx`、`apps/web/src/features/admin/loan-report/*`
- デプロイ標準: [deployment.md](../guides/deployment.md)
