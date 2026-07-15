#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MAIN_INVENTORY="${ROOT_DIR}/infrastructure/ansible/inventory.yml"
TALKPLAZA_INVENTORY="${ROOT_DIR}/infrastructure/ansible/inventory-talkplaza.yml"
PLAYBOOK="${ROOT_DIR}/infrastructure/ansible/playbooks/deploy-staged.yml"
ROLLBACK_TASKS="${ROOT_DIR}/infrastructure/ansible/tasks/rollback-configs.yml"
ORCHESTRATION_GUARD="${ROOT_DIR}/infrastructure/ansible/tasks/assert-release-orchestration.yml"

command -v ansible-inventory >/dev/null 2>&1 || {
  echo "[ERROR] ansible-inventory is required" >&2
  exit 1
}
command -v ansible-playbook >/dev/null 2>&1 || {
  echo "[ERROR] ansible-playbook is required" >&2
  exit 1
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

render_inventory_contract() {
  local name="$1"
  local inventory="$2"
  env -u ANSIBLE_CONFIG ansible-inventory -i "${inventory}" --list \
    > "${TMP_DIR}/${name}-inventory.json"
  env -u ANSIBLE_CONFIG \
    ANSIBLE_ROLES_PATH="${ROOT_DIR}/infrastructure/ansible/roles" \
    RELEASE_ORCHESTRATED=1 \
    ansible-playbook -i "${inventory}" "${PLAYBOOK}" --list-hosts \
    > "${TMP_DIR}/${name}-playbook-hosts.txt"
}

render_inventory_contract main "${MAIN_INVENTORY}"
render_inventory_contract talkplaza "${TALKPLAZA_INVENTORY}"

GUARD_PLAYBOOK="${TMP_DIR}/orchestration-guard-test.yml"
python3 - "${GUARD_PLAYBOOK}" "${ORCHESTRATION_GUARD}" <<'PY'
import json
import sys
from pathlib import Path

path, guard = sys.argv[1:]
Path(path).write_text(f'''---
- name: Exercise direct deployment guard
  hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - ansible.builtin.include_tasks: {json.dumps(guard)}
''', encoding='utf-8')
PY

if env -u ANSIBLE_CONFIG ansible-playbook -i localhost, "${GUARD_PLAYBOOK}" >/dev/null 2>&1; then
  echo "[ERROR] direct deployment guard accepted an unorchestrated run" >&2
  exit 1
fi
if env -u ANSIBLE_CONFIG ansible-playbook -i localhost, "${GUARD_PLAYBOOK}" \
  -e release_emergency_override=true >/dev/null 2>&1; then
  echo "[ERROR] emergency policy bypassed the rolling-release coordinator" >&2
  exit 1
fi
env -u ANSIBLE_CONFIG ansible-playbook -i localhost, "${GUARD_PLAYBOOK}" \
  -e release_orchestrated=true >/dev/null

python3 - "${TMP_DIR}" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
for name in ('main', 'talkplaza'):
    inventory = json.loads((root / f'{name}-inventory.json').read_text(encoding='utf-8'))
    assert inventory['clients']['children'] == ['kiosk', 'signage'], name
    hostvars = inventory['_meta']['hostvars']
    groups = {
        group: inventory[group]['hosts']
        for group in ('server', 'kiosk', 'signage')
    }
    assert not (set(groups['kiosk']) & set(groups['signage'])), name
    assert set(groups['kiosk']) == {
        host for host, values in hostvars.items()
        if values.get('manage_kiosk_browser') is True
    }, name
    assert set(groups['signage']) == {
        host for host, values in hostvars.items()
        if values.get('manage_signage_lite') is True
    }, name
    assert set((inventory.get('kiosk_canary') or {}).get('hosts') or []) <= set(groups['kiosk']), name
    assert set((inventory.get('signage_canary') or {}).get('hosts') or []) <= set(groups['signage']), name
    release_hosts = groups['kiosk'] + groups['signage']
    client_ids = [hostvars[host].get('status_agent_client_id') for host in release_hosts]
    assert all(isinstance(client_id, str) and client_id for client_id in client_ids), name
    assert len(client_ids) == len(set(client_ids)), name

    listed = (root / f'{name}-playbook-hosts.txt').read_text(encoding='utf-8')
    for group, expected_hosts in groups.items():
        match = re.search(
            rf"play #[0-9]+ \({group}\):.*?hosts \(([0-9]+)\):(?P<body>.*?)(?=\n\s*play #|\Z)",
            listed,
            re.DOTALL,
        )
        assert match, f'{name}: missing {group} play'
        listed_hosts = [line.strip() for line in match.group('body').splitlines() if line.strip()]
        assert int(match.group(1)) == len(expected_hosts), (name, group, listed_hosts)
        assert set(listed_hosts) == set(expected_hosts), (name, group, listed_hosts)

talkplaza = json.loads((root / 'talkplaza-inventory.json').read_text(encoding='utf-8'))
assert talkplaza['kiosk']['hosts'] == ['talkplaza-pi4']
assert talkplaza['signage']['hosts'] == ['talkplaza-signage01']
PY

BACKUP_DIR="${TMP_DIR}/backups"
UNIT_DIR="${TMP_DIR}/systemd"
POLKIT_DEST="${TMP_DIR}/polkit/50-pcscd-allow-all.rules"
mkdir -p "${BACKUP_DIR}" "${UNIT_DIR}" "$(dirname "${POLKIT_DEST}")"

write_backup() {
  local name="$1"
  local content="$2"
  printf '%s\n' "${content}" > "${BACKUP_DIR}/${name}"
}

for unit in status-agent.service status-agent.timer kiosk-browser.service signage-lite.service; do
  write_backup "${unit}.20260715_010101" "old:${unit}"
done
write_backup "polkit-50-pcscd-allow-all.rules.20260715_010101" "old:polkit"

for unit in status-agent.service status-agent.timer kiosk-browser.service; do
  write_backup "${unit}.20260715_020202" "selected:${unit}"
done
write_backup "polkit-50-pcscd-allow-all.rules.20260715_020202" "selected:polkit"

# These look newer but are not complete YYYYMMDD_HHMMSS backup-set names.
write_backup "status-agent.service.20260715_999999.extra" "malformed:status-agent.service"
write_backup "signage-lite.service.latest" "malformed:signage-lite.service"
write_backup "unmanaged.service.20990101_010101" "unmanaged:newer-set"
write_backup "polkit-50-pcscd-allow-all.rules.20990101_010101" "unmanaged:newer-polkit"

for unit in status-agent.service status-agent.timer kiosk-browser.service signage-lite.service; do
  printf 'sentinel:%s\n' "${unit}" > "${UNIT_DIR}/${unit}"
done
printf 'sentinel:polkit\n' > "${POLKIT_DEST}"

ROLLBACK_PLAYBOOK="${TMP_DIR}/rollback-test.yml"
python3 - "${ROLLBACK_PLAYBOOK}" "${ROLLBACK_TASKS}" "${BACKUP_DIR}" "${UNIT_DIR}" \
  "${POLKIT_DEST}" "$(id -un)" "$(id -gn)" <<'PY'
import json
import sys
from pathlib import Path

path, tasks, backup, units, polkit, owner, group = sys.argv[1:]
content = f'''---
- name: Exercise rollback backup-set selection
  hosts: localhost
  connection: local
  gather_facts: false
  vars:
    backup_dir: {json.dumps(backup)}
    backup_service_files:
      - status-agent.service
      - status-agent.timer
      - kiosk-browser.service
      - signage-lite.service
    systemd_unit_dir: {json.dumps(units)}
    rollback_polkit_path: {json.dumps(polkit)}
    rollback_unit_owner: {json.dumps(owner)}
    rollback_unit_group: {json.dumps(group)}
    rollback_reload_systemd: false
  tasks:
    - ansible.builtin.include_tasks: {json.dumps(tasks)}
  handlers:
    - name: restart pcscd
      ansible.builtin.debug:
        msg: test handler
'''
Path(path).write_text(content, encoding='utf-8')
PY

env -u ANSIBLE_CONFIG ansible-playbook -i localhost, "${ROLLBACK_PLAYBOOK}" >/dev/null

test "$(cat "${UNIT_DIR}/status-agent.service")" = "selected:status-agent.service"
test "$(cat "${UNIT_DIR}/status-agent.timer")" = "selected:status-agent.timer"
test "$(cat "${UNIT_DIR}/kiosk-browser.service")" = "selected:kiosk-browser.service"
test "$(cat "${UNIT_DIR}/signage-lite.service")" = "sentinel:signage-lite.service"
test "$(cat "${POLKIT_DEST}")" = "selected:polkit"

# Automatic rescue must restore its own timestamp even if a newer valid set exists.
for unit in status-agent.service status-agent.timer kiosk-browser.service signage-lite.service; do
  write_backup "${unit}.20260715_030303" "newer:${unit}"
  printf 'reset:%s\n' "${unit}" > "${UNIT_DIR}/${unit}"
done
write_backup "polkit-50-pcscd-allow-all.rules.20260715_030303" "newer:polkit"
printf 'reset:polkit\n' > "${POLKIT_DEST}"

env -u ANSIBLE_CONFIG ansible-playbook -i localhost, "${ROLLBACK_PLAYBOOK}" \
  -e backup_timestamp=20260715_010101 >/dev/null

for unit in status-agent.service status-agent.timer kiosk-browser.service signage-lite.service; do
  test "$(cat "${UNIT_DIR}/${unit}")" = "old:${unit}"
done
test "$(cat "${POLKIT_DEST}")" = "old:polkit"

NO_MANAGED_SET="${TMP_DIR}/no-managed-set"
mkdir -p "${NO_MANAGED_SET}"
printf 'polkit-only\n' > "${NO_MANAGED_SET}/polkit-50-pcscd-allow-all.rules.20990101_010101"
if env -u ANSIBLE_CONFIG ansible-playbook -i localhost, "${ROLLBACK_PLAYBOOK}" \
  -e "backup_dir=${NO_MANAGED_SET}" >/dev/null 2>&1; then
  echo "[ERROR] rollback accepted a set with no configured service/timer backup" >&2
  exit 1
fi

echo "deploy safety contract tests passed"
