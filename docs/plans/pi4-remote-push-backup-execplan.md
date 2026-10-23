---
title: Pi4 SD-card backup for kiosks on slow remote links ExecPlan
tags: [plan, backup, SD card, restic, Raspberry Pi 4, remote site, mobile router]
last-verified: 2026-10-23
related: [./pi4-sd-card-backup-execplan.md, ../decisions/ADR-20260930-pi4-sd-card-backup.md, ../runbooks/pi4-sd-card-backup.md]
category: plans
---

# Pi4 SD-card backup for kiosks on slow remote links

This ExecPlan is a living document and follows `.agent/PLANS.md`. It builds on `docs/plans/pi4-sd-card-backup-execplan.md` and `docs/decisions/ADR-20260930-pi4-sd-card-backup.md`, which describe the weekly SD-card backup that exists today.

## Purpose / Big Picture

Some kiosks are not on the factory LAN. `raspi4-assembly-02` stands in another building and reaches the Business Pi5 only through a mobile router (Wi-Fi `SPWN_H36_01E525`) and the public mobile network. More kiosks will be placed in a factory in another prefecture. The weekly SD-card backup was designed for the LAN. Every run, the Pi5 reads each kiosk's whole card over SSH, so about 8.4 GB crosses the line for `raspi4-assembly-02` every week. Restic removes duplicates only after the data has arrived on the Pi5.

On 2026-10-22 the first manual backup reached `raspi4-assembly-02` at 18:26 JST. It filled the mobile uplink (about 600 kbit/s) for 14 hours, until it was stopped at 08:18 the next morning. Round-trip time to the kiosk rose from about 0.3 s to 4–6 s. The kiosk's 5-second AI availability check then timed out, which raised a `kiosk-ui-error` alert every 30 minutes all night.

After this work, a kiosk marked as remote makes its own backup on the kiosk and sends only the data that the Pi5 does not already have. It sends only on Sundays; on 2026-10-23 the user allowed backup traffic all day on Sunday. The mobile plan has no data cap. The backup that arrives on the Pi5 has the same shape as a LAN kiosk's backup: three parts tagged with one run id. Card replacement, listing, retention, and the Google Drive copy therefore work as they do today, and the Runbook's restore command does not change.

Success means three things. First, a second weekly run of a remote kiosk uploads a small fraction of the card, measured by restic's own "added to the repository" figure. Second, a run that is stopped halfway continues on the next run without re-sending what it already sent. Third, a spare card restored from a pushed backup boots in that kiosk and passes the Runbook drill.

## Progress

- [x] 2026-10-23: Measured `raspi4-assembly-02` and `raspi4-assembly-01` read-only. Files changed within 7 days, with the backup's own excludes applied, came to 1068 MB and 830 MB. `raspi4-assembly-02`'s 1068 MB was mostly a Chromium package update (479 MB), container images from deploys (252 MB), the Chromium profile (181 MB), and `/var/cache/apt` package lists (132 MB). Files changed within one day came to 157 MB and 242 MB. Both kiosks have 3.8 GB of RAM and 4 cores, and Debian trixie offers restic 0.18.0, the same version as the Pi5.
- [x] 2026-10-23: Measured the line while the backup ran: about 600 kbit/s up, with round-trip time of 4–6 s. With the backup stopped, round-trip time was 0.17–0.52 s.
- [x] 2026-10-23: The user chose the kiosk-side push design. The mobile plan is unlimited, and backup traffic is allowed all day on Sunday only.
- [ ] Milestone 1: prove on a scratch repository that tar-stream snapshots deduplicate across runs, including after a week of access-time drift, and that an interrupted run resumes.
- [ ] Milestone 2: receiving service on the Pi5 (append-only, one repository and one password per remote kiosk).
- [ ] Milestone 3: kiosk-side push runner, unit, and timer, installed only on hosts marked remote.
- [ ] Milestone 4: Pi5 runner skips remote kiosks when pulling, imports their pushed runs into the main repository, and reports any remote kiosk without a complete run in the last 8 days.
- [ ] Milestone 5: first full upload of `raspi4-assembly-02` over one or two Sundays, then one incremental Sunday measured.
- [ ] Milestone 6: drill with a spare card restored from a pushed run. Update the ADR and Runbook.

## Surprises & Discoveries

- Observation: the current backup re-reads and re-sends the whole card every run. Only the storage on the Pi5 is deduplicated, not the transfer. Evidence: `scripts/pi4_sd_backup/plan.py` `ssh_command` streams `tar --create` from the kiosk to restic on the Pi5, and restic `--stdin-from-command` can only chunk the stream after receiving it.
- Observation: the main repository's password is the Business Pi5 disaster-recovery restic password (`/etc/raspi-google-drive-dr/restic-password`). Evidence: `infrastructure/ansible/playbooks/deploy-pi4-sd-backup.yml` sets `pi4_sd_backup_password_file` to that path. A kiosk must therefore never write to the main repository directly, because it would have to hold that password.
- Observation (risk, not yet measured): `TAR_CREATE` passes `--xattrs --acls`, so GNU tar writes pax format, and in pax format GNU tar stores each file's access time and change time in its extended header. Kiosks mount `/` with `relatime`, so a weekly read of every file moves almost every access time. Every header would then differ between weeks, and chunk deduplication could collapse. Evidence: `scripts/pi4_sd_backup/plan.py` `TAR_CREATE` has no `--pax-option`. Milestone 1 must test this with real access-time drift, and the likely fix is `--pax-option=delete=atime,delete=ctime`.
- Observation: the line's upload rate, not the data cap, limits the first upload. At about 600 kbit/s, 8.4 GB takes about 31 hours, which is more than one Sunday.

## Decision Log

- Decision: the kiosk produces the same three parts as today (`partition-table.sfdisk`, `boot.tar`, `root.tar`) with `restic backup --stdin-from-command`. It runs `plan.remote_script(part)` locally instead of over SSH. Rationale: restic splits a stream into chunks at content-defined boundaries, so an unchanged run of files in the tar produces the same chunks and is not uploaded again. The snapshots keep their current shape, so `list`, `restore`, retention, and the off-site copy need no change. Milestone 1 must confirm the deduplication rate before anything else is built. If it is poor, the fallback is a directory snapshot of `/` and `/boot/firmware`, restored through `restic dump --archive tar`. That fallback needs a second restore branch, and it must be proven to keep owners, ACLs, and extended attributes. Date/Author: 2026-10-23 / Claude.
- Decision: each remote kiosk pushes to its own restic repository on the Pi5, `/var/lib/raspi-pi4-sd-backup/push/<host>`, with its own password. The repository is created with `--copy-chunker-params` from the main repository. Rationale: a kiosk holds only its own key and cannot read other kiosks' backups or the Pi5 DR key. Sharing the chunker parameters keeps `restic copy` into the main repository deduplicated. Date/Author: 2026-10-23 / Claude.
- Decision: the kiosk reaches the push repository through `rest-server` running on the Pi5 with `--append-only` and `--private-repos`. It listens only on the Pi5's Tailscale address, and each remote kiosk has its own HTTP user. Rationale: append-only means a compromised kiosk can add snapshots but cannot delete or overwrite earlier ones. `--private-repos` limits each user to the repository named after it. Traffic already travels inside Tailscale, and restic encrypts the data itself. The Pi5 runs `forget` and `prune` on the push repositories directly on disk, not through `rest-server`. Date/Author: 2026-10-23 / Claude.
- Decision: the Google Drive token and the DR password stay on the Pi5. Rationale: ADR-20260930 rejected running restic on each kiosk because it would have put the Drive token on every terminal. In this design the kiosk talks only to the Pi5, so that objection no longer applies. Date/Author: 2026-10-23 / Claude.
- Decision: the kiosk timer starts on Sunday at 00:05 JST, and the unit stops itself before 23:55 JST. Upload speed is limited to a measured share of the line, so `status-agent` heartbeats still get through. Rationale: the user allows backup traffic all day on Sunday only. A run stopped at the deadline resumes on the next Sunday, if Milestone 1 confirms resume. Date/Author: 2026-10-23 / user and Claude.
- Decision: a kiosk is remote when its inventory host sets `pi4_sd_backup_mode: push`. The default is `pull`. Rationale: one switch, beside the host it describes. The existing playbook writes `targets.json` from the `kiosk` group, so it can split hosts by this value. Date/Author: 2026-10-23 / Claude.
- Decision: do not pre-seed a remote kiosk's push repository with another kiosk's snapshot to avoid sending shared OS files. Rationale: the kiosk could then decrypt the other kiosk's SSH host keys and client key. New remote kiosks make their first backup on the factory LAN before they are shipped. `raspi4-assembly-02` takes one or two Sundays. Date/Author: 2026-10-23 / Claude.
- Decision: LAN kiosks keep the current pull backup. Rationale: it already works and restores in minutes. Only its scheduling needs care: the 2026-10-22 manual run started on a working day. Date/Author: 2026-10-23 / Claude.

## Outcomes & Retrospective

Open until the drill in Milestone 6 passes.

## Context and Orientation

Terms used here. A "kiosk" is a Raspberry Pi 4 that shows the factory web app in Chromium and runs `status-agent` and a few agents. The "Business Pi5" (Tailscale address `100.106.158.2`) serves the web app and API and holds the backups. "restic" is the backup program. A "repository" is a directory of encrypted, deduplicated data. A "snapshot" is one saved backup in a repository, and `restic copy` moves snapshots between repositories. "rest-server" is the restic project's small HTTP server that serves repositories to remote restic clients. "Append-only" means a client may add data but not delete it. "Tailscale" is the VPN that connects every Pi; kiosks reach the Pi5 through it even when they are not on the LAN.

The current code. `scripts/pi4_sd_backup/plan.py` holds pure functions. `PARTS = ("table", "boot", "root")` and `STDIN_FILENAMES` name the three parts. `remote_script(part)` returns the shell that writes one part to stdout: `sfdisk --dump` of the boot disk, a tar of `/boot/firmware`, or a tar of `/` with `ROOT_EXCLUDES`. `backup_args` builds the restic command and its tags: `pi4-sd`, `part:<part>`, and `run:<UTC id>`. `latest_complete_run` accepts only a run whose three parts share one run tag. `snapshots_to_forget` applies retention: 4 weekly and 6 monthly runs. `scripts/pi4_sd_backup/runner.py` is the CLI (`backup`, `list`, `restore`). `backup` loops over `targets.json`, pulls every part over SSH, then runs `apply_retention` and `copy_offsite`. `restore` streams `restic dump <snapshot> /root.tar` into `tar --extract` on the new card. `infrastructure/ansible/playbooks/deploy-pi4-sd-backup.yml` installs everything on `raspberrypi5`, from the `kiosk` inventory group. The unit tests are in `scripts/deploy/tests/test_pi4_sd_backup.py`, and the deploy-contract CI job runs them. The operator steps are in `docs/runbooks/pi4-sd-card-backup.md`.

The current state on 2026-10-23. The weekly timer is disabled. The first manual run on 2026-10-22 stored complete runs for `raspberrypi4`, `raspi4-kensaku-stonebase01`, `raspi4-sessaku-01`, `raspi4-assembly-01`, and `raspi4-kensaku-02`. `raspi4-robodrill01` and `raspi4-fjv60-80` failed; they were offline. `raspi4-assembly-02` was stopped mid-run. The Google Drive copy did not run.

## Plan of Work

Milestone 1 is a prototype on a scratch repository, away from production. Run it in a `debian:trixie` container on the Mac, so the tar is GNU tar as on the kiosks (macOS ships bsdtar), with restic 0.18.0. Make a directory of a few hundred MB of mixed files, with some binaries and some small text files. Back it up twice as a tar stream with `restic backup --stdin-from-command -- sh -c '<TAR_CREATE> --directory=<dir> .'`, using the exact `TAR_CREATE` string from `plan.py`. Between the runs, change a handful of files and also move the access time of every file (`find <dir> -exec touch -a -d '8 days ago' {} +`), because that is what a week of `relatime` reads does on a kiosk. Record "Added to the repository" for the second run. If it is large, repeat with `--pax-option=delete=atime,delete=ctime` added to `TAR_CREATE` and record both numbers. The option must not change what a restore produces, so extract one stream of each kind and compare owners, modes, ACLs, and extended attributes with `getfacl -R` and `getfattr -R -d`. Then start a third run against a larger tree, stop it after a few minutes with SIGTERM, which is what systemd sends at `RuntimeMaxSec`, and start it again. Record whether the second attempt re-uploads the data the first attempt already sent; restic writes its index while a backup runs, so most of it should be found. Repeat the interrupted case once more with `restic prune` run between the two attempts, and record whether prune throws the uploaded data away. Milestone 4's prune rule depends on that answer. Use restic 0.18.0, the version on the Pi5 and the kiosks. Write both numbers into Surprises & Discoveries. If the second run adds more than about 10% of the stream, switch to the fallback in the Decision Log before Milestone 3.

Milestone 2 sets up the Pi5 side. Extend the dedicated playbook so that, for each kiosk with `pi4_sd_backup_mode: push`, it does the following. It creates `/var/lib/raspi-pi4-sd-backup/push/<host>`, initialised with `--copy-chunker-params` from the main repository. It writes that kiosk's restic password to `/etc/raspi-pi4-sd-backup/push/<host>.password` (mode 0600, root). It adds the kiosk's HTTP user to a `.htpasswd` read by `rest-server`. Run `rest-server` as a pinned container image or binary, with `--path /var/lib/raspi-pi4-sd-backup/push --append-only --private-repos --listen 100.106.158.2:<port>`, under a systemd unit. Check the Pi5's firewall and the Tailscale ACL, so that only tagged kiosks reach the port. Secrets come from Ansible Vault as `vault_<host>_sd_backup_push_password` and `vault_<host>_sd_backup_push_http_password`, following the existing `vault_raspi4_*` naming. The standard fleet deploy does not call this playbook, matching the existing backup.

Milestone 3 adds the kiosk side. Add `scripts/pi4_sd_backup/push.py`, which imports `plan` and runs one backup run. It makes a run id, then for each part runs `restic backup` with the same tags and `--stdin-filename` as `backup_args`. The difference is that the command is `sh -c plan.remote_script(part)`, run locally as root, and the repository is `rest:http://<user>:<password>@100.106.158.2:<port>/<host>/`. Pass the password and URL through environment variables and files, never on the command line. It passes `--limit-upload` from its configuration. It logs `push_start`, `part_done`, `part_failed`, and `push_done` as JSON lines, like the runner. A new playbook, `deploy-pi4-sd-backup-push.yml`, limited to push hosts, does the rest. It installs restic, copies `plan.py`, `push.py`, and `__init__.py` to `/opt/raspi-pi4-sd-backup`, writes `/etc/raspi-pi4-sd-backup/push.env` and the password file, and installs `raspi-pi4-sd-backup-push.service` and `.timer`. The timer runs `OnCalendar=Sun *-*-* 00:05:00 Asia/Tokyo`. The service sets `RuntimeMaxSec` to end before 23:55 and runs at `Nice=19` and `IOSchedulingClass=idle`. The timer ships disabled until Milestone 5.

Milestone 4 changes the Pi5 runner. When the playbook writes `targets.json`, it leaves out push hosts and writes `push-targets.json` instead. `backup` gains an import step before retention. For each push host, it lists complete runs in the push repository that the main repository does not have yet, and copies them with `restic copy --from-repo <push repo> --from-password-file <host password>`. Then it applies `snapshots_to_forget` to the push repository directly on disk, so only the newest complete run stays there to deduplicate against. Prune has two limits. It never runs on a push repository that has no complete run yet, because data uploaded by a cut-off run is not referenced by any snapshot, and prune would delete it; a first upload spread over several Sundays would then start again from zero every week. It never runs on Sunday JST, because prune takes an exclusive lock that would make a kiosk run in progress fail. Add a freshness check: if a push host has no complete run in the main repository from the last 8 days, add it to `failed_hosts` and log `push_stale`. Give the import step its own subcommand and a Monday 01:00 JST timer. Pushed runs then reach the main repository and Google Drive soon after each Sunday, without waiting for the LAN pull. Add unit tests for the target split, for selecting runs that are missing from the main repository, for the freshness rule, and for the two prune limits.

Milestone 5 is the first real use. Set `pi4_sd_backup_mode: push` on `raspi4-assembly-02`. Run both playbooks with `--check` first, then for real. Measure the line on a Sunday morning with a short timed upload, and set `--limit-upload` to about 70% of it. Enable the kiosk timer. After the first Sunday, read the push log. If the deadline cut the run short, confirm on the next Sunday that it continued. After a complete run, confirm `import` copied it and that `list` shows `raspi4-assembly-02`. Measure one further Sunday's "Added to the repository" and record it here.

Milestone 6 is the drill and the documents. Restore `raspi4-assembly-02`'s latest run onto a spare card with the unchanged Runbook command. Boot it in that kiosk, check the kiosk screen, NFC, `status-agent`, and a deploy limited to that host, then put the original card back in. Amend ADR-20260930 with a section on remote kiosks. Add the remote-kiosk steps to the Runbook: setting the mode, the first backup on the LAN before shipping, and reading the push log. Note in the earlier ExecPlan that the manual run must not start on a working day.

## Concrete Steps

Work in the task worktree `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--pi4-remote-push-backup`. Run unit tests from its root:

    python3 -m unittest scripts/deploy/tests/test_pi4_sd_backup.py

Run playbooks on the Pi5 from a clean checkout of the merged SHA, as the existing Runbook does:

    cd /opt/RaspberryPiSystem_002/infrastructure/ansible
    ansible-playbook playbooks/deploy-pi4-sd-backup.yml --limit raspberrypi5 --check
    ansible-playbook playbooks/deploy-pi4-sd-backup-push.yml --limit raspi4-assembly-02 --check

Read a kiosk's push log:

    journalctl -u raspi-pi4-sd-backup-push.service --since sunday

## Validation and Acceptance

In Milestone 1, the second tar-stream run adds no more than about 10% of the stream even after the access-time drift, a restore of the chosen tar options keeps owners, ACLs, and extended attributes, and a run stopped by SIGTERM resumes without re-sending. In Milestones 2–4, unit tests pass, and both playbooks pass `--check` with no unexpected changes. From the kiosk, `restic forget` against the push repository is refused, which proves append-only. In Milestone 5, a complete run of `raspi4-assembly-02` appears in `list`. A later Sunday adds a small fraction of the 8.4 GB, and the number is recorded here. No `kiosk-ui-error` or heartbeat alert fires for that kiosk on a weekday. In Milestone 6, the drill passes.

## Idempotence and Recovery

Push runs only add snapshots, and a failed or cut-off run leaves no snapshot, only reusable data. If a run was stopped before restic wrote the index for its last uploads, those packs are on disk but unknown to the next run; an operator can run `restic repair index` on the Pi5, which has disk access, and the next run reuses them. The kiosk cannot do this itself because its access is append-only. Rerunning either playbook rewrites files and units only. It never re-initialises an existing repository. Disabling the kiosk timer stops all remote traffic at once. Setting the host back to `pull` returns it to today's behaviour. The push repositories can be deleted only by an operator on the Pi5, never from a kiosk.

## Interfaces and Dependencies

restic 0.18.0 runs on both sides. `rest-server` is pinned to an exact release. Inventory variable: `pi4_sd_backup_mode: pull | push` (default `pull`). New files are `scripts/pi4_sd_backup/push.py`, `infrastructure/ansible/playbooks/deploy-pi4-sd-backup-push.yml`, templates for the push env, service, and timer and for the Pi5 `rest-server` unit, and `/etc/raspi-pi4-sd-backup/push-targets.json` on the Pi5. New runner subcommand: `import`. JSON log events: `push_start`, `push_done`, `part_failed`, `import_done`, `push_stale`.

Change note, 2026-10-23: first version, written after the 2026-10-22 overnight alerts and the user's choice of the kiosk-side push design. In review the same day, three risks were added: pax headers that carry access times, prune deleting a cut-off first upload, and packs left unindexed when a run is stopped. Milestone 1 now tests them, and Milestone 4 limits prune.
