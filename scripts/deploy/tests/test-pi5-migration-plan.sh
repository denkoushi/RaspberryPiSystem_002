#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/pi5-migration-plan.sh"
LIVE_EVIDENCE="$ROOT/scripts/deploy/pi5-live-migration-evidence.sh"
EVIDENCE="$ROOT/scripts/deploy/pi5-release-evidence.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

SHA="$(git -C "$ROOT" rev-parse HEAD)"
LEDGER="$TMP/ledger.txt"
python3 - "$ROOT" "$SHA" >"$LEDGER" <<'PY'
import hashlib, pathlib, subprocess, sys
root, sha = pathlib.Path(sys.argv[1]), sys.argv[2]
prefix='apps/api/prisma/migrations/'
raw=subprocess.check_output(['git','-C',str(root),'ls-tree','-r','--name-only',sha,'--',prefix], text=True)
for path in sorted(raw.splitlines()):
    if not path.endswith('/migration.sql'):
        continue
    content=subprocess.check_output(['git','-C',str(root),'show',f'{sha}:{path}'])
    print(f'{path.split("/")[-2]}|{hashlib.sha256(content).hexdigest()}')
PY

PLAN="$TMP/plan.json"
env PI5_PROJECT_DIR="$ROOT" PI5_MIGRATION_BASE_REF="$SHA" \
  PI5_MIGRATION_LEDGER_FILE="$LEDGER" PI5_MIGRATION_PLAN_TEST_MODE=1 \
  "$SCRIPT" --ref "$SHA" --run-id run-test-1 --output "$PLAN" >/dev/null
python3 "$EVIDENCE" verify-migration --path "$PLAN" --run-id run-test-1 \
  --sha "$SHA" --ledger "$LEDGER" >/dev/null
env PI5_PROJECT_DIR="$ROOT" PI5_MIGRATION_BASE_REF="$SHA" \
  PI5_MIGRATION_LEDGER_FILE="$LEDGER" PI5_MIGRATION_PLAN_TEST_MODE=1 \
  GIT_DIR="$TMP/poisoned-git-dir" GIT_WORK_TREE="$TMP" \
  "$SCRIPT" --ref "$SHA" --run-id run-test-git-env --output "$TMP/git-env.json" >/dev/null \
  || fail 'inherited Git environment poisoned migration planning'

if env PI5_PROJECT_DIR="$ROOT" PI5_MIGRATION_BASE_REF="$SHA" \
  PI5_MIGRATION_LEDGER_FILE="$LEDGER" PI5_MIGRATION_PLAN_TEST_MODE=0 \
  "$SCRIPT" --ref "$SHA" --run-id run-test-prod --output "$TMP/prod.json" >/dev/null 2>&1; then
  fail 'production planning accepted a caller-supplied migration base'
fi

if env PI5_PROJECT_DIR="$ROOT" PI5_MIGRATION_BASE_REF="$SHA" \
  PI5_MIGRATION_LEDGER_FILE="$LEDGER" PI5_MIGRATION_PLAN_TEST_MODE=1 \
  ROLLING_RELEASE_PROTOCOL=2 \
  "$SCRIPT" --ref "$SHA" --run-id run-test-protocol --output "$TMP/protocol.json" >/dev/null 2>&1; then
  fail 'production rolling-release protocol accepted migration test overrides'
fi

printf 'not-json\n' >"$TMP/malformed-bluegreen.json"
if env PI5_PROJECT_DIR="$ROOT" PI5_BLUE_GREEN_STATE_FILE="$TMP/malformed-bluegreen.json" \
  PI5_MIGRATION_LEDGER_FILE="$LEDGER" PI5_MIGRATION_PLAN_TEST_MODE=1 \
  "$SCRIPT" --ref "$SHA" --run-id run-test-state --output "$TMP/state.json" >/dev/null 2>&1; then
  fail 'planning treated malformed Blue/Green state as an absent bootstrap state'
fi

tail -n +2 "$LEDGER" >"$TMP/missing.txt"
if env PI5_PROJECT_DIR="$ROOT" PI5_MIGRATION_BASE_REF="$SHA" \
  PI5_MIGRATION_LEDGER_FILE="$TMP/missing.txt" PI5_MIGRATION_PLAN_TEST_MODE=1 \
  "$SCRIPT" --ref "$SHA" --run-id run-test-2 --output "$TMP/missing.json" >/dev/null 2>&1; then
  fail 'plan accepted a missing applied migration'
fi

awk -F'|' 'NR==1 {$2=sprintf("%064d",0)} {print $1 "|" $2}' "$LEDGER" >"$TMP/mismatch.txt"
if env PI5_PROJECT_DIR="$ROOT" PI5_MIGRATION_BASE_REF="$SHA" \
  PI5_MIGRATION_LEDGER_FILE="$TMP/mismatch.txt" PI5_MIGRATION_PLAN_TEST_MODE=1 \
  "$SCRIPT" --ref "$SHA" --run-id run-test-3 --output "$TMP/mismatch.json" >/dev/null 2>&1; then
  fail 'plan accepted an applied checksum mismatch'
fi

# Same-SHA/no-new observations must still validate every live DB row against
# committed migration bytes. A fake Phase 3 command supplies only the read-only
# ledger boundary; the production command and shared validator remain real.
FAKE_PHASE3="$TMP/fake-phase3"
cat >"$FAKE_PHASE3" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == migration-ledger ]]
cat "${LIVE_LEDGER_FILE:?}"
SH
chmod +x "$FAKE_PHASE3"
live_digest="$(env PI5_PROJECT_DIR="$ROOT" PI5_PHASE3_SCRIPT="$FAKE_PHASE3" \
  PI5_LIVE_MIGRATION_TEST_MODE=1 LIVE_LEDGER_FILE="$LEDGER" \
  "$LIVE_EVIDENCE" --ref "$SHA")"
[[ "$live_digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'zero-new live migration evidence did not emit a canonical digest'
for bad_ledger in missing mismatch; do
  if env PI5_PROJECT_DIR="$ROOT" PI5_PHASE3_SCRIPT="$FAKE_PHASE3" \
    PI5_LIVE_MIGRATION_TEST_MODE=1 LIVE_LEDGER_FILE="$TMP/${bad_ledger}.txt" \
    "$LIVE_EVIDENCE" --ref "$SHA" >/dev/null 2>&1; then
    fail "live migration evidence accepted ${bad_ledger} ledger"
  fi
done
if env PI5_PROJECT_DIR="$ROOT" PI5_PHASE3_SCRIPT="$FAKE_PHASE3" \
  PI5_LIVE_MIGRATION_TEST_MODE=1 LIVE_LEDGER_FILE="$LEDGER" \
  ROLLING_RELEASE_PROTOCOL=2 "$LIVE_EVIDENCE" --ref "$SHA" >/dev/null 2>&1; then
  fail 'production live migration evidence accepted a test Phase 3 override'
fi

grep -Fq 'finished_at IS NOT NULL AND rolled_back_at IS NULL' "$SCRIPT" \
  || fail 'plan query includes incomplete or rolled-back migrations'
grep -Fq 'finished_at IS NOT NULL AND rolled_back_at IS NULL' \
  "$ROOT/scripts/deploy/pi5-blue-green.sh" \
  || fail 'live evidence query includes incomplete or rolled-back migrations'
grep -Fq 'migration_gate_verify_applied_ledger' "$LIVE_EVIDENCE" \
  || fail 'live evidence does not use the canonical full-ledger guard'
if grep -Eq 'migrate (deploy|reset|down)|down migration' "$SCRIPT"; then
  fail 'migration planning contains a database mutation'
fi

printf 'PASS: Pi5 migration planning evidence\n'
