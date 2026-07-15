#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MAIN_INVENTORY="${ROOT_DIR}/infrastructure/ansible/inventory.yml"
TALKPLAZA_INVENTORY="${ROOT_DIR}/infrastructure/ansible/inventory-talkplaza.yml"
PLAYBOOK="${ROOT_DIR}/infrastructure/ansible/playbooks/deploy-staged.yml"
LEGACY_DEPLOY_PLAYBOOK="${ROOT_DIR}/infrastructure/ansible/playbooks/deploy.yml"
STANDALONE_ROLLBACK_PLAYBOOK="${ROOT_DIR}/infrastructure/ansible/playbooks/rollback.yml"
ROLLBACK_TASKS="${ROOT_DIR}/infrastructure/ansible/tasks/rollback-configs.yml"
COMMON_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/common/tasks/main.yml"
ORCHESTRATION_GUARD="${ROOT_DIR}/infrastructure/ansible/tasks/assert-release-orchestration.yml"
SERVER_DEFAULTS="${ROOT_DIR}/infrastructure/ansible/roles/server/defaults/main.yml"
SERVER_TASKS="${ROOT_DIR}/infrastructure/ansible/roles/server/tasks/main.yml"
SERVER_HANDLERS="${ROOT_DIR}/infrastructure/ansible/roles/server/handlers/main.yml"
UPDATE_CLIENTS_CORE="${ROOT_DIR}/infrastructure/ansible/tasks/update-clients-core.yml"

if grep -Eq 'status_code:[[:space:]]*\[[^]]*401|until:.*401|failed_when:[[:space:]]*false.*401' \
  "${UPDATE_CLIENTS_CORE}"; then
  echo "[ERROR] terminal endpoint health must fail closed on HTTP 401" >&2
  exit 1
fi

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

python3 - "${SERVER_DEFAULTS}" "${SERVER_TASKS}" "${SERVER_HANDLERS}" \
  "${PLAYBOOK}" "${ROOT_DIR}/infrastructure/ansible" <<'PY'
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
    if DEPLOY_ENTRYPOINT.search(command_payload):
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

# Audit the real server play execution graph as well as the server role.  The
# host-config-only adapter invokes deploy-staged.yml, so common/preflight/
# post-task additions must not become an unguarded second Pi5 runtime executor.
graph_visited = set()
graph_paths = set()
graph_roles = set()


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
assert len(server_plays) == 1, 'deploy-staged must contain exactly one server play'
server_play = server_plays[0]
for section in ('pre_tasks', 'tasks', 'post_tasks', 'handlers'):
    if section in server_play:
        walk_graph_tasks(server_play[section], playbook_path.resolve(), False)

assert {'common', 'server'} <= graph_roles, (
    f'server play graph lost required roles: {sorted(graph_roles)}'
)
update_clients_core = (ansible_root / 'tasks/update-clients-core.yml').resolve()
assert update_clients_core in graph_paths, (
    'server play graph no longer audits update-clients-core.yml'
)
assert (ansible_root / 'roles/common/tasks/main.yml').resolve() in graph_paths
assert tasks_path.resolve() in graph_paths

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
    'host-config convergence may enable reconcile for boot, but must not start/restart it'
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
