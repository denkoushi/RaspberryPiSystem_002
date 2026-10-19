# ADR-20260725: Kiosk Assembly Work Semantics and Machine-name Picker

- Status: accepted
- Date: 2026-07-25
- Scope: kiosk assembly work session and assembly template create-from-new/template flows
- related_code:
  - `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx`
  - `apps/web/src/features/assembly/AssemblyWorkSessionHeader.tsx`
  - `apps/web/src/features/assembly/AssemblyProcedureCanvas.tsx`
  - `apps/web/src/features/assembly/assemblyTemplateDraft.ts`
  - `apps/web/src/features/assembly/AssemblyMachineNamePickerDialog.tsx`
  - `apps/web/src/features/kiosk/kioskMarkerTheme.ts`
  - `apps/web/src/features/kiosk/kioskFlowButtonTheme.ts`
  - `apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingMarkerStyles.ts`
  - `apps/web/src/features/part-measurement/selfInspectionKioskTheme.ts`
  - `apps/api/src/services/production-schedule/machine-name-catalog.repository.ts`
  - `apps/api/src/services/assembly/assembly-machine-name-candidates.service.ts`
- related_docs:
  - `docs/plans/kiosk-assembly-work-uiux-improvements.md`
  - `docs/plans/assembly-approved-uiux-regression-recovery-execplan.md`
  - `docs/knowledge-base/KB-402-assembly-approved-uiux-feature-branch-overwrite.md`
  - `docs/design-previews/kiosk-assembly-work-uiux-preview.html`
  - `docs/decisions/ADR-20260714-assembly-marker-callout-and-shared-image-canvas.md`
  - `docs/decisions/ADR-20260717-assembly-torque-wrench-traceability.md`

## Context

The assembly work screen currently uses multiple saturated button colors without tying
them to the next required operator action. Its current-position cyan fill overrides the
bolt's OK/NG state, so the marker cannot communicate result and input target at once.
The measurement history renders the values and judgments too small for kiosk viewing.
An independent 56px status row also reduces the procedure-document viewport.

Assembly template creation labels its value as a model code/FHINCD, but the value is
matched against `FHINMEI` machine names in production schedules. Free entry allows
typos and names that are not present in current schedule or supplement data. Operators
report that machine names nearly always contain digits, so a numeric keypad is the
fastest primary filter; a text field is still required for supplementary filtering.

Existing machine-name resolution already reads winner-selected MH/SH schedule rows and
the supplement table, caches them for 60 seconds, and invalidates after imports.
Existing schema and indexes are sufficient.

## Decision

1. Use the self-inspection visual semantics across kiosk work flows:
   - pending marker is white, OK is emerald, NG is red;
   - current input target is a 3px sky outline layered over the state fill;
   - `IGNORED` remains in history but does not replace the latest valid OK/NG fill;
   - only the immediate required action is emerald, secondary enabled actions are
     neutral gray, unavailable actions are dimmed, and only genuinely dangerous
     confirmation is red.
2. Separate editor selection (`selectedBoltId`) from work input target
   (`inputTargetBoltId`). Editor selection retains its existing cyan fill.
3. Integrate the live status message into the flexible middle region of
   `AssemblyWorkSessionHeader`, preserving `role="status"`, `aria-live="polite"`,
   and `aria-atomic="true"`. Remove the separate fixed-height message row.
4. Increase history measurement and OK/NG typography to 24px, bold, tabular numerals.
   Keep metadata sizing and render `IGNORED` as a smaller neutral label.
5. Extract common marker, flow-action, and digit-tenkey primitives. Existing
   self-inspection exports remain compatibility wrappers. Assembly button presentation
   is derived by a pure state function rather than scattered JSX conditions.
6. Add a read-only assembly machine-name candidate endpoint backed by an injectable
   catalog repository. The repository owns schedule/supplement reads, TTL cache, and
   invalidation; candidate filtering owns normalization, de-duplication, AND matching,
   stable natural sorting, and limits.
7. Normalize full-width alphanumerics to ASCII, trim, and uppercase for matching and
   de-duplication. Numeric search compares against digits extracted from the normalized
   name; text search compares against the normalized full name. Exclude `機種名未登録`.
8. Replace free entry only for new and create-from-template flows with a wide,
   focus-trapped machine-name picker. It combines a digit keypad with an optional text
   filter, uses 200ms debounce and latest-response-wins protection, and commits the
   page's `modelCode` only after the operator selects a candidate and confirms.
9. Show the user-facing label `機種名` in template editing, list column, and list
   search. Keep internal `modelCode`, API/DB fields, and Excel headings unchanged.
10. Keep redo business logic and revision input unchanged. Combine the procedure
    viewer title, document tabs, and page navigation into one compact row without
    removing any controls. Do not change Prisma schema or migration history.
11. Product-code implementation was blocked until the interactive design preview was
    reviewed. The user approved V3 on 2026-07-25.

## API Contract

    GET /api/assembly/machine-name-candidates
      ?digitQuery=300
      &q=KP
      &limit=40

    {
      "candidates": ["L300KP", "L300KP-2"],
      "hasMore": false
    }

`digitQuery` accepts ASCII digits only and both queries accept at most 120 characters.
`limit` defaults to 40 and is capped at 100. Empty filters return the first page.
Authentication reuses assembly read access (`allowView`).

## Alternatives

- Keep current colors and only enlarge buttons: rejected because size does not give the
  colors a stable meaning.
- Fill the current marker cyan and show result elsewhere: rejected because it hides the
  most local, glanceable OK/NG signal.
- Add a database substring-search endpoint directly over raw schedule rows: rejected
  because it duplicates winner logic, leaks persistence concerns into the route, and
  adds load for a small cached catalog.
- Rename `modelCode` throughout DB/API/Excel: rejected because the user-facing problem
  can be fixed without a broad compatibility migration.
- Allow arbitrary text when no candidate matches: rejected for new/template creation
  because it reintroduces the data-quality failure this picker is meant to prevent.

## Consequences

- Marker color and target position can be understood simultaneously, including a red
  current marker with a sky outline.
- A single high-salience green action guides the operator without changing business
  permissions. Red becomes reserved for the dangerous takeover confirmation.
- The document gains the removed status-row height plus the former second viewer-toolbar
  row. Existing viewer controls remain available in one compact row.
- Candidate lookup becomes reusable and testable without React or route handlers
  depending on Prisma.
- Existing consumers and stored data remain compatible. The trade-off is that internal
  naming (`modelCode`) intentionally differs from the Japanese UI label.
- Candidate filtering is in memory after a cached catalog load; no new DB index or
  migration is introduced.

## Validation

Before changing product code, visually inspect the interactive preview at 1920×1080 and
1366×768, including long machine names, long warnings, all work states, no-result, and
over-40 candidate states. Record approval in the related ExecPlan and then change this
ADR from `proposed` to `accepted`.

After implementation, validate marker and action-state pure functions, compatibility
wrappers, dialog behavior, service normalization/cache/invalidation, route validation
and authorization, focused and complete API/Web suites, lint, production builds, and
`git diff --check`.

Apply every existing Prisma migration to an isolated temporary Postgres instance, seed
only that instance, inspect source rows with SQL, and run
`EXPLAIN (ANALYZE, BUFFERS)` for the schedule winner and supplement reads. Never alter
an existing container or database, and remove the temporary container, volume, and
network after validation.

## Open Items

- なし。

## Implementation Result

V3 preview approval後に本ADRの境界どおり実装した。Prisma schema、migration、
既存テンプレートAPI、Excel形式、やり直しAPIは変更していない。

隔離したPostgresへ全153 migrationを適用し、候補元SQLと既存indexを確認した。
関連API testは34件、API全体は2,441件、Web全体は1,509件が合格した。root lint、
shared-types/API/Web production build、`git diff --check` も合格した。

製品React画面の実測では、1366×768相当で作業ヘッダー58px、ドキュメントペイン
約655px、履歴約203px、1920×1080相当でドキュメントペイン約967px、履歴約515pxとなり、
全体横overflowは発生しなかった。機種名pickerも小さいviewport内に収まり、
テンキーと補助文字のAND検索が動作した。

最終SHA `5dbb98eb488009a6e9351bc0b898b3d39e4869e5` についてGitHubのCI、CodeQL、
gitleaksと、Pi5および実対象キオスク6台のread-only preflightが成功した。標準Deploy
run `20260725-150046-020a76` はPi5のBlue/Green安定監視、stonebase canary、
残り5台のrolling activationを完了し、API/Webはいずれも `verified`、キオスク6台は
全台 `success` となった。Deploy後の同一範囲print-planは対象0件、ヘルスAPIは
`status: ok`、runtimeは `cleaned / verified / consistent` を返した。

全inventory preflightで検出したsignage端末 `raspberrypi3` の低メモリは、この変更の
mutation、activation、verification対象外であることをprint-planと契約に照らして確認し、
同端末を触らない明示範囲でDeployした。安全基準、canary hold、rollback、証跡確認は
緩和していない。Prisma migrationと本番DB schema変更はない。

## 2026-07-27 Recovery Note

The accepted V3 implementation was deployed from its feature branch but was not merged
to `main`; a later main-based release consequently restored the older UI. The decision
itself is unchanged. Recovery is performed by merging approved immutable head
`8b4fc78dc76808855da9d6682a3c57e444e47e78` into the current step-based implementation,
not by redeploying the old branch. The later crop steps, shared marker projection, NFC
gate, and sequence viewer remain authoritative integration constraints. Incident and
prevention details are recorded in KB-402 and the recovery ExecPlan.
