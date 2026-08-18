#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NFC_LIFECYCLE_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/client/tasks/nfc-agent-lifecycle.yml"
TERMINAL_AGENT_HEALTH="${ROOT_DIR}/scripts/deploy/terminal-agent-health-probe.py"
SERVER_DEFAULTS="${ROOT_DIR}/infrastructure/ansible/roles/server/defaults/main.yml"
SERVER_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/server/tasks/main.yml"
SERVER_HANDLERS="${ROOT_DIR}/infrastructure/ansible/roles/server/handlers/main.yml"
MANAGE_APP_CONFIGS="${ROOT_DIR}/infrastructure/ansible/playbooks/manage-app-configs.yml"
COMMON_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/common/tasks/main.yml"
STANDARD_PLAYBOOK="${ROOT_DIR}/infrastructure/ansible/playbooks/deploy-release-standard.yml"

python3 - "${NFC_LIFECYCLE_TASKS}" "${TERMINAL_AGENT_HEALTH}" \
  "${SERVER_DEFAULTS}" "${SERVER_TASKS}" "${SERVER_HANDLERS}" \
  "${MANAGE_APP_CONFIGS}" "${COMMON_TASKS}" "${STANDARD_PLAYBOOK}" <<'PY'
import sys
from pathlib import Path

import yaml

(
    nfc_path,
    health_path,
    server_defaults_path,
    server_tasks_path,
    server_handlers_path,
    manage_app_path,
    common_path,
    standard_path,
) = map(Path, sys.argv[1:])

for path in (
    nfc_path,
    health_path,
    server_defaults_path,
    server_tasks_path,
    server_handlers_path,
    manage_app_path,
    common_path,
    standard_path,
):
    assert path.is_file(), f"missing deployment contract file: {path}"

nfc = nfc_path.read_text(encoding="utf-8")
assert "pcscd.socket" in nfc
assert "systemctl is-enabled --quiet pcscd.service" not in nfc
assert "systemctl is-active --quiet pcscd.service" not in nfc

health = health_path.read_text(encoding="utf-8")
assert "pcscd.socket" in health
assert "pcscd.comm" in health
assert "pcscd.service" not in health

server = server_tasks_path.read_text(encoding="utf-8")
for forbidden in (
    "pi5-image-deploy.sh",
    "pi5-candidate-build.sh",
    "pi5-candidate-reconcile.sh",
    "pi5-blue-green.sh",
    "pi5-phase3-legacy-guard.sh",
    "docker compose",
    "prisma migrate",
):
    assert forbidden not in server, f"server role still owns retired path: {forbidden}"

for path in (server_defaults_path, server_handlers_path, manage_app_path, common_path):
    text = path.read_text(encoding="utf-8")
    assert "backup_timestamp" not in text, f"retired timestamp state remains: {path}"
    assert "backup_service_files" not in text, f"retired backup state remains: {path}"

plays = yaml.safe_load(standard_path.read_text(encoding="utf-8")) or []
assert [play.get("hosts") for play in plays] == [
    "server", "kiosk", "kiosk", "server", "kiosk", "kiosk", "server",
    "server", "kiosk", "kiosk", "signage"
]
assert [play.get("serial") for play in plays if "serial" in play] == [1, 1, 1]
role_plays = [play for play in plays if play.get("roles")]
assert [play.get("roles", [{}])[0].get("role") for play in role_plays] == [
    "release_pi5",
    "release_kiosk",
    "release_signage",
]
cutover_plays = [play for play in plays if "torque-cutover" in play.get("tags", [])]
assert [play.get("hosts") for play in cutover_plays] == [
    "server", "kiosk", "kiosk", "server", "kiosk", "kiosk", "server", "kiosk"
]
cutover_names = [play.get("name") for play in cutover_plays]
assert cutover_names.index("Aggregate PREPARED before any torque endpoint stops") < cutover_names.index(
    "Quiesce all selected torque ownership endpoints before the API changes"
)
assert cutover_names.index("Finalize QUIESCED before changing the control plane") < [
    play.get("name") for play in plays
].index("Prepare and switch the Pi5 control plane")
PY

echo "deploy safety contract tests passed"
