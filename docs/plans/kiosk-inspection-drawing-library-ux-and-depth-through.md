---
title: Kiosk Inspection Drawing Library UX And Depth Through
id: plan-kiosk-inspection-drawing-library-ux-and-depth-through
status: deployed
date: 2026-07-09
branch: feat/kiosk-inspection-drawing-library-ux-and-depth-through
source_of_truth: true
validation: Pi5+Pi4×5 deploy · Runs 20260709-190355-23640 / 20260709-192630-7724 · verify-phase12 PASS 45 · on-site OK · PR #963
related_docs:
  - ../design-previews/kiosk-inspection-drawing-library-retire-and-keypad-preview.html
  - ../design-previews/kiosk-inspection-drawing-depth-through-mode-preview.html
  - ../decisions/ADR-20260709-inspection-drawing-depth-through-mode.md
  - ../guides/deployment.md#kiosk-inspection-drawing-library-ux-and-depth-through-2026-07-09
---

# Kiosk Inspection Drawing Library UX And Depth Through

## Scope

- A: Digit-only menubar tenkey (client-side digit `includes`, both panes)
- B: Retire button on template rows (existing retire API) + action height ×0.7
- C-1: Right pane density (no 補足 title, nominal inline, shorter delete buttons)
- C-2: Depth `through` mode via explicit `depthMode` (not null-clear tolerances)

## Decisions Locked

- Digit filter: client-side `digitsOf` + `includes` (no API change)
- Through: `depthMode` enum + sentinel limits `0/0` for template validity; evaluation skips by `depthMode`
- One feature branch; commits split by phase

## Open Items

- [x] Visual list `limit: 40` 外の数字一致: [後続ExecPlan](./kiosk-inspection-drawing-server-digit-search-retire-mode.md) で全図面対象の `digitQuery` サーバー検索へ移行（2026-07-10、未デプロイ）。

## Local Notes JA

- 現場語は「通し」。メニューバーは nowrap・外寸維持。テンキーに入力欄・タイトル・説明は置かない。
- 2026-07-09: Pi5 + Pi4×5 反映済（Pi3 対象外）。StoneBase01 実機OK。
