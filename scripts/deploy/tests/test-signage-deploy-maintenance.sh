#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE="$ROOT/infrastructure/ansible/roles/signage/templates/signage-update.sh.j2"
DISPLAY_TEMPLATE="$ROOT/infrastructure/ansible/roles/signage/templates/signage-display.sh.j2"
SERVICE_TEMPLATE="$ROOT/infrastructure/ansible/roles/signage/templates/signage-lite.service.j2"
UPDATE_SERVICE_TEMPLATE="$ROOT/infrastructure/ansible/roles/signage/templates/signage-lite-update.service.j2"
SVG="$ROOT/infrastructure/ansible/roles/signage/templates/signage-maintenance.svg.j2"
grep -Fq 'DEPLOY_STATUS_URL=' "$TEMPLATE"
grep -Fq 'acknowledge_maintenance' "$TEMPLATE"
grep -Fq 'acknowledge_ready_if_matching' "$TEMPLATE"
if grep -Fq 'source /etc/raspisystem-signage/runtime.env' \
    "$TEMPLATE" "$DISPLAY_TEMPLATE"; then
  echo 'non-root Signage scripts must use the systemd-provided environment' >&2
  exit 1
fi
grep -Fq 'EnvironmentFile=/etc/raspisystem-signage/runtime.env' "$SERVICE_TEMPLATE"
grep -Fq 'EnvironmentFile=/etc/raspisystem-signage/runtime.env' "$UPDATE_SERVICE_TEMPLATE"
grep -Fq 'STATUS_CLIENT_ID="${SIGNAGE_STATUS_CLIENT_ID}"' "$TEMPLATE"
grep -Fq 'STATUS_CLIENT_KEY="${SIGNAGE_STATUS_CLIENT_KEY}"' "$TEMPLATE"
grep -Fq 'IMAGE_CLIENT_KEY="${SIGNAGE_IMAGE_CLIENT_KEY}"' "$TEMPLATE"
grep -Fq 'curl "${CURL_OPTIONS[@]}" --header @-' "$TEMPLATE"
if grep -Eq -- '-H[[:space:]]+"?x-client-key:' "$TEMPLATE"; then
  echo 'signage credentials must not be placed in curl argv' >&2
  exit 1
fi
grep -Fq 'rsvg-convert' "$TEMPLATE"
grep -Fq 'ただいま更新中です' "$SVG"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
FIXTURE_REPO="${TMP_DIR}/repo"
FIXTURE_BIN="${TMP_DIR}/bin"
RENDERED_SCRIPT="${TMP_DIR}/signage-update.sh"
FIXTURE_ARTIFACT="${TMP_DIR}/raspi-signage-status-agent.pyz"
RUNTIME_ENV="${TMP_DIR}/runtime.env"
CURL_ARGV_LOG="${TMP_DIR}/curl-argv.log"
ACK_LOG="${TMP_DIR}/ack.log"
mkdir -p "${FIXTURE_REPO}" "${FIXTURE_BIN}"

git -C "${FIXTURE_REPO}" init -q
git -C "${FIXTURE_REPO}" config user.name 'signage ready fixture'
git -C "${FIXTURE_REPO}" config user.email 'signage-ready@example.invalid'
printf 'fixture\n' > "${FIXTURE_REPO}/release.txt"
git -C "${FIXTURE_REPO}" add release.txt
git -C "${FIXTURE_REPO}" commit -qm 'fixture release'
EXPECTED_SHA="$(git -C "${FIXTURE_REPO}" rev-parse HEAD)"
MISMATCHED_SHA="$(printf 'b%.0s' {1..40})"
if [[ "${MISMATCHED_SHA}" == "${EXPECTED_SHA}" ]]; then
  MISMATCHED_SHA="$(printf 'c%.0s' {1..40})"
fi
VERIFICATION_ID="$(printf 'd%.0s' {1..32})"

python3 - "${FIXTURE_ARTIFACT}" "${EXPECTED_SHA}" <<'PY'
import sys
from pathlib import Path

destination, source_sha = sys.argv[1:]
Path(destination).write_text(
    "import json\n"
    "print(json.dumps({\"sourceSha\": " + repr(source_sha) + "}))\n",
    encoding="utf-8",
)
PY

python3 - "${TEMPLATE}" "${RENDERED_SCRIPT}" "${FIXTURE_ARTIFACT}" <<'PY'
import sys
from pathlib import Path

source, destination, artifact = sys.argv[1:]
text = Path(source).read_text(encoding="utf-8")
replacements = {
    'RELEASE_ARTIFACT="/usr/local/bin/raspi-signage-status-agent.pyz"': (
        f'RELEASE_ARTIFACT="{artifact}"'
    ),
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"render fixture is missing template fragment: {old!r}")
    text = text.replace(old, new)
if "{{" in text or "{%" in text:
    raise SystemExit("render fixture left unresolved Jinja syntax")
Path(destination).write_text(text, encoding="utf-8")
PY
chmod +x "${RENDERED_SCRIPT}"

cat > "${RUNTIME_ENV}" <<'EOF'
SIGNAGE_SERVER_URL=https://fixture.invalid
SIGNAGE_IMAGE_CLIENT_KEY=fixture-image-secret
SIGNAGE_STATUS_CLIENT_ID=talkplaza-signage01
SIGNAGE_STATUS_CLIENT_KEY=fixture-status-secret
SIGNAGE_ALLOW_INSECURE_TLS=1
EOF
set -a
source "${RUNTIME_ENV}"
set +a

cat > "${FIXTURE_BIN}/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
auth_header=""
IFS= read -r auth_header || true
printf '%s\n' "$*" >> "${CURL_ARGV_LOG}"

args=("$@")
url="${args[${#args[@]}-1]}"
output=""
payload=""
for ((index = 0; index < ${#args[@]}; index += 1)); do
  case "${args[index]}" in
    -o)
      output="${args[index+1]}"
      ;;
    --data-binary)
      payload="${args[index+1]}"
      ;;
  esac
done

case "${url}" in
  */api/system/deploy-status/ack)
    [[ "${auth_header}" == 'x-client-key: fixture-status-secret' ]] || exit 22
    printf '%s\n' "${payload}" >> "${ACK_LOG}"
    printf '{"acknowledged":true}\n'
    ;;
  */api/system/deploy-status)
    [[ "${auth_header}" == 'x-client-key: fixture-status-secret' ]] || exit 22
    case "${STATUS_MODE}" in
      unauthorized)
        exit 22
        ;;
      mismatch)
        printf '{"isMaintenance":true,"runId":"fixture-run","phase":"verifying","desiredReleaseSha":"%s","verificationId":"%s"}\n' "${MISMATCHED_SHA}" "${FIXTURE_VERIFICATION_ID}"
        ;;
      missing-verification)
        printf '{"isMaintenance":true,"runId":"fixture-run","phase":"verifying","desiredReleaseSha":"%s"}\n' "${EXPECTED_SHA}"
        ;;
      malformed-verification)
        printf '{"isMaintenance":true,"runId":"fixture-run","phase":"verifying","desiredReleaseSha":"%s","verificationId":"NOT-A-VALID-VERIFICATION-ID"}\n' "${EXPECTED_SHA}"
        ;;
      match)
        printf '{"isMaintenance":true,"runId":"fixture-run","phase":"verifying","desiredReleaseSha":"%s","verificationId":"%s"}\n' "${EXPECTED_SHA}" "${FIXTURE_VERIFICATION_ID}"
        ;;
      *)
        exit 64
        ;;
    esac
    ;;
  */api/signage/current-image)
    [[ "${auth_header}" == 'x-client-key: fixture-image-secret' ]] || exit 22
    [[ -n "${output}" ]] || exit 64
    printf 'fixture image\n' > "${output}"
    ;;
  *)
    exit 64
    ;;
esac
SH
chmod +x "${FIXTURE_BIN}/curl"

cat > "${FIXTURE_BIN}/rsvg-convert" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
output=""
for ((index = 0; index < ${#args[@]}; index += 1)); do
  if [[ "${args[index]}" == '-o' ]]; then
    output="${args[index+1]}"
  fi
done
[[ -n "${output}" ]] || exit 64
printf 'maintenance image\n' > "${output}"
SH
chmod +x "${FIXTURE_BIN}/rsvg-convert"

MAINTENANCE_SVG="${TMP_DIR}/maintenance.svg"
printf '<svg/>\n' > "${MAINTENANCE_SVG}"

run_case() {
  local mode="$1"
  local output="${TMP_DIR}/${mode}.out"
  : > "${CURL_ARGV_LOG}"
  : > "${ACK_LOG}"
  rm -rf "${TMP_DIR}/cache"
  mkdir -p "${TMP_DIR}/cache"
  PATH="${FIXTURE_BIN}:${PATH}" \
    CURL_ARGV_LOG="${CURL_ARGV_LOG}" \
    ACK_LOG="${ACK_LOG}" \
    STATUS_MODE="${mode}" \
    EXPECTED_SHA="${EXPECTED_SHA}" \
    MISMATCHED_SHA="${MISMATCHED_SHA}" \
    FIXTURE_VERIFICATION_ID="${VERIFICATION_ID}" \
    SIGNAGE_CACHE_DIR="${TMP_DIR}/cache" \
    SIGNAGE_MAINTENANCE_SVG="${MAINTENANCE_SVG}" \
    bash "${RENDERED_SCRIPT}" > "${output}" 2>&1
  if grep -Fq 'fixture-status-secret' "${CURL_ARGV_LOG}" "${ACK_LOG}" "${output}" \
      || grep -Fq 'fixture-image-secret' "${CURL_ARGV_LOG}" "${ACK_LOG}" "${output}"; then
    echo "${mode}: a client credential leaked into argv or logs" >&2
    exit 1
  fi
}

# An unauthorized status lookup must not emit any acknowledgement. Image
# polling still uses its independent rendering credential and remains healthy.
run_case unauthorized
[[ ! -s "${ACK_LOG}" ]]
grep -Fq 'Image updated successfully' "${TMP_DIR}/unauthorized.out"

# A valid verifying response preserves the maintenance ACK, but a different
# immutable artifact source SHA must never produce a ready ACK.
run_case mismatch
grep -Fq '"phase":"maintenance"' "${ACK_LOG}"
if grep -Fq '"phase":"ready"' "${ACK_LOG}"; then
  echo 'mismatched signage HEAD emitted a ready acknowledgement' >&2
  exit 1
fi

# A matching local artifact source SHA is insufficient without the exact 32-character
# lowercase verification challenge from the active cycle.
for mode in missing-verification malformed-verification; do
  run_case "${mode}"
  grep -Fq '"phase":"maintenance"' "${ACK_LOG}"
  if grep -Fq '"phase":"ready"' "${ACK_LOG}"; then
    echo "${mode}: signage emitted ready without a valid verification ID" >&2
    exit 1
  fi
done

# Only the exact lowercase 40-character artifact source SHA and active verification ID
# can be acknowledged ready.
run_case match
grep -Fq '"phase":"maintenance"' "${ACK_LOG}"
python3 - "${ACK_LOG}" "${EXPECTED_SHA}" "${VERIFICATION_ID}" <<'PY'
import json
import sys

path, expected_sha, verification_id = sys.argv[1:]
with open(path, encoding="utf-8") as source:
    acknowledgements = [json.loads(line) for line in source if line.strip()]
ready = [value for value in acknowledgements if value.get("phase") == "ready"]
expected = {
    "runId": "fixture-run",
    "phase": "ready",
    "releaseSha": expected_sha,
    "verificationId": verification_id,
}
if ready != [expected]:
    raise SystemExit(f"ready acknowledgement did not bind the active verification ID: {ready!r}")
PY

echo 'PASS: signage maintenance and verification-cycle-bound ready acknowledgement'
