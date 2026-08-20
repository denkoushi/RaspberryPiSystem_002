---
title: Business Pi 5 Google Drive disaster-recovery backup Runbook
tags: [operations, backup, restore, Google Drive, restic, rclone, Raspberry Pi 5]
audience: [operators, release engineers, recovery operators]
last-verified: 2026-08-20
related: [../plans/google-drive-disaster-recovery-execplan.md, ../decisions/ADR-20260820-google-drive-disaster-recovery.md, ../guides/backup-and-restore.md]
category: runbooks
update-frequency: medium
---

# Business Pi 5 Google Drive disaster-recovery backup Runbook

## Purpose and responsibility split

This Runbook is the operational source of truth for the independent encrypted snapshot used when the Business Pi 5 or its SSD is lost. The daily Dropbox lane remains the normal path for restoring an individual file, database export, or configuration item. The Google Drive restic repository is a second off-site copy for rebuilding the complete Pi 5.

This Runbook never performs an automatic live restore. It first restores into a new isolated directory and verifies the result. A replacement Pi receives a fresh OS and standard Ansible configuration. Old SSH keys and Tailscale identity/state are not automatically restored to a new SD card or Pi. The current main branch has no Pi 4 one-shot recovery command: the former command, playbooks, tests, and runbook were removed in commit `f02c4be3` on 2026-08-08. Pi 4 recovery is a fresh OS plus standard Ansible reconstruction, outside this Pi 5 snapshot.

## Preconditions and safety boundaries

Only the immutable merged SHA approved for the relevant rollout may be used on a Pi. Local feature-branch success is not deployment evidence. The dedicated playbook targets exactly `raspberrypi5` and is not included in normal fleet deployment. Installing it, placing credentials, performing the first manual backup, enabling the timer, and changing a production host are separate approval steps.

The repository is:

    rclone:google-drive:RaspberryPiSystem_002/business-pi5

Google OAuth uses `drive.file`; this limits the application to files it creates. The restic password is repository-specific and must be held in the approved password manager and on an offline medium. Never paste the password or OAuth token into a shell history, Git file, manifest, ticket, or log.

The Pi credential directory is dedicated to this lane. It contains the rclone configuration, restic password file, and environment metadata as applicable. It must be owned by `root:root`, files must be mode `0600`, and the directory must not be a backup source. The systemd timer is disabled by default. Do not enable it until the manual capacity, backup, and isolated restore checks pass.

## Snapshot coverage

The runner includes the current application source and checked-out SHA, a Git bundle, a PostgreSQL custom-format dump, and the settings and primary files required to rebuild the Business Pi 5. The fixed logical categories are:

- `config/backup.json`, application/web/Docker environment files, certificate files, backup-only SSH authority, and release configuration;
- primary photos, PDFs, inspection drawings, assembly procedure images, measuring-instrument genre images, pallet-machine illustrations, CSV dashboards, and the integrity catalog; and
- the generated PostgreSQL dump and Git bundle in the run's private staging area.

The runner excludes `.ssh` authority directories, Google OAuth credentials, the restic password, Tailscale identity/state for automatic restoration, thumbnails, PDF-page renders, signage renders, drawing derivatives, caches, logs, build results, Docker images, and the raw PostgreSQL volume. A missing optional path or dirty Git worktree creates a warning in the non-secret manifest; it does not stop the DB, Git, or available primary-file backup.

## Initial provisioning (separate approval)

1. Select the exact merged SHA and prove the CI checks required by the release process. Do not run this playbook from an unreviewed feature branch on a production host.
2. Prepare the Google Drive remote with the `drive.file` scope. Create a new repository-specific restic password and store it in the approved password manager and an offline medium. Do not reuse the DGX repository password.
3. Transfer the rclone credential file and password file out of band to the dedicated Pi directory. Confirm `root:root` ownership and `0600` mode. Keep the timer disabled.
4. Run the dedicated Ansible playbook in check mode with an exact host limit and verify `--list-hosts` contains only `raspberrypi5`. The playbook must place the runner, non-secret environment, service, and disabled timer without changing the public API, UI, database schema, migrations, or Dropbox settings.
5. On the Pi, inspect the installed unit and environment paths without printing their values. Confirm the service is `Type=oneshot`, `TimeoutStartSec=9h30m`, `KillMode=control-group`, and has no `RuntimeMaxSec`; confirm the timer has `OnCalendar=*-*-* 21:30:00 Asia/Tokyo`, `Persistent=false`, and is disabled. The explicit calendar timezone makes the schedule independent of the host's local timezone; the playbook neither changes nor rejects the host timezone.

## Capacity check

Run this before every first initialization and after a long outage:

    sudo -u root /bin/sh -c 'set -a; . /etc/raspi-google-drive-dr/backup.env; set +a; cd /opt/raspi-google-drive-dr; exec /usr/bin/python3 -m google_drive_dr.runner capacity'

The output is redacted JSON. It may contain the stage name, source SHA, byte estimates, free-space result, and credential metadata, but never an OAuth token, restic password, database password, filename, or document content. Capacity must report enough Google Drive space for the first snapshot plus the configured safety reserve, enough local staging space for the dump and bundle, and valid credential metadata. `capacity` is read-only; it must not initialize or write the repository. This command intentionally reports the first-snapshot estimate. During a normal backup to an existing repository, the runner checks only the newly generated dump, Git bundle, and manifest bytes before upload; it does not reject a deduplicated run merely because the logical primary tree is larger than current free space.

If capacity or credentials fail, fix the out-of-band configuration and rerun `capacity`. Do not add a refusal for optional business files merely to make the check conservative.

## Manual backup

After `capacity` passes, run one manual snapshot while the timer remains disabled:

    sudo -u root /bin/sh -c 'set -a; . /etc/raspi-google-drive-dr/backup.env; set +a; cd /opt/raspi-google-drive-dr; exec /usr/bin/python3 -m google_drive_dr.runner backup'

The runner takes a consistent PostgreSQL dump with `pg_dump -Fc --no-owner --no-acl`, records the current Git SHA and dirty warning, verifies the Git bundle, builds a non-secret manifest, and uploads the staging output and resolved primary files through restic. It does not stop the API or copy the raw database volume. A normal success event contains only the stage, SHA, total byte count, and encrypted snapshot ID.

After success, inspect the service journal without exposing secret-bearing environment values:

    sudo journalctl -u raspi-google-drive-dr.service --since "15 minutes ago" --no-pager

Confirm that the snapshot ID is present, the repository check succeeded, and no secret, personal filename, document content, database password, OAuth token, or restic password appears. The first manual backup is not accepted until an isolated restore check also passes.

If the process is interrupted, do not delete the repository or another run's staging. restic can reuse already uploaded encrypted blobs on a later run. The next run creates a fresh database dump and safely removes only old, marked staging directories owned by this lane.

## Isolated restore check

Use a new, unused directory on a filesystem with sufficient space. Never point this command at `/opt/RaspberryPiSystem_002`, a live storage directory, or a directory that already exists:

    restore_target="/var/tmp/raspi-google-drive-dr-restore-$(date +%Y%m%d-%H%M%S)"
    test ! -e "${restore_target}"
    sudo -u root /bin/sh -c 'set -a; . /etc/raspi-google-drive-dr/backup.env; set +a; cd /opt/raspi-google-drive-dr; exec /usr/bin/python3 -m google_drive_dr.runner restore-check --target "$1"' sh "${restore_target}"

Before invoking restic, the runner resolves the target and rejects the project, credential, and staging roots and every descendant, including a symlinked parent that resolves into one of those roots. It resolves the newest tagged snapshot from the complete `snapshots --json --tag business-pi5` array by timezone-aware timestamp, using the snapshot ID as a deterministic tie-breaker; this permits selection across an old Pi hostname and a replacement Pi hostname without host/path grouping. The runner restores that concrete ID only after preflight, then verifies the manifest, current SHA/Git bundle, custom PostgreSQL dump format, and required primary-file categories. It must not write to the live application directory. Keep the isolated directory until the operator has reviewed the evidence; remove it only after confirming its exact path and ownership.

For a full rehearsal, create a new database in the same isolated PostgreSQL test environment and load the custom dump. Run `prisma migrate deploy` again, compare the schema and `_prisma_migrations` ledger with the source, compare representative row counts, run the agreed representative query with `EXPLAIN (ANALYZE, BUFFERS)`, verify `git bundle verify`, and compare SHA-256 hashes of representative primary files. Existing production DBs, containers, volumes, and networks are not valid rehearsal targets.

## Nightly timer and retention

The service is scheduled only after capacity, manual backup, and isolated restore acceptance. The timer contract is:

- starts daily from the explicit `OnCalendar=*-*-* 21:30:00 Asia/Tokyo` expression, independent of the host's local timezone;
- `Persistent=false`, so a missed run is not replayed during business hours;
- `Type=oneshot` with `TimeoutStartSec=9h30m` and `KillMode=control-group`;
- `forget --group-by host,tags` after every successful snapshot with daily 7, weekly 5, monthly 12. The matching `backup --group-by host,tags` keeps each UUID staging path in the single Business Pi 5 tag lane, rather than creating a separate retention group per run; and
- `prune` on Sunday only, so normal nightly uploads remain bounded.

Enablement is a separately approved operation. After enablement, inspect the next timer event and the following morning's service result. A run that has not finished by approximately 07:00 is not automatically treated as data loss: stop daytime uploads, inspect the journal and capacity, and let the next overnight run reuse restic blobs. Do not extend the timer into the business window without a new operational decision.

## Total-loss recovery procedure

1. Record the incident, the last known successful snapshot ID, and the exact immutable source SHA. Do not modify the failed SSD or delete the old repository.
2. Prepare a new Pi 5 or SSD with the approved OS, Docker, storage mount, fresh host identity, and standard Ansible prerequisites. Do not copy old `.ssh` or Tailscale state into the replacement.
3. Install the approved merged SHA and the dedicated DR runner/credentials using the Pi 5-only playbook. Keep the timer disabled and keep the live application path empty or isolated.
4. Run `capacity`, then `restore-check` into a new isolated directory. Verify the manifest, Git bundle, dump format, schema/migration ledger, representative row counts and query plan, and representative primary-file hashes.
5. Apply the same Git SHA and release configuration to the replacement. Restore application files only through an explicit, reviewed operator action after the isolated evidence passes. Load the database dump into the replacement database, run the approved migrations, and confirm API health and representative business screens before cutover.
6. Perform final network, certificate, authentication, and data checks. Only after the operator has accepted the isolated restore may traffic be switched to the replacement. Live restore is never triggered automatically by the backup timer.
7. Record the snapshot ID, SHA, dump verification, migration result, file-hash evidence, and final cutover approval. If the restore fails, keep the isolated directory and return to diagnosis; do not overwrite a working system to make the failure disappear.

## Failure handling and diagnostics

Credential, repository, or capacity failures must occur before any Google Drive write. Authentication metadata may be checked without revealing secret values. Optional missing sources and dirty worktrees are warnings. A failure in one optional path must not prevent the DB dump, Git bundle, and available primary data from completing.

On SIGTERM, the runner terminates its active child process group and exits with its documented signal status. systemd's `KillMode=control-group` covers child restic, rclone, `pg_dump`, and Git processes. It must not delete another staging directory or the repository. Review only redacted JSON events and the service journal; never use broad `pkill` or manual deletion of shared Docker/backup resources.

For a post-snapshot `restic check` failure, retain the run's marked staging directory, record the snapshot ID, and retry from a new dump after correcting the cause. If verification succeeded but `forget` or `prune` failed, retain the snapshot ID and maintenance-failure evidence but remove that run's staging normally; retry repository maintenance separately. For a restore failure, preserve the isolated target and compare manifest/hash evidence before attempting another target. If Google Drive is unavailable, the existing Dropbox individual restore and local/offline copies remain separate fallback sources; do not silently change the repository path or password.

## Verification checklist

Before timer activation, an operator must have observed all of the following:

- `--list-hosts` and check mode select only `raspberrypi5`;
- credential files are root-owned and `0600`, and the timer is disabled;
- `capacity` succeeds without cloud write;
- one manual `backup` succeeds and reports a snapshot ID without secrets or private filenames;
- `restore-check` succeeds in a new isolated directory and leaves the live path untouched;
- PostgreSQL custom dump load, migration idempotence, row counts, schema, and representative query plan pass in an isolated database;
- Git bundle verification and representative primary-file hash comparisons pass;
- retention behavior is daily 7, weekly 5, monthly 12 and Sunday prune; and
- Mac test cleanup proves zero task-labelled temporary Docker resources and unchanged pre-existing IDs.

Timer activation, first scheduled run, production placement, live cutover, push, pull request, merge, and physical Pi replacement remain separately approved actions. This Runbook does not authorize them by itself.
