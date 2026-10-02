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

## Updates (2026-09-28)

- The kiosks are 21.5-inch 1920×1080 monitors and have a physical keyboard (Pi4 and Mac). Typing on the kiosk is acceptable; flows stay touch-first.
- Areas are normalized (NFKC, trimmed) on intake, shelf creation and registration; existing rows were normalized once with `apps/api/scripts/inventory-area-normalize.mjs` (backup `/opt/backups/inventory-area-normalize-20260928.json`). Run scripts in the running blue/green API container (`docker ps | grep api`), not with `docker compose exec api`.
- Each item has one unit (null means 個; no conversion). Units are chosen or added in 在庫の準備; quantity tags carry only a number.

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
