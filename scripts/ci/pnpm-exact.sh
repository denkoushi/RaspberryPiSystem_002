#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE_JSON="${ROOT_DIR}/package.json"

fail() {
  echo "[pnpm-exact] ERROR: $*" >&2
  exit 2
}

for command in node python3; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "required tool is missing: ${command}"
done

declared="$({
  python3 - "$PACKAGE_JSON" <<'PY'
import json
import sys
from pathlib import Path

value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("packageManager")
if not isinstance(value, str):
    raise SystemExit(1)
print(value)
PY
} 2>/dev/null)" || fail "package.json has no readable packageManager declaration"

[[ "$declared" =~ ^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$ ]] \
  || fail "packageManager must declare one exact pnpm version"
expected="${BASH_REMATCH[1]}"
install_hint="npm install -g pnpm@${expected}"
pnpm_bin="$(command -v pnpm)" \
  || fail "pnpm is not installed; run: ${install_hint}"
# PATH entries may be relative. Keep an absolute executable path for the shim.
pnpm_bin="$(python3 -c 'import os, sys; print(os.path.abspath(sys.argv[1]))' "$pnpm_bin")"
resolved="$("$pnpm_bin" --version)" \
  || fail "could not run pnpm; run: ${install_hint}"
[[ "$resolved" == "$expected" ]] \
  || fail "pnpm ${resolved} does not match expected ${expected}; run: ${install_hint}"

echo "[pnpm-exact] node=$(node --version) pnpm=${resolved} declaration=${declared}" >&2

# Package scripts can invoke `pnpm` again. Put a run-scoped pnpm shim
# ahead of the caller's PATH so those child invocations cannot fall back to a
# different, incompatible pnpm.
shim_dir="$(mktemp -d "${TMPDIR:-/tmp}/raspisys-pnpm-exact.XXXXXX")"
trap 'rm -rf -- "$shim_dir"' EXIT
export PNPM_EXACT_BIN="$pnpm_bin"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'exec "$PNPM_EXACT_BIN" "$@"' \
  > "$shim_dir/pnpm"
chmod 0700 "$shim_dir/pnpm"

args=("$@")
install_seen=0
frozen_seen=0
for argument in "${args[@]}"; do
  [[ "$argument" == "install" ]] && install_seen=1
  [[ "$argument" == "--frozen-lockfile" ]] && frozen_seen=1
  [[ "$argument" == "--no-frozen-lockfile" ]] \
    && fail "install may not disable the frozen lockfile contract"
done
if ((install_seen && !frozen_seen)); then
  args+=(--frozen-lockfile)
fi

env CI=true PATH="${shim_dir}:${PATH}" \
  "$pnpm_bin" "${args[@]}"
