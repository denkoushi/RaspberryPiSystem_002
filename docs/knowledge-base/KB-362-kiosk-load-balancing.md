---
title: KB-362 キオスク負荷調整（山崩し支援）画面
tags: [kiosk, production-schedule, load-balancing]
audience: [開発者, 運用者]
last-verified: 2026-04-30
---

# KB-362: キオスク負荷調整（山崩し支援）画面

## Context

キオスクに **負荷調整** 専用タブを追加し、`plannedEndDate` 月次での資源CD負荷と能力設定を照らし合わせ、工程行単位の移管候補（サジェスト）を返す機能を追加した。

## Symptoms / 使い方

- 画面: `/kiosk/production-schedule/load-balancing`
- 月を選ぶと資源CD別の **必要分 / 能力分 / 超過** が表示される。
- 「サジェストを計算」で POST が走り、候補表が表示される（自動適用なし）。

## Investigation / 仕様メモ

- 集計 SQL は一覧と同様の **FKOJUNST S/R 可視性** を JOIN している。
- 能力は **月次上書き > 基準 > 未設定（null、計算上は0）**。

## Fix / 実装要点

- 設定 CRUD: `production-schedule-settings/load-balancing/*`
- キオスク: `load-balancing/overview`, `load-balancing/suggestions`
- 純粋ロジック: `reallocation-suggestion.engine.ts`（単体テストあり）

## Prevention

- サジェスト条件（分類・ルール・余力）を変えた場合は管理画面で設定し、キオスクで再計算して確認する。

## Production deploy（実績 2026-04-30）

- **ブランチ**: `feat/kiosk-load-balance-suggest`・代表コミット **`d3c37b6f`**（`main` 取り込み後の追従は **`main`** を `update-all-clients.sh` に指定）。
- **ホスト順（`--limit` 1 台ずつ）**: `raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`。**Pi3 は対象外**（リソース僅少・本機能の必須デプロイに含めない）。
- **Detach Run ID**（`ansible-update-`）: `20260430-131611-14988` / `20260430-132522-19139` / `20260430-132943-9367` / `20260430-133254-30349` / `20260430-133615-21765`（いずれも **`failed=0` / `unreachable=0` / exit `0`**）。
- **Phase12 自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。負荷調整エンドポイントは同スクリプト未カバーのため、デプロイ後はキオスク `/kiosk/production-schedule/load-balancing` で月選択・サジェスト計算、または `curl` で `GET …/load-balancing/overview?month=YYYY-MM`（必要なら `targetDeviceScopeKey`）／`POST …/suggestions` を確認する。

## Troubleshooting

- **`overview`/`suggestions` が 401/403**: `x-client-key` とキオスク端末登録を確認。
- **Mac 代理で 400（`targetDeviceScopeKey`）**: device-scope v2 有効時は **他納期画面と同様にクエリ必須**。設定・集計の **`siteKey`** は **`resolveProductionScheduleAssignmentLocationKey`** に合わせる（実装変更時はルートと KB を同期）。
- **Prisma マイグレーションエラー**: Pi5 で `api` コンテナ／マイグレーションログを確認し、競合マイグレーションが無いか検証。
- **UI が旧ビルド**: [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 の強制リロード。

## References

- [運用ガイド: kiosk-production-schedule-load-balancing.md](../guides/kiosk-production-schedule-load-balancing.md)
- [deployment.md §本変更の補足](../guides/deployment.md)
