#!/usr/bin/env bash
# Validate the immutable candidate migration ledger against a known deployed baseline.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BASE_REF="${1:-origin/main}"
CANDIDATE_REF="${2:-HEAD}"
MIGRATION_ROOT="apps/api/prisma/migrations"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
safe_git() {
  env -i HOME=/nonexistent \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C LC_ALL=C GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    /usr/bin/git -c core.fsmonitor=false -c core.ignorestat=false \
      -c core.trustctime=true -c extensions.worktreeConfig=false \
      -C "$PROJECT_DIR" "$@"
}

BASE_SHA="$(safe_git rev-parse --verify --end-of-options "${BASE_REF}^{commit}")" \
  || die "base ref is unavailable: ${BASE_REF}"
CANDIDATE_SHA="$(safe_git rev-parse --verify --end-of-options "${CANDIDATE_REF}^{commit}")" \
  || die "candidate ref is unavailable: ${CANDIDATE_REF}"
[[ "$BASE_SHA" =~ ^[0-9a-f]{40,64}$ ]] || die 'base ref did not resolve to an immutable commit'
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40,64}$ ]] || die 'candidate ref did not resolve to an immutable commit'

LEDGER="$(mktemp "${TMPDIR:-/tmp}/candidate-migration-ledger.XXXXXX")"
trap 'rm -f "$LEDGER"' EXIT
chmod 600 "$LEDGER"

python3 - "$PROJECT_DIR" "$BASE_SHA" "$MIGRATION_ROOT" >"$LEDGER" <<'PY'
import hashlib
import pathlib
import subprocess
import sys

repository = pathlib.Path(sys.argv[1])
base_sha = sys.argv[2]
migration_root = sys.argv[3].rstrip("/")
environment = {
    "HOME": "/nonexistent",
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LANG": "C",
    "LC_ALL": "C",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_NOSYSTEM": "1",
}

def git(*arguments: str) -> bytes:
    result = subprocess.run(
        [
            "/usr/bin/git",
            "-c", "core.fsmonitor=false",
            "-c", "core.ignorestat=false",
            "-c", "core.trustctime=true",
            "-c", "extensions.worktreeConfig=false",
            "-C", str(repository),
            *arguments,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        env=environment,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout

raw = git("ls-tree", "-r", "--name-only", "-z", base_sha, "--", migration_root)
for field in raw.rstrip(b"\0").split(b"\0") if raw else []:
    path = field.decode("utf-8")
    if not path.endswith("/migration.sql"):
        continue
    content = git("show", f"{base_sha}:{path}")
    name = pathlib.PurePosixPath(path).parent.name
    print(f"{name}|{hashlib.sha256(content).hexdigest()}")
PY

python3 "${SCRIPT_DIR}/validate-expand-only-migrations.py" \
  --applied-checksums "$LEDGER" \
  --repository "$PROJECT_DIR" \
  --base-ref "$BASE_SHA" \
  --candidate-ref "$CANDIDATE_SHA" \
  --migration-root "$MIGRATION_ROOT"

printf 'candidate migration preflight passed: base=%s candidate=%s\n' \
  "$BASE_SHA" "$CANDIDATE_SHA"
