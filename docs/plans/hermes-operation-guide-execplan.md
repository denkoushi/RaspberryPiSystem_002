# Hermes floating Chat operation guide: assembly first slice


This is the living implementation record for the local first slice, maintained under `.agent/PLANS.md`.

## Purpose / Big Picture


検索モードで「手順書の作り方」を尋ねると、組立の登録・編集を選び、実画面を操作しながら次の一手を確認できる。案内はブラウザ内の固定データで動き、AI回答を待たず、相談履歴へ保存しない。

## Progress


- [x] (2026-10-07) Existing Chat, approved mock and SOP references inspected; local question routing, choices, card and target tracking implemented.
- [x] (2026-10-07) Assembly registration and editing sequences added; existing server search retained for unrelated questions.
- [x] (2026-10-07) Focused Vitest 101/101, web lint, typecheck and kiosk SOP source check passed; integrity test rechecked after import cleanup (17/17).
- [ ] Real-browser visual verification at 1920×1080.
- [ ] integrationPending: commit, push, PR, main CI, merge and deployment are outside the requested stage.

## Scope


今回の対象は「組立の手順書を登録」と「組立の手順書を編集」の2本。加工の作業手順書、白紙からの要領書、AI回答、操作検知による自動送り、API・DB・取説生成物の変更は対象外。

## Context and Orientation


`apps/web/src/components/hermes/HermesFloatingChat.tsx` は全Routesの外に常駐するChat。新しい `apps/web/src/features/operation-guide/` に定義、質問判定、メモリ状態、対象追跡、配置計算、カード・リング・選択肢を置く。SOPは `apps/web/src/features/assembly/assembly-procedure-template-sop.definition.json` を正本とし、sheet/step IDで見出し・説明・targetId（実画面の `data-kiosk-sop-target` の値）を解決する。

## Plan of Work / Milestones


1. Define the two guide sequences and a conservative standalone authoring-question matcher. Intercept search questions before adding any server messages. Keep guide state separate from consultation messages.
2. Show choices through the existing Chat extension. Selecting a guide replaces the panel with a 320px card. Track visible target bounds only while the card is mounted, including clipping, duplicate targets and modal visibility; render a static noninteractive ring and badge. Choose a position away from the target and movable Chat icon.
3. Add ID/target integrity and interaction tests, then execute the checks below. Navigation uses only the library's fixed route; document editor routes require the user to open a document. Preserve state on route changes, offer the other guide on completion, and support end/return to questions.

## Decision Log


- Decision: Questions and progress live only in React state; SOP content is resolved at runtime, with short description overrides where needed.
  Rationale: Avoid duplicated source content, backend dependency and guide messages in saved consultation history.
  Date: 2026-10-07.
- Decision: Use only the library route as a navigation destination.
  Rationale: SOP editor routes contain fixture document IDs, not the user's document ID.
  Date: 2026-10-07.
- Decision: Guide steps use a discriminated union of SOP references and direct definitions carrying title, targetId and a short description for operations absent from SOP or mismatched with the current controls.
  Rationale: Direct definitions point to existing screen targets, so registration and editing guidance stays accurate without changing SOP JSON or existing target values.
  Date: 2026-10-07.
- Decision: Measure geometry immediately on resize and captured scroll events, sample every 200ms while the card is mounted, and update React state only when bounds change.
  Rationale: Follow scroll, resize, route/dialog changes, element replacement and layout movement without modifying controls or adding animations.
  Date: 2026-10-07.

## Surprises & Discoveries


- SOP toolbar targets are passed through `options.target`, and type-dialog targets are generated from the selected kind. Integrity tests cover these existing patterns as well as literal attributes.
- The registration SOP exposes the preview step but not dedicated library publication steps; the guide uses direct definitions for those existing screen controls.

## Concrete Steps


Run from repository root, with existing dependencies:

    pnpm --filter @raspi-system/web test src/features/operation-guide src/components/hermes/HermesFloatingChat.test.tsx src/components/hermes/HermesChatPanel.test.tsx
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web exec tsc --noEmit
    pnpm kiosk-sop:source-check

The web package has no separate typecheck script; `tsc --noEmit` checks its configured source. Do not generate or refresh SOP artifacts in this slice.

## Validation and Acceptance


検索で「手順書の作り方」「手順書はどうやって作るの?」「手順書を編集したい」を送ると「どの手順書ですか?」と組立の2択が即時表示される。無関係な「品番ABCの不適合は?」は既存サーバへ送る。案内を選び、戻る・次へ・ライブラリへの移動・完了・終了・質問へ戻るを確認する。リングは可視対象だけに出て、クリックを妨げず、カードは対象とアイコンを避ける。1920×1080のカードは見出し19px、説明14px、ボタン14px以上で1行説明を保つ。

Tests verify existing sheet/step IDs, implemented targets, short descriptions, conservative matching, placement, live target changes, route persistence and exclusion from server history. Validation results are recorded in Outcomes below.

## Idempotence and Recovery


No migration, storage or backend changes. Reloading clears guide state. Source edits can be reverted by file review; do not reset user work or perform git mutations. If a required dependency is missing, stop and report instead of installing it manually.

## Interfaces and Dependencies


Use existing React, React DOM, React Router, Vitest and Testing Library. `resolveGuideStep(reference)` returns SOP content or a direct definition and an optional fixed path. `useOperationGuide()` owns local question/guide/index state. `useGuideTarget()` supplies visible bounds to `placeGuideCard()` and `OperationGuideOverlay`; the floating Chat connects them through its existing extension and open state.

## Outcomes & Retrospective


Local implementation provides registration (5 cards) and editing (9 cards), with SOP references, direct definitions and in-memory state. Six targeted test files passed: 101 passed, 0 failed (including 39 FloatingChat and 18 ChatPanel tests). The final integrity-only check passed 17/17. Web lint completed with 0 errors/warnings; `tsc --noEmit` passed; SOP source digests are current. Real-browser visual verification remains unperformed. No server/API, DB, generated SOP, commit, push or deployment changes were made.

## Next Slice Candidates


加工の作業手順書、要領書工房、操作検知による自動送り、自由質問。登録操作のSOP step追加は別途正本の更新として検討する。

Revision 2026-10-07: Record the first local slice and the existing registration SOP coverage limit; keep later integration and additional guides separate.
