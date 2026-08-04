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
REDACTED_CONTEXT_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/release-build-contract-ansible.XXXXXX")"
REDACTED_ANSIBLE_DIR="${REDACTED_CONTEXT_ROOT}/ansible"
VAULT_PLACEHOLDERS="${ROOT}/scripts/ci/fixtures/normal-factory-vault-placeholders.yml"
cleanup() {
  local rc=$?
  [[ -z "$TEMP_OUTPUT" ]] || rm -f "$TEMP_OUTPUT"
  [[ -z "$CANONICAL_OUTPUT" ]] || rm -f "$CANONICAL_OUTPUT"
  [[ -z "$REDACTED_CONTEXT_ROOT" ]] || rm -rf "$REDACTED_CONTEXT_ROOT"
  trap - EXIT
  exit "$rc"
}
trap cleanup EXIT INT TERM
chmod 600 "$TEMP_OUTPUT"
python3 "${ROOT}/scripts/ci/prepare_redacted_ansible_context.py" \
  --source "${ROOT}/infrastructure/ansible" \
  --output "${REDACTED_ANSIBLE_DIR}" >/dev/null
INVENTORY_BASENAME="$(basename "$INVENTORY")"
REDACTED_INVENTORY="${REDACTED_ANSIBLE_DIR}/${INVENTORY_BASENAME}"
[[ -f "$REDACTED_INVENTORY" && ! -L "$REDACTED_INVENTORY" ]] || {
  echo "release build contract inventory is outside the canonical Ansible context" >&2
  exit 78
}

ANSIBLE_CONFIG="${REDACTED_ANSIBLE_DIR}/ansible.cfg" \
ANSIBLE_LOCAL_TEMP="${ANSIBLE_LOCAL_TEMP:-${TMPDIR:-/tmp}/ansible-local-release-contract}" \
ANSIBLE_REMOTE_TEMP="${ANSIBLE_REMOTE_TEMP:-${TMPDIR:-/tmp}/ansible-remote-release-contract}" \
RELEASE_BUILD_CONTRACT_SHA="$SHA" \
RELEASE_BUILD_CONTRACT_OUTPUT="$TEMP_OUTPUT" \
  ansible-playbook \
    -i "$REDACTED_INVENTORY" \
    "${REDACTED_ANSIBLE_DIR}/playbooks/render-release-build-contract.yml" \
    --extra-vars "@$VAULT_PLACEHOLDERS" \
    --limit raspberrypi5 >/dev/null

python3 "${ROOT}/scripts/deploy/release_build_contract.py" validate \
  --release-sha "$SHA" <"$TEMP_OUTPUT" >"$CANONICAL_OUTPUT"
mv "$CANONICAL_OUTPUT" "$OUTPUT"
chmod 600 "$OUTPUT"
rm -rf "$REDACTED_CONTEXT_ROOT"
TEMP_OUTPUT=""
CANONICAL_OUTPUT=""
REDACTED_CONTEXT_ROOT=""
REDACTED_ANSIBLE_DIR=""
