---
title: Kiosk Inspection Drawing Library UX And Depth Through
id: plan-kiosk-inspection-drawing-library-ux-and-depth-through
status: active
date: 2026-07-09
branch: feat/kiosk-inspection-drawing-library-ux-and-depth-through
source_of_truth: true
related_docs:
  - ../design-previews/kiosk-inspection-drawing-library-retire-and-keypad-preview.html
  - ../design-previews/kiosk-inspection-drawing-depth-through-mode-preview.html
  - ../decisions/ADR-20260709-inspection-drawing-depth-through-mode.md
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

- Visual list `limit: 40` may miss digit matches beyond the page; revisit API digitQuery later if needed

## Local Notes JA

- 現場語は「通し」。メニューバーは nowrap・外寸維持。テンキーに入力欄・タイトル・説明は置かない。
