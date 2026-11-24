#!/bin/bash
# Copy and verify the encrypted Google Drive DR repository in Oracle Object Storage.
set -euo pipefail
export LC_ALL=C

fail() { echo "RESULT=FAILED: $*"; exit 1; }

CONF=${ORACLE_DR_RCLONE_CONFIG:-/etc/raspi-google-drive-dr/rclone.conf}
PASS=${ORACLE_DR_RESTIC_PASSWORD_FILE:-/etc/raspi-google-drive-dr/restic-password}
ORACLE_ENV=${ORACLE_DR_ENV_FILE:-/etc/raspi-google-drive-dr/oci/oracle.env}
OCI_CONFIG=${ORACLE_DR_OCI_CONFIG:-/etc/raspi-google-drive-dr/oci/config}
RCLONE=${ORACLE_DR_RCLONE:-/opt/raspi-google-drive-dr/bin/rclone-v1.76.0/rclone}
SYSTEMCTL=${ORACLE_DR_SYSTEMCTL:-systemctl}
MAX_BYTES=${ORACLE_DR_MAX_BYTES:-$((17 * 1024 * 1024 * 1024))}
SRC=google-drive:RaspberryPiSystem_002/business-pi5
DEST=oracle:raspi-dr-business-pi5

for file in "$CONF" "$PASS" "$ORACLE_ENV" "$OCI_CONFIG"; do
  [[ -f "$file" && -r "$file" ]] || fail "required file missing or unreadable: $file"
done
[[ -f "$RCLONE" && -x "$RCLONE" ]] || fail "rclone missing or not executable: $RCLONE"
[[ "$MAX_BYTES" =~ ^(0|[1-9][0-9]*)$ ]] || fail "ORACLE_DR_MAX_BYTES must be a non-negative integer"

if "$SYSTEMCTL" is-active --quiet raspi-google-drive-dr.service; then
  fail "Google Drive DR backup is running"
fi

unset ORACLE_DR_NAMESPACE ORACLE_DR_COMPARTMENT ORACLE_DR_REGION
source "$ORACLE_ENV" || fail "could not load oracle.env"
for variable in ORACLE_DR_NAMESPACE ORACLE_DR_COMPARTMENT ORACLE_DR_REGION; do
  [[ -n "${!variable:-}" ]] || fail "$variable is empty or missing in oracle.env"
done

source_top=$("$RCLONE" --config "$CONF" lsf "$SRC") || fail "could not list the source"
grep -qx config <<<"$source_top" || fail "source has no restic config file"
RCLONE_CONFIG="$CONF" timeout 300 restic -r "rclone:$SRC" --password-file "$PASS" --no-cache --no-lock cat config >/dev/null \
  || fail "our password does not open the source"

export RCLONE_CONFIG_ORACLE_TYPE=oracleobjectstorage
export RCLONE_CONFIG_ORACLE_PROVIDER=user_principal_auth
export RCLONE_CONFIG_ORACLE_NAMESPACE="$ORACLE_DR_NAMESPACE"
export RCLONE_CONFIG_ORACLE_COMPARTMENT="$ORACLE_DR_COMPARTMENT"
export RCLONE_CONFIG_ORACLE_REGION="$ORACLE_DR_REGION"
export RCLONE_CONFIG_ORACLE_CONFIG_FILE="$OCI_CONFIG"
export RCLONE_CONFIG_ORACLE_CONFIG_PROFILE=DEFAULT

"$RCLONE" --config "$CONF" copy "$SRC" "$DEST" --exclude "locks/**" --immutable --size-only \
  --fast-list --oos-no-check-bucket --transfers 4 --checkers 4 --retries 3 --stats-one-line -v \
  || fail "Oracle copy failed"
"$RCLONE" --config "$CONF" check "$SRC" "$DEST" --one-way --size-only --exclude "locks/**" \
  --fast-list --oos-no-check-bucket || fail "Oracle copy verification failed"

bytes=$("$RCLONE" --config "$CONF" size --json --fast-list --oos-no-check-bucket "$DEST" |
  python3 -c 'import json, sys; print(json.load(sys.stdin)["bytes"])') || fail "could not measure Oracle bucket size"
[[ "$bytes" =~ ^(0|[1-9][0-9]*)$ ]] || fail "invalid Oracle bucket size"
[[ "$bytes" -le "$MAX_BYTES" ]] ||
  fail "Oracle bucket uses $bytes bytes (limit $MAX_BYTES); check whether the monthly bucket cleanup was missed"

echo "RESULT=OK"
