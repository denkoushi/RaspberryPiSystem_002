---
title: KB-396 Leader board left panel opacity regression
tags: [kiosk, leader-order-board, ui, regression, opacity]
audience: [開発者]
last-verified: 2026-07-07
category: knowledge-base
---

# KB-396: Leader board left panel opacity regression

## Metadata

| Field | Value |
|-------|-------|
| id | KB-396 |
| status | active |
| scope | キオスク順位ボード（`/kiosk/production-schedule/leader-order-board`）マウスオーバー左ペイン（`LeaderBoardLeftToolStack`）の背景不透明性 |
| date | 2026-07-07 |
| source_of_truth | this file |
| related_code | `apps/web/src/features/production-schedule/leader-order-board/LeaderBoardLeftToolStack.tsx`, `apps/web/src/features/kiosk/kioskTheme.ts` |

## Context

ユーザー報告: 「左ペインの背景色が透過しすぎてボタン等を視認しづらい」

キオスク順位ボードで左端ホットゾーンにマウスを載せると表示される左ツールスタック（製番検索・操作パネル等）の背景が半透明になり、背後のボード上のボタンや行が透けて視認性が低下していた。

Fix commit `0c57d5a0`（`fix(web): restore opaque background for leader board left tool stack`）は 2026-07-07 に `main` へマージ済み。本番デプロイは未実施。

## Symptoms Or Trigger

- ルート: `/kiosk/production-schedule/leader-order-board`
- 左端ホットゾーンへマウスオーバーで `LeaderBoardLeftToolStack` が `fixed z-50` オーバーレイとして表示される
- 外側 `aside` と内側製番検索パネルの背景が `bg-slate-900/60`（60% 不透明）となり、背後の順位ボード UI が透けて見える
- ボタンやラベルの判別が困難になる

## Investigation

- 2026-04-28 の不透明化修正 `93e111c3`（`fix(web): opaque backgrounds for kiosk leader board left panels`）では、左ペインを不透明背景（外側 `bg-slate-950`、内側 `bg-slate-900`）に変更済みだった
- 2026-07-03 のテーマ統一コミット `2f7f5069`（`feat: unify kiosk and DGX UI theme`）で共有トークン `kioskPanelClassName`（`bg-slate-900/60`）が `LeaderBoardLeftToolStack` の外側 `aside` と内側製番検索パネルに適用され、不透明化修正がリグレッションした
- `fixed z-50` オーバーレイのため、半透明背景の下に順位ボード本体がそのまま見える構造

## Root Cause

テーマ統一時に、**fixed オーバーレイ系パネル**へキオスク共通の半透明パネルトークン `kioskPanelClassName` を機械的に適用したこと。当該パネルは背後コンテンツの上に重なるため、半透明トークンは視認性を損なう。

## Fix

`LeaderBoardLeftToolStack.tsx` の **2 箇所のみ**変更（`kioskTheme.ts` のトークン定義は不変 — 他画面へ波及させない）:

- 外側 `aside`: `kioskPanelClassName` → `bg-slate-950`
- 内側製番検索パネル: `kioskPanelClassName` → `bg-slate-900`

Implementation commit: `0c57d5a0`（branch `fix/leaderboard-left-panel-opaque`）

## Prevention

- **fixed オーバーレイ系パネルには半透明共通トークン（`kioskPanelClassName` 等）を使わない**方針とする。背後が透ける UI では不透明背景を明示的に指定する
- テーマ統一・共有トークン適用の変更時は、過去の opacity 修正対象（例: `93e111c3` の leader board 左ペイン）を grep / git log で確認する

## Validation

2026-07-07、Mac ローカル:

| Check | Result |
|-------|--------|
| `apps/web` vitest | PASS — 258 files / 1292 tests |
| `apps/web` eslint | PASS |
| `apps/web` `tsc -b` | PASS |

本番デプロイ・Pi キオスク実機での視認性確認は未実施。

## Open Items

- Pi キオスク実機で左ペイン背景の視認性を確認する（本番デプロイ後）
- 他の fixed オーバーレイパネルに半透明トークンが誤適用されていないか、テーマ変更時のチェックリスト化

## References

- Regression引入: `2f7f5069`（`feat: unify kiosk and DGX UI theme`）
- Prior opaque fix: `93e111c3`（`fix(web): opaque backgrounds for kiosk leader board left panels`）
- Fix commit: `0c57d5a0`
- [KB-392 · 順位ボード現行契約の正本](./KB-392-kiosk-leaderboard-spec-source-of-truth.md)
- [KB-297 · 順位ボード左ペイン関連履歴](./KB-297-kiosk-due-management-workflow.md)
