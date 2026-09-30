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

## Updates (2026-09-30)

- All inventory screens (在庫操作 and 在庫の準備) share one look: the `inv` Tailwind palette in `apps/web/tailwind.config.ts`, class constants in `apps/web/src/features/kiosk/inventory/inventoryUi.ts`, and icons in `InventoryIcons.tsx`. The kiosk shell background is covered by `invSurface`. Use these instead of `slate`/`white/` classes on inventory screens.
- 数を直す opens over the item screen, not as a separate view.
- The tool-value pop-up (`setup/ToolValuePopup.tsx`) has two modes. 選ぶ: a second tap clears the field. 編集: rename, add, delete.
  - Renaming a value also rewrites every item that uses it, in one transaction. The screen shows the item count before the rename.
  - A value can be deleted only when no item uses it. Otherwise it would reappear, because the pick list merges item values with presets.
  - API: `GET/POST/PUT/DELETE /item-inventory/tool-field-values` (setup PIN).
- Pick lists sort naturally (`φ20` before `φ100`).
