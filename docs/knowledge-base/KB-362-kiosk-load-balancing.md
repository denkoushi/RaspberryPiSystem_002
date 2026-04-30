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

## References

- [運用ガイド: kiosk-production-schedule-load-balancing.md](../guides/kiosk-production-schedule-load-balancing.md)
