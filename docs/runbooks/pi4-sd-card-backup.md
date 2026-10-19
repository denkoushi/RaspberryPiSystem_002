---
title: Pi4 SD-card backup and card replacement Runbook
tags: [operations, backup, restore, SD card, Google Drive, restic, Raspberry Pi 4, kiosk]
audience: [operators, recovery operators]
last-verified: 2026-09-30
related: [../decisions/ADR-20260930-pi4-sd-card-backup.md, ../plans/pi4-sd-card-backup-execplan.md, ./google-drive-disaster-recovery.md, ../guides/status-agent.md]
category: runbooks
update-frequency: medium
---

# Pi4 SD-card backup and card replacement Runbook

Once a week the Business Pi5 backs up every Pi4 kiosk's SD card to its own SSD and then copies the backup to Google Drive. When a card dies, the Pi5 writes that kiosk's latest backup from its SSD onto a new card, which takes minutes over the LAN, and the card goes back into the same kiosk. The Drive copy is used only when the Pi5 itself is lost. The design and the identity rule are in [ADR-20260930](../decisions/ADR-20260930-pi4-sd-card-backup.md).

Warnings that a card is failing come from the status-agent SD health logs (see [status-agent guide](../guides/status-agent.md) section 5). A kiosk that stops reporting entirely triggers the heartbeat alert (section 5.2).

## Install or update the runner (Pi5)

This is not part of the standard fleet deploy. Run it on the Pi5 from a clean checkout of the target SHA. The Business Pi5 Google Drive DR credentials must already be in place.

    cd /opt/RaspberryPiSystem_002/infrastructure/ansible
    ansible-playbook playbooks/deploy-pi4-sd-backup.yml --limit raspberrypi5

This installs `/opt/raspi-pi4-sd-backup`, creates the local repository directory `/var/lib/raspi-pi4-sd-backup`, writes `/etc/raspi-pi4-sd-backup/targets.json` from the `kiosk` inventory group, and installs a service and timer. The timer stays disabled. Run the playbook again after adding or removing a kiosk in the inventory.

## First backup and enabling the weekly timer

Start one backup by hand and follow it. The local backup takes a few hours. The first copy to Google Drive uploads everything over the slow link and may take much longer.

    sudo systemctl start --no-block raspi-pi4-sd-backup.service
    journalctl -u raspi-pi4-sd-backup.service -f

Each kiosk logs `host_start`, three `part_done` lines (table, boot, root), and `host_done`. Then come `retention`, `offsite_done` (or `offsite_failed`), and `backup_finished` with any failed hosts. A failed host keeps no partial snapshot, and a failed off-site copy leaves the local backup intact. Check what is stored locally (add `--offsite` to check Google Drive):

    sudo sh -c 'set -a; . /etc/raspi-pi4-sd-backup/backup.env; cd /opt/raspi-pi4-sd-backup; python3 -m pi4_sd_backup.runner list'

When every kiosk shows a backup, enable the Sunday 12:00 JST timer:

    ansible-playbook playbooks/deploy-pi4-sd-backup.yml --limit raspberrypi5 -e pi4_sd_backup_timer_enabled=true

## Replacing a dead card

You need a new card at least as large as the kiosk's used space (`list` shows the size). A card of the same size as the old one is safest. You also need a USB card reader plugged into the Pi5.

1. Take the dead card out of the kiosk. From now on it must never go back into any device, because the restored card carries the same terminal identity. Destroy it or label it clearly.
2. Put the new card in the USB reader on the Pi5 and find its device name. Pick the disk whose size matches the card and whose transport is `usb`, for example `/dev/sdb`. The Pi5's own SSD holds `/` and is refused anyway.

        lsblk -d -o NAME,SIZE,TRAN,RM,MODEL

3. Restore the kiosk's latest backup. `--confirm-host` must repeat the host name exactly. All data on the card is erased.

        sudo sh -c 'set -a; . /etc/raspi-pi4-sd-backup/backup.env; cd /opt/raspi-pi4-sd-backup; python3 -m pi4_sd_backup.runner restore --host raspi4-kensaku-02 --device /dev/sdb --confirm-host raspi4-kensaku-02'

    It reads the Pi5 copy and ends with `restore_done`. Only if the Pi5 copy is gone (for example, the Pi5 SSD failed and was rebuilt), add `--offsite` to read Google Drive instead; that is much slower. `refused` means a safety check stopped it before anything was written, and the reason is in the log line.
4. Remove the card, insert it into the kiosk, and power it on. The kiosk comes back with its old address, SSH keys, Tailscale node, and client key. In `/admin/clients` its heartbeat returns, and the heartbeat alert sends a recovery message if it had fired.
5. Bring the kiosk to the current release with a standard deploy limited to that host (see [deployment guide](../guides/deployment.md)). Anything changed on the kiosk after its last weekly backup is replaced by the deploy.

## Drill

Do a drill before the first real failure, and again after any change to this runner. Use a spare card and a kiosk that can be offline for about 30 minutes. Keep that kiosk's original card aside, unmodified. Restore onto the spare card, boot the kiosk from it, and check the kiosk screen, NFC reading, `status-agent`, and a standard deploy to that host. Then put the original card back in, and wipe the spare card before reusing it. The original and the restored card must never run at the same time. Record the date, host, run id, and elapsed time in the ExecPlan.
