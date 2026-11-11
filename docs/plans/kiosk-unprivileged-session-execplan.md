# Run the Pi4 screen session with a less privileged user

This ExecPlan is a living document maintained according to `.agent/PLANS.md`.
Its Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective
sections must remain current. This file is the implementation and rollout record.

## Purpose / Big Picture

Allow a Pi4 kiosk to run its screen session with a separate, less privileged user.
A host flag selects the screen account while deployment and power requests keep
using the deployment account. Leaving the flag unspecified or false preserves
existing operation. This mechanism change leaves every host disabled; enabling
`kensaku-stonebase01` belongs to a separate PR and approved deployment.

## Progress

- [x] (2026-11-08) Read the repository rules and the supplied investigation;
  confirm the task worktree initially has no uncommitted changes.
- [x] (2026-11-08) Capture pre-change rendering fixtures, add optional account
  preparation, GUI account selection, reversible autologin, and session waiting.
- [x] (2026-11-08) Add a first-install guard and preserve deployment account paths.
- [x] (2026-11-08) Finish local tests: 271 related tests passed; final focused
  session tests (10), syntax-check, and whitespace checks passed.
- [x] (2026-11-08) Mechanism PR #2637: reviewed and merged with every host disabled.
- [x] (2026-11-08) Deliver the disabled mechanism to all Pi4 kiosks using the standard route.
- [x] (2026-11-08) Separate trial PR #2641: enable only `kensaku-stonebase01`.
- [x] (2026-11-09) Keyboard layout fix PR #2660 for the dedicated session;
  standard release run `20261109-010031-08cf2c` on the trial host.
- [x] (2026-11-09) Physical checks on the dedicated account accepted.
- [x] (2026-11-09) Return PR #2665 to the deployment account; standard release
  run `20261109-021644-8d33a8`; physical checks after return accepted.
- [x] (2026-11-09) Gradual fleet enablement approved in four rounds, at least
  one day apart: (1) `kensaku-stonebase01`, `kensaku-02`; (2) `sessaku-01`,
  `fjv60-80`, `robodrill01`; (3) `assembly-01`, `assembly-02`; (4) `raspberrypi4`.
  Each round is its own PR and a standard release limited to that round's hosts;
  rollback is a PR that removes the flag. Zero 2W and Pi3 are excluded.
- [x] Round 1 enabled (`kensaku-stonebase01`, `kensaku-02`). Deployed 2026-11-09 (#2676); on-site checks passed.
- [x] Round 2 enabled (`sessaku-01`, `fjv60-80`, `robodrill01`). Deployed 2026-11-10 (#2680); on-site checks passed.
- [x] Round 3 enabled (`assembly-01`, `assembly-02`). Deployed 2026-11-10 (#2692); on-site checks passed.
- [ ] Round 4 enabled (`raspberrypi4`).

## Surprises & Discoveries

- Observation: the existing launcher exports the session environment but does
  not wait for the screen user's X0 and D-Bus to become usable.
  Evidence: `infrastructure/ansible/templates/kiosk-launch.sh.j2` previously
  proceeded directly from environment setup to browser launch.
- Observation: standard releases run certificate policy before `release_kiosk`.
  Evidence: the kiosk pre-tasks in
  `infrastructure/ansible/playbooks/deploy-release-standard.yml` import
  `common/distrusted-intermediates`. The optional account must therefore exist
  before its NSS database is prepared.
- Observation: releases without agents previously did not distribute browser
  files. Optional-session enablement and removal need those files even on a
  browser-only kiosk; the previous behavior remains when no transition is needed.
- Observation: the dedicated account's labwc session had no keyboard environment
  file, so labwc fell back to the system default layout instead of the OS layout,
  and Japanese input switching keys moved.
  Evidence: `/etc/xdg/labwc/environment` sets a non-Japanese layout; the deployment
  account had its own `~/.config/labwc/environment`. PR #2660 writes that file for
  the dedicated account from `/etc/default/keyboard`. Check the effective layout in
  the environment of Xwayland or ibus-daemon; `setxkbmap -query` is not reliable.
- Observation: this development sandbox requires Ansible temporary directories
  inside a writable location. Use the `/tmp` settings below for local validation.

## Decision Log

- Decision: use `kiosk-display` with an empty supplementary group list by default.
  Rationale: do not copy the deployment account's groups. Any device-specific
  additions must be justified by the trial. Administrative groups are rejected.
  Date/Author: 2026-11-08 / Codex.
- Decision: prepare a fresh profile and retain both accounts and existing profiles.
  Rationale: preserve recovery while avoiding a whole-home copy. Cookies, saved
  logins, and local browser preferences are not migrated.
  Date/Author: 2026-11-08 / Codex.
- Decision: use a removable `99-kiosk-gui-session.conf` LightDM drop-in scoped to
  `Seat:seat0`; preserve OS autologin settings underneath it.
  Rationale: LightDM applies `Seat:*` defaults before matching seat sections
  ([upstream implementation](https://github.com/ubuntu/lightdm/blob/main/src/lightdm.c)).
  The trial must confirm the effective configuration and the actual local seat.
  Date/Author: 2026-11-08 / Codex.
- Decision: reject optional-session first-install before account or desktop changes.
  Rationale: this implementation covers already provisioned kiosks. Install first
  with the flag false, then use a separate standard release to change the session.
  Date/Author: 2026-11-08 / Codex.
- Decision: work only in the supplied worktree, with no Git mutation or deployment.
  Rationale: these are the boundaries of the implementation request. Later stages
  require separate instructions and the repository's Git/deployment workflow.
  Date/Author: 2026-11-08 / Codex.

## Outcomes & Retrospective

The mechanism (#2637) is on every Pi4 kiosk with the flag disabled. The trial
(#2641, #2660) ran the GUI session on `kensaku-stonebase01` as `kiosk-display`,
outside administrative groups. Accepted on the device on 2026-11-09:
screen, Japanese input and its switching keys, NFC, barcode, call audio, panel,
Wi-Fi without an authentication prompt, and power requests.

The return (#2665) removed the LightDM drop-in. After reboot, the GUI processes
run as the deployment account again, the layout is Japanese, the device containers
are up, and the device checks were accepted. Both accounts and profiles remain,
as designed.

Fleet enablement (Milestone 5) has not started and needs separate approval.
Include the keyboard environment check from Surprises in each enablement.

## Context and Orientation

`infrastructure/ansible/group_vars/all.yml` defines the optional flag and account
settings. `ansible_user` remains the deployment account. `kiosk_gui_user` selects
the dedicated account only when enabled; `kiosk_gui_home` and `kiosk_gui_uid` use
its passwd entry. Disabled rendering preserves the existing home paths.

The common certificate policy creates the optional account before preparing its
NSS database (the browser's certificate database). Other host profiles continue
using their existing account. Shared tasks under `infrastructure/ansible/tasks/`
prepare the account, desktop files, autologin drop-in, and session readiness.
New user-file operations inherit `LC_ALL=C.UTF-8`, `LANG=C.UTF-8`, and an empty
`LANGUAGE`, so hosts using EUC-JP can run them.

`roles/kiosk` is the older full provisioning route. `roles/release_kiosk` stages
browser and panel units, switches files, verifies the candidate, and restores
files on failure. Its session transaction captures the previous account, UID,
and drop-in before switching. Existing file backups restore the browser and
hotcorner units; the new rollback tasks restore or remove the autologin drop-in,
restart LightDM if needed, and wait for the previous user's session.

## Plan of Work

### Milestone 1: mechanism PR, disabled everywhere

Provide a locked account with no generated SSH key, a private primary group, and
explicit supplementary groups. Route only GUI owners and paths to that account:
browser, panel/hotcorner, IBus/Mozc, labwc, and kiosk NSS. Keep deployment, status,
container agents, and power-operation contracts unchanged. Add the first-install
guard. The launcher waits when enabled; switch and rollback stop the browser before
changing the desktop and wait for X0, the selected user's labwc and D-Bus, authenticated X access, and a D-Bus response.

Validate the disabled rendering against the pre-change fixture for every public
kiosk inventory host, enabled selection, removable autologin, and both rollback
directions. Use local fixtures only. Review the final diff before requesting any
later Git stage. Do not add a host override in this milestone.

### Milestone 2: distribute the mechanism while disabled

After integration and CI success, obtain deployment authorization for an exact
branch or immutable SHA. Follow `docs/guides/deployment.md` and
`docs/guides/quick-start-deployment.md`, inspect the standard rolling plan, and
select an exact host limit or explicitly approved full fleet. Deliver to all Pi4
kiosks with the flag still false. Record run ID, status, recap, health, and any
rollback. Confirm existing screen sessions and deployment behavior are preserved.

### Milestone 3: separate trial PR

In a separate task and PR, enable only `kensaku-stonebase01` with
`kiosk_unprivileged_session_enabled: true`. Keep all other hosts false. Establish
any necessary device groups from observed device access, without copying the
operator's group list. After CI and explicit deployment approval, use the standard
rolling update limited to that host. Preserve both browser profiles.

### Milestone 4: physical verification and reversal

At the trial terminal, reboot and check screen display, Japanese input, NFC,
barcode reads, call audio input/output, the panel, and power requests. Confirm the
screen session and its browser, IBus, and panel use the dedicated account, while
updates and power requests still complete through the deployment account.
Check how Wi-Fi and other network settings behave when operated from the screen
panel: the dedicated user is not in the `netdev` group. Keep the default group
list unchanged and record whether these operations work or require authentication.
Remove the flag, reapply the same standard route, and reboot again. Verify return
to the deployment account and repeat the operational checks. Record observations
without credentials, private inventory, or local browser data. Restore the flag
only through the separately approved trial process if further trials are needed.

### Milestone 5: gradual fleet enablement

Proceed only after the trial and its reversal are accepted. Enable bounded groups
of Pi4 hosts through separate reviewed changes and approved standard rolling
updates. Repeat the physical checks for device or locale variations. Stop a wave
on an unsuccessful result and use the standard rollback/recovery route described
in `docs/runbooks/deploy-status-recovery.md`.

## Concrete Steps

From the task worktree root, run the focused tests with writable Ansible scratch
paths. No credentials or private inventory are required:

    ANSIBLE_LOCAL_TEMP=/tmp/kiosk-ansible-local ANSIBLE_REMOTE_TEMP=/tmp/kiosk-ansible-remote python3 -m unittest scripts.deploy.tests.test_kiosk_gui_session

Run the related modules listed under Validation and Acceptance with the same
environment. For syntax validation, use a temporary Ansible configuration with
`roles_path` pointing to this repository's `infrastructure/ansible/roles`, and a
synthetic inventory containing `server`, `kiosk`, and `signage` groups, a fixture
`ansible_user`, and a fixture `release_pi4_canary_host`. Do not load the repository
vault password configuration or private inventory.

    ANSIBLE_CONFIG=/tmp/kiosk-syntax.cfg ansible-playbook -i /tmp/kiosk-syntax-inventory.yml infrastructure/ansible/playbooks/deploy-release-standard.yml --syntax-check
    git diff --check

Expected results are successful unittest summaries, the playbook path from
syntax-check, and no whitespace errors. Final counts and elapsed times belong in
Artifacts and Notes.

## Validation and Acceptance

`test_kiosk_gui_session.py` compares template hashes and existing user-dependent
task arguments against a fixture captured from the pre-change source. It covers
all kiosk inventory hosts for both missing and false flags, then checks enabled
account/home/runtime values and protected deployment contracts. Its local Ansible
transaction executes real file operations, replacing only service and session
operations, to verify creation, idempotence, flag removal, and both restoration
directions. The first-install assertion must reject true and accept missing/false.

Related regression modules are `scripts.deploy.tests.test_ansible_standard_release`,
`test_distrusted_intermediates`, `test_kiosk_hotcorner`, and
`test_terminal_runtime_manifest`, plus
`scripts.ci.tests.test_kiosk_security_scans_delivery` and
`test_security_review_kiosk_fetch_contract`. Additional affected template/task
contract tests are selected after the focused checks. No passing local check
constitutes evidence of a physical terminal, main integration, or deployment.

## Idempotence and Recovery

Reapplying true retains the dedicated user and profile and does not restart
LightDM when the drop-in is unchanged. Removing the flag explicitly removes the
drop-in and restores the OS autologin account. Release rollback restores the
captured drop-in bytes/metadata or removes a newly created drop-in, restores
staged units through existing backups, and waits before restarting the browser.
The account and its profile are intentionally retained after either reversal.
Full provisioning shares the selected account and reversible autologin tasks;
the transactional failure recovery belongs to the standard release route.

## Artifacts and Notes

- Review fixes (2026-11-08): rollback session operations now require a candidate
  drop-in change; release IME preparation includes only `ibus-process-owner` and
  `ibus-settings`, without package installation or cache updates. The focused
  command under Concrete Steps passed 12 tests in 10.178 seconds. Running the six
  related regression modules listed under Validation and Acceptance with the same
  environment passed 185 tests in 78.414 seconds (197 total). Disabled rendering
  passed against the unchanged baseline. Physical network-panel checks remain
  pending; no Git mutation or deployment was performed for these review fixes.
- Initial worktree: clean; no pre-existing WIP to preserve.
- Fixture: `scripts/deploy/tests/fixtures/kiosk-session/disabled-baseline.json`.
  It stores public host rendering contexts with a synthetic URL, hashes, and
  synthetic user-dependent task outputs; it contains no device credentials.
- Syntax-check: standard release playbook passed with synthetic inventory/config.
- Final combined regression: 271 tests passed in 241.396 seconds.
- Final focused session run after readiness-order changes: 10 passed in 26.521 seconds.
- Extra contract check: 77 passed in 1.325 seconds (included in the final combined
  run except for one deliberately repeated focused case).
- Initial failures: the default Ansible temporary directory was not writable,
  and existing literal account assertions required updating to the selected or
  captured account. The final runs use writable temporary directories and pass.
- Final review: account selection, disabled rendering, browser-only releases,
  switch/rollback ordering, account primary/supplementary group restrictions,
  and locale inheritance were checked. The final worktree contains only this
  task's changes; the starting worktree was clean.

Exact combined regression command (worktree root):

    ANSIBLE_LOCAL_TEMP=/tmp/kiosk-ansible-local ANSIBLE_REMOTE_TEMP=/tmp/kiosk-ansible-remote python3 -m unittest \
      scripts.deploy.tests.test_kiosk_gui_session \
      scripts.deploy.tests.test_distrusted_intermediates \
      scripts.deploy.tests.test_ansible_standard_release \
      scripts.deploy.tests.test_kiosk_hotcorner \
      scripts.deploy.tests.test_terminal_runtime_manifest \
      scripts.ci.tests.test_kiosk_security_scans_delivery \
      scripts.ci.tests.test_security_review_kiosk_fetch_contract \
      scripts.deploy.tests.test_ansible_task_keyword_placement \
      scripts.deploy.tests.test_ansible_template_contracts \
      scripts.deploy.tests.test_standard_ansible_release

The focused command is the one under Concrete Steps. The syntax command there
also passed on the final files with the temporary configuration/inventory, and
`git diff --check` produced no output.

Changed files (local implementation only):

- `docs/INDEX.md`
- `docs/plans/kiosk-unprivileged-session-execplan.md`
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/roles/common/tasks/distrusted-intermediates.yml`
- `infrastructure/ansible/roles/kiosk/tasks/diagnose-ime.yml`
- `infrastructure/ansible/roles/kiosk/tasks/firefox-chrome.yml`
- `infrastructure/ansible/roles/kiosk/tasks/ibus-process-owner.yml`
- `infrastructure/ansible/roles/kiosk/tasks/ibus-settings.yml`
- `infrastructure/ansible/roles/kiosk/tasks/main.yml`
- `infrastructure/ansible/roles/release_kiosk/tasks/first_install_preflight.yml`
- `infrastructure/ansible/roles/release_kiosk/tasks/health.yml`
- `infrastructure/ansible/roles/release_kiosk/tasks/prepare.yml`
- `infrastructure/ansible/roles/release_kiosk/tasks/prepare_gui_session.yml`
- `infrastructure/ansible/roles/release_kiosk/tasks/prepare_hotcorner.yml`
- `infrastructure/ansible/roles/release_kiosk/tasks/rollback.yml`
- `infrastructure/ansible/roles/release_kiosk/tasks/rollback_gui_session.yml`
- `infrastructure/ansible/roles/release_kiosk/tasks/switch.yml`
- `infrastructure/ansible/roles/release_kiosk/templates/kiosk-hotcorner.service.j2`
- `infrastructure/ansible/tasks/kiosk-gui-session-config.yml`
- `infrastructure/ansible/tasks/kiosk-gui-session-switch.yml`
- `infrastructure/ansible/tasks/kiosk-gui-session-wait.yml`
- `infrastructure/ansible/tasks/kiosk-gui-user.yml`
- `infrastructure/ansible/templates/kiosk-browser.service.j2`
- `infrastructure/ansible/templates/kiosk-gui-session.conf.j2`
- `infrastructure/ansible/templates/kiosk-launch.sh.j2`
- `scripts/deploy/tests/fixtures/kiosk-session/disabled-baseline.json`
- `scripts/deploy/tests/test_ansible_standard_release.py`
- `scripts/deploy/tests/test_distrusted_intermediates.py`
- `scripts/deploy/tests/test_kiosk_gui_session.py`

## Interfaces and Dependencies

The new public settings are `kiosk_unprivileged_session_enabled` (boolean, false),
`kiosk_unprivileged_session_user` (string, `kiosk-display`), and
`kiosk_unprivileged_session_groups` (list, empty). Shared GUI values are
`kiosk_gui_user`, `kiosk_gui_home`, and `kiosk_gui_uid`. Existing Ansible built-in
modules, LightDM, labwc/Xwayland, xset, dbus-send, systemd, and unittest/Jinja are
used; no new package dependency or external service is introduced.

Revision note (2026-11-08): created for the mechanism-only implementation and the
five-stage rollout requested by the user; updated with final local validation
evidence and browser stop/wait/start ordering. Later stages remain unexecuted.
