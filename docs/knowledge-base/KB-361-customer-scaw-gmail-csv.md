---
title: KB-361 CustomerSCAW Gmail CSV（製番→顧客名・順位ボード）
tags: [Gmail, CSV, 生産日程, CustomerSCAW, 順位ボード]
audience: [開発者, 運用者]
last-verified: 2026-04-30
category: knowledge-base
---

# KB-361: CustomerSCAW Gmail CSV（製番→顧客名・順位ボード）

## Context

Gmail 件名 **`CustomerSCAW`** の CSV を専用 CsvDashboard（固定 ID `PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID`）で取り込み、生産日程 winner の **MH/SH 行**の `FHINMEI` と CSV の `FANKENMEI` を正規化照合して **`ProductionScheduleFseibanCustomerScaw`** に **source 単位で全置換**する。一覧 API 応答の **`customerName`** とキオスク順位ボードの表示に利用する。

## Symptoms / 運用

- 固定 Gmail スケジュール ID: **`csv-import-productionschedule-customer-scaw`**
- 既定 cron: **`31 5 * * 0`**（日曜 05:31、Asia/Tokyo 想定の scheduler 起動に合わせる）
- 既定 **`enabled: true`**（他と同様に cron のみ編集可・削除不可）
- CSV 列: **`Customer`**, **`FANKENMEI`**, （任意）**`FANKENYMD`**

## Investigation / 仕様

- 正規化: **NFKC + trim + 連続空白単一化 + 大文字化**（`customer-scaw-normalize.ts`）
- 競合（同一製番・同一 MH/SH 行走査）: **後勝ち**
- 同一 `FANKENMEI` が複数顧客に対応する場合: **`FANKENYMD`（UTC 日正規化・`parseCustomerScawFankenymdUtcDayMs`）と「着手日」**の **最短距離**で顧客を決定。**着手日**は同期パイプラインで **製番（`FSEIBAN`）単位の `MIN(ProductionScheduleOrderSupplement.plannedStartDate)`** を付与する（MH 行に部品側 JOIN だけだと **null が多く近傍が死ぬ**のを防ぐ）。**同距離**は **`FANKENYMD <= 着手日（UTC 日）`** を優先、**さらに同率**は **CSV 走査の後勝ち**（`scanIndex`）。**着手日が無い**、または **パース可能な `FANKENYMD` が候補に無い**ときは **後勝ち**のみ。
- 不一致（`FANKENMEI` 空・`Customer` 空・本体に一致する `FHINMEI` なし）は無視

## Fix / 実装境界

- 取込定義: `customer-scaw-dashboard.definition.ts`
- 同期: `customer-scaw-sync.pipeline.ts` / `customer-scaw-sync.service.ts` / `customer-scaw-candidates.ts` / `customer-scaw-fankenymd.ts`
- 一覧 enrich: `production-schedule-customer-name-enrichment.service.ts`
- Post-ingest: `csv-dashboard-post-ingest.service.ts`（`ingestRunId` 必須）

## Prevention

- 固定スケジュールの変更は `system-csv-import-schedule-builtin-rows.ts` と `import-schedule-admin.service.ts` の削除ガードを同期すること
- 仕様変更時は `docs/guides/csv-import-export.md` と本 KB を更新すること

## 本番デプロイ記録（2026-04-30: 着手日＝製番集約・`FANKENYMD` パース拡張）

- **ブランチ**: `fix/customer-scaw-seiban-start-date`・代表コミット **`0ca15b5c`**
- **対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 1 台ずつ**）·**`raspberrypi3` は除外**
- **Detach Run ID**（`ansible-update-`）: **`20260430-121103-24992`** / **`20260430-122148-22710`** / **`20260430-122624-28383`** / **`20260430-122940-2356`** / **`20260430-123309-8603`**（各 **`failed=0` / `unreachable=0`**・リモート **`exit` `0`**）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **25s**）
- **知見**: 補助の `plannedStartDate` は **部品行に付きやすく**、MH winner 行の **行単位 JOIN では着手日が欠落**しがち → **製番で MIN 集約**してから近傍判定に使う。**`FANKENYMD`**: Gmail 由来の **`T00:00:00`**・**スラッシュ日付**・**和暦様表記**を許容（パース不能は従来どおり近傍候補外）。
- **トラブルシュート**: 期待顧客と異なるとき **当該製番の補助着手日**・**CSV の日付列**・**同一機種の複数行の順序**を確認。手順の正本は [deployment.md](../guides/deployment.md) 補足（2026-04-30 CustomerSCAW 製番集約）。

## 本番デプロイ記録（2026-04-30: `FANKENYMD` 近傍選定）

- **ブランチ**: `feat/customer-scaw-fankenymd-proximity`・代表コミット **`8d95c2dd`**
- **対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 1 台ずつ**）·**`raspberrypi3` は除外**
- **Detach Run ID**（`ansible-update-`）: **`20260430-104715-27689`** / **`20260430-105722-30608`** / **`20260430-110145-20682`** / **`20260430-110452-23417`** / **`20260430-110808-28659`**（各 **`failed=0` / `unreachable=0`**・リモート **`exit` `0`**）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **28s**）
- **知見**: `FANKENYMD` は **`Date.parse` 相当でパースできた行だけ**が近傍候補。**着手日**は `ProductionScheduleOrderSupplement.plannedStartDate`（部品納期個数系補助 CSV と同期）。パース不能・欠損は従来どおり **CSV 後勝ち**に落ちる。
- **トラブルシュート**: 顧客が食い違うときは **日付列の字句**・**補助の着手日有無**・**同一機種の複数行の順序**を確認。手順の正本は [deployment.md](../guides/deployment.md) 補足（2026-04-30 CustomerSCAW `FANKENYMD`）。

## 本番デプロイ記録（2026-04-30）

- **ブランチ**: `feat/customer-scaw-fseiban-customer-link`・代表コミット **`31c7985c`**
- **対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 1 台ずつ**）·**`raspberrypi3` は除外**
- **Detach Run ID**（`ansible-update-`）: **`20260430-092747-16`** / **`20260430-093831-8790`** / **`20260430-094303-29499`** / **`20260430-094627-7368`** / **`20260430-094955-16246`**（各 **`failed=0` / `unreachable=0`**）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **25s**）
- **トラブルシュート**: 顧客名が出ないときは **CSV 取込・照合キー・MH/SH 行**を疑う。キオスク UI が古いときは [verification-checklist.md](../guides/verification-checklist.md) の **強制リロード**。デプロイ手順の正本は [deployment.md](../guides/deployment.md) 補足（2026-04-30 CustomerSCAW）。

## References

- [csv-import-export.md](../guides/csv-import-export.md)
- [KB-350](./KB-350-seiban-machine-name-supplement-fhinmei-mh-sh.md)（製番→機種名補完・類似パターン）
