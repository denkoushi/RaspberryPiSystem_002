---
id: KB-409
title: Kiosk inventory split into a daily NFC screen and a touch setup screen
status: accepted
scope: kiosk Raspberry Pi item inventory (API and Web)
date: 2026-09-26
source_of_truth: false
related_code:
  - apps/web/src/pages/kiosk/KioskItemInventoryPage.tsx
  - apps/web/src/pages/kiosk/KioskItemInventorySettingsPage.tsx
  - apps/web/src/features/kiosk/inventory/
  - apps/api/src/routes/item-inventory/index.ts
related_docs:
  - ../plans/kiosk-inventory-ux-execplan.md
  - ../plans/raspi-item-inventory-execplan.md
validation:
  - apps/api/src/routes/item-inventory/cancel-authorization.test.ts
  - apps/web/src/pages/kiosk/KioskItemInventoryPage.test.tsx
  - apps/web/src/pages/kiosk/KioskItemInventorySettingsPage.test.tsx
  - apps/web/src/features/kiosk/inventory/
open_items:
  - Real-kiosk visual check of all screens at kiosk size.
---

# KB-409: Kiosk inventory daily and setup screens

The detailed plan, decisions and per-milestone evidence live in [kiosk-inventory-ux-execplan.md](../plans/kiosk-inventory-ux-execplan.md). This entry records what a worker sees, the permission boundary, and one deploy lesson.

## What changed

Before this work, the kiosk 在庫設定 page rendered the admin PC page (`RaspiInventoryPage`) behind a browser `window.prompt` PIN. Everything sat on one long page, and several fields needed a keyboard that the touch-panel kiosks do not have.

Now the header tab 在庫 opens the daily 在庫操作 screen (`/kiosk/inventory`). The tab id stays `inventory_settings`, so saved tab orders still work. On this screen:

- Workers take items out by holding the item tag, then a quantity tag.
- Workers put items back by holding the restock tag, then the item tag, then a quantity tag.
- After an item tag, the screen shows photos, stock, place and the drawer's last three movements.
- 数が合わないときは直す corrects the count on a keypad **without a password**, and 直前の取引を取消 undoes it.
- タグが無いとき：置き場所から選ぶ picks area, shelf and drawer by touch.

在庫の準備 (`/kiosk/inventory/settings`) opens with an on-screen 4-digit keypad. It has four tabs: 登録待ち (a step-by-step registration of mailed candidates), 棚・引き出し, NFCタグ, and アイテム編集. Tags are read as soon as a "hold the tag" panel is shown, with no read button. The admin PC page is unchanged. The history table and cross-terminal cancel stay there only.

## Permission boundary

`POST /item-inventory/corrections` accepts a registered kiosk client key alone, like stock transactions. A request that sends `x-kiosk-access-password` still goes through the password check and the failed-attempt limit.

Corrections carry `expectedBeforeQuantity`. The API returns 409 if stock changed after the kiosk showed it, so a worker never overwrites another terminal's movement unseen.

All setup endpoints still require the password.

## NFC detail

`useNfcStream` delivers `inventory`-role events only for UIDs that already resolve to an inventory tag. New tags being registered are unknown, so the setup screen listens as an ordinary (legacy) subscriber. The global inventory router is disabled on the setup path.

## Deploy lesson (2026-09-26)

Run `20260926-112811-48762d` failed after 3 seconds. The PR for the next milestone was merged right after the Pi5 release unit started, and the unit fetched `origin/main` a few seconds later. The unit then saw a SHA different from the planned `releaseSha` and exited before changing anything; Pi5 kept the previous release.

Do not merge to `main` until a standard release run has finished. The next run must re-check CI for the new SHA and re-run `--print-plan`.

## Updates (2026-10-09, hand-written label number)

Item NFC tags and physical goods can become separated. Each stored location (`InventoryCompartment`, the target of an item tag) now has a globally unique `labelNumber`, so workers can hand-write the same number on the tag and drawer.

- Display numbers with at least 4 digits (`0001`, `0002`, …; `10000` stays `10000`) using the shared `formatInventoryLabelNumber` helper. Numbers are never reused after a compartment is deleted; sequence gaps are allowed.
- Migration `20261009120000_add_inventory_compartment_label_number` numbers existing rows starting at 1 in `createdAt, id` order, then continues the sequence after the maximum. An empty table starts at 1.
- `GET /item-inventory/compartments/by-label/:labelNumber` uses the same kiosk client-key/JWT guard and `{ tag }` response shape as tag lookup. Positive integer input (including zero-padded digits) is required; invalid input returns 400, and an unknown compartment or soft-deleted item returns 404. Without an attached tag, the response uses the compartment id, an empty `uid`, and `itemTagUid: null`.
- API compartment responses add the numeric `labelNumber` field. Older web builds can continue using the existing fields and routes.
- Web display is covered by the label-number-on-screens update below.
- Production check (2026-10-09, after PR #1901): migration recorded; 2 compartments numbered 1 and 2, no duplicates.

## Updates (2026-10-09, quantity tag after a movement)

On the device check, a quantity tag held right after a movement answered 先にアイテムNFCタグを読み取ってください, although the item was still on the screen and the number buttons worked.

- Cause: after a movement the screen kept showing the item but dropped the selection that the quantity tag route reads (`flow.selectedTag`), and changed the prompt to アイテムタグ. The number buttons read another reference, so only the tag was refused.
- Fix: a movement no longer drops the selection. While an item is shown, both the number buttons and a quantity tag work and the prompt stays 数を押す か 数量タグ. 一覧へ, the 30-second return and a failed check still clear it. Restock mode still ends after one movement, so the next tag is a 払い出し.
- Device check (2026-10-09, after PR #1896 reached the Pi5, release run `20261009-063655-b7e283`): OK. A quantity tag held right after a movement is accepted.

## Updates (2026-10-09, crash after a movement)

On the first device check of the 在庫操作 screen the kiosk showed the error screen right after a quantity tag was held. `ClientLog` (`kiosk_ui_error`, `render_crash`, route `/kiosk/inventory`, 2026-10-09 09:23 JST, twice) had `Cannot read properties of undefined (reading 'name')`.

- Cause: the cancel button shows `取消：<item name>` from the movement response, but `POST /item-inventory/transactions`, `/touch-transactions` and `/transactions/:id/cancel` returned the bare transaction row without `inventoryItem`. Only `GET /item-inventory/history` included it. The web type claimed the field and the web test mocks carried it, so no test failed. The movement itself was saved before the crash.
- Fix: the three responses (and idempotent replays) include the same relations as history entries through one shared include. The web type for movement responses marks the relations as optional, and the cancel button falls back to the item name of the movement's compartment, or shows no name.
- Tests: the API tests assert `transaction.inventoryItem.name` on the NFC route, the touch route, a replay and cancel; the web tests run both routes with a response that has no `inventoryItem`.
- Not checked: the kiosk itself after the fix.

## Updates (2026-10-08, 在庫の準備 screen)

Fourth part of the review: fewer repeats and dead ends in setup. The four tabs and their panes keep their shape.

- The PIN is remembered in memory only (`setup/setupPinSession.ts`, never in browser storage) for 5 minutes after the last touch on the setup screen, so going to 在庫操作 and back does not ask again. ロック forgets it at once.
  - Every setup request goes through `sendSetupRequest`. It refuses to send when the session was locked after the request was created (also when the same PIN was entered again), and only a 401 or 403 on such a request locks the screen. Failures of other requests do not.
- 登録待ち: 登録しない sets a candidate aside (`dismiss`) and moves to the next one; 元に戻す is offered in the result row until another candidate is registered, set aside or edited.
- 棚・引き出し and NFCタグ: 削除 for a shelf without drawers, an empty drawer, and quantity and restock tags. 元に戻す creates it again with the same values, so the internal id is new.
- Quantity tags are registered one after another: the panel stays open, keeps the last quantity, counts the registrations and ignores a tag read twice. Tags read while one is being saved wait in order; a failure, 終わる, leaving the tab or a lock drops the ones still waiting.
- アイテム編集: holding a registered item tag opens its item (only while no panel or input is open), and タグを交換 replaces the tag of a drawer there. A lookup that answers after an item was picked by hand is ignored.
- Controls in setup are at least 44px, the words are 引き出し and 削除 everywhere in setup, errors appear next to the control that caused them in a fixed-height slot, and long names wrap to two lines.
- Accepted limit: a quantity tag read while the kiosk is offline is registered when the connection returns, also after 終わる, unless the screen was locked in between.
- Not checked: the real look at 1920×1080 on a kiosk.

## Updates (2026-10-08, 在庫操作 screen)

Third part of the review: the daily screen can be used by touch alone, and a tag shows its item at once.

- Number buttons (1, 2, 5, 10, 20 and ほかの数 with a keypad) record a movement the moment they are pressed, through `POST /item-inventory/touch-transactions`. There is no confirmation step; the named cancel button undoes a wrong press. 払い出し and 補充 are a two-way switch on the item screen and share the restock mode of the restock tag.
- The list is narrowed by area and shelf chips above it. 置き場所から選ぶ and the place and tool-detail blocks are gone from the daily screen.
- A scanned item tag is shown from a tag table kept on the kiosk (`['inventory-tags']`, loaded and refreshed every 5 minutes by `InventoryNfcRouter` on the inventory screens only; other kiosk screens send no tag request, and a scan there uses what is cached or asks the server as before) and checked against the server in the background. The check replaces the item if the tag now points at another drawer, updates the stock if only that changed, and clears the screen if the tag is gone.
- Rules that keep a movement on the drawer the worker sees:
  - Everything that changes stock (number button, quantity tag, correction, cancel) runs one at a time. A scan read while an operation is running waits for it.
  - An operation waits for the background check of the selection before it is sent, and is dropped if the check changes the drawer.
  - When an operation fails, scans read up to that moment are dropped, also across leaving and reopening the screen (the failure time is kept outside the component).
  - The tag route accepts `expectedCompartmentId`; if the tag now belongs to another drawer the API answers 409 `INVENTORY_CONFLICT` (タグの登録が変わりました) and nothing moves. A replay with the same idempotency key returns the first result before this check.
  - No answer (network error or 5xx) is treated as unknown: the item list is re-read and the screen says 通信できませんでした。在庫数を確かめてください. It does not retry by itself.
  - 補充 chosen on the header, or a quantity tag on a drawer without a tag, re-reads the quantity and goes through the touch route.
- The screen reads API errors from `errorCode` (what the error handler sends), falling back to `code`.
- Accepted limit: a quantity or restock tag deleted on another terminal is still treated as an inventory tag for up to 5 minutes here. No stock moves, because the server rejects it.
- Not checked: the real look at 1920×1080 on a kiosk. Tests cover behaviour only.

## Updates (2026-10-08, API)

API groundwork for the next kiosk screens; no screen calls the new endpoints yet.

- `POST /item-inventory/touch-transactions` (kiosk client key, no PIN) moves stock for a drawer chosen by touch: `compartmentId`, `quantity`, optional `restock`, `expectedBeforeQuantity` and `idempotencyKey`. It shares the stock logic of the tag route and records `details.source = "touch"`. Errors: 409 `INVENTORY_INSUFFICIENT_STOCK`, 409 `INVENTORY_CONFLICT`.
- Setup (PIN) can now delete: `DELETE /item-inventory/drawers/:id` (empty drawers only), `DELETE /item-inventory/shelves/:id` (shelves without drawers only), `DELETE /item-inventory/tags/:id` (quantity and restock tags only; an item tag returns 409).
- A mailed candidate can be set aside with `POST /item-inventory/imports/:id/dismiss` and brought back with `.../restore` (PIN). Status `DISMISSED` is hidden from both pending lists, and a resend of the same mail or content does not bring it back. There is no list of dismissed candidates; the screen must offer the undo itself.
- `InventoryCompartment.lastIssuedAt` replaces the per-request `groupBy` over all transactions in `GET /item-inventory/items`. It is set on every ISSUE and recomputed from the remaining ISSUE rows when one is cancelled. Migration `20261008130000` backfills it.
- `GET /api/storage/photos/*` answers with `Cache-Control: private, max-age=86400`, so a kiosk does not re-download full-size photos on every visit.
- Rollback note: the column and the enum value stay in the database. An API older than this change cannot read a candidate in status `DISMISSED`; restore such candidates before rolling back below this release.

## Updates (2026-09-28)

- The kiosks are 21.5-inch 1920×1080 monitors and have a physical keyboard (Pi4 and Mac). Typing on the kiosk is acceptable; flows stay touch-first.
- Areas are normalized (NFKC, trimmed) on intake, shelf creation and registration; existing rows were normalized once with `apps/api/scripts/inventory-area-normalize.mjs` (backup `/opt/backups/inventory-area-normalize-20260928.json`). Run scripts in the running blue/green API container (`docker ps | grep api`), not with `docker compose exec api`.
- Each item has one unit (null means 個; no conversion). Units are chosen or added in 在庫の準備; quantity tags carry only a number.

## Updates (2026-10-08)

A review of every inventory screen for fewer steps and faster response; this is the first of three parts (small fixes on the web side only, no API change).

- 在庫操作
  - After a movement the item stays on screen but the prompt asks for the item tag again, because the selection is already cleared. Before, the screen asked for a quantity tag and the next quantity tag gave an error.
  - The cancel button names its target (`取消：<item> <signed change><unit>`) and is shown only while there is something to cancel. Returning to the list (also the 30-second return) or choosing another drawer drops it. 選択をリセット is gone: 一覧へ does the same, and 補充をやめる appears only in restock mode with nothing chosen.
  - The change (`−5`, `+10`) is shown large beside the stock number while the result is displayed.
  - The list tells loading, failure (with もう一度) and empty apart.
  - Any touch or key press on the screen restarts the 30-second return.
  - A failed correction on a drawer without a tag re-reads the stock from the item list.
- Speed: a movement or correction rewrites the cached item list from the response and refreshes only history, locations and tags; cancel also refreshes items. The item grid is memoized and its images load lazily. One `AudioContext` is reused for the tones.
- 在庫の準備
  - The chosen candidate and its draft (including a tag already read) live in the page, so they survive a visit to another tab and the arrival of a newer candidate. A candidate that is no longer waiting falls back to the newest one.
  - 写真を確認した is no longer a required step.
  - Result messages sit in a fixed-height row, so buttons below do not move.
- Still open, planned as parts two and three: showing a scanned item without waiting for the tag lookup, smaller cached photos, and layout changes (filter by area and shelf on the list, touch-only issue, delete and undo in setup), which get a mock first.

## Updates (2026-10-02)

- 在庫操作 showed 401 on a stock change (keypad correction or quantity tag) although the change was saved. The browser still sent an expired admin-console token. `authenticate` sets the reply status to 401 before throwing; `writeOrKiosk` caught the error and went on with the client key, so the handler succeeded but the response kept the 401. `writeOrKiosk` now resets the status after the client key is accepted, as the other routes with a token-then-client-key fallback already do (rigging, measuring instruments, assembly, part measurement, torque wrenches, work instructions, loan analytics). Setup actions with the PIN were not affected because they do not try the token first.
- 登録待ち lost a name entered before 新規登録 was pressed: the button reset 名前, 型式 and 用途 every time (an item registered on 2026-10-02 kept its メーカー but stayed `ItemlistRaspi 4`). It now resets only when coming back from a chosen existing item, and then clears everything that item filled in.
- Text typed into a lane of the board is saved as a choice (`POST /item-inventory/tool-field-values`) as well as set on the item, so it is listed at once, also in 登録待ち before the item is registered. Typed text is NFKC-normalized. While the text differs from the saved value the field shows a ✓; Enter that only confirms an IME conversion does not leave the field.

## Updates (2026-10-01)

- The tool-value pop-up became a board (`setup/ToolValueBoard.tsx`) with one lane per field: 名前, メーカー, 工具名, 被削材, 工具寸法, 型式, 用途. Each lane has the item's value on top (typing is taken on Enter or on leaving the field) and the registered values below it. The notes on `ToolValuePopup.tsx` under 2026-09-30 describe the old pop-up; rename, add and delete still work the same way.
  - A tap changes this one item. まとめて直す switches to the registered values themselves (amber frame): renaming changes every item that uses the value.
  - アイテム編集 shows the board on the screen and saves each change at once through `PUT /item-inventory/items/:id/details` (setup PIN), with 元に戻す. 登録待ち opens the same board beside the photos.
  - 名前 is now a pick-list field. Names matching `ItemlistRaspi <number>` (given when PowerApps sends an item without a name) are provisional: they are not offered as choices, the board shows 仮名, and アイテム編集 can list only those. A registered item's name cannot be emptied.

## Updates (2026-09-30)

- All inventory screens (在庫操作 and 在庫の準備) share one look: the `inv` Tailwind palette in `apps/web/tailwind.config.ts`, class constants in `apps/web/src/features/kiosk/inventory/inventoryUi.ts`, and icons in `InventoryIcons.tsx`. The kiosk shell background is covered by `invSurface`. Use these instead of `slate`/`white/` classes on inventory screens.
- 数を直す opens over the item screen, not as a separate view.
- The tool-value pop-up (`setup/ToolValuePopup.tsx`) has two modes. 選ぶ: a second tap clears the field. 編集: rename, add, delete.
  - Renaming a value also rewrites every item that uses it, in one transaction. The screen shows the item count before the rename.
  - A value can be deleted only when no item uses it. Otherwise it would reappear, because the pick list merges item values with presets.
  - API: `GET/POST/PUT/DELETE /item-inventory/tool-field-values` (setup PIN).
- Pick lists sort naturally (`φ20` before `φ100`).
- Mailed candidates waiting for registration lead the 在庫操作 item list, newest first, with an amber 未登録 badge. Tapping a card opens 在庫の準備 (PIN first) with that candidate selected. The list reads `GET /item-inventory/import-summaries` (kiosk client key, no PIN; thumbnail, number, machine and category only) every minute. Candidate details and registration still need the PIN.
  - Why: a worker on 2026-09-30 saw a candidate ingested correctly but could not find it, because 登録待ち opened the oldest candidate and the others were small buttons in the right pane.
- 登録待ち lists candidates newest first in a thumbnail strip under the three panes, not in the right pane.
- An item screen has a 一覧へ button that returns to the list; the 30-second automatic return stays.


## Updates (2026-10-09, round 4 layout)

- Daily cards show populated tool details according to 小/中/大 (9/6/4 columns, 1/3/6 detail rows); multi-photo cards cycle photos without opening the item.
- Device-local settings: `kiosk-inventory-thumbnail-size` stores `small`, `medium` or `large` (default `medium`). `kiosk-inventory-default-area` stores the area name; an absent key means すべて. Only the home button saves the area, with six-second undo. A missing area falls back to すべて without clearing stored settings.
- 登録待ち shows steps 1–3 and 4–6 in two columns beside a narrower photo pane. Step marks show ✓; the candidate/action bar shows あと N つ / 登録できます. Finished area-name buttons use the existing `composeArea` semantics; shelf/drawer creation and occupied drawers are unchanged. Default names, units and quantity validation are unchanged.
- Tool-value lanes split registered strings on `・`, de-duplicate options and toggle multiple values joined with `・`; 名前 remains single. The registration overlay retains its existing immediate application timing. Bulk rename/add/delete still operate on the existing stored strings.
- アイテム編集 uses a 250px top block with photo paging, unit/photo/location actions and visible item deletion, leaving the lower space for the tool-value lanes. Existing action confirmations and NFC handling remain.
- Device check (2026-10-09, after PR #1900 reached the Pi5): OK.

## Updates (2026-10-09, label number on screens and photo text suggestion)

- Registration displays `result.compartment.labelNumber` from the existing registration response in a large amber dashed panel, with item name and location. The panel survives setup tab switches and stays until 次へ; photo-only registration has no new location number. The existing success banner and dismiss/restore undo remain.
- Each daily card shows its own location number at every thumbnail size (one card is one stored location). The daily item location and setup item-edit location rows show the same amber dashed number, formatted with `formatInventoryLabelNumber`.
- 番号で開く opens a compact digit keypad; 開く is enabled from one digit. `GET /item-inventory/compartments/by-label/:labelNumber` feeds the resolved tag into the same item-tag event queue, including locations with a detached tag. Four display slots pad short input; longer sequence numbers remain enterable within the API's positive 32-bit integer range. A 404 stays in the panel as この番号の品物はありません.
- `POST /item-inventory/import-photos/suggest-tool-fields` uses the existing kiosk setup write guard. Body: `{ source: "import", payloadId, photoId }` or `{ source: "item", itemId, photoId }`; the server resolves the stored photo within its parent. Registered item lookup excludes deleted items. Response: `{ model: string[], maker: string[], status: "ok" | "unavailable" }`.
- `ToolFieldSuggestionService` reads a resized JPEG through `PhotoStorage.readVisionInferenceJpeg` and reuses the domain-independent vision completion port and existing `photo_label` use case, with the existing runtime's `ensureReady`/`release`. No provider, inference-use-case or environment configuration changes. Temperature 0, JSON output, 300 tokens, a 30-second deadline and an abort signal bound the optional read. Prompt reads printed/engraved text only and forbids guessing.
- Fail-soft: inference errors, timeout and invalid JSON/schema return HTTP 200 with empty arrays and `status: "unavailable"`; legible-empty output returns `status: "ok"`. Invalid requests/auth and missing photos keep normal 4xx responses. Values are trimmed, deduplicated, empty/over-80-character values dropped, and capped at three models/two makers. Logs contain status/abort metadata only, never image bytes, recognised text, raw output or upstream error bodies (ADR-20260402).
- 写真から読む reads the most recently enlarged candidate photo, otherwise the first displayed candidate photo. 型式/メーカー chips appear only after reading; pressing a chip fills its field and highlights it. No auto-fill. Empty/unavailable results say 読み取れませんでした. Candidate changes clear chips and ignore late responses.
- Height arithmetic at 1920×1080 (16px root font): surface padding 20+24, title/tab row 49, gap 16, registration top padding 16, selected candidate strip 94 and its gap 12 leave 849px for columns (789px with the 48px banner + 12px gap). New registration's steps 1–3 need at most 102px (mode), 420px (four input rows plus one 44px chip row in both parallel columns) and 202px (unit content capped at 144px), plus 24px column gaps = 748px. This fits with 41px spare even with the banner; the no-chip default adds no height. Existing-item selection may add up to 104px; existing bounded inner choice/field overflow handles that extreme case without page scrolling. The read-failure text takes less space than the chip row.
- Not checked: real device, real DGX latency or actual photo recognition quality. Device/production checks above refer to PR #1900/#1901, not these additions.
