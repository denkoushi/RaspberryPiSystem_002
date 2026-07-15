#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

WRAPPER="${ROOT}/scripts/update-all-clients.sh"
test "$(wc -l < "${WRAPPER}" | tr -d ' ')" -le 10 || fail "public wrapper contains coordinator logic"
grep -Eq '^exec python3 .*scripts/deploy/rolling-release\.py" "\$@"$' "${WRAPPER}" \
  || fail "public wrapper is not an argument-preserving strict exec"
if grep -q 'ROLLING_RELEASE_V2' "${WRAPPER}"; then
  fail "hidden coordinator selector remains in the public wrapper"
fi
if grep -R -q 'ROLLING_RELEASE_LOCK_HELD' "${ROOT}/scripts/deploy/rolling_release"; then
  fail "legacy boolean lock fallback remains in the coordinator package"
fi
test "$(cat "${ROOT}/scripts/deploy/rolling_release/PROTOCOL")" = "raspi-rolling-release-v1" \
  || fail "rolling-release protocol marker is missing"

set +e
wrapper_output="$("${WRAPPER}" main infrastructure/ansible/inventory.yml --job 2>&1)"
wrapper_status=$?
set -e
test "${wrapper_status}" -eq 2 || fail "retired public option did not exit 2"
grep -q -- '--detach' <<<"${wrapper_output}" || fail "retired option did not print its replacement"

SPY_DIR="${TMP_DIR}/spy"
mkdir -p "${SPY_DIR}"
for command in git docker ansible-playbook systemd-run systemctl nohup; do
  printf '#!/usr/bin/env bash\ntouch %q\nexit 99\n' "${TMP_DIR}/mutation-called" > "${SPY_DIR}/${command}"
  chmod +x "${SPY_DIR}/${command}"
done

entries=(
  "scripts/server/deploy.sh"
  "scripts/server/deploy-detached.sh"
  "scripts/deploy/deploy-executor.sh"
  "scripts/deploy/deploy-all.sh"
)
for entry in "${entries[@]}"; do
  rm -f "${TMP_DIR}/rollback-called" "${TMP_DIR}/mutation-called"
  set +e
  output="$(
    env \
      PATH="${SPY_DIR}:/usr/bin:/bin" \
      DEPLOY_EXECUTOR_ENABLE=1 \
      FORCE_DEPLOY_FAILURE=1 \
      ROLLBACK_ON_FAIL=1 \
      ROLLBACK_CMD="touch ${TMP_DIR}/rollback-called" \
      /bin/bash "${ROOT}/${entry}" --dry-run 2>&1
  )"
  status=$?
  set -e
  test "${status}" -eq 2 || fail "${entry} did not fail closed with exit 2"
  grep -q 'scripts/update-all-clients.sh' <<<"${output}" \
    || fail "${entry} did not name the canonical replacement"
  test ! -e "${TMP_DIR}/rollback-called" || fail "${entry} executed legacy rollback"
  test ! -e "${TMP_DIR}/mutation-called" || fail "${entry} invoked a mutation backend"
done

echo "single deploy entrypoint contract tests passed"
