#!/usr/bin/env bash
# Contract tests for the Pi4 storage maintenance retention rules.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="${ROOT}/scripts/client/pi4-storage-maintenance.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

BIN_DIR="${TMP_DIR}/bin"
mkdir -p "${BIN_DIR}"

NFC="ghcr.io/denkoushi/raspisys-nfc-agent"
TORQUE="ghcr.io/denkoushi/raspisys-torque-agent"

# ID, repository, tag, created, last tag time
cat > "${TMP_DIR}/images.tsv" <<EOF
sha256:nfc-current	${NFC}	current	2026-10-02T07:00:00Z	2026-10-02 11:00:00.5 +0000 UTC
sha256:nfc-previous	${NFC}	previous	2026-10-01T07:00:00Z	2026-10-01 11:00:00.5 +0000 UTC
sha256:nfc-old	${NFC}	old	2026-08-01T07:00:00Z	2026-08-01 11:00:00.5 +0000 UTC
sha256:nfc-old	raspi-standard-rollback	20260818-045543-f6be69-nfc-agent	2026-08-01T07:00:00Z	2026-08-01 11:00:00.5 +0000 UTC
sha256:nfc-untagged	${NFC}	<none>	2026-07-01T07:00:00Z	2026-07-01 11:00:00.5 +0000 UTC
sha256:nfc-local	docker-nfc-agent	latest	2026-07-10T20:58:12+09:00	2026-07-10 12:00:00.5 +0000 UTC
sha256:torque-current	${TORQUE}	current	2026-10-02T07:00:00Z	2026-10-02 11:00:00.5 +0000 UTC
sha256:torque-previous	${TORQUE}	previous	2026-10-01T07:00:00Z	2026-10-01 11:00:00.5 +0000 UTC
sha256:torque-rollback	${TORQUE}	rollback	2026-09-01T07:00:00Z	2026-10-02 11:30:00.5 +0000 UTC
sha256:torque-rollback	raspi-rollback/host/torque-agent	0123456789abcdef0123	2026-09-01T07:00:00Z	2026-10-02 11:30:00.5 +0000 UTC
sha256:torque-old	${TORQUE}	old	2026-08-01T07:00:00Z	2026-08-01 11:00:00.5 +0000 UTC
sha256:unrelated	postgres	15-alpine	2025-12-01T07:00:00Z	2025-12-01 11:00:00.5 +0000 UTC
EOF

cat > "${BIN_DIR}/fake-docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

field() {
  awk -F'\t' -v id="$1" -v column="$2" '$1 == id { print $column; exit }' "${FAKE_IMAGES}"
}

case "$1 ${2:-}" in
  'info ')
    ;;
  'ps -aq')
    printf 'container-nfc\ncontainer-torque\n'
    ;;
  'inspect --format')
    case "$4" in
      container-nfc) printf 'sha256:nfc-current\n' ;;
      container-torque) printf 'sha256:torque-current\n' ;;
      *) exit 64 ;;
    esac
    ;;
  'images --no-trunc')
    cut -f1-3 "${FAKE_IMAGES}"
    ;;
  'image inspect')
    case "$4" in
      '{{.Created}}') field "$5" 4 ;;
      '{{.Metadata.LastTagTime}}') field "$5" 5 ;;
      *) exit 64 ;;
    esac
    ;;
  'image rm')
    printf '%s\n' "$3" >> "${FAKE_REMOVED_LOG}"
    ;;
  'builder prune')
    printf 'builder-prune\n' >> "${FAKE_REMOVED_LOG}"
    ;;
  'system df')
    printf 'TYPE TOTAL ACTIVE SIZE RECLAIMABLE\n'
    ;;
  *)
    exit 64
    ;;
esac
SH

cat > "${BIN_DIR}/fake-apt-get" <<'SH'
#!/usr/bin/env bash
printf 'apt-get %s\n' "$*" >> "${FAKE_REMOVED_LOG}"
SH

cat > "${BIN_DIR}/fake-dpkg-query" <<'SH'
#!/usr/bin/env bash
# Only the "firefox" package is installed.
[ "${*: -1}" = "firefox" ] || exit 1
printf 'install ok installed'
SH

cat > "${BIN_DIR}/fake-pgrep" <<'SH'
#!/usr/bin/env bash
exit "${FAKE_PGREP_STATUS:-1}"
SH
chmod +x "${BIN_DIR}"/fake-*

run_maintenance() {
  HOME_ROOT="${TMP_DIR}/home"
  rm -rf "${HOME_ROOT}"
  mkdir -p "${HOME_ROOT}/kiosk/.mozilla/firefox" "${HOME_ROOT}/kiosk/.cache/mozilla" "${HOME_ROOT}/kiosk/.config/chromium"
  : > "${TMP_DIR}/removed.log"
  env \
    FAKE_IMAGES="${TMP_DIR}/images.tsv" \
    FAKE_REMOVED_LOG="${TMP_DIR}/removed.log" \
    PI4_STORAGE_DOCKER_BIN="${BIN_DIR}/fake-docker" \
    PI4_STORAGE_APT_GET_BIN="${BIN_DIR}/fake-apt-get" \
    PI4_STORAGE_DPKG_QUERY_BIN="${BIN_DIR}/fake-dpkg-query" \
    PI4_STORAGE_PGREP_BIN="${BIN_DIR}/fake-pgrep" \
    PI4_STORAGE_HOME_ROOT="${HOME_ROOT}" \
    PI4_STORAGE_NOW_EPOCH="$(date -u -d '2026-10-02 12:00:00' +%s)" \
    "$@" bash "${SCRIPT}" > "${TMP_DIR}/output.log"
}

assert_removed() {
  local expected="$1"
  if ! diff <(printf '%s' "${expected}" | sort) <(sort "${TMP_DIR}/removed.log"); then
    echo "FAIL: unexpected removals (${2})" >&2
    cat "${TMP_DIR}/output.log" >&2
    exit 1
  fi
}

# 1. Keeps the running image, one previous image per repository and the image
#    behind a rollback tag made within the last day; removes the rest.
run_maintenance PI4_STORAGE_REMOVE_FIREFOX=0
assert_removed "${NFC}:old
raspi-standard-rollback:20260818-045543-f6be69-nfc-agent
sha256:nfc-untagged
docker-nfc-agent:latest
${TORQUE}:old
builder-prune
apt-get clean
" "default retention"
[ -d "${TMP_DIR}/home/kiosk/.mozilla" ] || { echo "FAIL: Firefox profile removed without opt-in" >&2; exit 1; }

# 2. Removes Firefox and its profile only when asked, and never Chromium's.
run_maintenance PI4_STORAGE_REMOVE_FIREFOX=1
grep -Fxq 'apt-get purge -y firefox' "${TMP_DIR}/removed.log" || { echo "FAIL: Firefox was not purged" >&2; exit 1; }
if grep -q 'firefox-esr' "${TMP_DIR}/removed.log"; then echo "FAIL: purged a package that is not installed" >&2; exit 1; fi
[ ! -e "${TMP_DIR}/home/kiosk/.mozilla" ] || { echo "FAIL: Firefox profile kept" >&2; exit 1; }
[ ! -e "${TMP_DIR}/home/kiosk/.cache/mozilla" ] || { echo "FAIL: Firefox cache kept" >&2; exit 1; }
[ -d "${TMP_DIR}/home/kiosk/.config/chromium" ] || { echo "FAIL: Chromium profile removed" >&2; exit 1; }

# 3. Leaves a running Firefox alone.
run_maintenance PI4_STORAGE_REMOVE_FIREFOX=1 FAKE_PGREP_STATUS=0
if grep -q 'purge' "${TMP_DIR}/removed.log"; then echo "FAIL: purged a running Firefox" >&2; exit 1; fi
[ -d "${TMP_DIR}/home/kiosk/.mozilla" ] || { echo "FAIL: profile of a running Firefox removed" >&2; exit 1; }

# 4. A dry run removes nothing.
run_maintenance PI4_STORAGE_REMOVE_FIREFOX=1 PI4_STORAGE_DRY_RUN=1
assert_removed "" "dry run"
[ -d "${TMP_DIR}/home/kiosk/.mozilla" ] || { echo "FAIL: dry run removed the Firefox profile" >&2; exit 1; }
grep -q "DRY-RUN: 削除対象 ${NFC}:old" "${TMP_DIR}/output.log" || { echo "FAIL: dry run did not list targets" >&2; exit 1; }

# 5. Keeping two previous images spares the next older one as well.
run_maintenance PI4_STORAGE_REMOVE_FIREFOX=0 PI4_STORAGE_KEEP_PREVIOUS=2
if grep -Fxq "${NFC}:old" "${TMP_DIR}/removed.log"; then echo "FAIL: second previous image removed" >&2; exit 1; fi

echo "pi4 storage maintenance tests passed"
