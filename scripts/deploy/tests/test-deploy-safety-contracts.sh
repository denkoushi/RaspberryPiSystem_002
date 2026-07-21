#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MAIN_INVENTORY="${ROOT_DIR}/infrastructure/ansible/inventory.yml"
TALKPLAZA_INVENTORY="${ROOT_DIR}/infrastructure/ansible/inventory-talkplaza.yml"
PLAYBOOK="${ROOT_DIR}/infrastructure/ansible/playbooks/deploy-staged.yml"
SERVER_CONFIG_PLAYBOOK="${ROOT_DIR}/infrastructure/ansible/playbooks/server-config-release.yml"
LEGACY_DEPLOY_PLAYBOOK="${ROOT_DIR}/infrastructure/ansible/playbooks/deploy.yml"
STANDALONE_ROLLBACK_PLAYBOOK="${ROOT_DIR}/infrastructure/ansible/playbooks/rollback.yml"
ROLLBACK_TASKS="${ROOT_DIR}/infrastructure/ansible/tasks/rollback-configs.yml"
COMMON_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/common/tasks/main.yml"
ORCHESTRATION_GUARD="${ROOT_DIR}/infrastructure/ansible/tasks/assert-release-orchestration.yml"
TERMINAL_RELEASE_GUARD="${ROOT_DIR}/infrastructure/ansible/tasks/assert-terminal-release-mode.yml"
SERVER_DEFAULTS="${ROOT_DIR}/infrastructure/ansible/roles/server/defaults/main.yml"
SERVER_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/server/tasks/main.yml"
SERVER_HANDLERS="${ROOT_DIR}/infrastructure/ansible/roles/server/handlers/main.yml"
UPDATE_CLIENTS_CORE="${ROOT_DIR}/infrastructure/ansible/tasks/update-clients-core.yml"
RESTART_CLIENT_SERVICE="${ROOT_DIR}/infrastructure/ansible/tasks/restart-client-service.yml"
TERMINAL_DISPLAY_PREFLIGHT="${ROOT_DIR}/infrastructure/ansible/tasks/preflight-terminal-display.yml"
SIGNAGE_PRESTAGE="${ROOT_DIR}/infrastructure/ansible/tasks/prestage-signage-runtime.yml"
CLIENT_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/client/tasks/main.yml"
NFC_LIFECYCLE_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/client/tasks/nfc-agent-lifecycle.yml"
RELEASE_APPLICATION="${ROOT_DIR}/scripts/deploy/rolling_release/application.py"
TERMINAL_PREFLIGHT="${ROOT_DIR}/scripts/deploy/rolling_release/terminal_preflight.py"
TERMINAL_AGENT_HEALTH="${ROOT_DIR}/scripts/deploy/terminal-agent-health-probe.py"
KIOSK_FIREFOX_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/kiosk/tasks/firefox-chrome.yml"
SIGNAGE_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/signage/tasks/main.yml"
KIOSK_LAUNCH_TEMPLATE="${ROOT_DIR}/infrastructure/ansible/templates/kiosk-launch.sh.j2"
SIGNAGE_DISPLAY_TEMPLATES=(
  "${ROOT_DIR}/infrastructure/ansible/templates/signage-display.sh.j2"
  "${ROOT_DIR}/infrastructure/ansible/roles/signage/templates/signage-display.sh.j2"
)

python3 - "${RELEASE_APPLICATION}" "${TERMINAL_PREFLIGHT}" "${NFC_LIFECYCLE_TASKS}" "${TERMINAL_AGENT_HEALTH}" <<'PY'
import sys
from pathlib import Path

application_path, preflight_path, nfc_path, agent_health_path = map(Path, sys.argv[1:])
application = application_path.read_text(encoding='utf-8')
preflight = preflight_path.read_text(encoding='utf-8')
nfc = nfc_path.read_text(encoding='utf-8')

migration = application.index('systemd.preflight_migrations(spec)')
terminal = application.index('systemd.preflight_terminals(')
submission = application.index('systemd.start(spec, wait=not args.detach)')
assert migration < terminal < submission, (
    'migration and aggregate terminal preflights must both precede release-unit submission'
)
assert 'no release unit was submitted' in preflight
assert 'for target in spec["targets"]' in preflight
assert 'results.append(result)' in preflight
assert 'os.O_CREAT' not in preflight
assert 'os.makedirs' not in preflight
assert 'UserKnownHostsFile=/dev/null' in preflight
assert 'candidate.artifact-missing' in preflight
assert '"cat-file", "-t"' in preflight
assert '_require_directory(issues, f"{repo}/clients/' not in preflight
assert 'pcscd.socket' in preflight
assert '_require_unit(issues, "pcscd.service"' not in preflight
assert 'pcscd.socket' in nfc
assert 'systemctl is-enabled --quiet pcscd.service' not in nfc
assert 'systemctl is-active --quiet pcscd.service' not in nfc
agent_health = agent_health_path.read_text(encoding='utf-8')
assert 'pcscd.socket' in agent_health
assert 'pcscd.comm' in agent_health
assert 'pcscd.service' not in agent_health
PY

python3 - "${ROOT_DIR}" <<'PY'
import importlib.util
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
facade_path = root / 'scripts/deploy/rolling-release.py'
wrapper_path = root / 'scripts/deploy/pi5-candidate-reconcile.sh'
executor_path = root / 'scripts/deploy/pi5-image-deploy.sh'

spec = importlib.util.spec_from_file_location('rolling_release_contract', facade_path)
assert spec is not None and spec.loader is not None
facade = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = facade
spec.loader.exec_module(facade)

calls = []
facade.run = lambda command, **options: calls.append((command, options))
facade.reconcile_pi5_candidate_workload()
assert calls == [([str(facade.PI5_CANDIDATE_RECONCILE)], {})], (
    'pre-plan Pi5 reconcile facade no longer invokes its dedicated adapter exactly once'
)

wrapper = ' '.join(
    wrapper_path.read_text(encoding='utf-8').replace('\\\n', '').split()
)
assert wrapper.endswith(
    'exec env PI5_DEPLOY_SKIP_PHASE3_LEGACY_GUARD=1 '
    '"${SCRIPT_DIR}/pi5-image-deploy.sh" reconcile-workload'
), 'candidate reconcile wrapper lost its env-scoped exec boundary'

executor = executor_path.read_text(encoding='utf-8')
assert 'reconcile-workload) reconcile_candidate_build_residue ;;' in executor, (
    'reconcile-workload no longer dispatches to candidate residue recovery'
)
match = re.search(
    r'^reconcile_candidate_build_residue\(\) \{\n(?P<body>.*?)^\}',
    executor,
    flags=re.MULTILINE | re.DOTALL,
)
assert match is not None, 'candidate residue recovery function is unavailable'
body = match.group('body')
owner = body.index('reconcile_signage_pause_owner')
containers = body.index('cleanup_orphan_candidate_validation_containers')
assert owner < containers, (
    'signage pause ownership must reconcile before orphan candidate cleanup'
)
PY

if grep -Eq 'status_code:[[:space:]]*\[[^]]*401|until:.*401|failed_when:[[:space:]]*false.*401' \
  "${UPDATE_CLIENTS_CORE}"; then
  echo "[ERROR] terminal endpoint health must fail closed on HTTP 401" >&2
  exit 1
fi

python3 - "${RESTART_CLIENT_SERVICE}" "${ROOT_DIR}" <<'PY'
import re
import sys
from pathlib import Path

import yaml

path = Path(sys.argv[1])
repository_root = Path(sys.argv[2])
tasks = yaml.safe_load(path.read_text(encoding='utf-8')) or []
guard = tasks[0]
assert guard.get('name') == (
    'Require restart target to be sealed by the terminal runtime manifest'
)
assert "terminal_release_mode | default('full') == 'release-only'" in guard['when']
contract = ' '.join(str(value) for value in guard['ansible.builtin.assert']['that'])
for unit in (
    'lightdm.service', 'status-agent.service', 'status-agent.timer',
    'haizen-agent.service', 'kiosk-browser.service', 'signage-lite.service',
    'signage-lite-update.service', 'signage-lite-update.timer',
    'signage-lite-watchdog.service', 'signage-lite-watchdog.timer',
    'signage-daily-reboot.service', 'signage-daily-reboot.timer',
):
    assert unit in contract, f'{path}: runtime manifest restart guard lost {unit}'
assert 'manage_kiosk_browser' in contract
assert 'manage_signage_lite' in contract
sys.path.insert(0, str(repository_root))
from scripts.deploy.rolling_release.backends import ansible as deploy_ansible

guard_units = set(re.findall(r'[A-Za-z0-9_-]+\.(?:service|timer)', contract))
kiosk_units, _ = deploy_ansible._terminal_runtime_contract('kiosk')
signage_units, _ = deploy_ansible._terminal_runtime_contract('signage')
assert guard_units == set(kiosk_units) | set(signage_units), (
    'Ansible restart allowlist and coordinator runtime manifest disagree: '
    f'{sorted(guard_units ^ (set(kiosk_units) | set(signage_units)))}'
)
PY

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

TERMINAL_GUARD_PLAYBOOK="${TMP_DIR}/terminal-release-guard-test.yml"
python3 - "${TERMINAL_GUARD_PLAYBOOK}" "${TERMINAL_RELEASE_GUARD}" <<'PY'
import json
import sys
from pathlib import Path

path, guard = sys.argv[1:]
Path(path).write_text(f'''---
- name: Exercise terminal release mutation-profile guard
  hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - ansible.builtin.include_tasks: {json.dumps(guard)}
''', encoding='utf-8')
PY

FULL_SHA=1111111111111111111111111111111111111111
if env -u ANSIBLE_CONFIG RELEASE_ORCHESTRATED=1 \
  ansible-playbook -i localhost, "${TERMINAL_GUARD_PLAYBOOK}" \
  -e release_orchestrated=true -e repo_version="${FULL_SHA}" >/dev/null 2>&1; then
  echo "[ERROR] terminal release guard accepted an omitted mutation profile" >&2
  exit 1
fi
if env -u ANSIBLE_CONFIG RELEASE_ORCHESTRATED=1 \
  ansible-playbook -i localhost, "${TERMINAL_GUARD_PLAYBOOK}" \
  -e release_orchestrated=true -e terminal_release_mode=full \
  -e repo_version="${FULL_SHA}" >/dev/null 2>&1; then
  echo "[ERROR] terminal release guard accepted provisioning mode" >&2
  exit 1
fi
if env -u ANSIBLE_CONFIG RELEASE_ORCHESTRATED=1 \
  ansible-playbook -i localhost, "${TERMINAL_GUARD_PLAYBOOK}" \
  -e release_orchestrated=true -e terminal_release_mode=release-only \
  -e repo_version=main >/dev/null 2>&1; then
  echo "[ERROR] terminal release guard accepted a mutable repository target" >&2
  exit 1
fi
env -u ANSIBLE_CONFIG RELEASE_ORCHESTRATED=1 \
  ansible-playbook -i localhost, "${TERMINAL_GUARD_PLAYBOOK}" \
  -e release_orchestrated=true -e terminal_release_mode=release-only \
  -e repo_version="${FULL_SHA}" >/dev/null

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

python3 - "${SERVER_DEFAULTS}" "${SERVER_TASKS}" "${SERVER_HANDLERS}" \
  "${SERVER_CONFIG_PLAYBOOK}" "${ROOT_DIR}/infrastructure/ansible" <<'PY'
import re
import sys
from pathlib import Path

import yaml

defaults_path, tasks_path, handlers_path, playbook_path, ansible_root = map(
    Path, sys.argv[1:]
)
ansible_root = ansible_root.resolve()
defaults = defaults_path.read_text(encoding='utf-8')
tasks = tasks_path.read_text(encoding='utf-8')

assert re.search(r'^server_release_mode:\s*full\s*$', defaults, re.MULTILINE)
assert "server_release_mode in ['full', 'host-config-only']" in tasks
assert 'Reject retired Ansible-owned Pi5 release executors' in tasks
assert 'pi5-image-deploy.sh' not in tasks
assert 'pi5-candidate-build.sh' not in tasks
assert 'pi5-blue-green.sh prepare' not in tasks
assert 'pi5-blue-green.sh switch' not in tasks

tasks_dir = tasks_path.parent.resolve()
task_paths = {path.resolve() for path in tasks_dir.glob('*.yml')}
assert tasks_path.resolve() in task_paths

FULL_GUARDS = {
    "server_release_mode == 'full'",
    "server_release_mode | default('full') == 'full'",
}
IMPORT_MODULES = {
    'ansible.builtin.import_tasks',
    'ansible.builtin.include_tasks',
    'import_tasks',
    'include_tasks',
}
ROLE_IMPORT_MODULES = {
    'ansible.builtin.import_role',
    'ansible.builtin.include_role',
    'import_role',
    'include_role',
}
EFFECTFUL_MODULES = {
    'ansible.builtin.shell',
    'ansible.builtin.command',
    'ansible.builtin.raw',
    'ansible.builtin.script',
    'ansible.builtin.uri',
    'ansible.builtin.wait_for',
    'ansible.builtin.systemd',
    'ansible.builtin.systemd_service',
    'ansible.builtin.service',
    'shell',
    'command',
    'raw',
    'script',
    'uri',
    'wait_for',
    'systemd',
    'systemd_service',
    'service',
    *IMPORT_MODULES,
    *ROLE_IMPORT_MODULES,
}
CONTAINER_MODULES = {
    'docker_compose',
    'docker_compose_v2',
    'docker_container',
    'docker_image',
    'podman_container',
    'podman_image',
}
RESCUE_TASK_NAME = (
    'Rescue measuring instrument genre images from api container before recreate'
)

def normalized(value):
    return ' '.join(str(value).split())


def when_items(task):
    conditions = task.get('when', [])
    return [conditions] if isinstance(conditions, str) else list(conditions or [])


def has_full_guard(task):
    return any(normalized(condition) in FULL_GUARDS for condition in when_items(task))


def module_entries(task):
    return [
        (key, value)
        for key, value in task.items()
        if key in EFFECTFUL_MODULES
        or key in CONTAINER_MODULES
        or key.startswith('community.docker.')
        or key.startswith('containers.podman.')
    ]


def flattened(value):
    if isinstance(value, dict):
        return ' '.join(flattened(item) for pair in value.items() for item in pair)
    if isinstance(value, list):
        return ' '.join(flattened(item) for item in value)
    return str(value)


COMPOSE_LIFECYCLE = re.compile(
    r'\bdocker\s+compose\b[^\n]*(?:'
    r'\bup\b|\bdown\b|\bbuild\b|\bstart\b|\brestart\b|\bstop\b|'
    r'\bkill\b|\brm\b|\bcreate\b|\brun\b|\bexec\b|\bpull\b|\bpush\b'
    r')',
    re.IGNORECASE,
)
DOCKER_LIFECYCLE = re.compile(
    r'\bdocker\s+(?!compose\b)(?:exec|cp|run|start|restart|stop|kill|rm|'
    r'create|build|load|import|pull|push|tag|commit|update|rename)\b',
    re.IGNORECASE,
)
DEPLOY_ENTRYPOINT = re.compile(
    r'(?:^|/)scripts/deploy/[A-Za-z0-9_.-]+', re.IGNORECASE | re.MULTILINE
)
PRISMA = re.compile(r'\bprisma\s+migrate\b', re.IGNORECASE)
SYSTEMCTL_RUNTIME = re.compile(
    r'\bsystemctl\s+(?:start|restart|stop|reload)\b[^\n]*'
    r'(?:api|web|docker|compose|release|deploy|blue[-_]?green)',
    re.IGNORECASE,
)
RUNTIME_UNIT = re.compile(
    r'(?:api|web|docker|compose|release|deploy|blue[-_]?green)', re.IGNORECASE
)
RISKY_IMPORT_NAME = re.compile(
    r'(?:deploy|release|runtime|executor|candidate|migration|docker|container|pi5)',
    re.IGNORECASE,
)


def runtime_reasons(task, module, module_value):
    if module not in EFFECTFUL_MODULES and not (
        module in CONTAINER_MODULES
        or module.startswith('community.docker.')
        or module.startswith('containers.podman.')
    ):
        return set()

    payload = flattened(module_value)
    command_payload = re.sub(r'\\[ \t]*\n[ \t]*', ' ', payload)
    text = '\n'.join((str(task.get('name', '')), payload))
    reasons = set()
    if COMPOSE_LIFECYCLE.search(command_payload):
        reasons.add('Docker Compose lifecycle')
    if DOCKER_LIFECYCLE.search(command_payload):
        reasons.add('Docker lifecycle')
    read_only_signage_proof = (
        task.get('name')
        == 'Verify authenticated signage endpoints with the host-local credential'
        and command_payload.endswith(
            'scripts/deploy/signage-runtime-proof.py --check-endpoints'
        )
        and '--refresh-image' not in command_payload
        and '--seal-maintenance-image' not in command_payload
    )
    if DEPLOY_ENTRYPOINT.search(command_payload) and not read_only_signage_proof:
        reasons.add('deploy script entrypoint')
    if PRISMA.search(command_payload):
        reasons.add('Prisma migration')
    if (
        'api_healthcheck_url' in text
        or 'api_health_result' in text
        or task.get('name') == 'Wait for API health endpoint to recover'
    ):
        reasons.add('legacy API health')
    if (
        task.get('name')
        == 'Verify API container environment variables after .env update'
        or ('printenv' in text and re.search(r'\bapi\b', text, re.IGNORECASE))
    ):
        reasons.add('legacy API environment verification')
    if SYSTEMCTL_RUNTIME.search(command_payload):
        reasons.add('runtime systemctl lifecycle')
    if module in {
        'ansible.builtin.systemd',
        'ansible.builtin.systemd_service',
        'ansible.builtin.service',
        'systemd',
        'systemd_service',
        'service',
    } and isinstance(module_value, dict):
        state = normalized(module_value.get('state', '')).lower()
        unit = flattened(module_value.get('name', ''))
        if state in {'started', 'restarted', 'stopped', 'reloaded'} and RUNTIME_UNIT.search(unit):
            reasons.add('runtime systemd lifecycle')
    if (
        module in CONTAINER_MODULES
        or module.startswith('community.docker.')
        or module.startswith('containers.podman.')
    ):
        reasons.add('container runtime module')
    if module in ROLE_IMPORT_MODULES:
        reasons.add('role import crosses the server task boundary')
    if module in IMPORT_MODULES:
        target = import_target(module_value)
        if target is None or RISKY_IMPORT_NAME.search(target):
            reasons.add('unknown or runtime-shaped task import')
    return reasons


def import_target(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get('file'), str):
        return value['file']
    return None


def validate_rescue_task(task, module, module_value):
    assert module == 'ansible.builtin.shell', (
        'genre-image rescue must remain one auditable shell task'
    )
    conditions = when_items(task)
    assert len(conditions) == 1, (
        'host-config-only rescue must be an independent OR, not an ANDed when item'
    )
    condition = normalized(conditions[0])
    assert re.match(
        r"^\(?\s*server_release_mode\s*==\s*['\"]host-config-only['\"]\s*\)?\s+or\s+",
        condition,
    ), f'host-config-only must be the independent first OR branch: {condition}'
    for trigger in (
        'force_docker_rebuild',
        'server_docker_build_needed',
        'docker_env_result.changed',
    ):
        assert trigger in condition, f'full-mode rescue trigger missing: {trigger}'

    shell = str(module_value)
    assert 'set -euo pipefail' in shell
    assert re.search(
        r'\bdocker\s+compose\b[^\n]*\bps\s+(?:-a\b|--all\b)', shell
    ), (
        'genre-image rescue must inspect stopped outgoing api containers with ps -a'
    )
    assert re.search(r'\bdocker\s+cp\s+["\']?\$\{API_CID\}:', shell), (
        'genre-image rescue must copy only from the outgoing container to the host'
    )
    assert '|| true' not in shell and '|| echo' not in shell
    assert task.get('failed_when') is not False
    assert not task.get('ignore_errors', False)

    dangerous_compose = re.compile(
        r'\bdocker\s+compose\b[^\n]*\b(?:up|down|build|start|restart|stop|kill|rm|create|run|exec|pull|push)\b',
        re.IGNORECASE,
    )
    dangerous_docker = re.compile(
        r'\bdocker\s+(?!compose\b)(?:run|start|restart|stop|kill|rm|create|build|load|import|pull|push|tag|commit|update|rename)\b',
        re.IGNORECASE,
    )
    assert not dangerous_compose.search(shell), (
        'genre-image rescue must not mutate Compose runtime state'
    )
    assert not dangerous_docker.search(shell), (
        'genre-image rescue must not mutate Docker runtime state'
    )


rescue_tasks = []
reconcile_tasks = []
observed_reasons = set()
scanned_paths = set()
referenced_paths = set()
visited = set()


def walk_file(path, inherited_full=False):
    key = (path.resolve(), inherited_full)
    if key in visited:
        return
    visited.add(key)
    scanned_paths.add(path.resolve())
    document = yaml.safe_load(path.read_text(encoding='utf-8')) or []
    assert isinstance(document, list), f'{path} must contain an Ansible task list'
    walk_tasks(document, path, inherited_full)


def walk_tasks(task_list, source, inherited_full):
    assert isinstance(task_list, list), f'{source} has a non-list task block'
    for task in task_list:
        assert isinstance(task, dict), f'{source} has a non-mapping task'
        effective_full = inherited_full or has_full_guard(task)
        name = task.get('name', '<unnamed>')
        entries = module_entries(task)

        if name == RESCUE_TASK_NAME:
            rescue_tasks.append((source, task, entries))
        if name == 'Enable Pi5 Blue/Green boot reconciliation service':
            reconcile_tasks.append((source, task))

        for module, module_value in entries:
            reasons = runtime_reasons(task, module, module_value)
            observed_reasons.update(reasons)
            if reasons and not effective_full:
                if name == RESCUE_TASK_NAME:
                    validate_rescue_task(task, module, module_value)
                else:
                    raise AssertionError(
                        f'{source}:{name} lacks an effective full-mode guard '
                        f'for {sorted(reasons)}'
                    )

            if module in IMPORT_MODULES:
                target = import_target(module_value)
                assert target is not None and '{{' not in target, (
                    f'{source}:{name} uses an uninspectable task import: {target!r}'
                )
                imported = (source.parent / target).resolve()
                assert imported.parent == tasks_dir and imported in task_paths, (
                    f'{source}:{name} imports outside the audited server task set: {target}'
                )
                referenced_paths.add(imported)
                walk_file(imported, effective_full)

        for section in ('block', 'rescue', 'always'):
            if section in task:
                walk_tasks(task[section], source, effective_full)


walk_file(tasks_path.resolve())
for path in sorted(task_paths - referenced_paths - {tasks_path.resolve()}):
    walk_file(path)

handler_document = yaml.safe_load(handlers_path.read_text(encoding='utf-8')) or []
scanned_paths.add(handlers_path.resolve())
walk_tasks(handler_document, handlers_path.resolve(), False)

# Audit the dedicated host-config graph as well as the full server role.  This
# playbook must never inherit common fetch/reset, update-clients, provisioning,
# post-marker, or runtime lifecycle behavior.
graph_visited = set()
graph_paths = set()
graph_roles = set()
HOST_CONFIG_FILE_MODULES = {
    'ansible.builtin.copy', 'ansible.builtin.file', 'ansible.builtin.template',
    'copy', 'file', 'template',
}
HOST_CONFIG_ALLOWED_PATHS = {
    '{{ repo_path }}/apps/api',
    '{{ repo_path }}/apps/api/.env',
    '{{ repo_path }}/apps/web',
    '{{ repo_path }}/apps/web/.env',
    '{{ repo_path }}/infrastructure/docker',
    '{{ repo_path }}/infrastructure/docker/.env',
    '{{ repo_path }}/storage/part-measurement-drawings',
    '{{ repo_path }}/storage/assembly-procedure-images',
    '{{ repo_path }}/storage/measuring-instrument-genres',
    '{{ repo_path }}/storage/pallet-machine-illustrations',
}
HOST_CONFIG_SHELL_TASKS = {
    'Verify exact clean Pi5 release checkout',
    'Validate API .env syntax',
    'Validate Web .env syntax',
    'Validate Docker Compose .env syntax',
    RESCUE_TASK_NAME,
}


def assert_inside_ansible(path, source):
    try:
        path.relative_to(ansible_root)
    except ValueError as error:
        raise AssertionError(
            f'{source} resolves outside the audited Ansible tree: {path}'
        ) from error


def role_target(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get('name'), str):
        return value['name']
    return None


def walk_graph_file(path, inherited_full=False):
    path = path.resolve()
    assert_inside_ansible(path, path)
    key = (path, inherited_full)
    if key in graph_visited:
        return
    graph_visited.add(key)
    graph_paths.add(path)
    document = yaml.safe_load(path.read_text(encoding='utf-8')) or []
    assert isinstance(document, list), f'{path} must contain an Ansible task list'
    walk_graph_tasks(document, path, inherited_full)


def walk_graph_tasks(task_list, source, inherited_full):
    assert isinstance(task_list, list), f'{source} has a non-list task block'
    for task in task_list:
        assert isinstance(task, dict), f'{source} has a non-mapping task'
        effective_full = inherited_full or has_full_guard(task)
        name = task.get('name', '<unnamed>')
        for module, module_value in module_entries(task):
            if module in ROLE_IMPORT_MODULES:
                target = role_target(module_value)
                assert target is not None and re.fullmatch(r'[A-Za-z0-9_.-]+', target), (
                    f'{source}:{name} uses an uninspectable role import: {target!r}'
                )
                graph_roles.add(target)
                role_root = (ansible_root / 'roles' / target).resolve()
                assert_inside_ansible(role_root, source)
                role_main = role_root / 'tasks/main.yml'
                assert role_main.is_file(), f'{source}:{name} role tasks are missing: {target}'
                walk_graph_file(role_main, effective_full)
                role_handlers = role_root / 'handlers/main.yml'
                if role_handlers.is_file():
                    # Handler conditions are evaluated on the handler itself;
                    # a guarded notifying task does not guard another notifier.
                    walk_graph_file(role_handlers, False)
                continue

            if module in IMPORT_MODULES:
                target = import_target(module_value)
                assert target is not None and '{{' not in target, (
                    f'{source}:{name} uses an uninspectable task import: {target!r}'
                )
                imported = (source.parent / target).resolve()
                assert_inside_ansible(imported, source)
                assert imported.is_file(), f'{source}:{name} import is missing: {target}'
                walk_graph_file(imported, effective_full)
                continue

            if module in HOST_CONFIG_FILE_MODULES and not effective_full:
                assert isinstance(module_value, dict), (
                    f'{source}:{name} uses an uninspectable host-config file mutation'
                )
                destination = module_value.get('dest', module_value.get('path'))
                assert destination in HOST_CONFIG_ALLOWED_PATHS, (
                    f'{source}:{name} expands host-config mutation scope to '
                    f'{destination!r}'
                )
            if module in {'ansible.builtin.shell', 'shell'} and not effective_full:
                assert name in HOST_CONFIG_SHELL_TASKS, (
                    f'{source}:{name} adds an unaudited host-config shell action'
                )

            reasons = runtime_reasons(task, module, module_value)
            if reasons and not effective_full:
                if name == RESCUE_TASK_NAME:
                    validate_rescue_task(task, module, module_value)
                else:
                    raise AssertionError(
                        f'{source}:{name} lacks an effective full-mode guard '
                        f'in the server play graph for {sorted(reasons)}'
                    )

        for section in ('block', 'rescue', 'always'):
            if section in task:
                walk_graph_tasks(task[section], source, effective_full)


playbook_document = yaml.safe_load(playbook_path.read_text(encoding='utf-8')) or []
server_plays = [
    play for play in playbook_document
    if isinstance(play, dict) and play.get('hosts') == 'server'
]
assert len(server_plays) == 1, (
    'server-config release playbook must contain exactly one server play'
)
server_play = server_plays[0]
for section in ('pre_tasks', 'tasks', 'post_tasks', 'handlers'):
    if section in server_play:
        walk_graph_tasks(server_play[section], playbook_path.resolve(), False)

assert graph_roles == {'server'}, (
    f'server-config playbook may import only the server role: {sorted(graph_roles)}'
)
update_clients_core = (ansible_root / 'tasks/update-clients-core.yml').resolve()
assert update_clients_core not in graph_paths, (
    'server-config playbook must not run update-clients-core.yml'
)
assert (ansible_root / 'roles/common/tasks/main.yml').resolve() not in graph_paths
assert tasks_path.resolve() in graph_paths

playbook_text = playbook_path.read_text(encoding='utf-8')
for forbidden in (
    'name: common',
    'update-clients-core.yml',
    'server-deployment-completed.json',
    'git fetch',
    'git reset --hard',
):
    assert forbidden not in playbook_text, (
        f'server-config playbook contains forbidden behavior: {forbidden}'
    )
for required in (
    'server_release_mode: host-config-only',
    'git status --porcelain --untracked-files=all',
    'git diff --cached --quiet',
    '[[ "${head}" == "${expected}" ]]',
):
    assert required in playbook_text, (
        f'server-config checkout proof lost {required}'
    )

assert scanned_paths >= task_paths | {handlers_path.resolve()}, (
    'every server task file and the handler file must be audited'
)
assert len(rescue_tasks) == 1, (
    f'expected exactly one exact-name genre-image rescue, found {len(rescue_tasks)}'
)
rescue_source, rescue_task, rescue_entries = rescue_tasks[0]
assert len(rescue_entries) == 1
validate_rescue_task(rescue_task, *rescue_entries[0])

assert len(reconcile_tasks) == 1
reconcile_source, reconcile_task = reconcile_tasks[0]
reconcile = reconcile_task.get('ansible.builtin.systemd')
assert isinstance(reconcile, dict), f'{reconcile_source}: reconcile must use systemd'
assert reconcile.get('name') == 'pi5-blue-green-reconcile.service'
assert reconcile.get('enabled') is True
assert 'state' not in reconcile, (
    'full provisioning may enable reconcile for boot, but must not start/restart it'
)
assert has_full_guard(reconcile_task), (
    'host-config-only must not mutate the reconcile unit'
)

required_reasons = {
    'Docker Compose lifecycle',
    'Docker lifecycle',
    'deploy script entrypoint',
    'Prisma migration',
    'legacy API health',
    'legacy API environment verification',
}
assert required_reasons <= observed_reasons, (
    f'runtime detector did not exercise: {sorted(required_reasons - observed_reasons)}'
)

# Keep classifier coverage fail-closed for future entrypoint and import shapes.
assert 'deploy script entrypoint' in runtime_reasons(
    {'name': 'future Pi5 executor'},
    'ansible.builtin.command',
    {'cmd': '{{ repo_path }}/scripts/deploy/pi5-future-executor.sh'},
)
assert 'unknown or runtime-shaped task import' in runtime_reasons(
    {'name': 'future runtime import'},
    'ansible.builtin.import_tasks',
    'pi5-runtime.yml',
)
assert 'Docker Compose lifecycle' in runtime_reasons(
    {'name': 'future Compose argv executor'},
    'ansible.builtin.command',
    {'argv': ['docker', 'compose', '-f', 'compose.yml', 'restart', 'api']},
)
multiline_compose_reasons = runtime_reasons(
    {'name': 'future multiline Compose executor'},
    'ansible.builtin.shell',
    'docker compose \\\n  -f compose.yml \\\n  up -d api',
)
assert 'Docker Compose lifecycle' in multiline_compose_reasons, multiline_compose_reasons
assert 'Docker lifecycle' in runtime_reasons(
    {'name': 'future direct Docker executor'},
    'ansible.builtin.command',
    {'argv': ['docker', 'restart', 'api']},
)
multiline_systemd_reasons = runtime_reasons(
    {'name': 'future multiline systemd executor'},
    'ansible.builtin.shell',
    'systemctl \\\n  restart \\\n  pi5-blue-green-reconcile.service',
)
assert 'runtime systemctl lifecycle' in multiline_systemd_reasons, multiline_systemd_reasons
assert 'runtime systemd lifecycle' in runtime_reasons(
    {'name': 'future systemd executor'},
    'ansible.builtin.systemd',
    {'name': 'pi5-blue-green-reconcile.service', 'state': 'restarted'},
)
assert 'legacy API health' in runtime_reasons(
    {'name': 'future API health gate'},
    'ansible.builtin.uri',
    {'url': '{{ api_healthcheck_url }}'},
)
PY

python3 - "${PLAYBOOK}" "${ROOT_DIR}/infrastructure/ansible" "${ROOT_DIR}" <<'PY'
import re
import sys
from pathlib import Path

import yaml

playbook_path = Path(sys.argv[1]).resolve()
ansible_root = Path(sys.argv[2]).resolve()
repository_root = Path(sys.argv[3]).resolve()
roles_root = ansible_root / 'roles'
playbooks_root = ansible_root / 'playbooks'

FULL_GUARDS = {
    "terminal_release_mode == 'full'",
    "terminal_release_mode | default('full') == 'full'",
}
ROLE_IMPORTS = {
    'ansible.builtin.import_role', 'ansible.builtin.include_role',
    'import_role', 'include_role',
}
TASK_IMPORTS = {
    'ansible.builtin.import_tasks', 'ansible.builtin.include_tasks',
    'import_tasks', 'include_tasks',
}
FILE_MODULES = {
    'ansible.builtin.blockinfile', 'ansible.builtin.copy',
    'ansible.builtin.file', 'ansible.builtin.lineinfile',
    'ansible.builtin.replace', 'ansible.builtin.template',
    'blockinfile', 'copy', 'file', 'lineinfile', 'replace', 'template',
}
PROVISIONING_MODULES = {
    'ansible.builtin.apt', 'ansible.builtin.apt_repository',
    'ansible.builtin.cron', 'ansible.builtin.find',
    'ansible.builtin.package', 'ansible.builtin.pip',
    'apt', 'apt_repository', 'cron', 'find', 'package', 'pip',
}
SYSTEMD_MODULES = {
    'ansible.builtin.service', 'ansible.builtin.systemd',
    'ansible.builtin.systemd_service', 'service', 'systemd', 'systemd_service',
}
SHELL_MODULES = {'ansible.builtin.shell', 'shell'}
COMMAND_MODULES = {'ansible.builtin.command', 'command'}
SCRIPT_MODULES = {'ansible.builtin.script', 'script'}
URI_MODULES = {'ansible.builtin.uri', 'uri'}

ALLOWED_RELEASE_FILE_DESTINATIONS = {
    '/etc/raspi-status-agent.conf',
    '/etc/systemd/system/status-agent.service',
    '/etc/systemd/system/status-agent.timer',
    '/etc/polkit-1/rules.d/50-pcscd-allow-all.rules',
    '{{ repo_path }}/clients/nfc-agent/.env',
    '{{ repo_path }}/clients/barcode-agent/.env',
    '{{ repo_path }}/clients/torque-agent/.env',
    '/usr/local/libexec/torque-bluetooth-adapter',
    '/usr/local/libexec/raspi-local-ansible-runner',
    '/usr/local/libexec/raspi_local_execution.py',
    '/usr/local/libexec/raspi-terminal-ready-probe',
    '/usr/local/libexec/raspi-terminal-maintenance-probe',
    '/usr/local/libexec/raspi-local-runtime-install',
    '/usr/local/libexec/raspi-local-runtime-lock.json',
    '/usr/local/libexec/raspi-local-requirements-aarch64-py311.lock',
    '/etc/systemd/system/torque-bluetooth-adapter@.service',
    '/etc/udev/rules.d/90-torque-bluetooth-adapter.rules',
    '/etc/udev/rules.d/99-torque-wrench-hid.rules',
    '/etc/raspi-haizen-agent.conf',
    '/etc/systemd/system/haizen-agent.service',
    '/etc/sudoers.d/{{ client_sudo_user }}',
    '/etc/sudoers.d/{{ client_sudoers_services_file }}',
    '/home/{{ ansible_user }}/.config/autostart/ibus.desktop',
    '/home/{{ ansible_user }}/.config/autostart/ibus-owner.desktop',
    '/home/{{ ansible_user }}/.config/autostart/{{ item }}',
    '/home/{{ ansible_user }}/.config/autostart/ibus-engine.desktop',
    '{{ kiosk_firefox_profile_abs }}/chrome/userChrome.css',
    '{{ kiosk_firefox_profile_abs }}/user.js',
    '/usr/local/bin/kiosk-launch.sh',
    '/etc/systemd/system/kiosk-browser.service',
    '/usr/local/bin/show-kiosk-panel.sh',
    '/usr/local/bin/clamav-kiosk-scan.sh',
    '/usr/local/bin/rkhunter-kiosk-scan.sh',
    '/home/{{ ansible_user }}/.config/labwc/rc.xml',
    '/usr/local/bin/ibus-kiosk-init.sh',
    '{{ ibus_process_owner_script_path }}',
    '/etc/tmpfiles.d/signage-lite.conf',
    '/usr/local/share/signage-maintenance.svg',
    '/usr/local/bin/signage-update.sh',
    '/usr/local/bin/signage-display.sh',
    '/usr/local/bin/signage-stop.sh',
    '/usr/local/bin/signage-lite-watchdog.sh',
    '/etc/systemd/system/signage-lite.service',
    '/etc/systemd/system/signage-lite-update.service',
    '/etc/systemd/system/signage-lite-update.timer',
    '/etc/systemd/system/signage-lite-watchdog.service',
    '/etc/systemd/system/signage-lite-watchdog.timer',
    '/etc/systemd/system/signage-daily-reboot.service',
    '/etc/systemd/system/signage-daily-reboot.timer',
}

STONEBASE_BOOTSTRAP_SOURCES = {
    '/usr/local/libexec/raspi-local-runtime-lock.json': (
        '{{ repo_path }}/infrastructure/ansible/files/'
        'stonebase-local-ansible/runtime-lock.json'
    ),
    '/usr/local/libexec/raspi-local-requirements-aarch64-py311.lock': (
        '{{ repo_path }}/infrastructure/ansible/files/'
        'stonebase-local-ansible/requirements-aarch64-py311.lock'
    ),
}

MUTATING_SHELL = re.compile(
    r'(?:\b(?:apt(?:-get)?|chmod|chown|kill|ln|mkdir|mv|pkill|pnpm\s+install|'
    r'rm|sed\s+-i|systemd-tmpfiles\s+--create|tailscale\s+up|touch|truncate)\b|'
    r'\bgsettings\s+set\b|\bgit\s+(?:clone|remote\s+set-url|reset)\b|'
    r'\bcrontab\b(?!\s+-u\s+[A-Za-z0-9_-]+\s+-l\b)|'
    r'\binstall\s+(?:-|/)|'
    r'\bsystemctl\s+(?:disable|enable|mask|reload|restart|start|stop|unmask)\b|'
    r'\s>>?\s*(?!/dev/null\b)(?:/|~|\{\{))',
    re.IGNORECASE,
)
DOCKER_LIFECYCLE = re.compile(
    r'\bdocker\s+compose\b[^\n]*(?:\bup\b|\brestart\b)', re.IGNORECASE
)
DOCKER_MUTATION = re.compile(
    r'\bdocker\s+(?:(?:compose\b[^\n]*\b(?:build|create|down|kill|pull|push|'
    r'restart|rm|run|start|stop|up)\b)|(?:build|commit|cp|create|exec|image\s+rm|'
    r'kill|load|pull|push|rename|restart|rm|run|start|stop|tag|update)\b)',
    re.IGNORECASE,
)
READ_ONLY_COMMAND = re.compile(
    r'^(?:/usr/local/libexec/raspi-local-runtime-install\s+status|'
    r'/usr/local/libexec/torque-bluetooth-adapter\s+--discover|'
    r'docker\s+--version|ip\s+-brief|rsvg-convert\s+--version|'
    r'systemctl\s+(?:is-|list-unit-files|show|status)|'
    r'journalctl\s+--unit=torque-bluetooth-adapter@\{\{\s+torque_bluetooth_controller_discovery\.stdout\s+\|\s+trim\s+\}\}\.service\s+--lines=80\s+--no-pager\s+--output=short-iso$|'
    r'systemd-analyze\s+verify|tailscale\s+status|which\s+)',
    re.IGNORECASE,
)

APPROVED_RELEASE_COMMANDS = {
    (
        'roles/client/tasks/local-runner-bootstrap.yml',
        'Bootstrap pinned StoneBase local executor runtime when needed',
        '/usr/local/libexec/raspi-local-runtime-install',
    ),
    (
        'roles/client/tasks/torque-agent.yml',
        'Reload udev rules for torque devices',
        'udevadm control --reload-rules',
    ),
    (
        'roles/client/tasks/torque-agent.yml',
        'Retrigger Bluetooth input devices after torque HID rule changes',
        'udevadm trigger --subsystem-match=input --property-match=ID_BUS=bluetooth --action=add',
    ),
    (
        'roles/client/tasks/torque-agent.yml',
        'Wait for torque udev events to settle',
        'udevadm settle --timeout=30',
    ),
}


def normalized(value):
    return ' '.join(str(value).split())


def when_items(task):
    value = task.get('when', [])
    return [value] if isinstance(value, str) else list(value or [])


def has_full_guard(task):
    return any(normalized(item) in FULL_GUARDS for item in when_items(task))


def role_name(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get('name')
    return None


def task_target(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get('file')
    return None


def resolve_task_file(source, target):
    assert isinstance(target, str), f'{source}: task import is not static'
    target = target.replace('{{ playbook_dir }}', str(playbooks_root))
    assert '{{' not in target, f'{source}: uninspectable task import {target!r}'
    path = Path(target)
    if not path.is_absolute():
        path = source.parent / path
    path = path.resolve()
    path.relative_to(ansible_root)
    assert path.is_file(), f'{source}: imported task file missing: {path}'
    return path


def command_text(value):
    if isinstance(value, str):
        return normalized(value)
    if isinstance(value, dict):
        if isinstance(value.get('argv'), list):
            return normalized(' '.join(str(item) for item in value['argv']))
        return normalized(value.get('cmd', value.get('_raw_params', '')))
    return normalized(value)


def destination(module_value):
    if not isinstance(module_value, dict):
        return None
    return module_value.get('dest', module_value.get('path'))


visited = set()
scanned = set()
release_destinations = set()
docker_exceptions = []


def audit_file(path, inherited_full=False):
    key = (path.resolve(), inherited_full)
    if key in visited:
        return
    visited.add(key)
    scanned.add(path.resolve())
    document = yaml.safe_load(path.read_text(encoding='utf-8')) or []
    assert isinstance(document, list), f'{path}: expected task list'
    audit_tasks(document, path, inherited_full)


def audit_tasks(tasks, source, inherited_full):
    assert isinstance(tasks, list), f'{source}: expected task list'
    for task in tasks:
        assert isinstance(task, dict), f'{source}: expected task mapping'
        name = str(task.get('name', '<unnamed>'))
        effective_full = inherited_full or has_full_guard(task)

        for module, value in task.items():
            if module in ROLE_IMPORTS:
                role = role_name(value)
                assert isinstance(role, str) and re.fullmatch(r'[A-Za-z0-9_.-]+', role), (
                    f'{source}:{name}: uninspectable role import {role!r}'
                )
                main = (roles_root / role / 'tasks/main.yml').resolve()
                main.relative_to(ansible_root)
                assert main.is_file(), f'{source}:{name}: role missing {role}'
                audit_file(main, effective_full)
                handlers = roles_root / role / 'handlers/main.yml'
                if handlers.is_file():
                    # A handler may be notified by another release-reachable task.
                    audit_file(handlers.resolve(), False)
                continue

            if module in TASK_IMPORTS:
                audit_file(resolve_task_file(source, task_target(value)), effective_full)
                continue

            if effective_full:
                continue

            if module in PROVISIONING_MODULES:
                raise AssertionError(
                    f'{source}:{name}: provisioning module {module} is release-reachable'
                )

            if module in SYSTEMD_MODULES and isinstance(value, dict):
                assert 'enabled' not in value, (
                    f'{source}:{name}: persistent unit enablement is release-reachable'
                )
                state = normalized(value.get('state', ''))
                if state == 'stopped':
                    assert (
                        source.resolve() == (roles_root / 'signage/tasks/main.yml').resolve()
                        and name == 'Stop signage runtime temporarily for release'
                        and task.get('loop') == [
                            'signage-lite-update.timer',
                            'signage-lite-watchdog.timer',
                            'signage-daily-reboot.timer',
                            'signage-lite-update.service',
                            'signage-lite-watchdog.service',
                            'signage-lite.service',
                        ]
                    ), f'{source}:{name}: uncontrolled release stop set'
                else:
                    assert state in {'', 'started', 'restarted', 'reloaded'}, (
                        f'{source}:{name}: uncontrolled systemd state {state!r}'
                    )

            if module in FILE_MODULES:
                dest = destination(value)
                if module.endswith('file') and isinstance(value, dict):
                    assert value.get('state', 'file') != 'directory', (
                        f'{source}:{name}: release may not create/change directories'
                    )
                    assert not value.get('recurse', False), (
                        f'{source}:{name}: recursive ownership is release-reachable'
                    )
                assert isinstance(dest, str), f'{source}:{name}: file destination is dynamic'
                release_destinations.add(dest)
                assert dest in ALLOWED_RELEASE_FILE_DESTINATIONS, (
                    f'{source}:{name}: destination is not manifest-backed: {dest}'
                )
                if dest in STONEBASE_BOOTSTRAP_SOURCES:
                    assert value.get('remote_src') is True, (
                        f'{source}:{name}: StoneBase lock must come from the immutable terminal checkout'
                    )
                    assert value.get('src') == STONEBASE_BOOTSTRAP_SOURCES[dest], (
                        f'{source}:{name}: StoneBase lock source does not match the candidate path'
                    )

            if module in SHELL_MODULES:
                payload = command_text(value)
                if DOCKER_MUTATION.search(payload):
                    allowed_source = source.resolve() in {
                        (roles_root / 'client/tasks/nfc-agent-lifecycle.yml').resolve(),
                        (roles_root / 'client/tasks/barcode-agent-lifecycle.yml').resolve(),
                        (roles_root / 'client/tasks/torque-agent-lifecycle.yml').resolve(),
                        (roles_root / 'client/handlers/main.yml').resolve(),
                    }
                    assert (
                        DOCKER_LIFECYCLE.search(payload)
                        and allowed_source
                        and 'docker-compose.client.yml' in payload
                    ), (
                        f'{source}:{name}: unowned Docker lifecycle in terminal release'
                    )
                    docker_exceptions.append((source, name))
                elif MUTATING_SHELL.search(payload):
                    approved_ssh_reset = (
                        source.resolve() == (roles_root / 'common/tasks/main.yml').resolve()
                        and name == 'Fetch and reset existing terminal repository to immutable release'
                        and 'git fetch --no-tags origin' in payload
                        and 'git reset --hard' in payload
                    )
                    approved_local_reset = (
                        source.resolve() == (roles_root / 'common/tasks/main.yml').resolve()
                        and name == 'Verify incremental bundle and reset existing terminal repository without network'
                        and "terminal_release_transport | default('ssh-ansible') == 'local-artifact'"
                        in [normalized(condition) for condition in when_items(task)]
                        and 'git bundle verify' in payload
                        and 'git fetch --no-tags' in payload
                        and 'git reset --hard' in payload
                        and ' origin ' not in f' {payload} '
                        and 'git diff --quiet' in payload
                        and 'git diff --cached --quiet' in payload
                    )
                    assert approved_ssh_reset or approved_local_reset, (
                        f'{source}:{name}: mutating shell is not an approved release adapter'
                    )

            if module in COMMAND_MODULES:
                payload = command_text(value)
                source_relative = source.resolve().relative_to(ansible_root).as_posix()
                approved_release_command = (source_relative, name, payload)
                assert READ_ONLY_COMMAND.match(payload) or approved_release_command in APPROVED_RELEASE_COMMANDS, (
                    f'{source}:{name}: command is not a recognized read-only preflight: {payload}'
                )

            if module in SCRIPT_MODULES:
                payload = command_text(value)
                approved_diagnostic = 'scripts/kiosk/diagnose-ime.sh' in payload
                approved_signage_proof = (
                    source.resolve() == (ansible_root / 'tasks/update-clients-core.yml').resolve()
                    and name == 'Verify authenticated signage endpoints with the host-local credential'
                    and payload.endswith(
                        'scripts/deploy/signage-runtime-proof.py --check-endpoints'
                    )
                    and '--refresh-image' not in payload
                    and '--seal-maintenance-image' not in payload
                )
                assert approved_diagnostic or approved_signage_proof, (
                    f'{source}:{name}: opaque script execution is release-reachable'
                )

            if module in URI_MODULES and isinstance(value, dict):
                assert normalized(value.get('method', 'GET')).upper() == 'GET', (
                    f'{source}:{name}: non-GET URI call is release-reachable'
                )

        for section in ('block', 'rescue', 'always'):
            if section in task:
                audit_tasks(task[section], source, effective_full)


document = yaml.safe_load(playbook_path.read_text(encoding='utf-8')) or []
plays = {play.get('hosts'): play for play in document if isinstance(play, dict)}
assert {'server', 'kiosk', 'signage'} <= set(plays)
assert all(
    task.get('name') != 'Require terminal release-only mode before shared tasks'
    for task in plays['server'].get('pre_tasks', [])
)
for group in ('kiosk', 'signage'):
    pre_tasks = plays[group].get('pre_tasks') or []
    names = [task.get('name') for task in pre_tasks]
    guard_index = names.index('Require terminal release-only mode before shared tasks')
    display_index = names.index(
        'Require an active display manager before kiosk release'
        if group == 'kiosk'
        else 'Require an active display manager before signage release'
    )
    common_index = names.index('Run common shared preparation tasks')
    assert guard_index < display_index < common_index, (
        f'{group}: release and display preflights must run before common mutations'
    )
    for section in ('pre_tasks', 'tasks', 'post_tasks', 'handlers'):
        audit_tasks(plays[group].get(section) or [], playbook_path, False)

common_text = (roles_root / 'common/tasks/main.yml').read_text(encoding='utf-8')
assert 'Remove unnecessary documentation directory' not in common_text
assert '{{ repo_path }}/docs' not in common_text
assert 'git fetch --no-tags origin' in common_text
assert 'git reset --hard "${target}"' in common_text
assert 'git status --porcelain --untracked-files=all' in common_text
for fragment in (
    '/usr/bin/env -i',
    'GIT_CONFIG_NOSYSTEM=1',
    'GIT_CONFIG_GLOBAL=/dev/null',
    'GIT_ATTR_NOSYSTEM=1',
    'GIT_OPTIONAL_LOCKS=0',
    '-c core.fsmonitor=false',
    '-c core.ignoreStat=false',
    'git ls-files -v -z',
    'git ls-files -u -z',
    'skip-worktree or assume-unchanged',
    'unmerged index entries',
):
    assert fragment in common_text, f'fixed Git/index release guard lost {fragment!r}'

common_tasks = yaml.safe_load(common_text) or []
release_checkout = next(
    task for task in common_tasks
    if task.get('name') == 'Fetch and reset existing terminal repository to immutable release'
)
assert release_checkout.get('become') is True, (
    'immutable terminal checkout must run as root for root-owned tracked paths'
)
assert 'become_user' not in release_checkout, (
    'immutable terminal checkout must not drop back to the inventory user'
)
release_checkout_shell = release_checkout['ansible.builtin.shell']
assert '-c safe.directory="{{ repo_path }}"' in release_checkout_shell
assert not re.search(r'\b(?:chown|chmod)\b', release_checkout_shell), (
    'immutable checkout must not normalize terminal ownership or modes'
)
fetch_offset = release_checkout_shell.index('git fetch --no-tags origin')
pre_reset_policy_offset = release_checkout_shell.rindex('verify_index_policy')
reset_offset = release_checkout_shell.index('git reset --hard "${target}"')
assert fetch_offset < pre_reset_policy_offset < reset_offset, (
    'terminal index policy must be rechecked after fetch and immediately before reset'
)
between_policy_and_reset = release_checkout_shell[pre_reset_policy_offset:reset_offset]
assert 'git fetch' not in between_policy_and_reset
assert 'git checkout' not in between_policy_and_reset

exact_preflight_fragments = {
    roles_root / 'client/tasks/main.yml': (
        "status_agent_timer_enabled.stdout | trim != 'enabled'",
    ),
    roles_root / 'client/tasks/network-preflight.yml': (
        'main_count == 1 && auth_count == 1 && desired_count == 1',
        'is-active',
        'NetworkManager.service',
    ),
    roles_root / 'kiosk/tasks/security.yml': (
        "item.stat.mode | default('') == '0755'",
        "grep -Fxc -- '#Ansible: Weekly ClamAV scan (kiosk)'",
        "grep -Fxc -- '#Ansible: Weekly rkhunter scan (kiosk)'",
        "grep -Fc -- '/usr/local/bin/clamav-kiosk-scan.sh'",
        "grep -Fc -- '/usr/local/bin/rkhunter-kiosk-scan.sh'",
    ),
    roles_root / 'signage/tasks/main.yml': (
        "signage_enabled_unit.stdout | trim != 'enabled'",
        'Stop signage runtime temporarily for release',
    ),
}
for path, fragments in exact_preflight_fragments.items():
    text = path.read_text(encoding='utf-8')
    for fragment in fragments:
        assert fragment in text, f'{path}: exact release preflight lost {fragment!r}'

docker_sources = [source.resolve() for source, _name in docker_exceptions]
for lifecycle in (
    'nfc-agent-lifecycle.yml',
    'barcode-agent-lifecycle.yml',
    'torque-agent-lifecycle.yml',
):
    source = (roles_root / 'client/tasks' / lifecycle).resolve()
    assert docker_sources.count(source) == 1, (
        f'{lifecycle}: release-only must execute exactly one Compose mutation'
    )

for path in ansible_root.rglob('*.yml'):
    text = path.read_text(encoding='utf-8')
    assert 'kill -9' not in text, f'{path}: force-kill is forbidden in Ansible release paths'

required_scanned = {
    (roles_root / 'common/tasks/main.yml').resolve(),
    (roles_root / 'client/tasks/main.yml').resolve(),
    (roles_root / 'client/tasks/network-preflight.yml').resolve(),
    (roles_root / 'kiosk/tasks/main.yml').resolve(),
    (roles_root / 'kiosk/tasks/security.yml').resolve(),
    (roles_root / 'signage/tasks/main.yml').resolve(),
    (ansible_root / 'tasks/preflight-terminal-display.yml').resolve(),
    (ansible_root / 'tasks/preflight-signage.yml').resolve(),
    (ansible_root / 'tasks/preflight-tailscale.yml').resolve(),
    (ansible_root / 'tasks/update-clients-core.yml').resolve(),
}
assert required_scanned <= scanned, (
    f'terminal recursive audit missed {sorted(str(path) for path in required_scanned - scanned)}'
)
assert (ansible_root / 'tasks/prestage-signage-runtime.yml').resolve() not in scanned, (
    'provisioning-only signage runtime preparation entered the release graph'
)

# Resolve every release-reachable file destination through the exact default
# path constraints asserted by the roles, then require it in the coordinator's
# capture set. This makes adding a new allowlisted Ansible mutation fail until
# rollback authority is extended in the same change.
sys.path.insert(0, str(repository_root))
from scripts.deploy.rolling_release.backends import ansible as deploy_ansible


def concrete_destination(value):
    replacements = (
        ('{{ repo_path }}', '/opt/RaspberryPiSystem_002'),
        ('{{ kiosk_firefox_profile_abs }}', '/home/tools03/.mozilla/firefox/kiosk-system'),
        ('{{ ibus_process_owner_script_path }}', '/usr/local/bin/ibus-process-owner.sh'),
        ('{{ client_sudoers_services_file }}', 'tools03-client-services'),
        ('{{ client_sudo_user }}', 'tools03'),
        ('{{ ansible_user }}', 'tools03'),
        ('{{ item }}', 'im-launch.desktop'),
    )
    result = value
    for source, destination_value in replacements:
        result = result.replace(source, destination_value)
    assert '{{' not in result, f'unresolved release destination: {value}'
    return result


captured_destinations = set(
    deploy_ansible._terminal_manifest_paths(
        'kiosk', 'tools03', '/home/tools03', 'contract-run'
    )
) | set(
    deploy_ansible._terminal_manifest_paths(
        'signage', 'signageras3', '/home/signageras3', 'contract-run'
    )
)
concrete_release_destinations = {
    concrete_destination(value) for value in release_destinations
}
assert concrete_release_destinations <= captured_destinations, (
    'release mutation destinations missing from rollback manifest: '
    f'{sorted(concrete_release_destinations - captured_destinations)}'
)
PY

python3 - "${LEGACY_DEPLOY_PLAYBOOK}" "${SIGNAGE_PRESTAGE}" \
  "${TERMINAL_DISPLAY_PREFLIGHT}" "${CLIENT_TASKS}" "${KIOSK_FIREFOX_TASKS}" \
  "${SIGNAGE_TASKS}" "${KIOSK_LAUNCH_TEMPLATE}" "${SIGNAGE_DISPLAY_TEMPLATES[@]}" <<'PY'
import sys
from pathlib import Path

import yaml

(
    deploy_path,
    prestage_path,
    display_path,
    client_path,
    firefox_path,
    signage_path,
    kiosk_template_path,
    *signage_template_paths,
) = map(Path, sys.argv[1:])

deploy = yaml.safe_load(deploy_path.read_text(encoding='utf-8')) or []
assert len(deploy) == 1
deploy_tasks = deploy[0].get('tasks') or []
by_name = {task.get('name'): task for task in deploy_tasks}
signage_preflight = by_name['Run signage preflight checks']
signage_prestage = by_name['Prepare signage runtime for provisioning']
assert "terminal_release_mode | default('full') == 'release-only'" in signage_preflight['when']
assert "terminal_release_mode == 'full'" in signage_prestage['when']

prestage = yaml.safe_load(prestage_path.read_text(encoding='utf-8')) or []
prestage_names = [task.get('name') for task in prestage]
discover_index = prestage_names.index(
    'Discover existing signage services and timers for provisioning'
)
stop_index = prestage_names.index(
    'Stop and disable existing signage services and timers for provisioning'
)
assert discover_index < stop_index
assert 'ignore_errors' not in prestage[discover_index]
assert 'failed_when' not in prestage[discover_index]
stop_task = prestage[stop_index]
assert "item.stdout | default('') | trim == 'loaded'" in stop_task['when']
assert 'ignore_errors' not in stop_task and 'failed_when' not in stop_task

display = yaml.safe_load(display_path.read_text(encoding='utf-8')) or []
assert [task.get('name') for task in display] == [
    'Require lightdm unit to be loaded before terminal release',
    'Require lightdm to be active before terminal release',
]
assert "stdout | trim != 'loaded'" in display[0]['failed_when']
assert "stdout | trim != 'active'" in display[1]['failed_when']

client_text = client_path.read_text(encoding='utf-8')
assert 'Hide desktop panel during full terminal provisioning' in client_text
assert "terminal_release_mode | default('full') == 'full'" in client_text
assert "pkill -f '^lwrespawn /usr/bin/wf-panel-pi( |$)'" in client_text
assert 'Filter out signage services for signage role convergence' in client_text
assert 'when: manage_signage_lite | default(false) | bool' in client_text

firefox_text = firefox_path.read_text(encoding='utf-8')
for fragment in (
    'Remove stale Firefox session restore files during full provisioning',
    'Converge Firefox session restore directory during full provisioning',
    'Find stale Firefox upgrade session restore files during full provisioning',
    "terminal_release_mode | default('full') == 'full'",
):
    assert fragment in firefox_text, fragment

signage_text = signage_path.read_text(encoding='utf-8')
assert 'Pause signage-lite workload before deployment' not in signage_text
tmpfiles_task = next(
    task for task in yaml.safe_load(signage_text) or []
    if task.get('name') == 'Ensure /run/signage directory exists (via tmpfiles)'
)
assert 'creates' not in tmpfiles_task.get('args', {})
for fragment in (
    "signage_runtime_directory.stat.pw_name | default('') == ansible_user",
    "signage_runtime_directory.stat.gr_name | default('') == ansible_user",
    "signage_runtime_directory.stat.mode | default('') == '0755'",
):
    assert fragment in signage_text, fragment

for template_path in (kiosk_template_path, *signage_template_paths):
    template = template_path.read_text(encoding='utf-8')
    for forbidden in ('pkill ', 'rm -f', 'mkdir -p', 'sessionstore.jsonlz4'):
        assert forbidden not in template, (
            f'{template_path}: release-launched runtime side effect remains: {forbidden}'
        )
PY

python3 - "${COMMON_TASKS}" "${TMP_DIR}/terminal-index-policy" <<'PY'
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

common_path = Path(sys.argv[1])
root = Path(sys.argv[2])
seed = root / 'seed'
remote = root / 'remote.git'
home = root / 'home'
root.mkdir(parents=True)
home.mkdir()


def git(*args, cwd=None):
    return subprocess.run(
        ('/usr/bin/git', *args),
        cwd=cwd,
        check=True,
        text=True,
        capture_output=True,
    )


git('init', str(seed))
git('config', 'user.name', 'deploy-contract-test', cwd=seed)
git('config', 'user.email', 'deploy-contract@example.invalid', cwd=seed)
(seed / 'tracked.txt').write_text('base\n', encoding='utf-8')
(seed / 'root-owned').mkdir()
(seed / 'root-owned' / 'tracked.txt').write_text('base-owned\n', encoding='utf-8')
git('add', 'tracked.txt', 'root-owned/tracked.txt', cwd=seed)
git('commit', '-m', 'base', cwd=seed)
base_sha = git('rev-parse', 'HEAD', cwd=seed).stdout.strip()
(seed / 'tracked.txt').write_text('target\n', encoding='utf-8')
(seed / 'root-owned' / 'tracked.txt').write_text('target-owned\n', encoding='utf-8')
git('commit', '-am', 'target', cwd=seed)
target_sha = git('rev-parse', 'HEAD', cwd=seed).stdout.strip()
git('clone', '--bare', str(seed), str(remote))

tasks = yaml.safe_load(common_path.read_text(encoding='utf-8')) or []
checkout_template = next(
    task['ansible.builtin.shell']
    for task in tasks
    if task.get('name') == 'Fetch and reset existing terminal repository to immutable release'
)


def render_checkout(work):
    checkout = checkout_template.replace(
        'safe_home="$(/usr/bin/getent passwd {{ ansible_user | quote }} | /usr/bin/cut -d: -f6)"',
        'safe_home="${HOME}"',
    )
    checkout = checkout.replace(
        "{{ (git_environment | default({})).get('GIT_SSH_COMMAND', '') | quote }}",
        "''",
    )
    checkout = checkout.replace('{{ repo_path }}', str(work))
    checkout = checkout.replace('{{ repo_version | quote }}', repr(target_sha))
    checkout = checkout.replace(
        '{{ repo_prev_head_release_result.stdout | quote }}',
        repr(base_sha),
    )
    assert '{{' not in checkout and '{%' not in checkout
    return checkout

for flag in ('--assume-unchanged', '--skip-worktree'):
    work = root / flag.removeprefix('--')
    git('clone', str(remote), str(work))
    git('checkout', base_sha, cwd=work)
    git('update-index', flag, 'tracked.txt', cwd=work)
    (work / 'tracked.txt').write_text('local state\n', encoding='utf-8')

    checkout = render_checkout(work)

    poisoned_environment = os.environ.copy()
    poisoned_environment.update(
        HOME=str(home),
        GIT_DIR='/nonexistent/poisoned-git-dir',
        GIT_WORK_TREE='/nonexistent/poisoned-work-tree',
        GIT_CONFIG_GLOBAL='/nonexistent/poisoned-git-config',
    )
    result = subprocess.run(
        ('/bin/bash', '-c', checkout),
        text=True,
        capture_output=True,
        env=poisoned_environment,
    )
    assert result.returncode != 0, f'{flag}: hidden index bit reached reset'
    assert 'skip-worktree or assume-unchanged' in result.stderr, result.stderr
    assert git('rev-parse', 'HEAD', cwd=work).stdout.strip() == base_sha
    assert (work / 'tracked.txt').read_text(encoding='utf-8') == 'local state\n'

sudo_ready = shutil.which('sudo') is not None and subprocess.run(
    ('sudo', '-n', 'true'), capture_output=True
).returncode == 0
if sudo_ready:
    work = root / 'root-owned-checkout'
    git('clone', str(remote), str(work))
    git('checkout', base_sha, cwd=work)
    owned_directory = work / 'root-owned'
    owned_file = owned_directory / 'tracked.txt'
    subprocess.run(
        ('sudo', '-n', 'chown', 'root:root', str(owned_directory), str(owned_file)),
        check=True,
    )
    subprocess.run(('sudo', '-n', 'chmod', '0755', str(owned_directory)), check=True)
    subprocess.run(('sudo', '-n', 'chmod', '0644', str(owned_file)), check=True)
    try:
        result = subprocess.run(
            (
                'sudo', '-n', '/usr/bin/env', f'HOME={home}',
                '/bin/bash', '-c', render_checkout(work),
            ),
            text=True,
            capture_output=True,
        )
        assert result.returncode == 0, result.stderr
        assert git('rev-parse', 'HEAD', cwd=work).stdout.strip() == target_sha
        assert owned_file.read_text(encoding='utf-8') == 'target-owned\n'
    finally:
        subprocess.run(
            (
                'sudo', '-n', 'chown',
                f'{os.getuid()}:{os.getgid()}',
                str(owned_directory), str(owned_file),
            ),
            check=True,
        )
PY

python3 - "${PLAYBOOK}" "${LEGACY_DEPLOY_PLAYBOOK}" "${COMMON_TASKS}" \
  "${UPDATE_CLIENTS_CORE}" "${ROLLBACK_TASKS}" "${STANDALONE_ROLLBACK_PLAYBOOK}" <<'PY'
import sys
from pathlib import Path

import yaml

staged_path, legacy_path, common_path, update_path, rollback_tasks_path, rollback_playbook_path = map(
    Path, sys.argv[1:]
)
staged_text = staged_path.read_text(encoding='utf-8')
legacy_text = legacy_path.read_text(encoding='utf-8')
common_text = common_path.read_text(encoding='utf-8')
update_text = update_path.read_text(encoding='utf-8')
rollback_text = rollback_tasks_path.read_text(encoding='utf-8')
rollback_playbook_text = rollback_playbook_path.read_text(encoding='utf-8')

# Terminal task failures must escape directly to the rolling-release
# coordinator. Server may retain its record-and-fail rescue block.
staged = yaml.safe_load(staged_text) or []
terminal_plays = [play for play in staged if play.get('hosts') in {'kiosk', 'signage'}]
assert {play.get('hosts') for play in terminal_plays} == {'kiosk', 'signage'}
for play in terminal_plays:
    for task in play.get('tasks') or []:
        assert 'rescue' not in task, f"{play['hosts']}: terminal rescue is forbidden"

staged_lower = staged_text.lower()
for misleading in ('automatic rollback', 'after rollback'):
    assert misleading not in staged_lower, (
        f'{staged_path}: misleading local rollback label remains: {misleading}'
    )
assert 'coordinator rollback ownership' in staged_lower
assert 'coordinator owns rollback' in staged_lower

for path, text in ((staged_path, staged_text), (legacy_path, legacy_text)):
    assert 'rollback-configs.yml' not in text, f'{path}: Ansible must not own terminal rollback'
    assert 'backup_timestamp' not in text, f'{path}: timestamp rollback state is retired'
    assert 'backup_service_files' not in text, f'{path}: timestamp backup sets are retired'

for path, text in ((common_path, common_text), (update_path, update_text)):
    assert 'backup_timestamp' not in text, f'{path}: timestamp backup generation is retired'
    assert 'backup: true' not in text, f'{path}: unmanaged Ansible backups are forbidden'

# The old standalone entrypoint is deliberately disabled until the coordinator
# supplies an exact run-specific manifest restore adapter. It must never search
# for, select, or restore a "latest" timestamp set.
for forbidden in (
    'ansible.builtin.find',
    'backup_timestamp',
    'rollback_backup_timestamp',
    'backup_service_files',
    'sort(reverse=true)',
):
    assert forbidden not in rollback_text, f'{rollback_tasks_path}: found {forbidden}'
rollback_tasks = yaml.safe_load(rollback_text) or []
assert len(rollback_tasks) == 1
assert 'ansible.builtin.fail' in rollback_tasks[0]
message = str(rollback_tasks[0]['ansible.builtin.fail'].get('msg', ''))
assert 'rolling-release coordinator' in message
assert 'run-specific manifest' in message
assert 'backup_dir' not in rollback_playbook_text
assert 'rollback-configs.yml' in rollback_playbook_text
PY

RETIRED_ROLLBACK_TEST="${TMP_DIR}/retired-rollback-test.yml"
python3 - "${RETIRED_ROLLBACK_TEST}" "${ROLLBACK_TASKS}" <<'PY'
import json
import sys
from pathlib import Path

path, tasks = sys.argv[1:]
Path(path).write_text(f'''---
- name: Exercise retired standalone rollback guard
  hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - ansible.builtin.include_tasks: {json.dumps(tasks)}
''', encoding='utf-8')
PY

if env -u ANSIBLE_CONFIG ansible-playbook -i localhost, "${RETIRED_ROLLBACK_TEST}" \
  -e backup_timestamp=20260715_010101 \
  -e backup_dir="${TMP_DIR}/legacy-backups" >/dev/null 2>&1; then
  echo "[ERROR] retired timestamp rollback was accepted" >&2
  exit 1
fi

echo "deploy safety contract tests passed"
