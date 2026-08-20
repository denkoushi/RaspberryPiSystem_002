---
title: "ADR-20260820: Independent encrypted Google Drive DR repository for Business Pi 5"
status: accepted
date: 2026-08-20
scope: Business Pi 5 disaster recovery, encrypted restic/rclone snapshot, overnight operations
related_code: scripts/google_drive_dr, infrastructure/ansible/playbooks/deploy-google-drive-disaster-recovery.yml, infrastructure/ansible/templates/raspi-google-drive-dr.*.j2
related_docs: ../plans/google-drive-disaster-recovery-execplan.md, ../runbooks/google-drive-disaster-recovery.md, ../guides/backup-and-restore.md
---

# ADR-20260820: Independent encrypted Google Drive DR repository for Business Pi 5

## Context

The current Raspberry Pi system already uses Dropbox-oriented backup and restore paths for individual data or configuration items. Those paths are useful during normal operations, but they are not the right single artifact for rebuilding a Pi 5 after total loss of its SSD or host. A recovery copy also needs to work when GitHub is unavailable, preserve a consistent PostgreSQL state, and protect primary business files without exposing credentials.

The existing TypeScript backup Factory and Loader are application-facing modules with their own provider and API contracts. Extending them with a full-host disaster-recovery workflow would couple cloud repository lifecycle, PostgreSQL dump orchestration, Git, staging, signals, and systemd concerns to the business API. The current code explicitly rejects `.ssh` authority paths. The former Pi 4 one-shot recovery command and runbook were removed in commit `f02c4be3` on 2026-08-08; current main supports a new OS plus standard Ansible reconstruction rather than reviving that command.

The recovery path must not stop the business API or mutate the live database. It must avoid automatic restoration of old SSH keys or Tailscale identity to a new SD card/Pi. It must also remain usable: an optional missing source or dirty worktree is evidence in the manifest, not a reason to discard the database and primary files.

## Decision

Add an independent Business Pi 5 DR lane implemented as small Python modules under `scripts/google_drive_dr/`. The pure `source_policy` module determines required, optional, and excluded inputs. `snapshot_builder` creates a private staging area, a PostgreSQL custom-format dump using `pg_dump -Fc --no-owner --no-acl`, a Git bundle and SHA/dirty manifest, while ordinary persistent files are read through the existing atomic-write contract. `restic_repository` owns only the encrypted repository operations. `restore_validator` owns isolated manifest, source, Git bundle, dump, and excluded-material verification. `runner` owns CLI ordering, exit codes, redacted structured logs, a local lock, and signal handling; `command_port` supplies the injected subprocess/process-group adapter.

The encrypted restic repository is reached through rclone at:

    rclone:google-drive:RaspberryPiSystem_002/business-pi5

The Google Drive OAuth scope is `drive.file`. A repository-specific restic password is generated independently and stored outside Google Drive in the approved password-management location and an offline medium. On the Pi, rclone credentials and the password file are pre-positioned in a dedicated root-owned directory with mode `0600`; neither is in Git, the manifest, logs, or the encrypted payload.

The snapshot includes configuration needed to rebuild the Business Pi 5 (`backup.json`, environment files, certificates, backup-only SSH authority, and release settings), the current SHA and Git bundle, the PostgreSQL dump, and primary business files such as photographs, PDFs, drawings, assembly images, measuring-instrument and pallet illustrations, CSV dashboards, and the integrity catalog. It excludes `.ssh` authority directories, Google authentication material, the restic password, Tailscale identity/state for automatic restore, thumbnails, rendered PDF pages, signage renders, drawing derivatives, caches, logs, build outputs, Docker images, and the raw database volume. Pi 4 collection is not part of this snapshot.

Dropbox remains the individual-restore service. Google Drive is the total-loss DR service. A replacement Pi receives a fresh OS, fresh host identity, and standard Ansible configuration; old SSH/Tailscale identity is never silently reinstated.

The public CLI is `capacity`, `backup`, and `restore-check --target <new-empty-path>`. Capacity is read-only and must pass before cloud write.
Backup creates a new dump on every run, uploads the snapshot, verifies it, and applies daily-7/weekly-5/monthly-12 retention.
Both `backup` and `forget` use `--group-by host,tags`: restic otherwise groups by host and paths, while this run's staging directory is intentionally unique on every invocation.
Keeping the grouping value identical on backup and forget preserves parent selection and applies the retention policy to the whole Business Pi 5 tag lane. `prune` runs only on Sunday.
Restore-check obtains the bounded tag-filtered array from `snapshots --json --tag business-pi5`, validates every object's non-empty `id` and timezone-aware `time`, and selects the greatest `(time, id)` pair.
This handles old and replacement Pi hostnames without a group-by assumption, avoids a latest-snapshot race, and makes same-time selection deterministic.
It then restores that concrete ID and does not depend on a restore summary repeating the ID.
JSON-line `backup` and `restore` calls use `--quiet`, and the adapter removes inherited `RESTIC_PROGRESS_FPS` because that variable would re-enable periodic status output.
Restore-check restores to a new unused directory and validates manifest, Git bundle, dump format, and required files. No command automatically overwrites a live path.

The dedicated Pi 5 playbook is not part of normal fleet deploy. It installs the runner and non-secret configuration on exactly `raspberrypi5`, creates the installed Python package directory before copying its modules, and writes a disabled-by-default systemd timer with `OnCalendar=*-*-* 21:30:00 Asia/Tokyo`. The calendar expression owns the IANA timezone, so deployment does not depend on or change the host's local timezone. The unit uses `Persistent=false`, `Type=oneshot`, `TimeoutStartSec=9h30m`, and `KillMode=control-group`, and does not use the invalid `RuntimeMaxSec` contract for a oneshot unit. Activation and production placement require later explicit approval.

## Alternatives

Extending the existing API provider factory was rejected because it would mix business API concerns with a host-level DR lifecycle and enlarge already large modules. Using Dropbox for the complete snapshot was rejected because it conflicts with its individual-restore role and the approved independent Google Drive requirement. Copying the PostgreSQL Docker volume was rejected because a raw engine volume is not a portable, consistent recovery artifact. Adding Pi 4 data to every Pi 5 run was rejected because a disconnected Pi 4 would make Pi 5 DR depend on a separate client and expand the failure surface. Automatically restoring SSH or Tailscale identity was rejected because it can clone credentials or a host identity onto a replacement. Automatically restoring into the live directory was rejected because an unverified snapshot could overwrite the only remaining working state.

## Consequences

The new lane adds a small Python runtime, a dedicated Ansible playbook, and an overnight operational contract, but leaves the public API, UI, Prisma schema, migrations, normal Dropbox settings, and existing individual-restore behavior unchanged. restic encryption and deduplication provide an off-site artifact that can be retried after interruption without re-uploading unchanged blobs. A dirty worktree and missing optional data are visible warnings while normal recovery inputs still complete.

The repository password and Google credentials become operational secrets with a separate offline custody requirement. A first run needs capacity and credentials configured, and a total-loss recovery requires an operator to prepare a new system and perform an isolated restore before cutover. The timer is intentionally disabled until those steps have been demonstrated.

## Validation

Pure unit tests must cover source policy, command ordering, failure-before-write, optional/dirty continuation, secret-safe logs, SIGTERM process-group cleanup, restore-target isolation, the explicit `host,tags` grouping contract, and exact time/ID snapshot selection before restore across old and replacement hostnames.
An isolated Mac Docker test must use only uniquely labelled temporary PostgreSQL resources, apply all migrations, insert representative rows, dump and restore into a second database, rerun migrations, compare schema/ledger/row counts, inspect representative `EXPLAIN (ANALYZE, BUFFERS)` plans, verify the Git bundle, compare primary-file hashes, and prove cleanup plus pre-existing Docker-ID immutability.
A disposable local restic repository should also prove that snapshots with different staging paths are handled as one tag group by the retention command.
The [restic forget documentation](https://restic.readthedocs.io/en/stable/060_forget.html) defines the default host-and-path grouping and recommends matching `backup --group-by` and `forget --group-by` values.
The [restic scripting documentation](https://github.com/restic/restic/blob/master/doc/075_scripting.rst) defines the snapshots JSON array, snapshot `time`/`id` fields, restore JSON summary fields, and the `--quiet`/`RESTIC_PROGRESS_FPS` interaction used by this adapter.
Ansible/systemd contract tests must prove the exact Pi 5 host, disabled timer, schedule, persistence, timeout, credential mode, and normal-fleet separation.
Production placement, live restore, timer activation, push, PR, merge, and physical acceptance are separate gates.

## Supersedes / Superseded By

- Supersedes the stale portions of `docs/guides/backup-and-restore.md` that described `.ssh` as a recommended backup target or implied that old Tailscale state should be restored to a new host.
- Does not supersede Dropbox individual restore, standard OS/Ansible reconstruction, or any existing public backup API contract.
- Superseded by: none.

## References

- [Business Pi 5 Google Drive DR ExecPlan](../plans/google-drive-disaster-recovery-execplan.md)
- [Business Pi 5 Google Drive DR Runbook](../runbooks/google-drive-disaster-recovery.md)
- [Backup and restore guide](../guides/backup-and-restore.md)
- [Backup SSH policy](../../apps/api/src/services/backup/backup-ssh-policy.ts)
- [restic scripting and JSON output](https://github.com/restic/restic/blob/master/doc/075_scripting.rst)
- [Pi 4 recovery removal](https://github.com/denkoushi/RaspberryPiSystem_002/commit/f02c4be3)
