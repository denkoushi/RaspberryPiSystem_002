#!/usr/bin/env bash
set -euo pipefail

# Single executable source for the GitHub deploy-contract job and local
# pre-push validation.  Keep the command list here so CI and developer checks
# cannot silently drift apart.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_COLLECTIONS=0

usage() {
  cat <<'EOF'
Usage: scripts/ci/run-deploy-contracts-local.sh [--install-collections]

Runs the same deployment contract, safety, inventory, and Ansible validation
used by the GitHub deploy-contract job. It never contacts managed hosts.

Options:
  --install-collections  Install the repository-required community.general
                         Ansible collection before validation.
EOF
}

while (($#)); do
  case "$1" in
    --install-collections)
      INSTALL_COLLECTIONS=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] unsupported argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

for command in bash python3 ansible-inventory ansible-playbook ansible-galaxy; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "[ERROR] required command is missing: $command" >&2
    echo "[ERROR] install ansible-core before running deploy contracts" >&2
    exit 2
  fi
done

if ((INSTALL_COLLECTIONS)); then
  ansible-galaxy collection install community.general
elif ! ansible-galaxy collection list community.general 2>/dev/null \
  | grep -Eq '^community\.general[[:space:]]'; then
  echo "[ERROR] required Ansible collection is missing: community.general" >&2
  echo "[ERROR] rerun with --install-collections" >&2
  exit 2
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/raspi-deploy-contracts.XXXXXX")"
PRODUCTION_PATH_AUDIT_OUTPUT="${PRODUCTION_PATH_AUDIT_OUTPUT:-${TEMP_DIR}/production-path-audit-report.json}"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT HUP INT TERM

cd "$ROOT_DIR"
export ADMIN_ALLOW_NETS="${ADMIN_ALLOW_NETS:-127.0.0.1/32}"

echo "[deploy-contract] parse all Ansible Jinja templates"
python3 scripts/ci/ansible_template_contracts.py

echo "[deploy-contract] shell and deployment lifecycle contracts"
bash -n scripts/update-all-clients.sh
bash -n scripts/server/deploy.sh
bash -n scripts/server/deploy-detached.sh
bash scripts/deploy/tests/test-single-deploy-entrypoint.sh
bash -n scripts/deploy/pi5-blue-green.sh
bash -n scripts/deploy/lib/pi5-blue-green/*.sh
bash -n scripts/deploy/pi5-candidate-build.sh
bash scripts/deploy/tests/test-verify-phase12-real.sh
bash scripts/deploy/tests/test-pi5-image-deploy.sh
bash scripts/deploy/tests/test-pi5-blue-green.sh
bash scripts/deploy/tests/test-pi5-blue-green-maintenance-container.sh
bash scripts/deploy/tests/test-web-static-routing.sh
python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
python3 scripts/deploy/production_path_audit.py validate
python3 scripts/deploy/production_path_incidents.py
python3 scripts/deploy/production_path_audit.py run \
  --output "$PRODUCTION_PATH_AUDIT_OUTPUT"
python3 -m json.tool "$PRODUCTION_PATH_AUDIT_OUTPUT" >/dev/null
python3 scripts/deploy/tests/test-client-agent-lifecycle-selection.py
bash scripts/deploy/tests/test-signage-deploy-maintenance.sh
bash scripts/deploy/tests/test-deploy-status-postgres-observability.sh
bash scripts/deploy/tests/test-deploy-status-postgres.sh
bash scripts/deploy/tests/test-postgres-role-boundaries.sh
bash scripts/deploy/tests/test-production-database-wiring.sh

echo "[deploy-contract] rollback and release safety contracts"
bash scripts/deploy/tests/test-deploy-safety-contracts.sh

echo "[deploy-contract] inventories and Ansible playbooks"
ANSIBLE_SOURCE_DIRECTORY="$ROOT_DIR/infrastructure/ansible"
ANSIBLE_DIRECTORY="$TEMP_DIR/ansible"
VAULT_PLACEHOLDERS="$ROOT_DIR/scripts/ci/fixtures/normal-factory-vault-placeholders.yml"
python3 "$ROOT_DIR/scripts/ci/prepare_redacted_ansible_context.py" \
  --source "$ANSIBLE_SOURCE_DIRECTORY" \
  --output "$ANSIBLE_DIRECTORY"
export ANSIBLE_CONFIG="$ANSIBLE_DIRECTORY/ansible.cfg"
export ANSIBLE_ROLES_PATH="$ANSIBLE_DIRECTORY/roles"
READ_ONLY_ANSIBLE_CONFIG="$ANSIBLE_DIRECTORY/ansible-readonly.cfg"

STATIC_PLAYBOOKS=(
  playbooks/deploy.yml
  playbooks/deploy-terminal-profile.yml
  playbooks/server-config-release.yml
  playbooks/prepare-pi5-runtime-permissions.yml
  playbooks/prepare-pi5-database-roles.yml
  playbooks/prepare-pi5-admin-network-policy.yml
  playbooks/prepare-client-local-ca-trust.yml
  playbooks/activate-pi5-local-ca-certificate.yml
  playbooks/verify-client-local-tls.yml
  playbooks/update-clients.yml
  playbooks/health-check.yml
  playbooks/manage-system-configs.yml
  playbooks/manage-app-configs.yml
  playbooks/rollback.yml
  playbooks/restart-services.yml
  playbooks/ping.yml
  playbooks/resolve-pi4-recovery-contract.yml
  playbooks/recover-pi4.yml
  playbooks/recover-pi4-verify.yml
)
TERMINAL_PROFILE_PLAYBOOKS=()
while IFS= read -r playbook; do
  [[ -n "$playbook" ]] && TERMINAL_PROFILE_PLAYBOOKS+=("$playbook")
done < <(
  python3 "$ROOT_DIR/scripts/deploy/terminal_profile_contracts.py" --list-playbooks
)

cd "$ANSIBLE_DIRECTORY"
python3 "$ROOT_DIR/scripts/deploy/tests/test_recover_pi4.py"
for inventory in inventory.yml inventory-talkplaza.yml; do
  output="$TEMP_DIR/${inventory%.yml}.json"
  ANSIBLE_CONFIG="$READ_ONLY_ANSIBLE_CONFIG" \
    ansible-inventory -i "$inventory" \
      --extra-vars "@$VAULT_PLACEHOLDERS" \
      --list > "$output"
  python3 -m json.tool "$output" >/dev/null
done
python3 "$ROOT_DIR/scripts/deploy/terminal_profile_contracts.py" \
  --inventory-json "$TEMP_DIR/inventory.json" \
  --inventory-json "$TEMP_DIR/inventory-talkplaza.json"
for playbook in "${STATIC_PLAYBOOKS[@]}" "${TERMINAL_PROFILE_PLAYBOOKS[@]}"; do
  ansible-playbook --syntax-check "$playbook" -i inventory.yml \
    --extra-vars "@$VAULT_PLACEHOLDERS"
done
for playbook in playbooks/deploy-terminal-profile.yml "${TERMINAL_PROFILE_PLAYBOOKS[@]}"; do
  ansible-playbook --syntax-check "$playbook" -i inventory-talkplaza.yml \
    --extra-vars "@$VAULT_PLACEHOLDERS"
done
ansible-playbook --check \
  -i "$ROOT_DIR/scripts/deploy/tests/fixtures/recovery-check-inventory.yml" \
  playbooks/recover-pi4-verify.yml \
  -e recovery_authorized=true

echo "[deploy-contract] all checks passed"
