#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from pathlib import Path

DEPLOY_DIRECTORY = Path(__file__).resolve().parent
if str(DEPLOY_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIRECTORY))

from terminal_profile_registry import (  # noqa: E402
    TerminalProfileRegistry,
    load_registry,
)


DEFAULT_REGISTRY = load_registry()


def _component_for(
    path: str, *, registry: TerminalProfileRegistry = DEFAULT_REGISTRY
) -> str:
    return registry.component_for(path)


def classify(paths, *, registry: TerminalProfileRegistry = DEFAULT_REGISTRY):
    result = {
        'server': False,
        'kiosk': False,
        'signage': False,
        'migration': False,
        'paths': paths,
        'components': [],
        'affectedProfiles': [],
    }
    components = set()
    for path in paths:
        component = _component_for(path, registry=registry)
        components.add(component)

        if component == 'unknown':
            # Fail closed without becoming a classifier error. Terminal scope
            # is expanded below from the complete registered profile set.
            result['server'] = True
            continue

        if component == 'global':
            result['server'] = True
            continue

        if component == 'migration':
            result['migration'] = result['server'] = True
            continue

        if component == 'server-app':
            result['server'] = True
            continue

    result['components'] = sorted(components)
    affected_profiles = registry.profiles_for_components(components)
    result['affectedProfiles'] = affected_profiles
    # Preserve the public compatibility fields while the registered profile
    # list can grow beyond the two production profiles.
    result['kiosk'] = 'kiosk' in affected_profiles
    result['signage'] = 'signage' in affected_profiles
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
