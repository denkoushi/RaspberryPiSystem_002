# Business Pi 5 Google Drive encrypted disaster-recovery backup

This ExecPlan is a living document. Keep the `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` sections current while the feature is implemented. It follows `.agent/PLANS.md`; a contributor must be able to resume the work from this file alone. Commit, push, pull request, merge, production deployment, and timer activation are separate approval stages and are not part of the approved local implementation stage.

## Purpose / Big Picture

The business Raspberry Pi 5 needs a recovery copy that remains useful when the Pi, its SSD, or the GitHub route is unavailable. Existing Dropbox backups remain the fast, individual-file recovery path. This feature adds an independent encrypted restic repository on the 2 TB Google Drive for rebuilding a replacement Pi 5 from a complete snapshot. PostgreSQL is captured with a consistent native dump, the exact application source is preserved as a Git bundle, and primary business files and configuration are copied without stopping the API or modifying the live database.

An operator will be able to run `capacity` before any cloud write, run `backup` manually or from a disabled-by-default nightly systemd timer, and run `restore-check --target <new-empty-path>` to restore the newest snapshot into an isolated directory and validate its manifest, Git bundle, database dump, and required primary files. The restore check never writes to the live application directory. A real disaster recovery still requires a fresh OS/SSD, an isolated restore, database verification, and an explicit final cutover.

## Progress

- [x] (2026-08-20 JST) Confirmed the implementation boundary: a separate Python DR lane, independent from the TypeScript backup factory, normal Dropbox configuration, public HTTP API, UI, Prisma schema, and migrations.
- [x] (2026-08-20 JST) Confirmed the dedicated branch/worktree boundary: `feat/google-drive-disaster-recovery` in `/Users/tsudatakashi/RaspberryPiSystem_002-google-drive-disaster-recovery`, based on the fetched `origin/main`.
- [x] (2026-08-20 JST) Read the current backup implementation and documentation. Existing API backup is primarily Dropbox/local and the current code rejects `.ssh` authority paths; the old Pi 4 one-shot recovery command was removed in commit `f02c4be3` on 2026-08-08.
- [x] (2026-08-20 JST) Added the design record, this living plan, the operator Runbook, the index links, and corrections to the general backup guide.
- [x] (2026-08-20 JST) Implemented `source_policy`, `snapshot_builder`, `restic_repository`, `restore_validator`, `command_port`, and `runner` under `scripts/google_drive_dr/`, with redacted events and focused tests.
- [x] (2026-08-20 JST) Added the Pi 5-only Ansible playbook, root-owned credential contract, nonpersistent systemd service/timer, and infrastructure contract tests. The timer remains disabled by default.
- [x] (2026-08-20 JST) Corrected the installed package shape by creating `/opt/raspi-google-drive-dr/google_drive_dr` before file copies, and made the timer's calendar expression explicitly use `Asia/Tokyo` instead of rejecting hosts whose local timezone differs.
- [x] (2026-08-20 JST) Corrected incremental capacity gating: an uninitialized repository uses the complete first-snapshot estimate, while an existing repository preflights only the current run's generated staging bytes. The repository existence probe is performed once, and focused tests cover both paths, including a 5 GiB logical primary tree with a 2 GiB free-space existing-repository run.
- [x] (2026-08-20 JST) Corrected post-snapshot recovery and retention behavior: `check` failure preserves the owned staging evidence, verified-snapshot `forget`/`prune` failures discard it, and matching `backup`/`forget --group-by host,tags` keeps UUID staging paths in one retention lane.
- [x] (2026-08-20 JST) Closed restore and service-working-directory gaps: restore preflight resolves symlink parents and rejects only the live project, credential, and staging roots or descendants before restic; both bundle verification paths use an explicit Git repository context and pass from a non-Git working directory.
- [x] (2026-08-20 JST) Passed focused Python, ruff, shell, Ansible syntax/list-host, existing backup, and isolated Docker PostgreSQL/restic checks. The successful Docker run removed all task-labelled resources and preserved every starting resource ID.
- [x] (2026-08-20 JST) Reviewed the local diff, documentation links, secret boundaries, and Deploy impact. Push, PR, merge, deployment, credential placement, manual cloud backup, and timer activation remain open and require later approval.

## Surprises & Discoveries

- Observation: the current TypeScript backup code is a large application-oriented path and must not become the DR orchestration boundary.
  Evidence: `apps/api/src/services/backup/storage-provider-factory.ts` and `apps/api/src/services/backup/backup-config-loader.ts` are large modules; `backup-execution.service.ts` currently narrows runtime providers to the existing local/Dropbox behavior.
- Observation: `.ssh` is not a valid backup target even though the general guide previously recommended it.
  Evidence: `apps/api/src/services/backup/backup-ssh-policy.ts` rejects paths containing `.ssh`, and `apps/api/src/services/backup/__tests__/backup-ssh-policy.test.ts` fixes this contract.
- Observation: the former Pi 4 SD recovery entrypoint is no longer present on current main.
  Evidence: commit `f02c4be3` removes `scripts/deploy/recover-pi4.py`, its recovery playbooks, tests, and runbook. This feature must not recreate that workflow.
- Observation: a dirty Git worktree is useful recovery evidence but is not a reason to discard the DB or primary files.
  Evidence: the approved design records the current SHA and dirty warning in the manifest and continues the independent snapshot inputs.
- Observation: a `Type=oneshot` unit does not provide the intended runtime ceiling through `RuntimeMaxSec`.
  Evidence: the approved systemd contract uses `TimeoutStartSec=9h30m` and `KillMode=control-group` instead.
- Observation: existing Mac Docker resources are shared and must not be reused by the integration test.
  Evidence: the host already has unrelated containers, volumes, and networks. The test therefore creates unique resources with `com.raspi-system.temporary=true`, records pre-existing IDs, and proves both cleanup and immutability afterward.
- Observation: a Docker-based restic test must translate host work-directory paths into the container's `/work` mount, and `pg_restore` must select the explicit PostgreSQL user.
  Evidence: the first two integration attempts reached Git bundle/restic restore respectively and exposed those harness defects. After the local corrections, the complete integration run passed and reported zero labelled resources. No production code or existing Docker resource was involved in either failure.
- Observation: every run's private staging directory is UUID-suffixed, so restic's default `host,paths` grouping would make each snapshot its own retention group.
  Evidence: restic's [forget documentation](https://restic.readthedocs.io/en/stable/060_forget.html) states the default grouping and recommends matching the `backup` and `forget` `--group-by` values.
- Observation: the final standard deploy-contract runner's single invocation stopped because only the API dependency directory was temporarily available; the existing `packages/shared-types` build reached `tsc: command not found`.
  Evidence: the expensive runner was not restarted. After temporarily referencing the original repository's existing package `node_modules`, the failed Python boundary was resumed: 353 deploy tests exposed one real feature contract update (the new exact-pnpm entrypoint), its explicit path set was corrected, and the failing test plus all subsequent PostgreSQL, rollback, inventory, and Ansible commands passed. Every temporary dependency symlink and Docker resource was removed afterward.
- Observation: the target Pi 5 operational record identifies systemd 257, and that version accepts an IANA timezone suffix directly in an `OnCalendar` expression.
  Evidence: an isolated Debian trixie container with systemd 257.13 normalized `*-*-* 21:30:00 Asia/Tokyo` without error and calculated the next elapse at 21:30 JST. Its labelled temporary container and dedicated network were removed after the check.

## Decision Log

- Decision: create an independent encrypted restic repository behind rclone at `rclone:google-drive:RaspberryPiSystem_002/business-pi5`.
  Rationale: the disaster-recovery copy must remain separate from Dropbox's individual restore workflow and from the DGX repository. restic supplies encryption, deduplication, resumable uploads, verification, retention, and isolated restore without coupling to application storage providers.
  Date/Author: 2026-08-20 / approved implementation design.
- Decision: keep the DR logic in small Python boundaries: `source_policy`, `snapshot_builder`, `restic_repository`, `restore_validator`, and `runner`, with a shared `command_port` adapter.
  Rationale: policy, restored-payload integrity, and state transitions remain unit-testable; subprocess, PostgreSQL, Git, restic, rclone, CLI, logging, and signals are adapters rather than business rules. The runner does not own manifest/path validation, and the existing Factory and Loader remain unchanged.
  Date/Author: 2026-08-20 / approved implementation design.
- Decision: dump PostgreSQL with `pg_dump -Fc --no-owner --no-acl` rather than copying the raw Docker volume.
  Rationale: a custom-format dump is consistent, portable to a fresh database, and does not require stopping the API or preserving engine-specific volume internals.
  Date/Author: 2026-08-20 / approved implementation design.
- Decision: save the current SHA and a Git bundle and treat a dirty worktree as a manifest warning.
  Rationale: recovery can reconstruct the exact checked-out source even without GitHub, while local uncommitted work is visible without preventing recovery of the stable database and primary files.
  Date/Author: 2026-08-20 / approved implementation design.
- Decision: use `drive.file` scope, a newly generated repository password, and a dedicated root-owned credential directory with `0600` files.
  Rationale: the Google credential can access only files created by this application, and the restic key and OAuth material are never placed in Git, logs, or the encrypted payload.
  Date/Author: 2026-08-20 / approved implementation design.
- Decision: nightly scheduling is 21:30 JST with `Persistent=false`, a 9 hour 30 minute timeout, and a timer disabled on installation.
  Rationale: uploads are confined to the approved overnight window and a missed timer does not unexpectedly upload during business hours. `OnCalendar=*-*-* 21:30:00 Asia/Tokyo` carries its own IANA timezone, so the playbook does not need to reject or mutate an otherwise valid host timezone. Operators first prove capacity and an isolated manual backup before enabling it.
  Date/Author: 2026-08-20 / approved implementation design.
- Decision: retention is daily 7, weekly 5, monthly 12; run `forget` after each snapshot and `prune` only on Sunday.
  Rationale: normal runs stay short while weekly repository maintenance remains bounded. Both commands use `--group-by host,tags` so UUID staging paths do not split the Business Pi 5 lane into one retention group per snapshot. restic can resume or repair an interrupted operation on a later run without touching live data.
  Date/Author: 2026-08-20 / approved implementation design.
- Decision: the live restore path is manual and staged, never an automatic overwrite.
  Rationale: a replacement Pi must be verified against the snapshot before final cutover; refusing to write a live directory is a useful safety boundary that still leaves a concrete, successful isolated recovery route.
  Date/Author: 2026-08-20 / approved implementation design.

## Outcomes & Retrospective

The local implementation milestone is complete. `python3 -m unittest discover -s scripts/google_drive_dr/tests -p 'test_*.py'` passed 40 tests; the dedicated deployment contract passed 9 tests; ruff, shell syntax, `git diff --check`, Ansible syntax, and `--list-hosts` passed, with the latter selecting only `raspberrypi5`.
The focused suite includes real Git bundle creation and verification from a non-Git working directory and resolved restore-target policy tests for live roots, symlink parents, and a normal isolated target. Existing backup policy/service/verifier tests passed 19 tests.
The isolated Docker run applied all 158 migrations, inserted and restored one representative row, created restic snapshot `abb12fcd`, verified schema and migration-ledger equality, reran `prisma migrate deploy`, executed `EXPLAIN (ANALYZE, BUFFERS)`, verified the Git bundle and primary-file hashes, and finished with `labelled temporary resources=0` while retaining every starting Docker ID.
A disposable local restic 0.18.0 repository additionally created two same-tag snapshots from distinct staging paths with a stable test host; `forget --group-by host,tags --keep-last 1` reduced them from 2 to 1, confirming the retention group is not split by the UUID-like path.
A second isolated adapter exercise parsed a quiet backup summary into snapshot `2ca01289`, added a newer replacement-host snapshot, resolved and restored its exact ID `58458f0c` despite the restore summary omitting an ID, verified the restored file, and removed its temporary container, network, and repository.
The first fixture attempt stopped before restore because restic 0.18 requires a space-separated `--time` input; correcting only that test fixture produced the successful evidence.

The standard `run-deploy-contracts-local.sh` boundary was invoked exactly once. It passed its template parse, shell/lifecycle, and real Compose recreation stages, then stopped when this isolated worktree lacked the existing `packages/shared-types` dependency installation (`tsc: command not found`).
The high-cost runner was not repeated. With read-only references to the original repository's installed dependencies, the failed Python boundary ran 353 tests and identified the new DR integration script as a sixth exact-pnpm entrypoint.
The contract now asserts the six explicit paths, its focused 4 tests pass, and all commands after that boundary—client lifecycle, PostgreSQL/migration/role checks, API deploy-status tests, rollback, inventories, and 13 standard Ansible syntax checks—passed.
All temporary `node_modules` symlinks and Docker resources were then removed. This is equivalent segmented evidence rather than a claim that one uninterrupted runner invocation passed.
Push, PR CI, merge, immutable SHA selection, Pi 5 check mode, credential installation, manual cloud backup, isolated production restore, and timer activation remain separate gates.

## Context and Orientation

The repository is a Raspberry Pi 5 server plus Pi 4 clients. `apps/api/src/services/backup/` owns the existing API-driven local/Dropbox backup contract and must not be expanded for this feature. `infrastructure/docker/docker-compose.server.yml` defines the PostgreSQL service and the host-mounted primary storage. `infrastructure/ansible/` owns deployment files, but this DR playbook is intentionally separate from the normal fleet playbook and targets only inventory host `raspberrypi5`.

The new Python package is `scripts/google_drive_dr/`. `source_policy.py` is pure policy: it names required, optional, and excluded sources and resolves only what is present. `snapshot_builder.py` creates a private staging directory, the PostgreSQL custom dump, Git bundle, SHA/dirty-state metadata, and a non-secret manifest. `restic_repository.py` is the cloud repository adapter: it performs init, capacity, backup, check, retention, and latest-snapshot restore without knowing application paths. `restore_validator.py` validates the manifest, every source recorded at backup time, Git bundle, streaming dump format, and excluded-material boundary in an isolated tree. `runner.py` is the CLI and process coordinator: it validates credentials, orders stages, acquires a local lock, emits redacted JSON events, handles signals, and maps failures to exit codes. `command_port.py` is the injected process and process-group boundary shared by the adapters.

The source root on the business Pi is `/opt/RaspberryPiSystem_002`. The repository directory, `config/backup.json`, application and Docker environment files, certificate directory, backup-only SSH authority, release configuration, PostgreSQL dump, Git bundle, and primary business data are included according to the policy. Primary data includes photos, PDFs, drawings, assembly images, measuring-instrument and pallet illustrations, CSV dashboards, and the integrity catalog. Derived thumbnails, PDF pages, signage renders, drawing derivatives, caches, logs, build outputs, Docker images, and the raw database volume are excluded. Google credentials and the restic password are not backup inputs.

Existing Dropbox remains responsible for routine individual restores. The Google Drive repository is responsible for a complete Pi 5 loss. Tailscale state may exist in older or investigative client archives, but it is never automatically restored to a new SD card or Pi; a replacement receives fresh, explicitly configured identity. No Pi 4 is collected as part of this snapshot. The current main branch has no Pi 4 one-shot recovery command; since its removal on 2026-08-08, the supported Pi 4 path is a new OS followed by standard Ansible reconstruction.

## Plan of Work

First preserve the unrelated source worktree and work only in `feat/google-drive-disaster-recovery` from the fetched `origin/main`. Create the living plan, ADR, Runbook, and index link before source changes. The plan and ADR explain why this lane is independent; the Runbook is the operator's procedural source of truth.

Next implement source selection as data, not scattered path checks. Required inputs must be present for a meaningful snapshot; optional paths produce a warning and do not block the database, Git, and primary-data snapshot. Exclusion rules must explicitly cover `.ssh` authority directories, Google OAuth material, restic password, raw database volumes, derived assets, caches, logs, images, and build artifacts. The policy must never emit file contents or personal filenames in logs.

Then implement staging and repository adapters. Build each run in a unique `0700` staging directory beneath the dedicated staging root. Use the existing atomic-write contract for ordinary files, a consistent `pg_dump` custom-format stream for PostgreSQL, and `git bundle create` plus `git bundle verify` for source. Write a manifest containing schema version, role, creation time, current SHA, dirty warning, dump/bundle identities, source category results, total bytes, and exclusions without secrets or document contents. Upload the staging output and resolved primary paths through restic with the approved tag and encryption password. A failed or interrupted run may leave only its own marked staging directory for the next safe cleanup; it must never delete a repository or another run's staging.

Expose three CLI operations. `capacity` reads rclone free space, first-run estimate, local staging space, and credential metadata without writing to Google Drive.
`backup` performs credential and capacity checks before cloud initialization/write, using the complete first-snapshot estimate only when the repository is uninitialized and the actual newly generated staging bytes for an existing deduplicating repository; it then builds, uploads, verifies, applies retention, and reports only stage, SHA, total bytes, and snapshot ID.
`restore-check --target <new-empty-path>` resolves the target before invoking restic and rejects the configured project, credential, or staging root and every descendant, including symlink-parent paths that resolve into those roots.
It then requires a new unused directory, restores the newest tagged snapshot into it, and validates the manifest, Git bundle, custom dump format, and required primary files. It must not infer a live target and must not overwrite an existing directory.

Add a dedicated Ansible playbook that asserts exactly `raspberrypi5`, installs restic/rclone, creates the package directory before copying the Python modules, installs the non-secret environment, and writes the systemd service/timer. Credentials are pre-provisioned separately under the dedicated root-owned directory with mode `0600`. The playbook is not included by the normal fleet deployment route. The service is `Type=oneshot`, has `TimeoutStartSec=9h30m`, uses `KillMode=control-group`, and has no `RuntimeMaxSec`; the timer uses `OnCalendar=*-*-* 21:30:00 Asia/Tokyo`, `Persistent=false`, and is disabled initially. The explicit calendar timezone avoids making the host's local timezone a deployment precondition.

Finally run the focused contracts and the isolated integration validation. The Mac test must record all existing Docker IDs before starting, use only uniquely named and labelled network/volume/container resources, apply all Prisma migrations to the temporary PostgreSQL, insert representative rows, dump and restore to a new database, rerun `prisma migrate deploy`, compare schema/migration ledger/row counts, run representative `EXPLAIN (ANALYZE, BUFFERS)`, verify the Git bundle, and compare primary-file hashes. Its trap must remove only its own container, volume, network, and work directory, and prove zero task-labelled resources and unchanged pre-existing IDs at the end.

## Concrete Steps

All work occurs in `/Users/tsudatakashi/RaspberryPiSystem_002-google-drive-disaster-recovery`.

The branch boundary is created from the latest fetched remote without checking out or altering the user's unrelated worktree:

    git fetch origin
    git status --short
    git worktree add -b feat/google-drive-disaster-recovery \
      /Users/tsudatakashi/RaspberryPiSystem_002-google-drive-disaster-recovery \
      origin/main

Before implementation, inspect the current branch and confirm that the working tree contains only this feature's changes:

    git status --short --branch
    git diff --check
    git diff --stat

Focused unit and contract checks are the first validation layer. The final command names may follow the implementation package, but the expected contracts are:

    python3 -m unittest discover -s scripts/google_drive_dr/tests -p 'test_*.py'
    bash -n scripts/ci/run-deploy-contracts-local.sh
    ansible-playbook -i infrastructure/ansible/inventory.yml <google-drive-dr-playbook> --syntax-check
    ansible-playbook -i infrastructure/ansible/inventory.yml <google-drive-dr-playbook> --list-hosts

The unit suite must cover required/optional/excluded paths, OAuth and restic secret exclusion, dump/Git/manifest/restic order, capacity and authentication pre-write failures, optional-missing and dirty-worktree continuation, SIGTERM child cleanup without deleting unrelated staging/repository, secret-safe logs, and restore refusal for existing/live targets.

For Mac integration, first record read-only snapshots of `docker ps -aq`, `docker volume ls -q`, and `docker network ls -q`. Create only unique resources with the label `com.raspi-system.temporary=true` and a unique test label. Use `pgvector/pgvector:pg15` or an official image already available locally; pulling an image is allowed, but no existing resource may be attached, stopped, or mutated. Apply all Prisma migrations, insert representative data with SQL, run the runner against a local restic repository, restore into a new directory, load the dump into a second database in the same temporary container, rerun `prisma migrate deploy`, compare schema/ledger/row counts, run representative `EXPLAIN (ANALYZE, BUFFERS)`, verify the Git bundle, and compare primary-file hashes. The trap must execute on success, failure, and interruption.

Before handoff, run the approved final local boundary once:

    scripts/ci/run-deploy-contracts-local.sh

Only run it after focused checks pass and only once at the final boundary. If a command fails for an unrelated baseline reason, record the failure and its evidence here; do not weaken assertions or change unrelated source to make it pass.

## Validation and Acceptance

The pure policy tests pass without a device, Docker, network, or cloud account. They prove that the normal case is not rejected merely because an optional source is absent or the Git worktree is dirty. The snapshot tests prove the exact dump, bundle, manifest, and repository command order and prove that logs contain no OAuth token, restic password, database password, personal filename, or document content.

The systemd and Ansible contract tests prove that only `raspberrypi5` is selected, the package directory exists before runtime copies, the timer is disabled initially, its schedule explicitly fixes `21:30:00 Asia/Tokyo` without a host-timezone assertion, `Persistent=false`, timeout is 9 hours 30 minutes, credentials are root-owned `0600`, and the playbook is outside normal fleet deployment. `RuntimeMaxSec` must not occur in the oneshot unit.

The isolated PostgreSQL test passes all repository migrations, shows the migration ledger complete and idempotent, restores the custom-format dump into a fresh database, reports matching representative row counts and schema, and produces a successful representative query plan. The restic test reports a snapshot ID, restores to an unused directory, verifies the manifest and Git bundle, checks the dump format, compares primary-file hashes, and leaves zero task-labelled Docker resources and no changes to pre-existing resource IDs.

Acceptance is also operational: after credentials are prepared, `capacity` succeeds without creating a cloud snapshot; `backup` completes in the normal case and emits only the approved redacted JSON fields; `restore-check` succeeds for an unused directory and rejects an existing/live directory without modifying it. An interrupted upload can be retried on a later night and reuses restic's already uploaded blobs. Retention removes only snapshots according to daily 7, weekly 5, monthly 12, and Sunday prune policy.

The feature is not accepted as production rollout until an immutable merged SHA is selected, the dedicated playbook passes check mode on exactly one Pi 5, credentials are installed separately, a manual capacity/backup/isolated-restore sequence passes, and only then is timer activation separately approved. No live restore is automated. A Pi 5 replacement follows the Runbook's fresh OS, isolated restore, database validation, exact Git SHA configuration, and final cutover sequence.

## Idempotence and Recovery

`capacity` is read-only and safe to repeat. `backup` creates a new dump each run, uses a unique staging directory, and can retry a failed restic upload without treating an incomplete prior upload as live data. Cleanup is restricted to directories carrying the runner's marker and residing under the dedicated staging root. It never removes other staging directories, the repository, or live application data.

`restore-check` requires a path that does not exist and is outside the resolved project, credential, and staging roots; choose a new temporary or isolated directory for each rehearsal. If validation fails, preserve the isolated restore for diagnosis and remove it only after confirming it is the task's directory. A real disaster never uses the live path as the restore target. Prepare a new SSD/Pi, restore and validate in isolation, apply the exact SHA, and perform the final cutover manually.

On SIGTERM, the runner terminates its active child restic/pg_dump/Git process group, removes no repository or unrelated staging, emits a redacted failure event, and exits with its documented signal code. systemd `KillMode=control-group` provides the outer process-group boundary. Missing optional files and dirty worktrees are warnings, not global abort conditions. Missing credentials, invalid repository configuration, insufficient capacity, or an invalid restore target fail before cloud write.

## Artifacts and Notes

The documentation artifacts are:

    docs/plans/google-drive-disaster-recovery-execplan.md
    docs/decisions/ADR-20260820-google-drive-disaster-recovery.md
    docs/runbooks/google-drive-disaster-recovery.md
    docs/guides/backup-and-restore.md
    docs/INDEX.md

The repository path and credential metadata are intentionally fixed in the operational contract:

    rclone:google-drive:RaspberryPiSystem_002/business-pi5
    Google OAuth scope: drive.file
    timer: OnCalendar=*-*-* 21:30:00 Asia/Tokyo, Persistent=false, disabled by default
    retention: daily 7, weekly 5, monthly 12; group-by host,tags for backup and forget

Do not record the repository password, OAuth token, database password, certificate contents, private filenames, or document contents in this plan, an ADR, a Runbook, a manifest, or logs.

## Interfaces and Dependencies

`source_policy` exposes a pure source specification and resolution result. It distinguishes required, optional, excluded, and generated staging inputs without reading file contents.
`snapshot_builder` accepts an injected command port and filesystem root, returns a snapshot manifest plus staging paths, and never knows Google Drive credentials.
`restic_repository` accepts repository configuration and an injected command port, returns capacity and snapshot results, and never knows application business paths.
Before restore, it parses the tag-filtered JSON array from `snapshots --json --tag business-pi5`, validates every non-empty `id` and timezone-aware `time`, and selects the greatest `(time, id)` pair across hosts and groups before passing that concrete ID to `restore --json --quiet`; restore summary bytes are advisory and the resolved ID is authoritative.
JSON-line upload/restore commands suppress periodic status and remove inherited `RESTIC_PROGRESS_FPS` so large operations do not accumulate status output.
`restore_validator` accepts an isolated target and command port and owns restored-tree integrity without knowing upload or live-cutover operations.
`runner` composes these ports, owns CLI exit codes and signals, and emits a stable redacted JSON event schema.

The repository adapter depends on `restic` and `rclone`; the snapshot builder depends on Git and PostgreSQL's `pg_dump`/`pg_restore` contract; the Pi 5 playbook supplies those executables and credentials. The application API and Prisma schema are not dependencies of the new runtime except through the read-only PostgreSQL dump and the isolated validation procedure. The only Google Drive write is the encrypted restic repository upload through the configured `rclone` remote. The [restic scripting reference](https://github.com/restic/restic/blob/master/doc/075_scripting.rst) is the source for the tag-filtered snapshots JSON array, snapshot `time`/`id`, and restore summary contracts, and documents that `RESTIC_PROGRESS_FPS` overrides `--quiet`.

Revision note (2026-08-20): created from the approved Business Pi 5 Google Drive DR implementation plan after reading the repository rules, current backup code, current guide, and the Pi 4 recovery deletion record. The initial revision records the implementation boundary and open validation milestones; update it with evidence at every subsequent stopping point.
