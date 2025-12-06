#!/bin/bash
set -euo pipefail

# Unit test for change-detector.sh
# - Works in an isolated temp repo
# - Verifies detection of config key change and code file change

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/change-detector.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this test." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pushd "$TMP" >/dev/null
git init -q
git config user.name "Test User"
git config user.email "test@example.com"

mkdir -p infrastructure/ansible/group_vars
cat > infrastructure/ansible/group_vars/all.yml <<'YML'
network_mode: local
server_ip: 192.168.10.10
YML

mkdir -p apps/api/src/services
echo "// api service" > apps/api/src/services/foo.ts

git add .
git commit -qm "init"

# Modify config and code
cat > infrastructure/ansible/group_vars/all.yml <<'YML'
network_mode: tailscale
server_ip: 192.168.10.10
YML
echo "// api service modified" > apps/api/src/services/foo.ts

export REPO_ROOT="$TMP"
output=$("$SCRIPT")

echo "$output" | jq -e '.config_changes[0].path == "infrastructure/ansible/group_vars/all.yml"' >/dev/null
echo "$output" | jq -e '.config_changes[0].changed_keys | index("network_mode")' >/dev/null
echo "$output" | jq -e '.code_changes[] | select(.path == "apps/api/src/services/foo.ts")' >/dev/null

echo "change-detector unit test: OK"
popd >/dev/null

