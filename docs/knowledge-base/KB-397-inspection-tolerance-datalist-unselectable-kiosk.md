---
title: KB-397 Inspection tolerance datalist unselectable on kiosk
tags: [kiosk, part-measurement, inspection-drawing, tolerance, datalist, ui]
audience: [開発者]
last-verified: 2026-07-07
category: knowledge-base
---

# KB-397: Inspection tolerance datalist unselectable on kiosk

## Metadata

| Field | Value |
|-------|-------|
| id | KB-397 |
| status | active |
| scope | キオスク検査図面テンプレ作成/編集の測定点設定パネル（上限公差・下限公差の候補選択） |
| date | 2026-07-07 |
| source_of_truth | this file |
| related_code | `apps/web/src/features/part-measurement/InspectionDrawingPointSettingsPanel.tsx` |

## Context

ユーザー報告: 「上下限交差を選択肢から選ぶ機能が消えている」

キオスク検査図面のテンプレート作成/編集画面における測定点設定パネルで、上限公差・下限公差を候補リストから選ぶ操作が機能しなくなっていた。UI ラベルや候補データ自体は削除されていない（`git log -S '上下限交差'` は 0 件）。

Fix commit `589d9d43`（`fix(web): make inspection tolerance candidates selectable on kiosk`）は 2026-07-07 に `main` へマージ済み。本番デプロイは未実施。

## Symptoms Or Trigger

- キオスク検査図面テンプレの作成/編集 → 測定点設定パネル
- 上限公差・下限公差入力欄にフォーカスしても、交差公差などの候補が表示されない
- 手入力は可能だが、候補からのワンタップ選択ができない
- キオスク Chromium（タッチ端末）で再現

## Investigation

- 候補 UI は HTML `<datalist>` + `input.showPicker()` 依存だった
- **(a)** コミット `becb6e7c` の `onFocus` ロジックが「現在値が候補リストに含まれない場合は早期 return」するため、手入力値を入力した後は候補 picker が開かない
- **(b)** `showPicker()` は `type="text"` + `datalist` の組み合わせで例外を投げるブラウザがあり、catch で silent に握り潰されていた — キオスク Chromium では候補が一切出ない
- UI 自体（「上下限交差」等の候補定義）は git 履歴上削除されていない

## Root Cause

キオスク（タッチ端末・Chromium）向け UI に、**native datalist / showPicker() に依存した選択方式**を使っていたこと。ブラウザ実装差と focus 時の早期 return ロジックが重なり、候補選択が実質不能になった。

## Fix

`InspectionDrawingPointSettingsPanel.tsx` のみ変更:

- `<datalist>` と `showPicker()` を撤去
- フォーカス中に React レンダリングの候補チップ（絶対配置ポップオーバー）を表示
- 候補クリック時は `onMouseDown` + `preventDefault()` で blur 前に選択を確定
- 候補外の手入力値でも候補チップが表示されるよう focus ロジックを修正

Implementation commit: `589d9d43`（branch `fix/inspection-tolerance-candidate-select`）

回帰テスト追加: 候補外値でも候補表示、選択確定、blur 挙動等 — **13 tests green**

## Prevention

- キオスク（タッチ端末）では **native datalist / showPicker() に依存した選択 UI を避ける**
- 候補選択 UI は React レンダリングのポップオーバー/チップ等、ブラウザ非依存の方式を優先する
- focus 時の早期 return は「候補外値 = 候補非表示」にならないよう、表示条件をテストで固定する

## Validation

2026-07-07、Mac ローカル:

| Check | Result |
|-------|--------|
| `InspectionDrawingPointSettingsPanel` 関連テスト | PASS — 13 tests |
| `apps/web` vitest 全体 | PASS — 258 files / 1292 tests |
| `apps/web` eslint | PASS |
| `apps/web` `tsc -b` | PASS |

本番デプロイ: 2026-07-07 に Run ID `20260707-101530-31384` で Pi5+Pi4×5+Pi3 へ反映済み（[deployment.md §キオスクUI修正3件](../archive/deployments/2026-07.md#kiosk-ui-fixes-leaderboard-tolerance-assembly-2026-07-07)）。
- **On-device check (2026-07-07, user verified)**: tolerance candidate chips selectable by touch on kiosk.
- **Remote browser note**: when the tab is in the background, `document.hasFocus()` is false so `element.focus()` does not fire React focus events and candidates do not appear; use `focusin` dispatch for display verification. No issue on on-device touch.

## Open Items

- 他画面に datalist/showPicker 依存の類似 UI が残っていないか横断確認

## References

- Fix commit: `589d9d43`
- Focus regression source: `becb6e7c`
- [KB-320 · キオスク部品測定記録](./KB-320-kiosk-part-measurement.md)
- [KB-394 · キオスク図面表示速度改善](./KB-394-kiosk-drawing-display-and-leaderboard-decoration-speedup.md)
