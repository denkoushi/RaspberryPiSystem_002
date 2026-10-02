---
id: KB-412
title: Kiosk Firefox stopped passing keys to IBus (日本語入力不可) because focusmanager.testmode was left in the profile
status: active
scope: Pi4 kiosk Firefox profile (kiosk-system), IBus / Mozc Japanese input
date: 2026-10-01
source_of_truth: true
related_code:
  - infrastructure/ansible/templates/kiosk-launch.sh.j2
  - infrastructure/ansible/roles/kiosk/templates/firefox-user.js.j2
  - scripts/kiosk/diagnose-ime.sh
validation:
  - scripts/deploy/tests/test_ansible_standard_release.py
---

# KB-412: Kiosk Firefox stopped passing keys to IBus because `focusmanager.testmode` was left in the profile

## Context

- 2026-10-01, `raspi4-kensaku-stonebase01` (the kiosk canary). Reported as 「パイ4のキーボードからの日本語入力ができなくなってる」.
- Every text field was affected (在庫の準備 の入力欄, 順位ボードの備考欄). The user reported it had also failed on 2026-09-30.
- The other six Pi4 kiosks were not affected.

## Symptoms Or Trigger

- 半角/全角キーを押しても変化なし. Latin letters typed normally.
- `scripts/kiosk/diagnose-ime.sh` looked healthy: one `ibus-daemon` with the expected arguments, single-owner PASS, engine `mozc-jp`.
- Restarting IBus, restarting `kiosk-browser.service`, and rebooting the terminal did not help.

## Investigation

1. IBus side: `dbus-monitor` on the IBus private bus showed `FocusIn` from Firefox when the field was clicked, but zero `ProcessKeyEvent` calls while keys were typed.
2. X side: `xinput test-xi2 --root` showed the key presses reaching Xwayland, and `XGetInputFocus` / `_NET_ACTIVE_WINDOW` pointed at the Firefox window. Keycode 49 mapped to `Zenkaku_Hankaku`.
3. Firefox side: a run with `MOZ_LOG=IMEHandler:4,KeyboardHandler:4` logged, for every key, `OnKeyEvent(), FAILED, the caller isn't focused window, mLastFocusedWindow=0x0`, and never logged `OnFocusWindow`.
4. Comparison with `raspi4-robodrill01`: identical packages, launcher, `user.js`, `userChrome.css`, `rc.xml`. The only difference was `prefs.js`: StoneBase01 had 295 prefs against 204, including `focusmanager.testmode = true` and `remote.prefs.recommended.applied = true`, and the profile held a `WebDriverBiDiServer.json`.

## Root Cause

Firefox had been started on the kiosk profile under remote automation (WebDriver / Marionette). Firefox then writes its automation "recommended preferences" into the profile, and they stay in `prefs.js` after that session ends. `focusmanager.testmode = true` makes the focus manager treat the window as active without the real widget activation, so the GTK IME context never learns which window is focused and refuses to hand key events to IBus.

Who started Firefox that way, and exactly when, could not be determined from the logs. Mozc last recorded learning on 2026-09-22.

## Fix

On StoneBase01, with `kiosk-browser.service` stopped (Firefox rewrites `prefs.js` on exit), the two lines `focusmanager.testmode` and `remote.prefs.recommended.applied` were removed from `prefs.js` after a backup. Japanese input worked again on the next start (user-confirmed).

## Prevention

- `kiosk-launch.sh` removes `focusmanager.testmode` from the kiosk profile's `prefs.js` before starting Firefox. The launcher is installed by the standard release route, so every Pi4 kiosk self-heals at the next browser start.
- `firefox-user.js.j2` sets `focusmanager.testmode` to `false`. `user.js` is only written by the `kiosk` role (provisioning), not by the standard release route.
- `scripts/kiosk/diagnose-ime.sh` reports `focusmanager.testmode` and `remote.prefs.recommended.applied`.
- Do not start Firefox with `--marionette`, `--remote-debugging-port`, geckodriver, or Playwright against the `kiosk-system` profile. Use a temporary profile for on-device automation.

## Validation

- `python3 -m unittest scripts.deploy.tests.test_ansible_standard_release` covers the launcher guard and its position before the Firefox `exec`.
- On-device after the fix: `prefs.js` no longer contains either pref after a browser start; the user typed Japanese in the 順位ボード 備考欄.
- After the release: on all seven Pi4 kiosks `/usr/local/bin/kiosk-launch.sh` has the guard line before the Firefox `exec`, `kiosk-browser.service` is active, and `focusmanager.testmode` is absent from `prefs.js`.
- All seven Pi4 kiosk profiles were checked read-only on 2026-10-01; only StoneBase01 had the prefs.

## Open Items

- None. Closed on 2026-10-02:
  - The 89 other automation prefs on StoneBase01 were removed from `prefs.js` on 2026-10-01 (browser stopped, backup taken, names matched against Firefox's own `RecommendedPreferences` list). The profile now has 210 prefs, in line with the other kiosks (203–210).
  - The launcher guard reached all seven Pi4 kiosks with run `20261001-092737-9d674b` (SHA `706d7b06`). The earlier run `20261001-080054-dbfade` reported success but skipped the launcher on every Pi4, because the release set for an API-only head commit had no Pi4 agent services; #1611 fixed that classification. Verify Pi4 files on the device, not from the run result.
  - The user confirmed normal display and Japanese input on StoneBase01 on 2026-10-02.

## References

- How to capture the Firefox IME log: stop `kiosk-browser.service`, run `/usr/local/bin/kiosk-launch.sh` with `MOZ_LOG="IMEHandler:4,KeyboardHandler:4,timestamp"` and `MOZ_LOG_FILE=<path>`, reproduce, stop that Firefox, start the service again. The log contains typed characters; delete it afterwards.
- [Runbook: キオスク備考欄 日本語入力不具合の診断](../runbooks/kiosk-ime-diagnosis.md)
- Earlier, different causes: [KB-276 / KB-287](./frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善) (IBus double start, switch key).
