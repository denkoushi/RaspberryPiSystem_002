# ADR-20260707: Assembly Kiosk Record Approval Workflow and Home UI Consistency

- Status: accepted
- Date: 2026-07-07
- Scope: kiosk assembly home (`/kiosk/assembly`), procedure order settings preview, assembly record approval (`/kiosk/assembly/record-approvals`)
- related_code:
  - `apps/api/prisma/migrations/20260707061829_assembly_work_session_record_approval/migration.sql`
  - `apps/api/src/services/assembly/assembly-work-session-record-approval.service.ts`
  - `apps/api/src/routes/kiosk/assembly-record-approval-auth.ts`
  - `apps/web/src/pages/kiosk/KioskAssemblyRecordApprovalPage.tsx`
  - `apps/web/src/features/assembly/KioskDocumentPageImage.tsx`
  - `apps/web/src/features/assembly/AssemblyWipPane.tsx`
  - `apps/web/src/features/assembly/AssemblyCompletedPane.tsx`
  - `apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx`
- related_docs: `docs/decisions/ADR-20260707-assembly-procedure-order-library-scope.md`, `docs/knowledge-base/KB-320-kiosk-part-measurement.md`

## Context

Operator feedback on the assembly kiosk (組立):

1. 閲覧順設定 preview showed a broken image icon for 組立手順書. The image endpoint `/api/storage/assembly-procedure-images/*` requires `x-client-key` or JWT, but the preview used a raw `<img src>`, which cannot send headers (401). PDF page images (`/api/storage/pdf-pages/*`) are unauthenticated, so only 組立手順書 broke.
2. The three home header buttons (手順書ライブラリ / 組立テンプレート / 閲覧順設定) used three different `Button` variants (ghostOnDark / primary / secondary) with no state meaning, confusing "pressable vs disabled" expectations. 手順書ライブラリ and 組立テンプレート also navigated to the same page.
3. 完了した製品 pane items were display-only; there was no way to review a completed session's torque records, and no approval step (unlike 自主検査 > 検査記録確認).
4. Both 仕掛中 / 完了した製品 panes allocated the full pane width to a single item row, wasting space as item counts grow.

## Decision

1. **Protected image display**: new shared component `KioskDocumentPageImage` decides per path: `/storage/assembly-procedure-images/` goes through `useProtectedImageBlobUrl` (axios with `x-client-key`, Blob URL); other page images stay raw `<img src>`. Applied to the 閲覧順設定 preview and to `AssemblyProcedureSequenceViewer` (same latent bug); prefetch skips protected paths.
2. **Header button consistency**: all three header nav links use `ghostOnDark`. Meaning is carried by state (filled = primary action, dimmed = disabled), not by per-button colors. `?focus=procedures|templates` on `/kiosk/assembly/library` scrolls to the corresponding pane so the two entry buttons keep distinct behavior.
3. **Assembly record approval (組立記録確認)**: modeled on 自主検査 検査記録確認.
   - Schema: new `AssemblyWorkSessionApproval` (1:1 with `AssemblyWorkSession`, unique `sessionId`, approver employee FK + code/name/NFC-UID snapshots, comment, client device snapshot). Additive-only migration.
   - API: `POST /assembly/work-sessions/:id/record-approval/approve` (kiosk-write preHandler; 409 unless COMPLETED, 409 if already approved, 404 unknown NFC, 403 non-ACTIVE employee); `approval` field added to work-session summary and detail responses; `areaTorqueSummaries` (per-area OK/NG/IGNORED counts) added to detail; `POST /api/kiosk/assembly/record-approvals/verify-access-password` reuses the 閲覧順設定 password source (2520 family, KB-320 lineage).
   - UI: new page `/kiosk/assembly/record-approvals` (password gate → completed session list with approval filter → detail with area torque summary → approver NFC → 承認して完了; `?sessionId=` preselects). 完了した製品 cards link there and show 承認済み/未承認 badges. Home header gains a 記録確認 link.
   - Approver authority follows the self-inspection precedent: any ACTIVE employee NFC tag, no JWT role check.
4. **Multi-column panes**: 仕掛中 / 完了した製品 items become compact cards in `grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3`, keeping all previously shown fields and `min-h-11` tap targets.

## Alternatives

- Reusing the existing work-session page in read-only mode for completed review: rejected; that page is built around active torque input state.
- JWT ADMIN/MANAGER approval (old self-inspection out-of-tolerance style): rejected to keep kiosk terminals login-free, matching the current 検査記録確認 pattern.
- Making the 閲覧順設定 image endpoint unauthenticated like `pdf-pages`: rejected; weakening the storage auth boundary for a display bug is the wrong direction.

## Consequences

- Existing clients are unaffected: work-session responses only gained fields; completion flow (`POST .../complete`) unchanged.
- Approval is recorded with snapshots, so employee master changes do not corrupt history.
- One more kiosk password gate shares the existing password source; rotating it affects both screens at once (accepted trade-off).

## Validation

- `pnpm --filter @raspi-system/web test` on merged main: 261 files / 1299 tests passed; `pnpm --filter @raspi-system/web build` succeeded.
- `assembly.integration.test.ts` (13 tests, incl. approve success / non-COMPLETED 409 / double-approve 409 / unknown NFC 404) passed against a fresh `postgres-test-local` container after `prisma migrate deploy` of the full migration chain.
- `pnpm --filter @raspi-system/api build` succeeded.
- The generated migration initially contained unrelated drift statements (DROP of `photo_tool_similarity_gallery` etc.); it was hand-reduced to the new table only and re-verified with `migrate deploy` on a clean database.

## Open Items

- Production deploy and Pi 実機 migration are not executed (requires explicit user instruction).
- No dedicated approver-resolve preview endpoint; NFC is validated at approve time only.

## Local Notes JA

- 承認者は自主検査と同じく「ACTIVE社員のNFCタグ」方式。厳密な「管理者ロール承認」が必要になった場合は preHandler の差し替えで対応可能。
