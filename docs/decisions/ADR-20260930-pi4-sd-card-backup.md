---
title: "ADR-20260930: Weekly encrypted Pi4 SD-card backup to Google Drive"
status: accepted
date: 2026-09-30
scope: Pi4 kiosk SD-card replacement, Google Drive restic repository, Business Pi5 runner
related_code: scripts/pi4_sd_backup, infrastructure/ansible/playbooks/deploy-pi4-sd-backup.yml, infrastructure/ansible/templates/raspi-pi4-sd-backup.*.j2
related_docs: ../runbooks/pi4-sd-card-backup.md, ../plans/pi4-sd-card-backup-execplan.md, ./ADR-20260820-google-drive-disaster-recovery.md
---

# ADR-20260930: Weekly encrypted Pi4 SD-card backup to Google Drive

## Context

Each Pi4 kiosk runs from a consumer SD card, which is a consumable part. On 2026-09-30 the seven kiosks wrote 0.8–1.5 GB a day and used 9–21 GB of their 29–58 GB cards. When a card dies, nothing can rebuild the kiosk from a blank card. The one-shot Pi4 recovery command was removed on 2026-08-08 (`f02c4be3`) without ever passing a physical drill. The standard release (`release_kiosk`) assumes an already-provisioned kiosk: it captures running agent containers for rollback before it changes anything. The roles that once provisioned a Pi4 (`common`, `kiosk`, `client`) are no longer called by any playbook.

The Business Pi5 already has an encrypted restic repository on Google Drive for its own total-loss recovery (ADR-20260820). Its Drive account had 1.65 TiB free on 2026-09-30. The Pi5 SSD itself was 84% full, so it cannot hold kiosk images.

## Decision

The Business Pi5 backs up every Pi4 kiosk weekly into a separate restic repository, `rclone:google-drive:RaspberryPiSystem_002/pi4-sd`. It uses `restic backup --stdin-from-command`. restic runs an SSH command, as the Pi5 deploy user, that streams one part of the kiosk to stdout, and it stores that stream as one file. The Pi5 SSD stages nothing. The kiosk card is only read, which adds no wear. Each weekly run stores three parts per kiosk, tagged with the same `run:<UTC timestamp>`. They are the `sfdisk --dump` of the boot disk, a tar of `/boot/firmware`, and a tar of `/` taken with `--one-file-system`. The root tar leaves out the journal, apt archives, caches, and swap files. GNU tar exit 1 ("file changed as we read it") is accepted, because the kiosk keeps running. Any other failure makes restic keep no snapshot, so a broken or offline kiosk never produces a partial "latest" backup.

Retention is decided per run, not by `restic forget --group-by`, because that cannot keep the three parts of one run together. For each kiosk the runner keeps the newest complete run of each of the last four ISO weeks and of the last six months. Incomplete runs newer than the newest complete run are left alone; older ones are forgotten.

Restore runs on the Pi5 with the replacement card in a USB reader. It writes the saved partition table and keeps the disk identifier (`label-id`), so every PARTUUID in `/etc/fstab` and `cmdline.txt` stays valid. The last partition grows to fill the new card. It then formats both partitions and extracts the two tars. Before it finishes, it checks that the PARTUUIDs the system will look for exist on the new card. It refuses any device that is not a whole unmounted removable or USB disk, the disk holding the running system, or a card too small for the backup.

The repository reuses the Business Pi5 DR rclone configuration and restic password files. These already have offline custody, so no new secret is created. The runner is installed by a dedicated playbook on `raspberrypi5` only, outside the standard fleet deploy. Its Sunday 12:00 JST timer is disabled by default, like the DR timer. Even an 8-hour run ends before the 21:30 Pi5 DR snapshot.

### Terminal identity: an exception for replacing the same terminal's card

ADR-20260820 says a replacement Pi gets a fresh host identity and never silently receives old SSH or Tailscale identity. This lane makes one deliberate exception, approved by the user on 2026-09-30. A kiosk's backup may be restored with its SSH host keys, Tailscale state, and client configuration, but only onto the replacement card for that same kiosk, while its old card is out of service. The restore command requires `--confirm-host` to repeat `--host`. The Runbook requires the old card to be destroyed or kept out of every device. Restoring one kiosk's backup onto another device, or running two cards of one kiosk at once, is not allowed. It would duplicate a Tailscale node and an SSH identity.

## Alternatives

A USB reader with a spare card on every kiosk, cloned by `rpi-clone`, would recover fastest, but it needs seven readers and cards on site. Storing images on the Pi5 SSD was rejected because the SSD is 84% full. Rebuilding a kiosk from plain Raspberry Pi OS with Ansible would avoid storing identities, but it means bringing back provisioning roles that no playbook runs today. The last attempt never passed a drill. `dd` of the live card was rejected: a consistent block copy would require freezing the root filesystem for the whole read, which hangs the kiosk. Running restic on each kiosk was rejected because it would put the Google Drive token on seven terminals.

## Consequences

A dead card becomes a card swap. The operator restores the latest weekly backup onto a new card on the Pi5 and inserts it. Then a standard deploy brings the kiosk up to the current release. Anything changed on the kiosk since the last weekly run is lost; kiosks keep no business data locally. The live tar is crash-consistent at best, so a file being written during the backup may be restored stale. The weekly run reads every card fully, about 9–21 GB each over the network. restic's content-defined chunking uploads only changed data. The first run uploads roughly the unique content of all seven kiosks. The Google Drive credentials and restic password now also protect kiosk identities, which raises the value of their offline custody.

## Validation

`scripts/deploy/tests/test_pi4_sd_backup.py` covers target validation against shell metacharacters, the SSH and tar command shape, tolerating exit code 1, per-run retention, partial-run handling, partition-table rewriting against a real kiosk dump, PARTUUID extraction, and the device safety refusals. The CI classifier and deploy-impact registry map the new paths to the Pi5 control plane. The physical drill in the ExecPlan remains the acceptance proof: a first real backup, then a restore of one kiosk onto a new card that boots and passes the standard health checks.
