#!/bin/bash
# Pi5: copy the encrypted DR repository from Google Drive to a USB stick, verify it, unmount.
# Never deletes anything on Google Drive (read-only there). On the stick it only deletes key files
# that are gone from Google Drive, so a replaced password stops opening the stick too.
# It stops before touching the stick if our password no longer opens Google Drive, and never
# overwrites a file already on the stick (restic files never change, so a changed one fails the check).
# See KB-416 for the install location and procedure.
set -euo pipefail
export LC_ALL=C
D=/root/offline-dr
LOG=$D/copy-$(date +%Y%m%d-%H%M%S).log
mkdir -p "$D"
ln -sfn "$LOG" "$D/latest.log"
exec >>"$LOG" 2>&1
echo "=== start $(date '+%F %T') ==="
MNT=/mnt/offline-dr
MOUNTED_BY_US=0
fail() { echo "RESULT=FAILED: $*"; exit 1; }
cleanup() { if [ "$MOUNTED_BY_US" = 1 ]; then sync; umount "$MNT" 2>/dev/null && echo "unmounted" || echo "WARNING: unmount failed"; fi; }
trap 'echo "RESULT=FAILED: line $LINENO"; cleanup' ERR
CONF=/etc/raspi-google-drive-dr/rclone.conf
PASS=/etc/raspi-google-drive-dr/restic-password
SRC=google-drive:RaspberryPiSystem_002/business-pi5

# preconditions
# A oneshot backup reports "activating" while it runs, which is-active treats as not active.
dr_state=$(systemctl show -p ActiveState --value raspi-google-drive-dr.service) || fail "DR state unreadable"
case "$dr_state" in inactive | failed) ;; *) fail "DR is running ($dr_state)" ;; esac
next=$(systemctl show raspi-google-drive-dr.timer -p NextElapseUSecRealtime --value)
[ -n "$next" ] && [ $(( $(date -d "$next" +%s) - $(date +%s) )) -lt 7200 ] && fail "the next DR run is less than 2 hours away"

# find the stick: exactly one USB disk that does not hold the root filesystem
ROOTDISK=$(lsblk -no PKNAME "$(findmnt -no SOURCE /)")
mapfile -t DISKS < <(lsblk -dn -o NAME,TRAN,TYPE | awk -v r="$ROOTDISK" '$2=="usb" && $3=="disk" && $1!=r {print $1}')
[ "${#DISKS[@]}" -eq 1 ] || fail "expected exactly one extra USB disk, found ${#DISKS[@]}"
DISK=${DISKS[0]}
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT,MODEL "/dev/$DISK"
PART=$(lsblk -ln -o NAME,FSTYPE "/dev/$DISK" | awk '$2=="exfat"||$2=="vfat"||$2=="ext4" {print $1; exit}')
[ -n "$PART" ] || fail "no exfat/vfat/ext4 filesystem on /dev/$DISK"
CUR=$(lsblk -ln -o MOUNTPOINT "/dev/$PART" | head -1)
if [ -n "$CUR" ]; then MNT=$CUR; else mkdir -p "$MNT"; mount "/dev/$PART" "$MNT"; MOUNTED_BY_US=1; fi
echo "stick: /dev/$PART at $MNT"
DEST=$MNT/business-pi5
mkdir -p "$DEST"

# source sanity: a restic repository has a config file and snapshots
rclone --config "$CONF" lsf "$SRC" | tee "$D/source-top.txt"
grep -qx config "$D/source-top.txt" || fail "source has no restic config file"
# touch nothing on the stick unless our password still opens the source
RCLONE_CONFIG="$CONF" timeout 300 restic -r "rclone:$SRC" --password-file "$PASS" --no-cache --no-lock cat config >/dev/null \
  || fail "our password does not open the source; the stick was left unchanged"
SRC_SIZE=$(rclone --config "$CONF" size --json "$SRC")
echo "source: $SRC_SIZE"
need=$(echo "$SRC_SIZE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["bytes"])')
free=$(df -B1 --output=avail "$MNT" | tail -1)
[ "$free" -gt $(( need * 2 )) ] || fail "not enough free space on the stick"

# copy (no deletions, no overwrites), then compare
rclone --config "$CONF" copy "$SRC" "$DEST" --exclude "locks/**" --immutable --transfers 4 --stats 30s --stats-one-line -v 2>&1 | grep -v ": Copied (new)" || true
rclone --config "$CONF" check "$SRC" "$DEST" --exclude "locks/**" --one-way 2>&1 | tail -3
rclone --config "$CONF" sync "$SRC/keys" "$DEST/keys" -v 2>&1 | tail -5
sync

# verify every byte with restic, and list what is inside
restic -r "$DEST" --password-file "$PASS" --no-cache check --read-data
restic -r "$DEST" --password-file "$PASS" --no-cache --no-lock snapshots --compact | tail -12
rm -rf "$DEST/locks"/* 2>/dev/null || true
{
  echo "Encrypted restic repository copied from Google Drive on $(date '+%F %T %Z')."
  echo "Source: rclone:$SRC   Host: $(hostname)"
  echo "Restore needs the restic password (kept separately, not on this stick)."
  echo "Read with: restic -r <this folder>/business-pi5 snapshots"
} >"$MNT/README-offline-dr.txt"
du -sh "$DEST"
sync
trap - ERR
MOUNTED_BY_US=1
cleanup
mountpoint -q "$MNT" && { echo "RESULT=FAILED: still mounted"; exit 1; }
echo "=== end $(date '+%F %T') ==="
echo "RESULT=OK"
