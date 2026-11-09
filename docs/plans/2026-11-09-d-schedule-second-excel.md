# Import both production schedule minutes formats


This ExecPlan follows `.agent/PLANS.md` and is the implementation record for this task. Scope is local implementation and validation in the existing `feat/d-schedule-second-excel` worktree. Commit, push, branch changes, migration execution and deployment are not authorized.

## Purpose / Big Picture


A verified sender can attach both D社日程会議議事録 and the internal product schedule to one email, or send them separately. Both feed the existing production board. Importing one product group must preserve the other group's automatically registered production numbers (製番). Tests construct fictitious workbooks with ExcelJS to demonstrate this behavior.

## Progress


- [x] (2026-11-09) Confirmed a clean initial worktree and existing strict parts-date interpretation.
- [x] (2026-11-09) Added the kind migration, internal-format parser, attachment iteration and kind-specific comparison/ownership queries.
- [x] (2026-11-09) Added parser, multi-attachment and alternating-kind registration regressions.
- [x] (2026-11-09) Completed local tests, Prisma validation, API lint, production TypeScript checking and diff checks; PostgreSQL-dependent checks remain unavailable.
- [ ] integrationPending: migration application, CI, main integration and production verification remain outside the authorized task. There is no PR or superseding change yet.

## Surprises & Discoveries


The existing D parser rejects workbooks if fewer than 80% of production numbers have readable dates. Internal schedules frequently contain 完 and other text, so the separate parser reuses the strict date reader but does not impose that D-specific ratio. The first focused run passed all 22 new parser cases; the apply/registration suites could not resolve the unbuilt workspace package `@raspi-system/shared-types`. Build that package before retrying.

Read-only check against the real 2026-11-07 email on Pi5 (2026-11-09, by Claude): the D parser still reads `20261107D社日程会議議事録.xlsx` as before (58 blocks, meeting date 2026-11-07) and the internal parser returns MISSING_HEADERS for it. For `日程会議議事録_1106.xlsx` the D parser returns NO_BASE_DATE, and the internal parser reads sheet `1106結果` (meeting date 2026-11-06, 312 production numbers, 207 with a parts date, 5+ line-break aliases such as BA1S9209(BA1RA201)). The undated values are 完, `-`, empty cells and free text such as 支給品以外完 or 11/6？. All 72 warnings are UNREADABLE_DATE: 42 for 完 and the rest for free text. In the production schedule, 215 of the 320 production numbers (aliases included) exist and 151 of them have a dated row. The registration cap is 100 (`KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX`), so registering the internal file like the D file would overflow every board and the shared history. The user must decide how to register the internal file before this is merged.

## Decision Log


Decision: store `D_COMPANY` and `INTERNAL` in the import run, with a unique `(gmailMessageId, kind)` key. Existing rows receive `D_COMPANY` through the migration default. Rationale: the approved contract has one import per format per email, while production numbers share one latest-value table. Date/Author: 2026-11-09 / Codex.

Decision: scope previous-run comparisons, later-run registration suppression and ownership inheritance to the same kind. Compare a stored production number for abnormal date changes only when its source kind matches; keep the existing cross-kind meeting-date winner check for latest values. Rationale: unrelated product groups must not suppress or remove one another. Date/Author: 2026-11-09 / Codex.

Decision: infer the year of an MMDD from receipt time, rolling back when more than 45 days in the future; use that chronology to select the latest result sheet across New Year. B1's Date wins for the meeting date, followed by filename `_MMDD`, then the selected sheet. Rationale: the existing D parser already uses 45 days to flag date discrepancies. Date/Author: 2026-11-09 / Codex.

Decision: inspect all XLSX attachments and finish independent attachments even when one fails. A transient failure leaves the mail unread. Permanent content failures preserve the mail and mark it read only after there are no transient failures. Successful mail is trashed/read once. Rationale: retries reuse successful kind-specific runs without losing the second attachment. Date/Author: 2026-11-09 / Codex.

## After deploy: importing the 2026-11-07 email once


Gmail message `1a1bd5b14ff055a8` was already trashed and marked read by the old code, and only its D社 attachment was imported. After the deploy, move that email from the trash back to the inbox, remove the `rps_processed` label (moving to trash adds it, and the intake query excludes it), and mark it unread. On the next cycle the existing D_COMPANY SUCCESS run is reused, so only the INTERNAL attachment is applied. The D notice is not sent twice because it is delivered with `once: true`. After that cycle the email goes back to the trash. This changes production mail, so it needs explicit approval.

## Outcomes & Retrospective


Local implementation and non-PostgreSQL regression validation are complete. The existing D parser and `date-cell.ts` are unchanged. Remaining scope limits: the requested compound key represents one attachment per kind per email; multiple different workbooks of the same kind do not create additional runs. Real PostgreSQL migration and integration evidence require an explicitly selected test database or later CI. No production mail or database is accessed by the unit tests.

## Context and Orientation


`apps/api/prisma/schema.prisma` defines the import history and shared latest values. `apps/api/src/services/production-schedule/d-schedule-minutes/` contains the parsers, Gmail ingestion, persistence, registration and summaries. Registration ownership records the production numbers added automatically to each board and shared search history, so a later import can reconcile only its own additions. `apps/api/src/services/kiosk-inquiry/system-notice-sources.ts` formats warnings.

## Plan of Work


Milestone 1 (storage and parsing): add `kind` and the compound unique key with migration `apps/api/prisma/migrations/20261109120000_d_schedule_minutes_kind/migration.sql`. Add `parse-internal-schedule-minutes.ts`, returning the existing `DScheduleMinutesParseResult`. Select normalized MMDD結果 sheets, scan repeated headers by column name, skip hidden rows, and call strict `readDate` for 部品. Preserve raw values, aliases and existing warning codes. Leave the D parser unchanged.

Milestone 2 (intake and registration): update `d-schedule-minutes-gmail-ingestion.service.ts` to try D and internal parsing, reuse each kind's successful run, and defer mail finalization. Update `apply-d-schedule-minutes.service.ts` and `auto-register-d-schedule-minutes.service.ts` to filter comparison and ownership history by kind. Use `minutes-kind.ts` for the two notice names and distinguish their notice keys while preserving existing D notice keys. Reuse `summarizeMinutes`, adding kind to each cycle run.

## Concrete Steps


From repository root, generate the Prisma client and build the existing workspace dependency if absent:

    pnpm -C apps/api exec prisma generate
    pnpm -C packages/shared-types build

Run the requested suites and the existing Gmail scheduler regressions:

    cd apps/api
    pnpm vitest run src/services/production-schedule/d-schedule-minutes src/services/kiosk-inquiry
    pnpm vitest run src/services/imports/__tests__/d-schedule-minutes-gmail.test.ts

From repository root:

    pnpm -C apps/api exec prisma validate
    pnpm -C apps/api lint
    git diff --check

## Validation and Acceptance


The parser tests must pass for sheet selection, repeated sections, line-break aliases, serial 46338 → 2026-11-12, Date/M/D values, text preservation, hidden rows and meeting-date fallback. Gmail tests must produce two runs and one mail finalization for two kinds, process only the missing kind on retry, and handle separate emails and partial failures. Registration tests must retain D-owned numbers after an internal import and internal-owned numbers after the next D import. PostgreSQL-only tests may be skipped when no approved local database is available. Prisma validation and API lint must pass.

## Idempotence and Recovery


Successful `(message, kind)` runs are reused on retries; APPLIED runs resume existing registration. The migration is added but not executed. A later migration application must use the repository's approved database procedure and backup; do not roll back to the old unique key after emails have two runs without first resolving duplicates. Local edits can be reviewed through `git diff`; initial worktree contained no WIP.

## Artifacts and Notes


The requested combined Vitest command completed in about 8 seconds: 318 tests passed, 2 PostgreSQL SQL tests failed at database calls, and 7 PostgreSQL apply tests were skipped after their database setup failed. All non-PostgreSQL tests passed, including the 138 unchanged D parser cases, 22 internal parser cases, 7 attachment cases and 16 registration cases. After adding two notice-specific assertions, the focused notice suite passed all 30 tests. The existing Gmail scheduler suite passed all 36 tests after adapting its single-fatal-attachment fixture to the all-attachments behavior.

Prisma validation passed; client generation and required workspace dependency builds completed. API-wide `pnpm -C apps/api lint` passed (about 80 seconds), followed by lint of the final changed TypeScript scope. `pnpm -C apps/api exec tsc -p tsconfig.build.json --noEmit` passed (about 60 seconds). `git diff --check` passed. Unit test logs are temporary `/tmp/d-minutes-*.log` files, not repository artifacts. No real client workbooks, secrets or UI descriptions are added.

Changed files (repository-relative):

    apps/api/prisma/schema.prisma
    apps/api/prisma/migrations/20261109120000_d_schedule_minutes_kind/migration.sql
    apps/api/src/services/production-schedule/d-schedule-minutes/minutes-kind.ts
    apps/api/src/services/production-schedule/d-schedule-minutes/parse-internal-schedule-minutes.ts
    apps/api/src/services/production-schedule/d-schedule-minutes/parse-internal-schedule-minutes.test.ts
    apps/api/src/services/production-schedule/d-schedule-minutes/d-schedule-minutes-gmail-ingestion.service.ts
    apps/api/src/services/production-schedule/d-schedule-minutes/d-schedule-minutes-gmail-ingestion.service.test.ts
    apps/api/src/services/production-schedule/d-schedule-minutes/apply-d-schedule-minutes.service.ts
    apps/api/src/services/production-schedule/d-schedule-minutes/apply-d-schedule-minutes.service.test.ts
    apps/api/src/services/production-schedule/d-schedule-minutes/auto-register-d-schedule-minutes.service.ts
    apps/api/src/services/production-schedule/d-schedule-minutes/auto-register-d-schedule-minutes.service.test.ts
    apps/api/src/services/kiosk-inquiry/system-notice-sources.ts
    apps/api/src/services/kiosk-inquiry/__tests__/system-notice-sources.test.ts
    apps/api/src/services/imports/__tests__/d-schedule-minutes-gmail.test.ts
    docs/plans/2026-11-09-d-schedule-second-excel.md
    docs/INDEX.md

## Interfaces and Dependencies


`parseInternalScheduleMinutesXlsx({buffer, filename, receivedAt, subject?})` returns `Promise<DScheduleMinutesParseResult>` and sets `assigneeColumnFound: false`. `DScheduleMinutesRunMetadata.kind` defaults to D_COMPANY for existing callers. `deliverDScheduleMinutesNotice(messageId, warnings, kind = 'D_COMPANY')` preserves existing callers. Dependencies remain ExcelJS, Prisma and the existing Gmail/storage/board services.

Revision: 2026-11-09 — captured implementation decisions and initial validation dependency failure.

Revision: 2026-11-09 — recorded final local evidence and the PostgreSQL/integration boundary.

Revision: 2026-11-09 — limited section detection to column A so unused remarks cannot reset headers; all 22 internal parser cases passed again. Added the complete changed-file inventory.
