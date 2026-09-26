# Kiosk inventory screens: one daily NFC screen and a separate setup screen

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It is maintained in accordance with `.agent/PLANS.md` at the repository root.

## Purpose / Big Picture

The Raspberry Pi item inventory (the `ItemlistRaspi` workflow described in `docs/plans/raspi-item-inventory-execplan.md`) is still in development and has not been put into use. Its kiosk screens are hard to use on a touch panel without a physical keyboard. Everyday work and rare setup work share one long page, NFC reads need a button press before each read, and several fields need a keyboard. The only way in is a browser `window.prompt` password dialog.

After this change, a worker at a kiosk can do everything daily without a keyboard or a password. They hold an item's NFC tag to the reader and see its photo, stock, and place. They hold a quantity tag to take items out, or the restock tag first to put items back. If the stock count is wrong, they can correct it with a large on-screen keypad. They can undo the last action. A worker whose item tag is missing can pick the item by touching area, shelf, and drawer buttons. Setup work lives on a separate screen behind the existing 4-digit password, which is typed on an on-screen keypad. That work is registering candidates received by mail, adding shelves and drawers, registering quantity and restock tags, swapping item tags, and editing items. On that screen, tags are read just by holding them to the reader.

The approved visual mockup is the Design canvas "キオスク在庫画面モック" (https://claude.ai/artifact/YRtMfKkfaNQHFybdkbWrte, boards 1 to 8). The mockup shows layout intent only. Where this plan and the mockup differ, this plan wins.

## Progress

- [x] (2026-09-26) Read the current kiosk inventory code, API authorization, service methods, tests, NFC routing, and the kiosk keyboard component; recorded findings below.
- [x] (2026-09-26) User approved the flow: stock checking and correction are merged into the daily 在庫操作 screen without a password; setup stays separate with the password.
- [x] (2026-09-26) Milestone 1: API allows kiosk stock correction without the password, guarded by an expected-before check, and history can be filtered by compartment. Web client and `useInventoryCompartmentHistory` hook added. Focused API tests 27/27 pass; api and web type checks pass.
- [x] (2026-09-26) Milestone 1 merged as PR #1506 (merge SHA 60ba5c25); main CI green.
- [x] (2026-09-26) Milestone 2: Daily 在庫操作 screen shows item detail, recent history, touch correction with undo, and a tag-less picker; header tab renamed 在庫 and pointed at `/kiosk/inventory`. Related web tests 28/28 and `tsc -b` pass. Real-kiosk screen check is left to Milestone 6.
- [ ] Milestone 3: Kiosk setup screen gets an on-screen PIN keypad and a tabbed shell, with the NFCタグ and 棚・引き出し tabs.
- [ ] Milestone 4: Kiosk setup 登録待ち tab becomes a step-by-step registration flow with automatic NFC reads.
- [ ] Milestone 5: Kiosk setup アイテム編集 tab (move, item tag swap, photo order and delete, item delete); the kiosk stops using the admin page component.
- [ ] Milestone 6: Knowledge record and final verification on a kiosk-sized viewport.

## Surprises & Discoveries

- Observation: The kiosk has a touch panel and no physical keyboard. The shared on-screen keyboard only types A to Z and 0 to 9, so it cannot enter Japanese item names.
  Evidence: `apps/web/src/components/kiosk/KioskKeyboardModal.tsx` defines `NUMBER_KEYS` and `LETTER_ROWS` only. `docs/knowledge-base/frontend.md` records that touch-panel kiosks lack a keyboard. Some Pi4 kiosks do run IBus and mozc for Japanese input (`docs/knowledge-base/KB-investigation-kiosk-ime-and-power-regression.md`), but that needs a keyboard.
- Observation: Every setup and correction endpoint currently requires the 4-digit password header `x-kiosk-access-password`. Only transactions and the terminal's own last cancel work without it.
  Evidence: `apps/api/src/routes/item-inventory/index.ts`. `POST /item-inventory/corrections` uses `authorizeManageOrKiosk`. `POST /item-inventory/transactions` uses `writeOrKiosk`. `cancelWrite` falls back to `writeOrKiosk` when no password header is present.
- Observation: The history API cannot filter by item or compartment. It only returns the newest N rows overall.
  Evidence: `GET /item-inventory/history` parses only `limit`, and `ItemInventoryService.listHistory(limit)` in `apps/api/src/services/item-inventory/item-inventory.service.ts` has no `where`.
- Observation: Stock correction writes an absolute value with no check that the stock is still what the worker saw.
  Evidence: `correctStock` locks the row, then sets `stockQuantity = desiredQuantity` unconditionally.
- Observation: The global inventory NFC router ignores tags only on `/kiosk/inventory/settings`. Everywhere else, an inventory tag navigates to `/kiosk/inventory`.
  Evidence: `apps/web/src/features/kiosk/InventoryNfcRouter.tsx`, `useNfcStream(location.pathname !== '/kiosk/inventory/settings', …)`.
- Observation: The kiosk settings route renders the admin page component `RaspiInventoryPage`, which is also mounted at `/admin/tools/raspi-inventory`. It needs an explicit button press ("読み取り") before each NFC read.
  Evidence: `apps/web/src/pages/kiosk/KioskItemInventorySettingsPage.tsx` returns `<RaspiInventoryPage accessPassword=… />`. In `apps/web/src/pages/admin/RaspiInventoryPage.tsx`, `armNfcTarget` sets `scanTarget`.
- Observation: The daily page has no header tab. Workers reach it only by holding an inventory tag. The header tab `inventory_settings` (label 在庫設定) points to the settings route.
  Evidence: `apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderTabLabels.ts` and `kioskHeaderReorderableTabRenderer.tsx`, case `'inventory_settings'`.
- Observation: `item-inventory.service.test.ts` uses in-memory mocks, not a real database, so it runs locally without PostgreSQL. A fresh worktree needs `pnpm install` and a build of every `packages/*` workspace before `tsc` works.
  Evidence: the `inventoryState` helper in that test file; `tsc` reported missing `@raspi-system/shelf-layout-core` until the packages were built.

## Decision Log

- Decision: Stock checking and correction live on the daily 在庫操作 page (`/kiosk/inventory`), not on a separate page.
  Rationale: Workers already hold tags there. Merging avoids a third screen. User decision on 2026-09-26.
  Date/Author: 2026-09-26 / user, recorded by Claude.
- Decision: Kiosk stock correction needs only a registered kiosk client key, like transactions. The password stays for setup work.
  Rationale: The same field workers do both daily and setup work. The user wants daily correction without a password. The client key still limits corrections to registered terminals, and every correction is recorded with the terminal's `clientId`.
  Date/Author: 2026-09-26 / user, recorded by Claude.
- Decision: The correction request gains an optional `expectedBeforeQuantity`. When present and different from the locked current stock, the API returns 409 `INVENTORY_CONFLICT` and changes nothing.
  Rationale: The screen shows "いまの記録 12 → 数えた数 9". Without the check, a transaction made by another terminal between opening and confirming the screen would be silently overwritten. The field is optional, so the admin page keeps working unchanged. It also makes an accidental double submit fail instead of writing a second zero-delta row.
  Date/Author: 2026-09-26 / Claude.
- Decision: Keep the setup route at `/kiosk/inventory/settings` and keep the header tab id `inventory_settings`. Change the tab's label to 在庫 and point it at `/kiosk/inventory`, active for any path that starts with `/kiosk/inventory`. The daily page links to setup with a 在庫の準備 button.
  Rationale: The tab id is part of the shared type `KioskReorderableHeaderTabId` and of saved per-terminal tab orders, so renaming it would break saved orders. The settings path is what disables global NFC routing during setup, so moving it would need router changes for no benefit.
  Date/Author: 2026-09-26 / Claude.
- Decision: The admin page `/admin/tools/raspi-inventory` (`RaspiInventoryPage`) stays as it is for PC use with a keyboard. The kiosk setup gets its own components under `apps/web/src/features/kiosk/inventory/`. Shared pure helpers may be extracted when both need them.
  Rationale: This keeps the admin path working and testable while the kiosk UI is rebuilt. Milestone 5 removes the kiosk's dependency on the admin component.
  Date/Author: 2026-09-26 / Claude.
- Decision: The password unlock lasts while the worker stays on the setup page. Leaving the page (unmounting it) forgets the password. No timer.
  Rationale: This is today's behaviour: `accessPassword` lives in React state of `KioskItemInventorySettingsPage`. The mockup text says 在庫操作に戻るとロック, which matches. A timer would add state without a stated need.
  Date/Author: 2026-09-26 / Claude.
- Decision: The daily correction keypad reuses the existing `apps/web/src/features/kiosk/KioskDigitTenkey.tsx` with larger key classes, instead of moving `NumericKeypad` out of `RaspiInventoryPage.tsx`.
  Rationale: A kiosk tenkey already exists and is used by other kiosk screens, and the admin page and its tests stay untouched.
  Date/Author: 2026-09-26 / Claude.
- Decision: The success panel reuses the existing message area and the existing 直前の取引を取消 button, instead of a separate large いまの取引を取り消す button.
  Rationale: The existing button already undoes the last issue, restock or correction, and the existing tests pin its name.
  Date/Author: 2026-09-26 / Claude.
- Decision (was open; user approved 2026-09-26): In the kiosk registration flow, the 名前など step is optional. It is prefilled with the current default (`ItemlistRaspi <sourceItemId>`), and model and usage are left blank. The step offers the ordinary text input, which works on terminals with a keyboard and IBus. Japanese renaming on keyboard-less terminals is done later on the admin PC page.
  Rationale: The on-screen keyboard cannot type Japanese, and building a kana keyboard is outside this scope. Ask the user before Milestone 4 whether this default is acceptable.
  Date/Author: 2026-09-26 / Claude.

## Outcomes & Retrospective

Not started.

## Context and Orientation

The repository is a pnpm monorepo. `apps/api` is a Fastify server written in TypeScript with Prisma for PostgreSQL. `apps/web` is a React single-page app built with Vite, using TanStack Query for server state and Tailwind CSS classes for styling. Both use Vitest for tests.

A "kiosk" is a Raspberry Pi terminal with a touch panel and an NFC reader, running the web app full-screen under `/kiosk/...`. Each kiosk sends a secret client key header `x-client-key` that identifies it as a registered "client device". An "NFC event" is one tag read. `apps/web/src/hooks/useNfcStream.ts` delivers the reads to React components as `{ uid, eventId?, timestamp }`, and subscribers declare a `role`.

Inventory concepts, all in Prisma models used by `apps/api/src/services/item-inventory/item-inventory.service.ts`:

- An "item" (`InventoryItem`) has name, code, model, usage, category, area, note, and photos.
- A "compartment" (`InventoryCompartment`) is one drawer holding one item type with its own `stockQuantity`. It has an "item tag", an NFC tag stuck on that drawer.
- A drawer belongs to a shelf, and a shelf belongs to an area. The area is a text such as `30007_KSJP-55`.
- A "quantity tag" is an NFC tag meaning "N pieces".
- The "restock tag" switches the next operation from taking out to putting back.
- Each stock change writes an `InventoryTransaction` row with `action` (ISSUE, RESTOCK, CORRECTION, CANCEL…), `delta`, `beforeQuantity`, `afterQuantity`, and `clientId`.
- Cancelling is allowed only for the newest transaction of a compartment, and only while stock still equals that row's `afterQuantity`. Without the password, only the same terminal's own transaction can be cancelled.

Files that matter:

- `apps/api/src/routes/item-inventory/index.ts` holds all HTTP routes and their authorization.
  - `writeOrKiosk` accepts an admin or manager JWT, or a registered client key.
  - `authorizeManageOrKiosk` additionally requires the 4-digit password header when used from a kiosk.
  - `cancelWrite` picks between the two depending on whether the password header is present.
- `apps/api/src/routes/item-inventory/cancel-authorization.test.ts` holds the route-level authorization tests. Copy its setup pattern for new route tests.
- `apps/api/src/services/item-inventory/item-inventory.service.ts` holds `correctStock`, `cancelTransaction`, and `listHistory`. Tests are in `apps/api/src/services/item-inventory/__tests__/item-inventory.service.test.ts`.
- `apps/web/src/api/domains/item-inventory.ts` holds the HTTP client functions and types. `apps/web/src/api/hooks/item-inventory.ts` holds the TanStack Query hooks, and `useInventoryMutations(accessPassword?)` returns every mutation.
- `apps/web/src/pages/kiosk/KioskItemInventoryPage.tsx` is the daily 在庫操作 page. It queues NFC events that arrive through router state from `InventoryNfcRouter`, resolves each tag, and runs item → quantity or restock → item → quantity. It resets after 30 seconds without activity, and offers 選択をリセット and 直前の取引を取消. Tests are in `KioskItemInventoryPage.test.tsx`.
- `apps/web/src/pages/kiosk/KioskItemInventorySettingsPage.tsx` asks for the password with `window.prompt`, verifies it through `POST /kiosk/item-inventory/settings/verify-access-password`, then renders the admin component. Tests are in `KioskItemInventorySettingsPage.test.tsx`.
- `apps/web/src/features/kiosk/InventoryNfcRouter.tsx` sends inventory tags from any kiosk page to `/kiosk/inventory`, except on the settings path.
- `apps/web/src/features/kiosk/kioskTheme.ts` holds the shared kiosk Tailwind class names. Use them instead of new ad-hoc colours.
- `apps/web/src/components/kiosk/InventoryPhotoDialog.tsx` is the enlarged photo view, already used by both pages.
- `apps/web/src/App.tsx` holds the routes `/kiosk/inventory` and `/kiosk/inventory/settings`.

## Plan of Work

### Milestone 1: API for password-free correction and per-compartment history

At the end of this milestone, a kiosk with only its client key can correct stock, a stale correction is refused, and history can be read for one compartment. Nothing in the web app changes yet, and the admin page keeps working.

In `apps/api/src/routes/item-inventory/index.ts`, add a pre-handler `correctionWrite` shaped like `cancelWrite`. If the password header is present, it calls `authorizeManageOrKiosk`, so an existing admin-page caller that sends the password keeps the same behaviour and the same failed-attempt limit. Otherwise it calls `writeOrKiosk`. Use it for `POST /item-inventory/corrections`. Extend that route's body schema with `expectedBeforeQuantity: z.number().int().min(0).optional()` and pass it to the service.

In `ItemInventoryService.correctStock`, add an optional last parameter `options: { expectedBeforeQuantity?: number } = {}`. After the `FOR UPDATE` lock and the lookup, throw `new InventoryConflictError('在庫が変わりました。もう一度数えてください')` when `options.expectedBeforeQuantity !== undefined` and it differs from `compartment.stockQuantity`. The existing `mapMutationError` turns this into HTTP 409.

For history, extend the `GET /item-inventory/history` query schema with `compartmentId: z.string().uuid().optional()`. Change `listHistory(limit, filter: { compartmentId?: string } = {})` to add `where: filter.compartmentId ? { compartmentId: filter.compartmentId } : undefined`.

Tests:

- In `item-inventory.service.test.ts`, add a correction test. It succeeds with a matching `expectedBeforeQuantity`, and with a different one it throws and leaves stock and history unchanged. Follow the existing test "refuses cancellation when a newer transaction changed the balance".
- In `cancel-authorization.test.ts` (it already holds the shared route mocks), add three route tests plus a history filter test:
  - A kiosk client key without a password can post a correction.
  - A request with a wrong password header is still rejected with 403.
  - A request with neither a JWT nor a client key is rejected.

### Milestone 2: the daily 在庫操作 screen

At the end of this milestone, the daily page matches mockup boards 1 to 5. Holding tags behaves exactly as today, so existing tests keep passing.

Split `KioskItemInventoryPage.tsx`, which is already long, into a page that owns the NFC queue and flow state, plus small presentational components in a new folder `apps/web/src/features/kiosk/inventory/`:

- `InventoryWaitingPanel`: the large "アイテムのタグをかざしてください" prompt with the two scan-order hints.
- `InventoryItemPanel`: photos, name, code, stock, and place. It shows "数量タグをかざすと持ち出します", or the restock wording in restock mode.
- `InventoryRecentHistory`: the three newest rows for the compartment, from a new hook `useInventoryCompartmentHistory(compartmentId)` that calls `getInventoryHistory(3, compartmentId)`.
- `InventoryResultPanel`: success or error after a transaction, with 在庫 before → after and a large いまの取引を取り消す button bound to the existing `cancelLast`.
- `InventoryCorrectionPanel`: the before → after display, a numeric keypad, and a confirm button. Reuse the keypad logic of `NumericKeypad` in `RaspiInventoryPage.tsx` by moving it to `apps/web/src/features/kiosk/inventory/NumericKeypad.tsx` with larger kiosk sizes. Import it from both places.
- `InventoryLocationPicker`: area → shelf → drawer buttons built from `useInventoryItems()`, with no typing.

Behaviour to add in the page:

- While an item is selected, a 数が合わないときは直す button opens the correction panel. Opening it pauses the 30-second reset, and closing it resumes the reset.
- Confirming calls `mutations.correction.mutateAsync({ compartmentId, desiredQuantity, expectedBeforeQuantity: shownStock })` without a password. On success, show the result panel ("記録を N 個 減らしました／増やしました", 12 → 9) and set `lastTransaction`, so the same undo button works. On 409, show the server message and reload the tag.
- The picker is opened by タグが無いとき：置き場所から選ぶ on the waiting panel. Choosing a drawer selects that compartment exactly like scanning its item tag. Build a synthetic `InventoryTag` from the compartment. A compartment whose `itemTagUid` is null can be viewed and corrected, but the quantity-tag step shows "この引き出しにはアイテムタグがありません" and does not call the transaction API, because that API needs `itemTagUid`.
- An NFC event arriving while the picker or correction panel is open is handled as today. It closes the panel and advances the flow.
- The header gets a 在庫の準備 link to `/kiosk/inventory/settings`.

In `kioskHeaderTabLabels.ts`, change `inventory_settings` to 在庫. In `kioskHeaderReorderableTabRenderer.tsx`, point the tab at `/kiosk/inventory` with `isActive: pathname.startsWith('/kiosk/inventory')`. Update `kioskHeaderReorderableTabRenderer.test.tsx`.

Tests in `KioskItemInventoryPage.test.tsx`:

- Correction sends `expectedBeforeQuantity` and no password header, then shows the result.
- A correction 409 shows the message and changes nothing.
- The picker selects a compartment and a following quantity scan posts a transaction with that compartment's `itemTagUid`.
- The picker with a null `itemTagUid` blocks the quantity step.
- The reset timer does not fire while the correction panel is open.
- Keep the two existing tests passing unchanged.

### Milestone 3: kiosk setup shell, PIN keypad, NFCタグ and 棚・引き出し tabs

At the end of this milestone, `/kiosk/inventory/settings` no longer uses `window.prompt`. It shows an on-screen 4-digit keypad (mockup board 6), and after unlocking it shows a tab bar: 登録待ち, 棚・引き出し, NFCタグ, アイテム編集. 登録待ち and アイテム編集 still render the old admin component inside their tab until Milestones 4 and 5, so no function is lost at any point.

Create `apps/web/src/features/kiosk/inventory/setup/`:

- `InventoryPinPad`: dots, a 3×4 keypad, やめる returning to `/kiosk/inventory`, and auto-submit on the fourth digit. It uses the existing `useVerifyKioskDueManagementAccessPassword` and the same messages as today.
- `useArmedNfcRead`: a small hook wrapping `useNfcStream(true, undefined, { role: 'inventory' })`. It returns the next NFC event that arrives after it was armed, ignoring an event already present when armed. Copy the `nfcBaselineKeyRef` idea from `RaspiInventoryPage`. The tag screens arm it automatically when a "かざしてください" panel opens, so no read button is needed. A hidden `<details>` keeps manual UID entry as a fallback.
- `InventoryTagsTab` (mockup board 8):
  - A quantity-tag list built from `useInventoryTags()`, filtered to kind QUANTITY and grouped by quantity.
  - 追加 opens a panel: choose a number on the keypad, then hold the new tag, then call `mutations.quantityTag`.
  - The restock tag works the same way with `mutations.restockTag`.
  - Item tag swap: choose a compartment with `InventoryLocationPicker`, hold the new tag, then call `mutations.replaceTag`.
- `InventoryShelvesTab`: area buttons, shelf buttons with ＋棚を追加, and drawer buttons with ＋引き出しを追加. The next free number is proposed and adjustable with the keypad, then `mutations.createShelf` or `mutations.createDrawer` is called. A new area name is the only text here. Use the normal input, and note that it needs a keyboard terminal (see the Decision Log).

Rewrite `KioskItemInventorySettingsPage.tsx` to render the PIN pad, then the tab shell, keeping `accessPassword` in state as today. Update `KioskItemInventorySettingsPage.test.tsx`: replace the `window.prompt` mock with keypad clicks, and keep the three behaviours (verify before open, reject non-four-digit, clear the error message after a few seconds). Add tests that a tag registered in the NFCタグ tab uses the armed read without a button press, and that an event present before arming is ignored.

### Milestone 4: step-by-step registration in 登録待ち

Before starting, ask the user whether the default in the open Decision Log entry about the 名前など step is acceptable, and record the answer.

`InventoryRegistrationWizard` replaces the admin component in the 登録待ち tab (mockup board 7). The left side lists pending candidates from `useInventoryImports(accessPassword)`, with the retry banner for failed mails from `useInventoryImportMessages`. The steps are:

1. 写真の確認: large photos, reorder by ↑↓ buttons, delete with confirmation. Reuse the same mutations as the admin page.
2. 新規か既存か: two big buttons. 既存 shows item cards to touch.
3. 名前など: optional, see the Decision Log.
4. 置き場所: shelf and drawer buttons for the candidate's area. Used drawers are disabled.
5. タグをかざす: an armed read with automatic advance. Skipped for 既存.
6. 最初の数: keypad, then 登録する calls `mutations.registerImport` with the same input shape the admin page sends today.

After success, show a result and move to the next candidate. Tests cover a full new-item registration with the exact request body, and the 既存 path sending `mode: 'EXISTING_ITEM'` with no location or tag.

### Milestone 5: アイテム編集 and removing the admin component from the kiosk

`InventoryItemEditTab` lists items with `InventoryLocationPicker` or a simple list. For the chosen item it offers:

- 移す: drawer buttons in the same area, calling `mutations.move`.
- 写真: reorder and delete, calling the item-photo mutations.
- アイテムを削除: with a confirm dialog, calling `mutations.deleteItem`.

Stock correction is not here, because it is on the daily page. After this, `KioskItemInventorySettingsPage` no longer imports `RaspiInventoryPage`. In `RaspiInventoryPage.tsx`, change `isActiveRoute` to check only `/admin/tools/raspi-inventory`. Run the admin page tests unchanged to prove the admin path still works.

### Milestone 6: record and verify

Add a short KB entry for the new kiosk inventory flow in the existing frontend knowledge base, following `.cursor/rules/01-core-docs-and-knowledge.mdc`. Link it to this plan. Update `docs/plans/raspi-item-inventory-execplan.md` only with a one-line pointer here.

Run the web app locally and check each board at the kiosk's size in the browser. Record anything that does not fit.

## Concrete Steps

Work in the task worktree `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--kiosk-inventory-ux` on branch `feat/kiosk-inventory-ux`, created by `python3 -m scripts.git_lifecycle.cli start`.

Focused test commands, run from the worktree root:

    pnpm --filter @raspi-system/api exec vitest run src/services/item-inventory/__tests__/item-inventory.service.test.ts src/routes/item-inventory
    pnpm --filter @raspi-system/web exec vitest run src/pages/kiosk/KioskItemInventoryPage.test.tsx src/pages/kiosk/KioskItemInventorySettingsPage.test.tsx src/pages/admin/RaspiInventoryPage.test.tsx src/features/kiosk

The listed service and route tests are mock-based and need no database. In a fresh worktree, run `pnpm install --frozen-lockfile`, then `pnpm run build` inside each `packages/*` directory before running `tsc`. Type-check the API with `pnpm exec tsc --noEmit -p tsconfig.build.json` in `apps/api`, and the web app with `pnpm exec tsc -b` in `apps/web`.

Expected: all listed files pass, the new tests fail before their code change and pass after, and there are no type errors.

## Validation and Acceptance

On a local web build at 1280×800 with a kiosk client key:

1. Open `/kiosk/inventory`. The waiting panel shows. Holding (or simulating) an item tag shows photo, stock 12, and place 棚2 / 引出し3, plus the last three history rows for that compartment.
2. Touch 数が合わないときは直す, then enter 9. The screen shows "記録を 3個 減らします". Confirming shows 12 → 9, and the request carries no `x-kiosk-access-password` header. いまの取引を取り消す restores 12.
3. Change stock from another tab after opening the correction panel, then confirm. The screen shows "在庫が変わりました。もう一度数えてください", and stock keeps the other tab's value.
4. From the waiting panel, touch タグが無いとき and pick area, shelf, and drawer, then hold a quantity tag. Stock decreases as with a scanned item tag.
5. Open 在庫の準備. The on-screen keypad appears, and no browser dialog opens. A wrong PIN shows the error, and the correct PIN opens the tabs.
6. In NFCタグ, add a quantity tag of 3 by touching 追加, entering 3, and holding a new tag. No 読み取り button press is needed.
7. Complete one candidate in 登録待ち using only touch and tags, apart from the optional 名前など step.
8. `/admin/tools/raspi-inventory` behaves exactly as before, and its tests pass.

## Idempotence and Recovery

All API changes are additive and optional. `expectedBeforeQuantity` and `compartmentId` may be omitted, which gives today's behaviour. There is no database migration. Each milestone leaves the kiosk fully usable, because setup tabs not yet rebuilt keep rendering the old admin component. To roll back, revert the milestone's commit. No data changes are involved.

## Artifacts and Notes

The mockup is https://claude.ai/artifact/YRtMfKkfaNQHFybdkbWrte. Board titles:

1. 待機：タグをかざす
2. アイテムを読んだあと
3. 数を直す（パスワードなし）
4. 完了と取消
5. タグが無いとき：置き場所から選ぶ
6. 準備を開く：パスワード
7. 準備：登録待ち
8. 準備：NFCタグ

Board 2 shows a 選びなおす button, which maps to the existing reset. Board 4 says the result returns to waiting after a few seconds, which matches the existing 4-second message timer.

## Interfaces and Dependencies

No new libraries. At the end of Milestone 1, these signatures must exist:

In `apps/api/src/services/item-inventory/item-inventory.service.ts`:

    async correctStock(compartmentId: string, desiredQuantity: number, actor: InventoryActor, note?: string, options?: { expectedBeforeQuantity?: number })
    async listHistory(limit?: number, filter?: { compartmentId?: string })

In `apps/web/src/api/domains/item-inventory.ts`:

    export async function correctInventoryStock(input: { compartmentId: string; desiredQuantity: number; expectedBeforeQuantity?: number; note?: string }, accessPassword?: string)
    export async function getInventoryHistory(limit?: number, compartmentId?: string)

In `apps/web/src/api/hooks/item-inventory.ts`:

    export function useInventoryCompartmentHistory(compartmentId: string | null)

It uses the query key `['inventory-history', compartmentId]`, so the existing `invalidateInventory` prefix invalidation of `['inventory-history']` also refreshes it.
