"""Validated data passed across rolling-release execution boundaries."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any


NEW_RUN_ID_RE = re.compile(r'^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$')
SAFE_RUN_ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$')
FULL_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
UNIT_PREFIX = 'raspi-release-'
UNIT_SUFFIX = '.service'
_FORBIDDEN_REF_CHARACTERS = frozenset(' ~^:?*[\\')
STONEBASE_LOCAL_LIMIT = 'raspberrypi5:raspi4-kensaku-stonebase01'


def validate_lookup_run_id(run_id: str) -> str:
    if not isinstance(run_id, str) or not SAFE_RUN_ID_RE.fullmatch(run_id):
        raise ValueError('run ID contains unsupported characters')
    return run_id


def validate_new_run_id(run_id: str) -> str:
    validate_lookup_run_id(run_id)
    if not NEW_RUN_ID_RE.fullmatch(run_id):
        raise ValueError('new run ID must use YYYYMMDD-HHMMSS-<6 lowercase hex>')
    return run_id


def unit_name_for(run_id: str, *, require_new: bool = False) -> str:
    if require_new:
        validate_new_run_id(run_id)
    else:
        validate_lookup_run_id(run_id)
    return f'{UNIT_PREFIX}{run_id}{UNIT_SUFFIX}'


def validate_branch(branch: str) -> str:
    """Conservatively enforce the Git branch-name rules without shelling out."""
    if not isinstance(branch, str) or not branch or len(branch) > 255:
        raise ValueError('branch is missing or too long')
    if branch.startswith(('-', '/', '.')) or branch.endswith(('/', '.')):
        raise ValueError('branch has an unsafe boundary')
    if branch == '@' or '..' in branch or '//' in branch or '@{' in branch:
        raise ValueError('branch is not a valid Git ref')
    if any(component.endswith('.lock') or component.startswith('.') for component in branch.split('/')):
        raise ValueError('branch is not a valid Git ref')
    if any(ord(character) < 32 or ord(character) == 127 for character in branch):
        raise ValueError('branch contains a control character')
    if any(character in _FORBIDDEN_REF_CHARACTERS for character in branch):
        raise ValueError('branch contains a character forbidden in Git refs')
    return branch


def validate_inventory(inventory: str) -> str:
    if (
        not isinstance(inventory, str)
        or not inventory
        or len(inventory) > 1000
        or '\x00' in inventory
    ):
        raise ValueError('inventory is missing or malformed')
    path = PurePosixPath(inventory)
    if (
        path.is_absolute()
        or str(path) != inventory
        or any(part in ('', '.', '..') for part in path.parts)
    ):
        raise ValueError('remote inventory must be a normalized relative path')
    return inventory


def validate_text(value: str, *, name: str, maximum: int) -> str:
    if not isinstance(value, str) or '\x00' in value or len(value) > maximum:
        raise ValueError(f'{name} is malformed or too long')
    return value


@dataclass(frozen=True)
class LaunchSpec:
    run_id: str
    branch: str
    sha: str
    inventory: str
    expected_server_client_id: str
    limit: str = ''
    canary_hold_timeout: int = 1800
    emergency_override: bool = False
    reason: str | None = None
    skip_canary_hold: bool = False
    full_fleet: bool = False
    reverify_selected: bool = False
    stonebase_local_ansible_poc: bool = False

    @property
    def unit_name(self) -> str:
        return unit_name_for(self.run_id, require_new=True)

    def validate(self) -> LaunchSpec:
        validate_new_run_id(self.run_id)
        validate_branch(self.branch)
        if not isinstance(self.sha, str) or not FULL_SHA_RE.fullmatch(self.sha):
            raise ValueError('release SHA must be 40 lowercase hexadecimal characters')
        validate_inventory(self.inventory)
        if not isinstance(self.expected_server_client_id, str) or not re.fullmatch(
            r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', self.expected_server_client_id
        ):
            raise ValueError('expected server client ID is malformed')
        validate_text(self.limit, name='limit', maximum=1000)
        if type(self.canary_hold_timeout) is not int or self.canary_hold_timeout <= 0:
            raise ValueError('canary hold timeout must be greater than zero')
        if type(self.emergency_override) is not bool:
            raise ValueError('emergency override must be boolean')
        if (
            type(self.skip_canary_hold) is not bool
            or type(self.full_fleet) is not bool
            or type(self.reverify_selected) is not bool
            or type(self.stonebase_local_ansible_poc) is not bool
        ):
            raise ValueError('release flags must be boolean')
        if self.full_fleet and self.limit:
            raise ValueError('full fleet cannot be combined with a limit')
        if self.reverify_selected and not self.limit:
            raise ValueError('selected re-verification requires a limit')
        if self.stonebase_local_ansible_poc and self.limit != STONEBASE_LOCAL_LIMIT:
            raise ValueError(
                'StoneBase local Ansible POC requires the exact Pi5 + StoneBase limit'
            )
        if self.reason is not None:
            validate_text(self.reason, name='reason', maximum=1000)
            if not self.emergency_override:
                raise ValueError('reason is only valid with emergency override')
        if self.emergency_override and not (self.reason and self.reason.strip()):
            raise ValueError('emergency override requires a reason')
        if self.skip_canary_hold and not (
            self.emergency_override and self.reason and self.reason.strip()
        ):
            raise ValueError('skip canary hold requires emergency override and a reason')
        return self

    def bootstrap_payload(self, remote_project: str) -> dict[str, Any]:
        self.validate()
        if not isinstance(remote_project, str) or not os.path.isabs(remote_project):
            raise ValueError('remote project must be an absolute path')
        if os.path.normpath(remote_project) != remote_project or '\x00' in remote_project:
            raise ValueError('remote project must be a normalized absolute path')
        return {
            'version': 3,
            'project': remote_project,
            'runId': self.run_id,
            'unitName': self.unit_name,
            'branch': self.branch,
            'sha': self.sha,
            'inventory': self.inventory,
            'expectedServerClientId': self.expected_server_client_id,
            'limit': self.limit,
            'canaryHoldTimeout': self.canary_hold_timeout,
            'emergencyOverride': self.emergency_override,
            'reason': self.reason,
            'skipCanaryHold': self.skip_canary_hold,
            'fullFleet': self.full_fleet,
            'reverifySelected': self.reverify_selected,
            'stonebaseLocalAnsiblePoc': self.stonebase_local_ansible_poc,
        }


@dataclass(frozen=True)
class UnitObservation:
    unit_name: str
    reachable: bool
    load_state: str | None = None
    active_state: str | None = None
    sub_state: str | None = None
    result: str | None = None
    exec_main_code: str | None = None
    exec_main_status: int | None = None
    error: str | None = None
