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

- The server certificate is self-signed (CN is the Tailscale host name, no SAN, valid to 2035) and the kiosks connect by IP, so importing it as trusted would still fail on the name. Chromium therefore pins the server key: with `kiosk_server_cert_spki_sha256` set, the launcher passes `--ignore-certificate-errors-spki-list=<pin> --user-data-dir=~/.config/chromium` instead of `--ignore-certificate-errors`. Set for StoneBase01 only; a host without the variable keeps the blanket switch. The release compares the pin with the key the server presents and stops before the switch when they differ. Recreating the server certificate with a new key means updating the pin first.
- Pin value: `openssl s_client -connect <pi5>:443 </dev/null 2>/dev/null | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`.
- Verified off the device (Debian 13 Chromium in a container against the Pi5): the right pin loads the kiosk page, a wrong pin and no flag both fail with `ERR_CERT_AUTHORITY_INVALID`. Google Chrome on macOS ignores the pin list, so do not use it to test this.
- Do not start a test browser on a kiosk that is in use: a headless probe on StoneBase01 made gnome-keyring show its password window on the real screen (2026-10-02).
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

### 2026-10-02 first deploy: Chromium started with no flags

- Run `20261002-042206-50585c` (release `a9224655`) switched StoneBase01 to Chromium at 13:36 JST. Firefox closed and a password window appeared.
- Read on the device: the launcher had `BROWSER_ENGINE="chromium"` and `BROWSER_BIN="/usr/bin/chromium"`, but `CHROMIUM_FLAGS` held only `--app` and `--unsafely-treat-insecure-origin-as-secure`. `COMMON_FLAGS` was empty. `gnome-keyring-daemon` and `gcr-prompter` were running (the password window). `kiosk-browser.service` stayed active, so the release health check passed.
- Root cause: `kiosk_browser_flags_chromium` and `kiosk_browser_flags_common` are defaults of the `kiosk` role. `release_kiosk` renders the launcher itself and only includes `resolve-browser` from that role, so the defaults were out of scope and the template fell back to empty lists. Firefox was unaffected because its flags have defaults inside the template.
- Fix: `release_kiosk` reads the `kiosk` role defaults for the two flag lists (a host override still wins) and refuses to stage a Chromium launcher that lacks `--ozone-platform=x11`, `--gtk-version=3` or `--password-store=basic`. The common flags are applied for Chromium only, so the Firefox kiosks keep starting exactly as before.
- Lesson: the template tests rendered the launcher with flags passed in by hand. Check a launcher change by rendering it through the role that ships it (a local `ansible-playbook` run of the `release_kiosk` tasks did reproduce the empty flags and confirm the fix).

### 2026-10-02 second deploy: Chromium works on the device

- Run `20261002-045820-77189a` (release `1d7a49ed`). Read on the device: the running Chromium has `--ozone-platform=x11 --gtk-version=3 --password-store=basic --ignore-certificate-errors --start-maximized`, no `gcr-prompter`, one `ibus-daemon`, `diagnose-ime.sh` passes, three agents on the new SHA.
- Checked on the device by the user: screen shown, Japanese input with the physical keyboard (toggle, candidates, commit), NFC and power buttons all work. Screens feel much faster than on Firefox. No timing numbers were taken (not required).
- One remaining complaint: typing Japanese in the 順位ボード note dialog lags slightly.
  - The dialog keeps its draft in local state, so the board is not re-rendered per keystroke.
  - Raspberry Pi OS adds `--force-renderer-accessibility` to every Chromium start (`/etc/chromium.d/00-rpi-vars`). With it, each keystroke updates the accessibility tree of the whole page, which is costly on a large board. `--disable-renderer-accessibility` was added to the kiosk flags to cancel it. Whether this removes the lag is to be confirmed on the device; if it does not, look at the IBus preedit path next.

## Rollback

Revert this change's commit (PR #1621) and run the standard release for the host (`scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspi4-kensaku-stonebase01`, after `--print-plan` shows `pi4ReleaseFiles: staged`). The Firefox profile `kiosk-system` is left untouched by this change.

Do not roll back by editing only `inventory.yml`: an inventory-only commit names no Pi4 agent, so the release would not stage the launcher and the kiosk would stay on Chromium. The revert touches `resolve-browser.yml` and the role defaults, which the change classifier treats as Pi4 kiosk release files.
