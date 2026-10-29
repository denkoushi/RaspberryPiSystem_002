# Assembly check sheet: import per-machine Excel sheets and stamp each item with an employee NFC tag on the kiosk

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It is maintained in accordance with `.agent/PLANS.md` at the repository root.

## Purpose / Big Picture

Today the final assembly inspection of every machine unit is done on a printed Excel sheet ("組立最終検査チェックシート"). The worker writes values by hand and presses a personal hanko (seal) next to each row. After this change, a Pi4 kiosk standing next to the unit shows the same sheet as a one-screen checklist. For every item, the worker enters what that item asks for (OK/NG, a number with a unit, short text, a choice), then holds their employee NFC tag on the reader. The tag works as the hanko: the item gets a red round stamp with the person's family name and the time. Items that must be confirmed by a 班長 (leader), 係長 (section chief) or 制御設計担当 accept only a tag of such a person. When a check is NG, the worker chooses either 中断 (pause the sheet) or 目印を付けて次へ (flag the item and continue). When the sheet is finished, a "紙の控え" (paper copy) can be produced in the ORIGINAL Excel layout of that machine: the system writes the entered values and stamps into a copy of the original .xlsx and offers it for download, and the kiosk can show a preview of that layout.

Sheets are imported by an administrator on a PC: upload the .xlsx, the system proposes a normalized item list, the administrator fixes it in a table and saves it as a revision. When a sheet is revised, units that already started keep the revision they started with.

To see it working after all milestones: import the sample workbook in the admin screen, save it, open `/kiosk/assembly/check-sheets/<id>` on a kiosk (or a desktop browser at 1920×1080), stamp a few items with test NFC tags, mark one NG with 目印, finish, press 紙の控え, and download the filled .xlsx; opening it in Excel shows the original sheet with the values and stamp text filled in, and its embedded objects intact.

The approved screen design is the static mock `docs/design-previews/assembly-check-sheet-mock.html` (open it in a browser; it is self-contained). The kiosk page in Milestone 3 must reproduce its layout and behaviour. Read it before Milestone 3.

## Progress

- [x] (2026-10-29) Milestone 1 implementation: additive schema/migration, pure xlsx parser/normalizer, admin import/save + revision read API, shared payloads, and 23 focused tests. Sample: 22 groups / 57 items / 17 warnings. Repository-wide typecheck is blocked by errors outside this change; live DB migration/concurrency verification remains unperformed (DB unavailable).
- [x] (2026-10-29) Milestone 2 implementation: admin head list, xlsx import/review table, header/department-member editors, new/revision saves, and pure editing/payload functions. Added 13 focused web tests; web typecheck and scoped lint pass. Manual sample upload/save against a live API remains unperformed.
- [ ] Milestone 3: kiosk check-sheet page with NFC stamping, role check, NG pause/flag, conditional items.
- [ ] Milestone 4: filled original .xlsx (raw XML patch) download and kiosk layout preview.
- [ ] Milestone 5 (prototype, optional): LibreOffice headless PDF conversion feasibility on the API image.

## Surprises & Discoveries

- Observation (Milestone 2): the existing employee hook (`useEmployees`, `/tools/employees`) and revision-head endpoint cover the admin workflow without API changes. Validation responses include `issues` with paths; the screen displays these next to Save and retains the draft after failure.

- Observation (Milestone 1): bullets alone do not delimit the sample. Stamp-box borders join rows 43–44 into one item, rows 58–59 form the four-axis stroke item, and groups 21/22 have their item text in merged C:R cells. The parser uses merge masters and stamp borders; result: 22 groups, 57 items, 17 warnings across 15 items. The original file's SHA-256 was unchanged after read-only acceptance.
- Observation (Milestone 1): item 7-4 combines 有/無 and manufacturer/model blanks in different cells. Its fields are retained with `multiple_value_cells_review`; the current single-cell `valueTarget` needs human review. The condition is guessed for 7-2 through 7-6 (until the next group), and absent voltage/stroke units remain empty with `unit_unknown`.
- Observation (validation): `pnpm --filter @raspi-system/api test -- check-sheet` passes a literal `--` to Vitest 4 and starts the full suite. It was interrupted after unrelated DB `ECONNREFUSED` failures; `pnpm --filter @raspi-system/api exec vitest run check-sheet` correctly selected 3 files / 23 passing tests. The requested `tsc --noEmit` first stops at 5 pre-existing rootDir/include conflicts; the rootDir override exposed 498 diagnostics outside this change and one new test annotation error, which was fixed. No unrelated files were changed.

- Observation: exceljs drops embedded OLE objects, VML drawings, printer settings and calcChain when it rewrites a workbook. The check-sheet sheet of the sample workbook (`xl/worksheets/sheet1.xml`) references `oleObject1.bin`, `oleObject2.bin`, `vmlDrawing1.vml` and `printerSettings1.bin`.
  Evidence: unzip of the original lists `xl/embeddings/oleObject1..7.bin`, `xl/drawings/vmlDrawing1..4.vml`, `xl/printerSettings/*`; after `wb.xlsx.readFile` → `writeFile` with exceljs 4.4 none of these remain and sheets are renumbered. Merged ranges (165), print area `A1:S83`, A4 portrait fit-to-1-page survive.
- Observation: shared strings in the sample contain furigana runs (`<rPh>`), so naive text extraction yields "…締結トルク（　　  N･m）カクジツシツテイケツ". exceljs `cell.text` already ignores them; any raw-XML reader must skip `<rPh>` elements.
- Observation: the sample's item text lives in merged range F:R per row, the 主項目 in merged C:E spanning several rows, the No in A:B, and the stamp column is S (header "ﾁｪｯｸ"). Value blanks are written inside the item text as full-width-space parentheses, e.g. `締結トルク（　　  N･m）`, `（　　　）Ｎ`, `（　OK　・　NG　・　該当無し　）`. Some items span two physical rows (rows 39–40, 45–46, 47–48). Role words appear in the text: `（班長）`, `（係長）`, and in the 主項目 `IOチェック（制御設計担当）`. Header cells (date, 出荷予定日, 製品No, 製番, 製品名, 客先名) are formulas pointing to an input block outside the print area (columns U..AC).

## Decision Log

- Decision (Milestone 2): keep the admin-only pure editor functions beside the page, reuse the existing API client and React Query, and derive department pickers from item role keys plus saved member mappings (excluding rank roles). Empty header cells are omitted from the save payload; removing a row preserves the other rows' source mappings and warnings.
  Rationale: implements the review boundary without changing shared contracts, employee APIs, or kiosk code.
  Date/Author: 2026-10-29 / Codex

- Decision: Use a dedicated `AssemblyCheckSheetAsset` model; `importId` is this immutable asset's id, with unique SHA-256 and storage key, stored through the existing durable file store. Repeated imports reuse the same bytes and identity.
  Rationale: avoids changes to existing asset relations/enums and preserves OLE objects by never rewriting the uploaded workbook. Unused imports remain stored as planned.
  Date/Author: 2026-10-29 / Codex
- Decision: Employee references are Prisma relations (`onDelete: SetNull`, named FKs) with inverse lists on Employee, following the repo convention. The partial unique head index is SQL-only; future migrations must preserve it.
  Rationale: the task permits changing existing models only for the AssemblyWorkUnit inverse relation; Prisma Employee inverse relations would exceed that boundary. Snapshots retain identity after employee deletion.
  Date/Author: 2026-10-29 / Codex
- Decision: Revision saves lock the root row and atomically demote the head and insert the new revision/groups/items. The import sheet override is the `sheetName` query parameter; save revalidates the edited source sheet against the stored original.
  Rationale: serializes same-root saves without modifying existing sheets and prevents dangling source-sheet selections.
  Date/Author: 2026-10-29 / Codex

- Decision: Do not reuse `AssemblyTemplateCheckItem` / `AssemblyCheckRecord`. Add new models for check sheets.
  Rationale: existing items are boolean markers placed on a procedure drawing and records store only an operator name string; a check sheet needs typed inputs, per-item role requirements, NG handling and an employee FK with snapshots.
  Date/Author: 2026-10-29 / Claude
- Decision: A check sheet hangs off `AssemblyWorkUnit` (one unit = one sheet instance), not off `AssemblyTemplate`.
  Rationale: `AssemblyTemplate.procedureDocumentId` is mandatory and represents a procedure drawing; machines will get check sheets before or without procedure documents. Linking to the work unit gives "1台1枚" directly and keeps future side-by-side display with procedures possible.
  Date/Author: 2026-10-29 / Claude
- Decision: Revisions copy the procedure-document pattern: `revisionRootId` + `revisionNumber` + `isRevisionHead`. A unit's sheet stores the exact revision id it started on and never moves.
  Rationale: requirement "改訂時、作業中の台は古い版のまま".
- Decision: The paper copy uses each machine's original Excel layout (user decision 2026-10-29). It is produced by patching cell values directly in the original .xlsx package XML (unzip, edit `xl/worksheets/sheetN.xml` cells as inline strings, re-zip), not by exceljs rewrite.
  Rationale: exceljs loses the OLE objects and printer settings of the sample (see Surprises). Patching only the needed `<c>` elements keeps everything else byte-identical.
- Decision: The kiosk preview of the paper copy is an HTML rendering of the original sheet's print area (merged cells, column widths, row heights, borders, alignment, font size) built from a layout snapshot captured at import time with exceljs (reading only, never writing), with the entered values and stamps overlaid. A true PDF is a later prototype (Milestone 5).
  Rationale: no PDF writer or LibreOffice exists in the API image today; adding LibreOffice to the arm64 image is a size/feasibility question that should not block the feature.
- Decision: Import/review is an admin (PC) page under `/admin`, not a kiosk page.
  Rationale: uploading .xlsx files and editing a 57-row table is PC work.
- Decision: Item role requirement is stored as a list of role keys: `leader` (班長), `section_chief` (係長), and free department labels such as `制御設計担当`. Rank roles are checked with `Employee.positionName` mapped through the existing `apps/api/src/services/knowledge/knowledge-position-rank.ts` (rank at or above the required one passes). Department labels are checked against an explicit allow-list of employee ids kept per sheet revision (edited in the review screen). An employee with null `positionName` passes only items with no role requirement.
  Rationale: 制御設計担当 is not a rank; a small explicit list is predictable and auditable.
- Decision: 梱包チェックシート and the link from NG flags to the 問題点 sheet are out of scope (user decision 2026-10-29: 梱包 later).
- Decision: Units (V, mm, N·m …) and conditional ranges (e.g. "モータブラケットが一体でない場合" covering 7-2..7-5) are guessed by the normalizer and confirmed/fixed by a human in the review screen (user decision 2026-10-29).

## Outcomes & Retrospective

Milestone 1 (2026-10-29): implemented only the data/import/revision boundary. Added 7 tables and 3 enums; existing stored tables are unchanged. The migration was generated with an offline schema diff and augmented with additive Employee FKs and a unique head index. Prisma validate/generate, shared-types build, focused typecheck (new files plus dependencies and existing Fastify declarations), API scoped ESLint and shared-types ESLint passed.
Parser, storage/service and route contract tests use synthetic ExcelJS workbooks and mocked persistence; customer data is not in the repository.
The acceptance script/result live outside the repository under `$TMPDIR` and the original workbook was read only. No live DB migration was applied; real DB locking/rollback behaviour is not yet exercised. No Milestone 2+ UI, stamping endpoints, paper export, commit, push, merge or deployment was performed.

## Context and Orientation

The repository is a pnpm monorepo. `apps/api` is a Fastify + Prisma (PostgreSQL) server, `apps/web` is a React + Vite + Tailwind app served to kiosks (Raspberry Pi 4 with a 1920×1080 screen running Chromium) and to admins on PCs, `packages/shared-types` holds types shared by both. Tests use vitest in both apps (`pnpm --filter @raspi-system/api test`, `pnpm --filter @raspi-system/web test`; check the exact package names in each `package.json`).

Relevant existing code:

The Prisma schema is `apps/api/prisma/schema.prisma`. Assembly models start around line 2837 (`AssemblyWorkSessionStatus`) through ~4300. `AssemblyWorkUnit` (mapped table `AssemblySerialRegistry`, field `workId` is the per-unit id) is the "one unit" entity. `AssemblyWorkSessionApproval` shows the snapshot style to copy for stamps (approverEmployeeId plus code/name/nfcTagUid snapshots and client device). `AssemblyProcedureDocumentRevision` shows the revision pattern. `AssemblyProcedureAsset` (enum `AssemblyProcedureAssetKind { SOURCE OVERLAY_IMAGE }`) stores uploaded files with `storageKey`, `sha256`, `byteSize`, `contentType`, `originalFileName`. Migrations live in `apps/api/prisma/migrations/YYYYMMDDHHMMSS_snake_case/migration.sql`; the newest is `20261029120000_mobile_scan_frames`, so use a later timestamp. Index names are explicit (`@@index(..., map: "Model_idx_xxx")`). Rollouts are expand-first: only add tables/nullable columns.

Assembly API routes are in `apps/api/src/routes/assembly/` (registrar `index.ts`, auth split into allowView / allowWriteKiosk as in `work-sessions.ts`), services in `apps/api/src/services/assembly/`. Kiosk-side auth helpers are in `apps/api/src/routes/kiosk/assembly-*-auth.ts`. NFC tag → employee resolution is `apps/api/src/services/assembly/assembly-operator-nfc-resolve.service.ts` (finds ACTIVE employee by `nfcTagUid`, returns id, code, displayName, nfcTagUid; extend or wrap it to also return `positionName`). Position ranks: `apps/api/src/services/knowledge/knowledge-position-rank.ts` (`KNOWLEDGE_POSITION_RANKS = ['general','leader','section_chief','manager','general_manager','executive']`). File storage: `getFileStorageRoot()` / `getFileStorageRuntime()` as used in `apps/api/src/lib/assembly-procedure-image-storage.ts`; uploads use `@fastify/multipart`. exceljs ^4.4.0 is already a dependency of apps/api (`apps/api/src/services/assembly/assembly-excel-export.service.ts` is an example of use). jszip is a transitive dependency of exceljs; add it as a direct dependency of apps/api at the same major version for the raw XML patch.

Web: routes are declared in `apps/web/src/App.tsx` (kiosk assembly routes around lines 247–271, path constants in `apps/web/src/features/assembly/assemblyRoutes.ts`), kiosk pages in `apps/web/src/pages/kiosk/KioskAssembly*.tsx`, admin pages in `apps/web/src/pages/admin/`. NFC on kiosk pages comes from `useNfcStream(enabled, policy, options)` in `apps/web/src/hooks/useNfcStream.ts`; `apps/web/src/features/assembly/AssemblyOperatorNfcDialog.tsx` shows how assembly uses it. The assembly home is `/kiosk/assembly` (`KioskAssemblyHomePage`).

Terms: "item" = one checkable row (57 in the sample). "group" = 大項目/主項目 (22 in the sample). "stamp" = the record that an employee confirmed an item with their NFC tag. "flag" (目印) = an NG item the worker chose to pass for now; it stays listed until re-checked OK. "conditional item" = an item that applies only if a stated condition holds; the worker can mark the whole condition 該当なし and its items get an N/A stamp. "role item" = an item that only certain employees may stamp.

## Plan of Work

### Milestone 1: data model, parser, import and save API

Add to `schema.prisma` (one migration):

`AssemblyCheckSheetRevision`: id, revisionRootId, revisionNumber (unique with root), isRevisionHead, documentNo (e.g. `産3-A002BBC-1`), title, modelCode (the machine/model this sheet is for, free text matched by admins), revisionLabel (e.g. `△1 2026.10.15`), sourceAssetId (FK to the stored original .xlsx), sourceSheetName, layoutSnapshot (Json, Milestone 4 fills it; nullable now), headerCellMap (Json: field key → cell address, e.g. `{"date":"D3","shipDate":"I3","productNo":"Q3","seiban":"Q4","productName":"D4","customer":"K6"}`), stampColumn (e.g. `S`), departmentRoleMembers (Json: label → employeeId[]), createdByUserId, createdAt.

`AssemblyCheckSheetGroup`: id, revisionId, groupNo (int), label, sortOrder.

`AssemblyCheckSheetItem`: id, revisionId, groupId, itemKey (e.g. `6-3`), sortOrder, label (cleaned text), note (nullable, e.g. `※締結トルクはメーカー推奨値参照`), inputKind (enum `OK_NG | NUMBER | TEXT | CHOICE | NONE`), inputSpec (Json: for NUMBER `{fields:[{key,label,unit}]}` (multiple fields allowed, e.g. X/Y/Z/θ strokes), for CHOICE `{options:[...]}`, for TEXT `{fields:[{key,label}]}`), roleKeys (String[]), conditionKey (nullable string; items sharing the same key form one condition), conditionLabel (nullable), sourceRows (Int[] physical row numbers), stampCell (e.g. `S41`), valueTarget (Json: either `{mode:"cell", cell:"T41"}` or `{mode:"inline", cell:"F41", template:"・クランプボルトサイズ（M{size}）締結トルク（{torque} N･m）"}`).

`AssemblyCheckSheet` (one per unit): id, workUnitId (unique, FK AssemblyWorkUnit), revisionId (FK, onDelete Restrict), status (enum `IN_PROGRESS | PAUSED | COMPLETED`), header values Json (productNo, seiban, productName, shipDate, customer), startedAt, completedAt, completedByEmployeeId + snapshots, pausedReason nullable, clientDeviceId nullable.

`AssemblyCheckSheetStamp`: id, sheetId, itemId (unique pair), result (enum `OK | NG | NA`), values (Json keyed by inputSpec field keys), flagged (bool), employeeId FK + employeeCodeSnapshot, employeeNameSnapshot, nfcTagUidSnapshot, positionNameSnapshot, clientDeviceId, stampedAt. Re-stamping an item overwrites it but appends the previous row to `AssemblyCheckSheetStampHistory` (same columns plus supersededAt) so NG→OK is auditable.

Add `CHECK_SHEET_SOURCE` to `AssemblyProcedureAssetKind` (or, if adding an enum value is awkward with the expand-first rule, a dedicated `AssemblyCheckSheetAsset` model with the same columns; record the choice).

Parser/normalizer in `apps/api/src/services/assembly/check-sheet/` (new folder): `check-sheet-xlsx-parser.ts` reads the workbook with exceljs (read only), picks the sheet whose name contains `チェックシート` and not `梱包` (the admin can override by name), finds the header row (cells containing `Ｎｏ`/`No`, `主`+`項`+`目`, `チ`…`項`…`目`, `ﾁｪｯｸ`/`チェック`), then walks rows below it until a row whose A cell starts with `制` `定` (制定年月日) or the print area ends. It must use the merge master value only once per merged range, use `cell.text` (no furigana), normalize width (NFKC for half-width katakana and full-width digits/letters, keep the 全角 space handling explicit), strip the leading `・`/`･`, and join continuation rows (rows whose F text continues the previous item and have no new bullet) into one item. `check-sheet-normalizer.ts` turns parsed rows into the proposal: groups from the No/主項目 columns; inputKind NUMBER with one field per blank `（ … unit）` found in the text (unit read from the text after the blank: `N･m`→`N·m`, `Ｎ`→`N`, `個`→`個`, otherwise empty for a human to fill); CHOICE for `（OK・NG・該当無し）`-style or `有・無`; TEXT for blanks without a unit (e.g. `使用ボルトは合っているか（　　　）区分（　　）` gives two TEXT fields); OK_NG otherwise. Role keys from `（班長）` → `leader`, `（係長）` → `section_chief`, `（…担当）` in group label → that department label. Condition: a row starting with a condition sentence such as `…場合は以下の確認を実施すること` becomes conditionLabel and applies to following items until the next group (the human fixes the range). The proposal lists `warnings` per item (unit unknown, condition guessed, role guessed). Keep the parser pure (input Buffer → JSON) so it is unit-testable.

API (register in `apps/api/src/routes/assembly/index.ts`, admin-only write):

    POST /api/assembly/check-sheets/imports            multipart .xlsx → { importId, sheetNames, proposal }
    POST /api/assembly/check-sheets/revisions          { importId, proposal(edited), revisionRootId? } → saved revision (new root, or next revisionNumber of the given root; previous head loses isRevisionHead)
    GET  /api/assembly/check-sheets/revisions          list heads (and ?rootId= for history)
    GET  /api/assembly/check-sheets/revisions/:id      full revision with groups and items

The uploaded file is stored immediately (sha256 dedup) so `importId` can reference it; an unused import can be left (no cleanup job in this plan).

Tests: build small synthetic workbooks in the test with exceljs (merged C:E group cells, F:R item text with furigana-free strings, an `（　　  N･m）` blank, a `（班長）` item, a conditional sentence, a two-row item) and assert the proposal. Do not commit the customer workbook. Route tests follow `apps/api/src/routes/assembly/__tests__/*.routes.test.ts`.

Acceptance: `pnpm --filter @raspi-system/api test -- check-sheet` passes; running the parser on `/Users/tsudatakashi/Downloads/組立最終検査ﾁｪｯｸｼｰﾄ 産3-A002BBC-1.xlsx` with a throwaway script (not committed) yields 22 groups and 57 items (if the count differs, record why in Surprises; the human-fixable proposal is still acceptable).

### Milestone 2: admin import and review screen

Add `apps/web/src/pages/admin/AssemblyCheckSheetsPage.tsx` (route `/admin/assembly-check-sheets`, linked from the admin navigation next to other assembly admin entries). It lists revision heads (document no, title, model code, revision, saved date) and has an import button. After upload it shows the proposal as an editable table: group, item key, label, input kind (select), fields with unit, role keys, condition key/label, stamp cell, value target; warning rows are highlighted. A small header-cell map editor and the department-role member picker (employees) sit above the table. Save calls the revisions endpoint; when importing a new version of an existing sheet the admin picks "既存シートの改訂として保存" with the root. Follow existing admin page styling; do not add explanatory helper text (repository rule: no auxiliary labels, layout communicates).

Acceptance: web tests for the page (render proposal, edit a unit, save payload), and manually: upload the sample, fix warnings, save, list shows the revision.

### Milestone 3: kiosk check-sheet page

API (kiosk auth as in work-sessions):

    POST /api/assembly/check-sheets               { workUnitId, revisionId? } → creates the unit's sheet on the current head revision of the chosen root (or returns the existing one)
    GET  /api/assembly/check-sheets/:id           sheet + its revision items + stamps
    POST /api/assembly/check-sheets/:id/stamps    { itemId, result, values, flagged, nfcTagUid, clientDeviceId } → resolves the tag server-side, enforces role (403 with code CHECK_SHEET_ROLE_REQUIRED and the required role labels), stores stamp + history
    POST /api/assembly/check-sheets/:id/conditions { conditionKey, applies:false, nfcTagUid } → NA stamps for that condition's items
    POST /api/assembly/check-sheets/:id/pause | /resume | /complete   (complete requires every item to be stamped OK or NA; flagged NG items must be re-stamped OK first; NG with 中断 sets status PAUSED)

Web: new route `/kiosk/assembly/check-sheets/:sheetId` (constant in `assemblyRoutes.ts`), page `apps/web/src/pages/kiosk/KioskAssemblyCheckSheetPage.tsx` with components in `apps/web/src/features/assembly/checkSheet/`. Entry: from the assembly home / work-unit view, a button to open (or start) the unit's check sheet; pick the smallest change that fits the current home board, and record it.

Layout must match the mock `docs/design-previews/assembly-check-sheet-mock.html`: a fixed 1920×1080 stage scaled to the window (`transform: scale(min(innerWidth/1920, innerHeight/1080))`, page itself never scrolls). Top bar: 組立 back, sheet title, document no + revision, 製番, 製品名, 出荷予定日, progress `24 / 57` with bar, 中断. Left (680px): one row per group, one round cell per item (states: stamped = vermilion seal with family-name initial; NG flagged = amber "!"; current = cyan with ring; N/A; role item = small purple dot), tapping a cell jumps to it. Center: the previously stamped item as a thin strip, the focus card (item key + group, role tag, revision, 30px question, note, condition 該当/該当なし buttons, input controls 56px high, OK/NG, NG box with 中断 / 目印を付けて次へ, NFC prompt pill, 156px seal slot), then the next items list fading out at the bottom. Right (330px): current worker box, 目印 list (fills remaining height, scrolls inside), then 紙の控え and 完了 buttons with remaining count. Paper-copy overlay opens only from the 紙の控え button. The mock's "試し：タグ" bar is a mock-only simulator: do not ship it. Read NFC with `useNfcStream`; a scan while an item is ready submits the stamp; errors (role mismatch, unknown tag) show a short toast as in the mock. Reuse the vermilion seal and NFC prompt look from the mock; keep text minimal.

Acceptance: API route tests for stamping, role rejection, NA condition, flag/complete rules, revision pinning (create sheet, save a new revision, the existing sheet still returns the old revision's items). Web tests for the page (renders map and focus card from a fixture, NFC event stamps, role error toast, NG → 目印 adds to the list). Visual check of the page at 1920×1080 and at 1280×720 (whole page fits, no page scroll).

### Milestone 4: paper copy

At save time (Milestone 1 endpoint), also compute `layoutSnapshot` with exceljs from the stored source: the print-area range, column widths (px), row heights (px), merged ranges, and per-cell text, font size/bold, horizontal/vertical alignment, borders (thin/medium/none per side), wrap. Keep it under ~500 KB.

`apps/api/src/services/assembly/check-sheet/check-sheet-xlsx-filler.ts`: input = original .xlsx Buffer, sheet name, list of `{cell, text}` writes; output = new Buffer. Implementation: open with jszip, resolve the sheet's part path via `xl/workbook.xml` + `xl/_rels/workbook.xml.rels`, edit only the target `<c r="…">` elements in that sheet XML (replace content with `t="inlineStr"` `<is><t xml:space="preserve">…</t></is>`, keep the `s` style attribute; create the `<c>` in the right `<row>` in column order if missing), remove `<f>` from overwritten formula cells, delete `xl/calcChain.xml` and its references in `[Content_Types].xml` and the workbook rels if present, set `fullCalcOnLoad="1"` on `<calcPr>`, and leave every other zip entry untouched. Writes: stamp cell ← `山田 10/29 09:12` (NA → `該当なし 山田`, NG flagged → `NG 山田`), value targets per item (cell mode writes the formatted value; inline mode rebuilds the item text from its template), header cells from the sheet's header values.

API: `GET /api/assembly/check-sheets/:id/paper.xlsx` (download, filename `<documentNo>_<seiban>.xlsx`) and `GET /api/assembly/check-sheets/:id/paper-layout` (layoutSnapshot + the same writes). Kiosk overlay renders the layout as an HTML table scaled to fit, with stamps drawn as vermilion seals in stamp cells, and has 印刷 (browser print of the overlay only) and 閉じる. Admin list gets a download link per completed sheet.

Acceptance: unit test with a synthetic workbook that contains a formula cell, a merged range and an extra arbitrary zip entry (e.g. `xl/embeddings/oleObject1.bin` added via jszip): after filling, the target cells contain the text, the formula is gone from that cell only, the extra entry is byte-identical, and exceljs can still read the file. Manual: fill the sample workbook through the API and open it in Excel/LibreOffice on a PC; embedded objects remain.

### Milestone 5 (prototype, optional, separate PR)

Evaluate adding LibreOffice headless to the API Docker image (check `apps/api/Dockerfile` base image and architecture) to convert the filled .xlsx to PDF, then reuse `apps/api/src/lib/pdf-converter.ts` (pdftoppm) for page images. Promote only if image size growth and conversion time on the server are acceptable; otherwise discard and keep the HTML preview.

## Concrete Steps

Work in the worktree `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--assembly-check-sheet` on branch `feat/assembly-check-sheet`. Do not commit, push or run git history commands; the orchestrator commits.

    pnpm install --frozen-lockfile        (after adding jszip in Milestone 4: pnpm --filter @raspi-system/api add jszip@^3)
    pnpm --filter @raspi-system/api exec prisma migrate dev --create-only --name assembly_check_sheets   (if a local DB is unavailable, write migration.sql by hand following existing migrations and run prisma validate + prisma generate)
    pnpm --filter @raspi-system/api test -- check-sheet
    pnpm --filter @raspi-system/web test -- CheckSheet
    pnpm lint && pnpm typecheck        (use the scripts that exist in the root package.json)

## Validation and Acceptance

Per milestone as stated above. Final: the scenario in Purpose works end to end in a local dev environment; all new tests pass; existing assembly tests still pass.

## Idempotence and Recovery

The migration only adds tables, enums and (if chosen) one enum value; rolling back the app leaves unused tables. Import is repeatable (sha256 dedup of the file, a new proposal each time). Saving a revision is a single transaction. The xlsx filler never modifies the stored original; it always works on a copy in memory.

## Interfaces and Dependencies

Shared types for proposal, revision, sheet and stamp payloads go in `packages/shared-types` (follow existing assembly type files there). New direct dependency: jszip ^3 in apps/api. No changes to deploy scripts, Ansible, or kiosk client software.

Plan update (2026-10-29 / Codex): recorded Milestone 1 implementation, acceptance counts, SQL-owned constraints, parser review warnings and local validation limits; later milestones remain unchanged.
