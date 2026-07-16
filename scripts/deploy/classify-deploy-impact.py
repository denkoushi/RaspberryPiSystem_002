#!/usr/bin/env python3
import argparse
import json
import subprocess

SERVER_PREFIXES = ('apps/api/', 'apps/web/', 'packages/', 'infrastructure/docker/')
SERVER_FILES = frozenset({'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'})
MIGRATION_PREFIX = 'apps/api/prisma/migrations/'
NFC_PREFIX = 'clients/nfc-agent/'
BARCODE_PREFIX = 'clients/barcode-agent/'
STATUS_PREFIX = 'clients/status-agent/'
CLIENT_ROLE_PREFIX = 'infrastructure/ansible/roles/client/'
KIOSK_ROLE_PREFIX = 'infrastructure/ansible/roles/kiosk/'
SIGNAGE_ROLE_PREFIX = 'infrastructure/ansible/roles/signage/'
# Pi3 runtime assets live under the signage role, plus legacy template/preflight copies.
SIGNAGE_PREFIXES = (
    SIGNAGE_ROLE_PREFIX,
    'infrastructure/ansible/templates/signage',
    'infrastructure/ansible/tasks/preflight-signage.yml',
)
# These files execute from the immutable target checkout on the Pi5
# coordinator and are transferred to a terminal by the Ansible adapter when
# needed.  Changing them changes deployment control, not the product/runtime
# installed on every host, so they must not manufacture fleet-wide work.
DEPLOY_CONTROL_FILES = frozenset(
    {
        'scripts/deploy/classify-deploy-impact.py',
        'scripts/deploy/rollback-manifest.py',
        'scripts/deploy/rolling_release/coordinator.py',
        'scripts/deploy/rolling_release/backends/ansible.py',
        'scripts/deploy/terminal-runtime-manifest.py',
    }
)
SIGNAGE_RUNTIME_FILES = frozenset({'scripts/deploy/signage-runtime-proof.py'})
GLOBAL_PREFIXES = (
    'scripts/update-all-clients.sh',
    'infrastructure/ansible/playbooks/',
    'infrastructure/ansible/group_vars/',
    'infrastructure/ansible/inventory',
)
# Provably runtime-irrelevant paths: never require a Pi5 rebuild or terminal work.
NEUTRAL_PREFIXES = (
    'docs/',
    '.cursor/',
    '.agent/',
    '.github/',
    'scripts/deploy/tests/',
    'AGENTS.md',
    'README',
    'EXEC_PLAN.md',
)


def _is_server_path(path: str) -> bool:
    return path.startswith(SERVER_PREFIXES) or path in SERVER_FILES


def _is_signage_path(path: str) -> bool:
    return path.startswith(SIGNAGE_PREFIXES)


def _is_global_path(path: str) -> bool:
    return path.startswith(GLOBAL_PREFIXES)


def _component_for(path: str) -> str:
    if path.startswith(NEUTRAL_PREFIXES):
        return 'neutral'
    if path in DEPLOY_CONTROL_FILES:
        return 'deploy-control'
    if path in SIGNAGE_RUNTIME_FILES:
        return 'signage-role'
    if path.startswith(MIGRATION_PREFIX):
        return 'migration'
    if _is_server_path(path):
        return 'server-app'
    if path.startswith(NFC_PREFIX):
        return 'nfc-agent'
    if path.startswith(BARCODE_PREFIX):
        return 'barcode-agent'
    if path.startswith(STATUS_PREFIX):
        return 'status-agent'
    if path.startswith(KIOSK_ROLE_PREFIX):
        return 'kiosk-role'
    if path.startswith(CLIENT_ROLE_PREFIX):
        return 'client-role'
    if _is_signage_path(path):
        return 'signage-role'
    if _is_global_path(path):
        return 'global'
    return 'unknown'


def _mark_all(result: dict) -> None:
    result['server'] = result['kiosk'] = result['signage'] = True


def classify(paths):
    result = {
        'server': False,
        'kiosk': False,
        'signage': False,
        'migration': False,
        'paths': paths,
        'components': [],
    }
    components = set()
    for path in paths:
        component = _component_for(path)
        components.add(component)

        if component == 'neutral':
            continue

        if component == 'deploy-control':
            continue

        if component == 'unknown':
            # Fail-closed: unclassified paths expand to all terminal scopes.
            _mark_all(result)
            continue

        if component == 'global':
            _mark_all(result)
            continue

        if component == 'migration':
            result['migration'] = result['server'] = True
            continue

        if component == 'server-app':
            result['server'] = True
            continue

        if component == 'nfc-agent':
            result['kiosk'] = True
            continue

        if component == 'barcode-agent':
            result['kiosk'] = True
            continue

        if component == 'status-agent':
            # status-agent ships to every terminal (kiosk + signage) via deploy-staged.yml.
            result['kiosk'] = result['signage'] = True
            continue

        if component == 'kiosk-role':
            result['kiosk'] = True
            continue

        if component == 'client-role':
            # client role is applied on both kiosk and signage hosts in deploy-staged.yml.
            result['kiosk'] = result['signage'] = True
            continue

        if component == 'signage-role':
            result['signage'] = True
            continue

    result['components'] = sorted(components)
    return result


def changed_paths(base: str, head: str) -> list[str]:
    # Treat renames as a deletion plus an addition. Otherwise Git's rename
    # detection reports only the destination to --name-only, and moving a
    # runtime file into docs could incorrectly classify the removal as neutral.
    output = subprocess.check_output(
        ['git', 'diff', '--no-renames', '--name-only', base, head], text=True
    )
    return [line for line in output.splitlines() if line]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    args = parser.parse_args()
    print(json.dumps(classify(changed_paths(args.base, args.head)), ensure_ascii=False))


if __name__ == '__main__':
    main()
