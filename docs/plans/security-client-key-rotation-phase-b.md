---
id: security-client-key-rotation-phase-b
status: in_progress
scope: Replace every production device credential (`ClientDevice.apiKey`, sent as `x-client-key`) with a per-device random value, one device at a time, through the standard release route.
date: 2026-10-06
source_of_truth: this plan
related_code:
  - apps/api/src/services/clients/client-device-auth.service.ts
  - apps/api/src/services/clients/client-telemetry.service.ts
  - apps/web/src/lib/client-key/
  - infrastructure/ansible/inventory.yml
  - infrastructure/ansible/roles/release_kiosk/
  - infrastructure/ansible/roles/release_signage/
  - scripts/deploy/verify-phase12-real.sh
  - scripts/register-clients.sh
related_docs:
  - docs/plans/security-client-key-rotation-phase-a.md
  - docs/runbooks/security-hardening-remediation.md
  - docs/guides/deployment.md
  - docs/guides/api-key-policy.md
validation: per-device evidence that the new credential authenticates and the previous credential is rejected, recorded in this plan without credential values
open_items: Every device row now has a per-device random credential (2026-10-06). Left: a second rotation of the Pi3, on-device checks by the system owner, and the Milestone 4 closeout items.
supersedes: none
superseded_by: none
---

# Phase B: Rotate every device credential to a per-device random value

This is a living ExecPlan and must remain current while the work is in progress. It follows `.agent/PLANS.md`; the safety rules in `AGENTS.md` take precedence where they differ. It continues `docs/plans/security-client-key-rotation-phase-a.md`, which prepared the Pi3 signage device only and left production rotation as a separate approval.

This repository is public. This plan and every commit, pull request and log produced from it must not contain a credential value, old or new, and must not describe how a current value could be derived. Record only variable names, device names, counts and pass/fail results.

## Purpose / Big Picture

Every kiosk, signage display and device agent proves which device it is by sending a credential in the `x-client-key` request header. The API looks that value up in the `apiKey` column of the `ClientDevice` table. The security runbook item C-4 in `docs/runbooks/security-hardening-remediation.md` records that these credentials do not have enough randomness and asks for a per-device random value held in Ansible Vault. A read-only production check on 2026-10-06 confirmed that the item still applies to production.

After this plan is executed, each device holds a credential that cannot be guessed from the device's name or from this repository, the shop floor has seen at most a few minutes of interruption per device inside an agreed window, and for every device there is recorded evidence that the new credential works and the previous one is rejected with HTTP 401. Other access-control fixes that depend on the device credential (loan routes, due management, device telemetry) only become meaningful once this is done.

## Progress

- [x] (2026-10-06) Read-only repository survey of where the credential is rendered, stored, looked up and changed. Findings are in `Context and Orientation`.
- [x] (2026-10-06) Read-only production count confirming that item C-4 applies. Counts are intentionally not recorded here.
- [x] (2026-10-06) Milestone 0: read-only production audit, run by the system owner with commands that print no values. Results are in `Artifacts and Notes`.
- [x] (2026-10-06) Milestone 1, part: `scripts/security/rotate-client-key.sh` with dry-run and restore modes, tested against PostgreSQL in the `db-infra` job (#1735, `11ba0e0b`).
- [x] (2026-10-06) Milestone 1, part: the standard Pi3 release renders the status-agent file (#1738, `0d03337f`, by the session that owns the Pi3).
- [x] (2026-10-06) Milestone 1, part: the standard Pi5 release renders the status-agent file (#1740, `d76a679c`); first applied by run `20261006-051151-e50cd6`, file mode 600, status agent succeeded twice afterwards.
- [x] (2026-10-06) Milestone 1, part: the script reaches the database through the server compose file and checks the connection before any credential is sent (#1743, `47e68000`).
- [ ] Milestone 1, rest: Pi4 literals in `scripts/deploy/verify-phase12-real.sh`, power dispatcher check.
- [x] (2026-10-06) Pi3 signage device rotated by the session that owns the Pi3. Evidence is in `Artifacts and Notes`.
- [x] (2026-10-06) Milestone 2, part: the four unused rows are disabled. Evidence is in `Artifacts and Notes`.
- [x] (2026-10-06) Milestone 2, rest: the development Mac.
- [x] (2026-10-06) Milestone 3: six Pi4 kiosks, one at a time, then the Pi5. Evidence is in `Artifacts and Notes`. The final read-only audit shows all fourteen device rows with a credential of the new form.
- [ ] Milestone 3: remaining devices, one per window slot.
- [ ] Milestone 4: closeout. Done: runbook item C-4 updated. Open: a torque measurement on `raspi4-assembly-01` and a loan and return on each kiosk, seen by the system owner; the second Pi3 rotation; documentation scrub of credential literals; Pi4 literals in `scripts/deploy/verify-phase12-real.sh`; review of the seed and web defaults; the follow-ups listed in `Artifacts and Notes`.

## Surprises & Discoveries

- Observation: no route or script can change the credential of an existing device. The administrator update route `PUT /clients/:id` does not accept `apiKey`, and `POST /clients` with an unknown credential creates a second device row.
  Evidence: `apps/api/src/routes/clients/shared.ts` (update schema), `apps/api/src/services/clients/client-telemetry.service.ts` (upsert by `apiKey`).
- Observation: a second device row would orphan the first one. Loans, measurement sheets, torque sessions and per-device settings (`siteKey`, `defaultMode`, `canProxyOtherDevices`, `statusClientId`, shelf and signage settings) are attached to the device row's id, so the credential must be replaced in place on the existing row.
  Evidence: `apps/api/prisma/schema.prisma`, model `ClientDevice` and its relations.
- Observation: delivering a new credential to a device before the database knows it makes the release roll itself back. The Pi4 release runs the status agent once as a health check; an unknown credential makes the agent exit non-zero, and the release restores the previous files.
  Evidence: `infrastructure/ansible/roles/release_kiosk/tasks/health_checks.yml`, `clients/status-agent/status-agent.py`.
- Observation: the credential's shape is load-bearing. The kiosk web app adopts a credential from the launcher URL only when it begins with `client-key-`, and both the API and the web app treat a device as a signage display when its credential contains the word `signage`. Some web features also branch on how the stored credential begins.
  Evidence: `apps/web/src/lib/client-key/sources.ts`, `apps/api/src/lib/signage/signage-display-client.ts`, `apps/web/src/lib/signageTargetClientDevices.ts`, `apps/web/src/features/nfc/nfcPolicy.ts`, `apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts`.
- Observation: the standard release does not render the status-agent configuration file on the Pi5 server or on the Pi3 signage device; it only edits single lines in a file written once by a retired role. On a Pi4 the credential-bearing files are staged only when the release set names at least one Pi4 agent for that host.
  Evidence: `infrastructure/ansible/roles/release_pi5/tasks/host-status-agent-storage.yml`, `infrastructure/ansible/roles/release_signage/tasks/host-status-agent-storage.yml`, `infrastructure/ansible/roles/release_kiosk/tasks/prepare.yml`.
- Observation: the Pi5 power dispatcher matches a queued power request to a host by comparing the credential in the request with inventory values, and writes the credential to a debug log.
  Evidence: `infrastructure/ansible/templates/pi5-power-dispatcher.sh.j2`, `apps/api/src/routes/kiosk/power.ts`.
- Observation: `scripts/deploy/verify-phase12-real.sh` carries Pi4 credentials as literals and calls production with them, so it stops working for each device as that device is rotated.
- Observation: the first Pi3 release after the database switch failed before reaching the Pi3. The Pi5 checkout under `/opt/RaspberryPiSystem_002` could not create a new file in `scripts/security/` because that directory was not writable by the release user; earlier commits had added no file there. The Pi3 was without a valid credential until the ownership was corrected and the release re-run.
  Evidence: run `20261006-014830-0b169b` (failed at checkout), run `20261006-015022-f5eddd` (success).
- Observation: a hand-written switch statement echoed the new value to the operator's terminal during the Pi3 step. The script from #1735 does not print values and is the only supported way from now on.
- Observation: a commit that changes only a host's Vault file names no Pi4 agent in the release set, so a Pi4 release of that commit restarts the browser and delivers no credential file. The Pi4 pull request also carried an inventory comment because the inventory is a Pi4 release input. The classifier does not treat host Vault files as release inputs; that gap is a follow-up.
  Evidence: `scripts/ci/classify_changes.py`, `PI4_KIOSK_RELEASE_FILES`; #1758.
- Observation: a browser remembers the credential per address. The development Mac opens the kiosk at an address different from the one first used for the new value, so the page had no credential until the value was appended to the address actually used. Pi4 kiosks start from a rendered address and are not affected.
- Observation: the first production dry run of the script failed before touching data. It passed a project directory to Compose, and the server compose file resolves its environment file next to itself. The tests had used a small compose file of their own, so the difference did not show. Fixed in #1743; a tool that is tested only against a stand-in for production has not been tested for production.

## Decision Log

- Decision: the new credential has the form `client-key-<the device's existing label>-<32 random hexadecimal characters>`, generated with a cryptographic random source on the operator's machine.
  Rationale: it keeps the leading text and the `signage` marker that existing code depends on, so no application behaviour changes, while the random tail makes the value unguessable. Removing the dependence on the credential's shape is a separate improvement and is not required for this plan.
  Date/Author: 2026-10-06 / Claude.
- Decision: replace the credential in place on the existing device row in one database transaction, together with every other row that stores the same value (`ClientDevice.signagePreviewTargetApiKey` and entries of `SignageSchedule.targetClientKeys`). Audit columns that recorded the credential presented at the time (`actorClientKey` on three production-schedule tables) are historical and stay unchanged.
  Rationale: the row id and its settings must survive; history rows describe what happened and hold a value that is dead after rotation.
  Date/Author: 2026-10-06 / Claude.
- Decision: add one operator script that performs that transaction, reading the previous and new values from environment variables and printing only row counts. This revises the Phase A statement that no helper is needed.
  Rationale: Phase A covered a single device. Repeating a hand-typed multi-table statement for every device invites a mistake that takes a kiosk out of service; a reviewed script with a dry-run mode and a test against the test database is the smaller risk. It is an operator tool, not an API route, and it is never called from a deploy.
  Date/Author: 2026-10-06 / Claude.
- Decision: do not build acceptance of two credentials per device. Each device is rotated inside an agreed window with a short interruption.
  Rationale: accepting a previous credential for a grace period would need a schema migration and changes at roughly ten lookup sites, and would itself be new authentication code to get right. The interruption per device is the time between the database transaction and the end of that device's release, which is a few minutes.
  Date/Author: 2026-10-06 / Claude. Open to revision if the shop floor cannot accept the interruption.
- Decision: one device per Vault commit, merged and released before the next device's commit is merged.
  Rationale: Vault files are tracked, and the release checks out an exact pushed commit. If several devices' new values were on `main` at once, any unrelated release reaching one of those devices before its database transaction would fail its health check and roll back.
  Date/Author: 2026-10-06 / Claude.
- Decision (revises the previous one): the six Pi4 hosts shared one Vault commit, and the Pi5 had its own. Merges to `main` and every release that could reach a Pi4 were frozen by the single session that owns merges and releases from the Pi4 merge until the sixth host was done, and Pi5 releases were held from the Pi5 merge until its database switch.
  Rationale: one commit means one Pi4 artifact build instead of six, and the freeze removes the risk the earlier decision guarded against. It needs one owner for all merges and releases.
  Date/Author: 2026-10-06 / Claude and the release-owning session.
- Decision: the new value for an in-use device is generated on the operator's machine, written to Vault and kept in a local store readable only by the operator until the device is done; the database step receives it over standard input and first checks that the value Vault held before matches the database row. The previous value is kept in the same store so that the row can be restored. The store is deleted when the device set is finished.
  Date/Author: 2026-10-06 / Claude.
- Decision: per device the order is database transaction first, standard release second.
  Rationale: the reverse order fails the release health check by design.
  Date/Author: 2026-10-06 / Claude.
- Decision: before the database transaction for any device, prove that the release can start: print the release plan for that device, confirm the required artifacts exist for the head commit, and confirm the Pi5 checkout is clean and can be updated to that commit. Only then switch the database.
  Rationale: the Pi3 step switched the database first and then lost several minutes to a checkout failure unrelated to the device.
  Date/Author: 2026-10-06 / Claude.
- Decision: unused device rows are not deleted. Their credential is replaced with a random value that is stored nowhere, which disables the old value and keeps the row and its history.
  Rationale: deletion can fail on or cascade into history rows; replacement is reversible by issuing a new value. Approved by the system owner on 2026-10-06.
  Date/Author: 2026-10-06 / Claude.
- Decision: the system owner runs every production command (Vault edit, database step); the agent prepares the commands and judges the results. The Pi3 belongs to the session that started it; all other rows belong to this plan's session.
  Date/Author: 2026-10-06 / system owner and Claude.

## Outcomes & Retrospective

Not started.

## Context and Orientation

A "device credential" in this plan is the string a device sends in the `x-client-key` header. The API matches it exactly against `ClientDevice.apiKey`, a unique plain-text column defined in `apps/api/prisma/schema.prisma`. The lookups live in `apps/api/src/services/clients/client-device-auth.service.ts`; an unknown value produces HTTP 401 (code `INVALID_CLIENT_KEY`) on kiosk routes and HTTP 404 on the telemetry routes.

"Ansible Vault" is the encrypted variable store under `infrastructure/ansible/host_vars/<host>/vault.yml`. `infrastructure/ansible/inventory.yml` maps each host's `status_agent_client_key` (and, where present, `signage_client_key`, `torque_agent_client_key`, `nfc_agent_client_secret`) to a Vault variable. On every Pi4 kiosk the same variable feeds both the status agent's configuration file and the kiosk browser's start URL, so the two share one device row. Three hosts (the Pi5 server, the first Pi4 and the Pi3) use a Vault variable of the same name in their own host files; whether the values are equal is not known from the repository. `scripts/ci/validate_production_secret_structure.py` pins the variable names, so this plan changes values only.

"Standard release" is `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml` with an exact `--limit`. It requires the branch to be pushed, runs on the Pi5 against that exact commit, and for a Pi4 restarts the kiosk browser and runs the status agent once as a health check. `docs/guides/deployment.md` is the authority for that route and forbids direct Ansible, direct SSH changes, and unrelated database or Vault work during a release.

On a kiosk the browser takes the credential from the start URL when it is present and overwrites the copy in its local storage, so a kiosk picks up a new value at the browser restart that the release performs. When a stored credential is rejected with HTTP 401 the web app clears it, re-reads the URL and reloads once.

The signage renderer caches one image per credential, in a file named by a hash of the credential, so a rotated signage device shows its image again after the next render cycle.

## Plan of Work

Milestone 0 is a read-only production audit and changes nothing. Its purpose is to replace every "not known from the repository" in this plan with a fact. It lists the device rows (id, name, `statusClientId`, last seen time, and whether the credential has the weak form, never the value); counts rows in `SignageSchedule.targetClientKeys` and `signagePreviewTargetApiKey` that hold a device's credential; states for each host whether its Vault variables are equal to each other and to the same-named variable on other hosts (equal or different only); maps every device row to an inventory host or marks it as outside the inventory (for example a development Mac, an Android signage display, a Zero 2 W shelf device, or a stale row); checks whether the agent variables on a host (`torque_agent_client_key`, `nfc_agent_client_secret`) equal that host's main credential or have their own row; and confirms from `--print-plan` whether the current release set stages the credential-bearing files for each Pi4 (the plan must not print `pi4ReleaseFiles: skipped`). The audit result is recorded here as a table of device names and yes/no answers. The acceptance for this milestone is that every device row has an owner, a delivery path and a rotation order, or an explicit decision to delete or leave it.

Milestone 1 prepares the repository and reaches production only as ordinary code. It adds `scripts/security/rotate-client-key.sh` (name may follow existing conventions): it takes the device row id as an argument, reads the previous and new values from two environment variables, refuses to run unless the previous value matches that row and the new value is unused and has the agreed form, performs the in-place replacement on the three fields in one transaction, prints the number of rows changed per field, and supports a dry run that rolls back. A reverse run with the two variables swapped is the rollback. It has a test against the test database covering a normal run, a dry run, a wrong previous value, a duplicate new value and the reverse run. This milestone also moves the Pi4 literals in `scripts/deploy/verify-phase12-real.sh` to environment variables in the way Phase A did for the Pi3; confirms by test that every place that inspects the credential's shape still behaves the same with the new form; provides a standard, reviewed way to deliver a changed credential to the status-agent file on the Pi5 and on the Pi3 (rendering the file from the existing template in the standard release roles is the expected answer, decided after Milestone 0 shows what those files contain today); and confirms that the power dispatcher still maps a request to its host after a rotation. The acceptance is green CI and, for the script, the test output.

Milestone 2 rotates one pilot device end to end. The pilot is the device whose current value is most exposed, unless the audit shows that device is the busiest on the floor, in which case a quiet kiosk goes first and the exposed one second. The steps are in `Concrete Steps`. The acceptance is the per-device evidence listed in `Validation and Acceptance`, plus a short entry in `Surprises & Discoveries` for anything that differed from this plan. The plan is revised before Milestone 3 starts.

Milestone 3 repeats the same steps for each remaining device in the order fixed by Milestone 0, one device per slot. Devices outside the inventory are handled by their owner's documented method or removed, as decided in Milestone 0. The Pi5 server's own device row is last, because its status agent is not a shop-floor function and its delivery path is the one added in Milestone 1.

Milestone 4 closes the work: a final pass confirms that no device row has the weak form, the documentation that still shows credential literals is scrubbed (`docs/guides/api-key-policy.md` first), the seed and web defaults that no longer correspond to any production value are reviewed, the Phase C secret-scanner suppression from the Phase A plan is applied for retired values, runbook item C-4 is marked done with a link to this plan, and the follow-ups below are filed.

## Concrete Steps

These are the steps for one device. They are run by the operator who holds the Vault credential, inside the window agreed for that device, and only after explicit approval for that device.

First confirm that no release is running and that the device is idle (no loan or measurement in progress on its screen). Generate the new value on the operator's machine with a cryptographic random source and keep it only in the shell session and in Vault. Edit that host's Vault variable or variables (all variables that Milestone 0 showed to be equal are changed together), commit on a branch named for the device, open a pull request whose description names the device and nothing else about the value, wait for CI, and merge.

Take a database backup by the existing backup procedure. On the Pi5, export the previous and new values into the two environment variables without echoing them, run the rotation script in dry-run mode and read the counts, then run it for real. From this moment the device is out of service until its release finishes.

Print the release plan and check its target and file list, then run the release for that device alone:

    scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan --limit <host>
    scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit <host>

Follow the run with `--status <RUN_ID>` until it reports success. Then collect the evidence in `Validation and Acceptance`, clear the two environment variables, and record the device, the run id, the merge commit and the pass/fail results in `Progress`.

## Validation and Acceptance

For each device, all of the following are observed and recorded without values. The release run ends in success and its health check shows the status agent exited with status 0. The device's row keeps the same id and its `statusClientId`, and its last-seen time advances after the release. On the device, the kiosk screen (or signage image) is showing and one ordinary action works: a tag read on a loan kiosk, a page change on a schedule kiosk, a fresh image on signage. A request with the previous value to a kiosk route returns HTTP 401. The administrator device list shows one row for the device, not two. Where the device has agents (torque, shelf, NFC), one agent action succeeds. A power request from the kiosk still reaches the right host.

The whole plan is accepted when the Milestone 4 final pass reports zero device rows with the weak form and every device has the evidence above.

## Idempotence and Recovery

The rotation script changes nothing when the previous value does not match, so running it twice is safe. If the release fails or rolls back after the database transaction, the device still holds its previous files while the database holds the new value: run the script in reverse to restore service, then investigate before retrying. If the release succeeds but the device misbehaves, the same reverse run followed by a release of the commit before the Vault change restores the earlier state; the database backup is the last resort. A device that was offline at release time is dropped from the run by the release preflight; in that case run the script in reverse immediately and reschedule the device. Never leave a slot with the database and the device disagreeing.

## Artifacts and Notes

Evidence is added here per device as it is produced: device name, date, merge commit, run id, and the pass/fail list. No values.

Milestone 0 audit, 2026-10-06. The inventory has nine hosts and every host's credential differs from every other host's. Within a host all credential variables hold one value: status agent and NFC on every Pi4, plus the torque agent on `raspi4-kensaku-stonebase01` and `raspi4-assembly-01`, plus signage on the Pi3. One Pi4 already has a credential of the new form and is out of scope. Besides the inventory hosts, the database has one development machine that is in use and four rows that have not been seen for months. Only two rows are referenced from signage schedules or preview targets, and the script updates those references.

Unused rows, 2026-10-06, run by the system owner on the Pi5 with the script from `main` (`47e68000`). Each of the four rows got a random value that is stored nowhere. Every row was dry-run first and then executed; all eight runs reported success. Three rows changed one device row and no references; the Android signage row changed one device row and two schedule entries. The read-only audit afterwards shows the four rows with a credential of the new form, the schedule references still attached to the signage row, and every other row unchanged. No release was involved.

Development Mac, 2026-10-06 16:54 JST. Database row switched with the script (one row, no references); the Mac's status-agent file updated and restricted to its owner; the next heartbeat at 16:55 succeeded; the kiosk page loads after the new value was given to the browser at the address the operator uses. No release.

Six Pi4 kiosks, 2026-10-06, Vault change #1758 (`aa24f812`). For each host the database row was switched (one row, no references, after a dry run and a match check) and the host was released at once with its own `--limit`. All six runs: `Result=success`, `failed=0 unreachable=0 rescued=0`. After each release the host's last-seen time advanced and the kiosk browser's rejected requests dropped to zero. Interruption per host was five to seven minutes.

    raspi4-fjv60-80              run 20261006-094803-68dc20  done 18:53
    raspi4-robodrill01           run 20261006-100202-bb58c9  done 19:07
    raspi4-sessaku-01            run 20261006-101245-a531c3  done 19:18
    raspberrypi4                 run 20261006-102117-3d83e0  done 19:25
    raspi4-kensaku-stonebase01   run 20261006-103713-998aa0  done 19:44
    raspi4-assembly-01           run 20261006-104802-e92896  done 19:54

On the two hosts with a torque agent the release recreated the agent with the new file and its local health check passed. The torque agent calls the API only while a wrench is in use, so delivery with the new value is confirmed by a real measurement, which is an open on-device check.

Pi5 (`raspberrypi5`), 2026-10-06, Vault change #1764 (`4c9e0df5`). Database row switched at 20:29 JST (one row, no references); release run `20261006-113032-20d958`, `Result=success`, recap `ok=268 changed=32 unreachable=0 failed=0 rescued=0`; the status-agent file was rendered at 20:41 with mode 600 and the agent succeeded at 20:42. Only the Pi5's own status heartbeat was interrupted, for about thirteen minutes.

Final read-only audit, 2026-10-06 20:50 JST: all fourteen device rows have a credential of the new form; the signage references are attached to the same rows as before; every in-use device was seen within the last minute.

Pi3 (`raspberrypi3`), 2026-10-06, by the session that owns the Pi3. Vault change #1736 (`ec82f19e`); status-agent rendering #1738 (`0d03337f`). Database switch at 10:48 JST: one device row, three preview targets, four schedule entries, zero remaining references to the previous value. Release run `20261006-015022-f5eddd`, success, recap `ok=53 changed=18 failed=0`. New value returns 200 and the previous value 401 on `/api/signage/current-image`; the status-agent file was re-rendered and the agent exits normally every minute. The secret-scanner suppression for the previous value was already in place (#1727). Because the new value was shown on the operator's terminal during the switch, the Pi3 is to be rotated once more with the script.

Follow-ups that are out of scope for this plan and should be filed at closeout: treating host Vault files as Pi4 release inputs in `scripts/ci/classify_changes.py`; sending the credential only in a header instead of in start URLs and query strings (runbook item C-9); removing the application's dependence on the credential's shape so that a fully random value can be used; binding device telemetry to the authenticated device, which first needs an administrator way to clear or change a device's `statusClientId`; restricting the status-agent configuration file's permissions together with privilege for the client backup that reads it; removing the credential from the power dispatcher's debug log and from queue file names; cleaning signage cache files left under retired credentials.

## Interfaces and Dependencies

No API route, schema or Vault variable name changes. The only new artifact is the operator script described in Milestone 1 and the delivery of two existing files by the standard release. The work depends on the standard release route in `docs/guides/deployment.md`, on the Vault credential held by the operator and by the Pi5, and on a maintenance window per device agreed with the shop floor.

Decisions still needed from the system owner before Milestone 2: the windows in which each device may be interrupted for a few minutes; whether that interruption is acceptable at all (if not, the two-credential approach rejected above has to be built first); and who performs the Vault edit and the database step.

## Local Notes JA

- 「device credential」は端末キー(`x-client-key` / `ClientDevice.apiKey`)のこと。
- 1台ごとの手順は「Vault の値を変更してマージ → DB の値を入れ替え → その端末だけ標準デプロイ → 新キーで動作・旧キーで 401 を確認」。DB の入れ替えからデプロイ完了までの数分間、その端末は使えない。
- 公開リポジトリのため、キーの値、件数、推測方法はこの計画書・PR・ログに書かない。
