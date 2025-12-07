#!/bin/bash
set -euo pipefail

# Unit test for impact-analyzer.sh
# - Works in an isolated temp repo
# - Validates config change (network_mode) and code change (signage service)

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/impact-analyzer.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this test." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pushd "$TMP" >/dev/null
git init -q
git config user.name "Test User"
git config user.email test@example.com

# config-impact-map.yml
mkdir -p infrastructure/ansible
cat > infrastructure/ansible/config-impact-map.yml <<'YML'
config_impact_map:
  network_mode:
    impact: [server, pi4_kiosk, pi3_signage, nfc_agent]
    reason: "ネットワーク設定は全コンポーネントに影響"
YML

# dependency-map.yml
cat > infrastructure/ansible/dependency-map.yml <<'YML'
dependency_map:
  module_dependencies:
    tools:
      depends_on: []
      reason: "独立"
    signage:
      depends_on: [tools]
      reason: "toolsに依存"
    kiosk:
      depends_on: [tools]
      reason: "toolsに依存"
YML

# config change input
cat > /tmp/input-config.json <<'JSON'
{
  "config_changes": [
    {
      "path": "infrastructure/ansible/group_vars/all.yml",
      "changed_keys": ["network_mode"],
      "old_values": {},
      "new_values": {},
      "change_type": "modified"
    }
  ],
  "code_changes": []
}
JSON

export REPO_ROOT="$TMP"
out_cfg=$(cat /tmp/input-config.json | "$SCRIPT")
echo "$out_cfg" | jq -e '.impact_scope.server == true' >/dev/null
echo "$out_cfg" | jq -e '.impact_scope.pi4_kiosk == true' >/dev/null
echo "$out_cfg" | jq -e '.impact_scope.pi3_signage == true' >/dev/null

# code change (signage service) input
cat > /tmp/input-code.json <<'JSON'
{
  "config_changes": [],
  "code_changes": [
    {
      "path": "apps/api/src/services/signage/signage.service.ts",
      "change_type": "modified"
    }
  ]
}
JSON

out_code=$(cat /tmp/input-code.json | "$SCRIPT")
echo "$out_code" | jq -e '.impact_scope.pi3_signage == true' >/dev/null
echo "$out_code" | jq -e '.impact_scope.server == true' >/dev/null

echo "impact-analyzer unit test: OK"
popd >/dev/null

