#!/usr/bin/env bash
# Verify the complete live Prisma ledger for one immutable release and emit a
# digest bound to both the release SHA and the read-only database snapshot.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/migration-gate.sh
source "${SCRIPT_DIR}/lib/migration-gate.sh"

PROJECT_DIR="${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
PHASE3="${PI5_PHASE3_SCRIPT:-${SCRIPT_DIR}/pi5-blue-green.sh}"
REF=""

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
  cat >&2 <<'EOF'
Usage: pi5-live-migration-evidence.sh --ref FULL_SHA

Reads the completed, non-rolled-back Prisma ledger from the normalized active
API, verifies that every migration at FULL_SHA is applied with its committed
checksum, and emits a release-bound sha256 digest. The database is never
mutated.
EOF
}

while (($#)); do
  case "$1" in
    --ref) [[ $# -ge 2 ]] || die '--ref requires a value'; REF="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || die '--ref must be a full lowercase Git SHA'
if [[ "${ROLLING_RELEASE_PROTOCOL:-}" == 2 \
  && ( -n "${PI5_LIVE_MIGRATION_TEST_MODE:-}" \
    || -n "${PI5_PHASE3_SCRIPT:-}" ) ]]; then
  die 'live migration test overrides are forbidden under the production rolling-release protocol'
fi
if [[ -n "${PI5_PHASE3_SCRIPT:-}" && "${PI5_LIVE_MIGRATION_TEST_MODE:-0}" != 1 ]]; then
  die 'Phase 3 command override is test-only'
fi
[[ -x "$PHASE3" ]] || die "Phase 3 command is unavailable: $PHASE3"

LEDGER="$(mktemp "${TMPDIR:-/tmp}/pi5-live-migration.XXXXXX")" \
  || die 'could not create the live migration ledger snapshot'
trap 'rm -f "$LEDGER"' EXIT
chmod 600 "$LEDGER"

"$PHASE3" migration-ledger >"$LEDGER" \
  || die 'could not read the live applied Prisma migration ledger'
migration_gate_verify_applied_ledger \
  "$PROJECT_DIR" "$REF" "$REF" "$LEDGER" \
  || die 'live migration ledger is missing or has a checksum mismatch'

python3 - "$REF" "$LEDGER" <<'PY'
import hashlib
import pathlib
import sys

release_sha, ledger_path = sys.argv[1:]
digest = hashlib.sha256()
digest.update(b"release-sha\0")
digest.update(release_sha.encode("ascii"))
digest.update(b"\0applied-ledger\0")
digest.update(pathlib.Path(ledger_path).read_bytes())
print("sha256:" + digest.hexdigest())
PY
