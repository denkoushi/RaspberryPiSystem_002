#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INVENTORY=""
OUTPUT=""
SHA=""

usage() {
  cat <<'EOF'
Usage: render-release-build-contract.sh --inventory FILE --sha FULL_SHA --output FILE
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --inventory) INVENTORY="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "release build contract SHA is malformed" >&2
  exit 78
}
[[ -n "$INVENTORY" && -f "$INVENTORY" && ! -L "$INVENTORY" ]] || {
  echo "release build contract inventory is unavailable" >&2
  exit 78
}
[[ "$OUTPUT" == /* && "$OUTPUT" != *$'\n'* && "$OUTPUT" != *$'\r'* ]] || {
  echo "release build contract output path is malformed" >&2
  exit 78
}

TEMP_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/release-build-contract.XXXXXX")"
CANONICAL_OUTPUT="${TEMP_OUTPUT}.canonical"
VAULT_PASSWORD_FILE="$(mktemp "${TMPDIR:-/tmp}/release-build-contract-vault.XXXXXX")"
cleanup() {
  local rc=$?
  [[ -z "$TEMP_OUTPUT" ]] || rm -f "$TEMP_OUTPUT"
  [[ -z "$CANONICAL_OUTPUT" ]] || rm -f "$CANONICAL_OUTPUT"
  [[ -z "$VAULT_PASSWORD_FILE" ]] || rm -f "$VAULT_PASSWORD_FILE"
  trap - EXIT
  exit "$rc"
}
trap cleanup EXIT INT TERM
chmod 600 "$TEMP_OUTPUT"
chmod 600 "$VAULT_PASSWORD_FILE"
printf '%s\n' 'release-contract-has-no-vault-inputs' >"$VAULT_PASSWORD_FILE"

ANSIBLE_CONFIG="${ROOT}/infrastructure/ansible/ansible.cfg" \
ANSIBLE_LOCAL_TEMP="${ANSIBLE_LOCAL_TEMP:-${TMPDIR:-/tmp}/ansible-local-release-contract}" \
ANSIBLE_REMOTE_TEMP="${ANSIBLE_REMOTE_TEMP:-${TMPDIR:-/tmp}/ansible-remote-release-contract}" \
ANSIBLE_VAULT_PASSWORD_FILE="$VAULT_PASSWORD_FILE" \
RELEASE_BUILD_CONTRACT_SHA="$SHA" \
RELEASE_BUILD_CONTRACT_OUTPUT="$TEMP_OUTPUT" \
  ansible-playbook \
    -i "$INVENTORY" \
    "${ROOT}/infrastructure/ansible/playbooks/render-release-build-contract.yml" \
    --limit raspberrypi5 >/dev/null

python3 "${ROOT}/scripts/deploy/release_build_contract.py" validate \
  --release-sha "$SHA" <"$TEMP_OUTPUT" >"$CANONICAL_OUTPUT"
mv "$CANONICAL_OUTPUT" "$OUTPUT"
chmod 600 "$OUTPUT"
rm -f "$VAULT_PASSWORD_FILE"
TEMP_OUTPUT=""
CANONICAL_OUTPUT=""
VAULT_PASSWORD_FILE=""
