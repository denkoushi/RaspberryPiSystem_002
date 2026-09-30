---
title: Pi4 SD-card backup and card replacement ExecPlan
tags: [plan, backup, SD card, Google Drive, Raspberry Pi 4]
last-verified: 2026-09-30
related: [../decisions/ADR-20260930-pi4-sd-card-backup.md, ../runbooks/pi4-sd-card-backup.md]
category: plans
---

# Pi4 SD-card backup and card replacement

This ExecPlan is a living document and follows `.agent/PLANS.md`.

## Purpose / Big Picture

Every Pi4 kiosk boots from a consumer SD card, and cards wear out. Before this work, a dead card meant rebuilding the kiosk by hand. Nothing could turn a blank card back into a working kiosk: the old recovery command was removed on 2026-08-08, and the standard release only updates kiosks that are already set up. After this work, the Business Pi5 keeps a weekly encrypted copy of each kiosk's card on Google Drive. When a card dies, an operator puts a new card in a USB reader on the Pi5 and runs one command. The card is ready to go back into the same kiosk. Success is a drill: a kiosk boots from a restored card and passes the standard health checks.

## Progress

- [x] 2026-09-30: Measured the fleet read-only: seven Pi4 kiosks on Raspberry Pi OS trixie, 9–21 GB used on 29–58 GB cards, 0.8–1.5 GB written per day, two-partition DOS tables with PARTUUID references. Google Drive had 1.65 TiB free; the Pi5 SSD was 84% used; restic 0.18.0 was installed.
- [x] 2026-09-30: The user chose image backup over provisioning automation. Google Drive is the storage, and restoring a terminal's identity onto its own replacement card is allowed.
- [x] 2026-09-30: Implemented `scripts/pi4_sd_backup` (plan and runner), the dedicated playbook, the units, the CI classification, 16 unit tests, the ADR, and the Runbook.
- [ ] Merge, then run the dedicated playbook on the Pi5 (timer disabled) and one manual backup of all kiosks.
- [ ] Physical drill on one kiosk with a spare card and a USB reader on the Pi5. Record host, run id, elapsed time, and health results here.
- [ ] Enable the weekly timer after the drill passes.

## Surprises & Discoveries

- Observation: `restic forget --group-by host,tags` cannot keep the three parts of one run together. The run tag differs every week, so grouping by it keeps everything, and grouping by host alone would keep one part per week. Evidence: restic keeps one snapshot per time bucket in each group. Retention is therefore decided per run in `plan.snapshots_to_forget`.
- Observation: kiosks already mount `/` with `noatime`, and trixie mounts `/tmp` as tmpfs, so `--one-file-system` skips it.

## Decision Log

- Decision: pull from the Pi5 with `restic backup --stdin-from-command` over SSH as the Pi5 deploy user. Rationale: nothing is staged on the nearly full Pi5 SSD, the Drive token stays on one host, and restic keeps no snapshot when the reading command fails. Date/Author: 2026-09-30 / Claude.
- Decision: reuse the Business Pi5 DR rclone configuration and restic password, in a separate repository path. Rationale: no new secret to take into offline custody. Date/Author: 2026-09-30 / Claude.
- Decision: keep the saved `label-id` when repartitioning. Rationale: PARTUUIDs stay valid, so the restored card boots without editing `fstab` or `cmdline.txt`. Date/Author: 2026-09-30 / Claude.

## Outcomes & Retrospective

Open until the drill passes.

## Context and Orientation

`scripts/pi4_sd_backup/plan.py` holds every decision as pure functions: target validation, the remote tar and sfdisk scripts, restic arguments, run selection, retention, partition-table rewriting, and device safety checks. `scripts/pi4_sd_backup/runner.py` is the CLI (`backup`, `list`, `restore`) that runs restic, `lsblk`, `sfdisk`, `mkfs` and `tar`. `infrastructure/ansible/playbooks/deploy-pi4-sd-backup.yml` installs the runner on `raspberrypi5` and writes the kiosk list from the `kiosk` inventory group. The operator steps are in `docs/runbooks/pi4-sd-card-backup.md`.

## Validation and Acceptance

Run `python3 -m unittest scripts/deploy/tests/test_pi4_sd_backup.py`, and expect 16 passing tests. The deploy-contract CI job runs the same file. Acceptance is the drill in the Runbook. After the first manual backup, `list` shows every kiosk. A spare card restored for one kiosk boots in that kiosk. The kiosk screen, NFC, `status-agent`, and a standard deploy limited to that host all succeed. The original card then goes back in.

## Idempotence and Recovery

Backups only add snapshots, and a failed kiosk leaves none. Rerunning the playbook rewrites only the runner, the kiosk list, and the units. Restore erases only the named card, after the safety checks pass. The original card of a drilled kiosk is never written.
