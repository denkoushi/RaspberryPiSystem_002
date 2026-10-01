---
id: KB-413
title: Kiosk browser canary on StoneBase01 — Firefox to Chromium for faster screens
status: active
scope: Pi4 kiosk browser engine (raspi4-kensaku-stonebase01 only), IBus / Mozc Japanese input
date: 2026-10-02
source_of_truth: true
related_code:
  - infrastructure/ansible/inventory.yml
  - infrastructure/ansible/roles/kiosk/defaults/main.yml
  - infrastructure/ansible/roles/kiosk/tasks/resolve-browser.yml
  - infrastructure/ansible/templates/kiosk-launch.sh.j2
validation:
  - scripts/deploy/tests/test_ansible_standard_release.py
---

# KB-413: Kiosk browser canary on StoneBase01 — Firefox to Chromium

## Context

- Goal: make kiosk screens respond faster. All seven Pi4 kiosks run Firefox since 2026-03 (moved off Chromium 142 because Japanese input broke, see [KB-investigation-kiosk-ime-and-power-regression](./KB-investigation-kiosk-ime-and-power-regression.md)).
- 2026-10-02 isolated measurement on `raspi4-kensaku-stonebase01` (headless labwc + Xwayland, one first load and two reloads per condition, production Firefox running on the same Pi4), `/kiosk/production-schedule` until 「検索してください。」 appears:

| Condition | First | Reload 1 | Reload 2 |
|---|---|---|---|
| Chromium 142 | 7.4 s | 2.1 s | 1.9 s |
| Firefox 145, current prefs (cache off) | 17.2 s | 10.0 s | 8.0 s |
| Firefox 145, cache on | 20.8 s | 10.7 s | 13.1 s |

- In the same isolated session, Chromium with `--ozone-platform=x11 --gtk-version=3` converted and committed `nihongo → 日本語` through IBus/Mozc with OS-level key events (XTest). The March attempt used `--ozone-platform=x11` only.

## What Changed

- `raspi4-kensaku-stonebase01` only: `kiosk_browser_engine: "chromium"`.
- Chromium flags gain `--gtk-version=3`.
- `resolve-browser.yml` falls back to `/usr/bin/chromium` when `/usr/bin/chromium-browser` is missing. StoneBase01 (Debian trixie) has no compatibility symlink, and the standard release never creates it, so the launcher would otherwise point at a missing binary.

## Known Limits (decide before any wider rollout)

- The server certificate is self-signed. Firefox trusts it through a per-profile exception; Chromium still depends on `--ignore-certificate-errors`. Replace it (import the certificate into the kiosk user's NSS store, or pin it with `--ignore-certificate-errors-spki-list`) before moving more kiosks.
- `--remote-debugging-port=9222` stays bound to 127.0.0.1.
- The standard release only stages the launcher when the release carries Pi4 agent services. A release with an empty agent set restarts the browser without changing the engine; read `/usr/local/bin/kiosk-launch.sh` on the device to confirm.
- IBus settings and the Firefox profile are owned by the `kiosk` role (full provisioning), not by the standard release. This change does not touch them.
- Never attach Marionette/WebDriver to the production Firefox profile (KB-412).

## Acceptance Checks On The Device

1. Normal session shows the kiosk app in Chromium.
2. Physical keyboard: 全角/半角 or Ctrl+Space toggles, candidates can be chosen and committed, still works after moving between fields and after a reload.
3. One `ibus-daemon` process.
4. Browser choice and Japanese input survive a reboot.
5. 生産スケジュールの表示・検索・スクロール, NFC, power buttons.
6. A release after this one reaches the screen (`_appRef` changes, no stale bundle).
7. Same screen and same operations timed against Firefox.

## Results

Not measured yet. Fill in after the canary deploy.

## Rollback

Set `kiosk_browser_engine: "firefox"` for `raspi4-kensaku-stonebase01` in `infrastructure/ansible/inventory.yml` and run the standard release for that host (`scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspi4-kensaku-stonebase01`, after `--print-plan`). The Firefox profile `kiosk-system` is left untouched by this change.
