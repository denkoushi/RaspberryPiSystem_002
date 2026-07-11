#!/usr/bin/env python3
import argparse
import json
import subprocess


def classify(paths):
    result = {'server': False, 'kiosk': False, 'signage': False, 'migration': False, 'paths': paths}
    for path in paths:
        if path.startswith('apps/api/prisma/migrations/'):
            result['migration'] = result['server'] = True
        if path.startswith(('apps/api/', 'apps/web/', 'packages/', 'infrastructure/docker/')) or path in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'):
            result['server'] = True
        if path.startswith(('clients/nfc-agent/', 'infrastructure/ansible/roles/client/', 'infrastructure/ansible/roles/kiosk/')):
            result['kiosk'] = True
        if 'signage' in path or path.startswith('infrastructure/ansible/roles/signage/'):
            result['signage'] = True
        if path.startswith(('scripts/update-all-clients.sh', 'infrastructure/ansible/playbooks/', 'infrastructure/ansible/group_vars/', 'infrastructure/ansible/inventory')):
            result['server'] = result['kiosk'] = result['signage'] = True
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    args = parser.parse_args()
    output = subprocess.check_output(['git', 'diff', '--name-only', args.base, args.head], text=True)
    print(json.dumps(classify([line for line in output.splitlines() if line]), ensure_ascii=False))


if __name__ == '__main__':
    main()
