#!/usr/bin/env python3
"""Canonical, fail-closed rolling release coordinator.

The command deliberately owns release ordering and deploy-status mutations.
Ansible remains the host configuration executor; it must not decide which
terminal is in maintenance or whether the rollout continues.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIRECTORY = Path(__file__).resolve().parent
if str(SCRIPT_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIRECTORY))

from terminal_notice import (
    NOTICE_ACK_TIMEOUT_SECONDS,
    NOTICE_DURATION_SECONDS,
    should_issue_terminal_notice,
    terminal_notice_skip_reason,
)

PROJECT = Path(__file__).resolve().parents[2]
REMOTE_PROJECT = Path('/opt/RaspberryPiSystem_002')
ANSIBLE_DIRECTORY = PROJECT / 'infrastructure/ansible'
STATUS_TOOL = PROJECT / 'scripts/deploy/deploy-status-state.py'
PHASE3 = PROJECT / 'scripts/deploy/pi5-blue-green.sh'
CANDIDATE_BUILD = PROJECT / 'scripts/deploy/pi5-candidate-build.sh'
RUN_DIRECTORY = PROJECT / 'logs/deploy/release-runs'
PI5_RELEASE_CURRENT = PROJECT / 'logs/deploy/pi5-release-current.json'
OPERATOR_CANARY_APPROVAL_CLIENT = 'operator-canary-approval'
DEFAULT_CANARY_HOLD_TIMEOUT = 1800
FULL_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
CLEANUP_LOCK_CONFLICT = 'another Pi5 Blue/Green operation is running'
CLEANUP_LOCK_RETRY_TIMEOUT = 30
CLEANUP_LOCK_RETRY_INTERVAL = 2
ROLLING_RELEASE_LOCK_ENV = 'ROLLING_RELEASE_LOCK_HELD'
# Kiosk-scoped components used to detect barcode-agent-only rollouts.
KIOSK_SCOPE_COMPONENTS = frozenset({
    'nfc-agent',
    'barcode-agent',
    'status-agent',
    'kiosk-role',
    'client-role',
})


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def run(command: list[str], *, cwd: Path = PROJECT, capture: bool = False, env: dict[str, str] | None = None) -> str:
    result = subprocess.run(command, cwd=cwd, check=True, text=True, capture_output=capture, env=env)
    return result.stdout if capture else ''


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def release_targets(inventory: dict[str, Any], selected: Iterable[str] | None = None) -> list[dict[str, str]]:
    """Return canary kiosk, remaining kiosks, then signage in inventory order."""
    if not isinstance(inventory, dict):
        raise RuntimeError('inventory is malformed')
    metadata = inventory.get('_meta', {})
    if not isinstance(metadata, dict):
        raise RuntimeError('inventory metadata are malformed')
    hosts = metadata.get('hostvars', {})
    if not isinstance(hosts, dict):
        raise RuntimeError('inventory hostvars are malformed')
    if any(not isinstance(values, dict) for values in hosts.values()):
        raise RuntimeError('inventory host variables are malformed')

    group_hosts: dict[str, list[str]] = {}
    for group in ('kiosk', 'signage'):
        group_data = inventory.get(group, {})
        if not isinstance(group_data, dict):
            raise RuntimeError(f'inventory {group} group is malformed')
        values = group_data.get('hosts', [])
        if not isinstance(values, list) or any(not isinstance(host, str) for host in values):
            raise RuntimeError(f'inventory {group} group is malformed')
        if len(values) != len(set(values)):
            raise RuntimeError(f'inventory {group} group contains duplicate hosts')
        group_hosts[group] = values

    kiosk_group = set(group_hosts['kiosk'])
    signage_group = set(group_hosts['signage'])
    if kiosk_group & signage_group:
        raise RuntimeError('kiosk and signage groups must be disjoint')
    claimed_kiosks = {host for host, values in hosts.items() if values.get('manage_kiosk_browser') is True}
    claimed_signage = {host for host, values in hosts.items() if values.get('manage_signage_lite') is True}
    if kiosk_group != claimed_kiosks:
        raise RuntimeError('kiosk group does not match manage_kiosk_browser role claims')
    if signage_group != claimed_signage:
        raise RuntimeError('signage group does not match manage_signage_lite role claims')

    canary_group = inventory.get('kiosk_canary', {})
    if not isinstance(canary_group, dict):
        raise RuntimeError('inventory kiosk_canary group is malformed')
    canary_values = canary_group.get('hosts', [])
    if not isinstance(canary_values, list) or any(not isinstance(host, str) for host in canary_values):
        raise RuntimeError('inventory kiosk_canary group is malformed')
    if len(canary_values) != len(set(canary_values)):
        raise RuntimeError('inventory kiosk_canary group contains duplicate hosts')
    canary_hosts = set(canary_values)
    if not canary_hosts <= kiosk_group:
        raise RuntimeError('kiosk_canary hosts must belong to the kiosk group')

    # ``None`` means no --limit.  An explicit empty selection is meaningful:
    # it must never widen a Pi5-only or zero-match limit into a fleet rollout.
    selected_set = set(hosts if selected is None else selected)
    all_targets: dict[str, list[dict[str, str]]] = {'kiosk': [], 'signage': []}
    client_ids: set[str] = set()
    for group in ('kiosk', 'signage'):
        for host in group_hosts[group]:
            values = hosts.get(host)
            client_id = values.get('status_agent_client_id') if isinstance(values, dict) else None
            if not isinstance(client_id, str) or not client_id:
                raise RuntimeError(f'{group} host {host} is missing status_agent_client_id')
            if client_id in client_ids:
                raise RuntimeError(f'duplicate status_agent_client_id in release targets: {client_id}')
            client_ids.add(client_id)
            all_targets[group].append({'host': host, 'clientId': client_id, 'terminalType': group})

    targets = {
        group: [target for target in all_targets[group] if target['host'] in selected_set]
        for group in ('kiosk', 'signage')
    }
    kiosks = targets['kiosk']
    return [item for item in kiosks if item['host'] in canary_hosts] + [
        item for item in kiosks if item['host'] not in canary_hosts
    ] + targets['signage']


@dataclass
class ReleaseState:
    path: Path
    payload: dict[str, Any]

    def save(self) -> None:
        self.payload['updatedAt'] = utc_now()
        atomic_json(self.path, self.payload)

    def target(self, host: str) -> dict[str, Any]:
        for target in self.payload['targets']:
            if target['host'] == host:
                return target
        raise KeyError(host)


def status_file(run_id: str) -> Path:
    return RUN_DIRECTORY / f'{run_id}.json'


def inventory_json(path: str) -> dict[str, Any]:
    return json.loads(run(['ansible-inventory', '-i', path, '--list'], capture=True))


def selected_hosts(path: str, limit: str) -> list[str] | None:
    if not limit:
        return None
    output = run(['ansible', '-i', path, 'server:clients', '--list-hosts', '--limit', limit], capture=True)
    return [line.strip() for line in output.splitlines() if line.strip() and not line.lstrip().startswith('hosts')]


def state_command(*arguments: str) -> None:
    run(['python3', str(STATUS_TOOL), '--file', str(PROJECT / 'config/deploy-status.json'), *arguments])


def acknowledgement_record(run_id: str, client_id: str) -> dict[str, Any] | None:
    try:
        value = json.loads((PROJECT / 'config/deploy-status.json').read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    record = ((value.get('acknowledgements') or {}).get(run_id) or {}).get(client_id)
    return record if isinstance(record, dict) else None


def acknowledgement_received(run_id: str, client_id: str, *, phase: str = 'maintenance') -> bool:
    record = acknowledgement_record(run_id, client_id)
    if record is None:
        return False
    # Existing in-flight maintenance entries use the previous flat record.
    if phase == 'maintenance' and isinstance(record.get('acknowledgedAt'), str):
        return True
    return isinstance(record.get(phase), dict) and isinstance(record[phase].get('acknowledgedAt'), str)


def wait_for_ack(run_id: str, client_id: str, timeout: int = 30, *, phase: str = 'maintenance') -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if acknowledgement_received(run_id, client_id, phase=phase):
            return True
        time.sleep(5)
    return acknowledgement_received(run_id, client_id, phase=phase)


def notice_scheduled_at(run_id: str, client_id: str) -> str | None:
    try:
        value = json.loads((PROJECT / 'config/deploy-status.json').read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    entry = ((value.get('kioskByClient') or {}).get(client_id) or {})
    scheduled_at = entry.get('scheduledAt') if entry.get('runId') == run_id else None
    return scheduled_at if isinstance(scheduled_at, str) else None


def wait_for_notice_deadline(scheduled_at: str) -> None:
    try:
        deadline = datetime.fromisoformat(scheduled_at.replace('Z', '+00:00')).timestamp()
    except ValueError as error:
        raise RuntimeError(f'notice schedule is invalid: {scheduled_at!r}') from error
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            return
        time.sleep(min(5, max(1, remaining)))


def deliver_terminal_notice(state: ReleaseState, target_spec: dict[str, str], target: dict[str, Any], run_id: str) -> None:
    """Display and verify the 60-second save-work notice before maintenance."""
    target['notice'] = {'state': 'requested', 'requestedAt': utc_now(), 'durationSeconds': NOTICE_DURATION_SECONDS}
    state.save()
    state_command(
        'put-notice', '--run-id', run_id, '--clients', target_spec['clientId'],
        '--terminal-type', 'kiosk', '--duration-seconds', str(NOTICE_DURATION_SECONDS),
    )
    try:
        if not wait_for_ack(run_id, target_spec['clientId'], NOTICE_ACK_TIMEOUT_SECONDS, phase='notice'):
            raise RuntimeError(f'pre-deploy notice acknowledgement timed out for {target_spec["host"]}')
        scheduled_at = notice_scheduled_at(run_id, target_spec['clientId'])
        if not scheduled_at:
            raise RuntimeError(f'pre-deploy notice schedule is missing for {target_spec["host"]}')
        target['notice'].update({'state': 'acknowledged', 'acknowledgedAt': utc_now(), 'scheduledAt': scheduled_at})
        state.save()
        wait_for_notice_deadline(scheduled_at)
        target['notice'].update({'state': 'completed', 'completedAt': utc_now()})
        state.save()
    except Exception:
        # No deployment has begun while the notice is active, so it must not
        # leave the terminal with an obsolete warning after a failed run.
        state_command('remove-client', '--run-id', run_id, '--client', target_spec['clientId'])
        target['notice'].update({'state': 'failed', 'failedAt': utc_now()})
        state.save()
        raise


def canary_hold_record(run_id: str) -> dict[str, Any]:
    """Read the lock-protected operator gate rather than generic terminal ACKs."""
    output = run([
        'python3', str(STATUS_TOOL), '--file', str(PROJECT / 'config/deploy-status.json'),
        'canary-hold-state', '--run-id', run_id,
    ], capture=True)
    record = json.loads(output)
    if not isinstance(record, dict):
        raise RuntimeError('canary hold state is malformed')
    return record


def wait_for_canary_approval(run_id: str, timeout: int) -> dict[str, Any]:
    """Wait for the one-time canary gate; expiry and approval share one lock."""
    deadline = time.monotonic() + timeout
    while True:
        record = canary_hold_record(run_id)
        gate_state = record.get('state')
        if gate_state == 'approved':
            return record
        if gate_state == 'expired':
            raise RuntimeError(
                f'canary hold timed out after {timeout}s waiting for operator approval '
                f'(client={OPERATOR_CANARY_APPROVAL_CLIENT})'
            )
        if gate_state != 'waiting-verification':
            raise RuntimeError(f'canary hold entered unexpected state: {gate_state!r}')

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            # `expire-canary-hold` and `approve` transition the same record while
            # holding StatusLock.  Whichever wins is the only terminal outcome.
            state_command('expire-canary-hold', '--run-id', run_id)
            record = canary_hold_record(run_id)
            if record.get('state') == 'approved':
                return record
            raise RuntimeError(
                f'canary hold timed out after {timeout}s waiting for operator approval '
                f'(client={OPERATOR_CANARY_APPROVAL_CLIENT})'
            )
        time.sleep(min(5, max(1, remaining)))


def should_hold_after_canary(targets: list[dict[str, str]], index: int, *, skip: bool) -> bool:
    """Hold only after the first target when later hosts remain and kiosks are in scope."""
    if skip or index != 0 or index + 1 >= len(targets):
        return False
    return any(target.get('terminalType') == 'kiosk' for target in targets)


def wait_for_canary_hold(state: ReleaseState, run_id: str, canary_host: str, timeout: int) -> None:
    if timeout <= 0:
        raise RuntimeError('canary hold timeout must be greater than zero')
    expires_at = int(time.time()) + timeout
    state.payload['canaryHold'] = {
        'state': 'waiting-verification',
        'canary': canary_host,
        'since': utc_now(),
        'expiresAt': expires_at,
    }
    state.save()
    # The release-run state is written first.  If the gate cannot be opened,
    # approval remains impossible and the outer release path fails closed.
    state_command(
        'open-canary-hold', '--run-id', run_id, '--canary', canary_host,
        '--expires-at', str(expires_at),
    )
    print(
        f'Canary verification pending. Approve with: scripts/update-all-clients.sh --approve {run_id}',
        flush=True,
    )
    state.payload['canaryHold'].update(wait_for_canary_approval(run_id, timeout))
    state.save()


def prestage_signage_maintenance(inventory: str, host: str, run_id: str, client_id: str) -> None:
    """Bootstrap the first Pi3 maintenance display before its repository update.

    Later releases are acknowledged by signage-update.sh itself.  The initial
    installation has no such code yet, so the controller verifies the rendered
    local screen and records a clearly labelled controller acknowledgement.
    """
    source = ANSIBLE_DIRECTORY / 'roles/signage/templates/signage-maintenance.svg.j2'
    run(['ansible', '-i', inventory, host, '-b', '-m', 'apt', '-a', 'name=librsvg2-bin state=present update_cache=yes'])
    run(['ansible', '-i', inventory, host, '-b', '-m', 'copy', '-a', f'src={source} dest=/usr/local/share/signage-maintenance.svg mode=0644'])
    command = (
        'set -e; mkdir -p /run/signage; '
        'rsvg-convert -f png -w 1920 -h 1080 /usr/local/share/signage-maintenance.svg -o /run/signage/current.tmp.jpg; '
        'if test -f /run/signage/current.jpg; then cat /run/signage/current.tmp.jpg > /run/signage/current.jpg; rm -f /run/signage/current.tmp.jpg; '
        'else mv /run/signage/current.tmp.jpg /run/signage/current.jpg; fi'
    )
    run(['ansible', '-i', inventory, host, '-b', '-m', 'shell', '-a', command])
    state_command('ack', '--run-id', run_id, '--client', client_id)


def remote_previous_sha(inventory: str, host: str) -> str:
    output = run(['ansible', '-i', inventory, host, '-b', '-m', 'command', '-a', 'git -C /opt/RaspberryPiSystem_002 rev-parse HEAD'], capture=True)
    for line in output.splitlines():
        candidate = line.strip()
        if len(candidate) == 40 and all(ch in '0123456789abcdef' for ch in candidate):
            return candidate
    raise RuntimeError(f'could not resolve previous SHA for {host}: {output}')


def playbook(inventory: str, host: str, revision: str, run_id: str, *, rollback: bool = False) -> None:
    env = os.environ.copy()
    env.update({'ANSIBLE_REPO_VERSION': revision, 'RUN_ID': run_id, 'RELEASE_ORCHESTRATED': '1'})
    extra = 'release_orchestrated=true release_rollback=' + ('true' if rollback else 'false')
    # roles_path and vault_password_file in ansible.cfg are relative to the
    # Ansible project.  Run from that directory rather than the repository
    # root so a remote coordinator resolves the same roles as local CI.
    run(
        ['ansible-playbook', '-i', inventory, str(ANSIBLE_DIRECTORY / 'playbooks/deploy-staged.yml'), '--limit', host, '-e', extra],
        cwd=ANSIBLE_DIRECTORY,
        env=env,
    )


def phase3_release(sha: str, state: ReleaseState) -> None:
    run([str(CANDIDATE_BUILD), '--ref', sha])
    candidate = json.loads((PROJECT / 'logs/deploy/pi5-image-deploy-state.json').read_text(encoding='utf-8'))['candidate']
    run([str(PHASE3), 'prepare', '--api-image', candidate['api'], '--web-image', candidate['web']])
    run([str(PHASE3), 'switch'])
    state.payload['pi5'] = {'candidate': candidate, 'state': 'stability-monitoring'}
    state.save()


def wait_for_pi5_stability(state: ReleaseState) -> None:
    """Wait for Phase 3's rollback window before touching a terminal.

    ``switch`` starts the existing five-minute monitor asynchronously.  A
    successful switch alone is therefore not a release success: the terminal
    rollout must wait until that monitor has either completed consistently or
    reported an error.
    """
    while True:
        phase3 = json.loads(run([str(PHASE3), 'status'], capture=True))
        if phase3.get('runtimeStatus') != 'consistent':
            raise RuntimeError('Pi5 Blue/Green monitor reported inconsistent state')
        stable_until = phase3.get('stableUntil')
        if not isinstance(stable_until, int) or stable_until <= int(time.time()):
            break
        time.sleep(min(5, max(1, stable_until - int(time.time()))))
    cleanup_after_pi5_stability()
    state.payload['pi5']['state'] = 'stable'
    state.save()


def cleanup_after_pi5_stability() -> None:
    """Run Phase 3 cleanup after the monitor releases its inherited flock.

    ``switch`` starts the monitor before its flock-owning process exits. The
    child inherits that descriptor, so a cleanup launched exactly at the end of
    the stability window can see a brief, expected lock conflict. Retry only
    that exact pre-side-effect failure, and re-check lock-free Phase 3 status
    before each retry. Every other cleanup error remains terminal.
    """
    deadline = time.monotonic() + CLEANUP_LOCK_RETRY_TIMEOUT
    while True:
        try:
            stdout = run([str(PHASE3), 'cleanup'], capture=True)
            if stdout:
                print(stdout, end='' if stdout.endswith('\n') else '\n')
            return
        except subprocess.CalledProcessError as error:
            stdout = error.stdout or ''
            stderr = error.stderr or ''
            if stdout:
                print(stdout, end='' if stdout.endswith('\n') else '\n')
            if stderr:
                print(stderr, end='' if stderr.endswith('\n') else '\n', file=sys.stderr)
            if CLEANUP_LOCK_CONFLICT not in stderr:
                raise
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    f'Pi5 cleanup remained locked for {CLEANUP_LOCK_RETRY_TIMEOUT}s after stability monitoring',
                ) from error
            phase3 = json.loads(run([str(PHASE3), 'status'], capture=True))
            if phase3.get('runtimeStatus') != 'consistent':
                raise RuntimeError('Pi5 Blue/Green state became inconsistent while waiting to clean up') from error
            stable_until = phase3.get('stableUntil')
            if isinstance(stable_until, int) and stable_until > int(time.time()):
                raise RuntimeError('Pi5 stability window resumed while waiting to clean up') from error
            time.sleep(min(CLEANUP_LOCK_RETRY_INTERVAL, max(1, deadline - time.monotonic())))


def read_pi5_release_current() -> dict[str, Any] | None:
    """Return the durable Pi5 success marker, or None when absent/unreadable."""
    try:
        payload = json.loads(PI5_RELEASE_CURRENT.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def read_plan_pi5_release_current() -> tuple[dict[str, Any] | None, list[str]]:
    """Read the Pi5 success marker for a local shadow plan without changing it."""
    host = os.environ.get('RASPI_SERVER_HOST')
    if not host:
        return None, ['Pi5 release marker unavailable: RASPI_SERVER_HOST is required for classification']
    try:
        result = subprocess.run(
            ['ssh', host, 'cat /opt/RaspberryPiSystem_002/logs/deploy/pi5-release-current.json'],
            check=True,
            text=True,
            capture_output=True,
        )
        payload = json.loads(result.stdout)
    except Exception as error:
        return None, [f'Pi5 release marker unavailable: {error}']
    if not isinstance(payload, dict):
        return None, ['Pi5 release marker unavailable: marker is not an object']
    return payload, []


def record_pi5_release_current(sha: str, candidate: dict[str, Any] | None) -> None:
    """Persist the SHA only after Phase 3 release and stability both succeed."""
    atomic_json(PI5_RELEASE_CURRENT, {
        'sha': sha,
        'candidate': candidate or {},
        'completedAt': utc_now(),
    })


def candidate_image_matches_sha(image: Any, sha: str) -> bool:
    """Accept only the immutable candidate tag produced for this full SHA."""
    if not isinstance(image, str) or not isinstance(sha, str):
        return False
    _repository, separator, tag = image.rpartition(':')
    return bool(
        _repository
        and separator
        and FULL_SHA_RE.fullmatch(sha)
        and re.fullmatch(re.escape(sha) + r'-[0-9a-f]{12}', tag)
    )


def marker_candidate_for_sha(marker: dict[str, Any], sha: str) -> dict[str, str] | None:
    """Return a complete immutable marker candidate, or None on any ambiguity."""
    candidate = marker.get('candidate')
    if not isinstance(candidate, dict):
        return None
    api, web = candidate.get('api'), candidate.get('web')
    if not candidate_image_matches_sha(api, sha) or not candidate_image_matches_sha(web, sha):
        return None
    return {'api': api, 'web': web}


def phase3_matches_marker_candidate(phase3: Any, candidate: dict[str, str]) -> bool:
    """Require Phase 3 routing and the live slot image pair to match the marker."""
    if not isinstance(phase3, dict) or phase3.get('runtimeStatus') != 'consistent':
        return False
    active_slot = phase3.get('activeSlot')
    if active_slot not in {'blue', 'green'}:
        return False
    gateway = phase3.get('gateway')
    if not isinstance(gateway, dict) or gateway.get('mode') != 'application' or gateway.get('slot') != active_slot:
        return False
    slots = phase3.get('slots')
    active = slots.get(active_slot) if isinstance(slots, dict) else None
    images = active.get('images') if isinstance(active, dict) else None
    return isinstance(images, dict) and images.get('api') == candidate['api'] and images.get('web') == candidate['web']


def pi5_already_current(sha: str) -> bool:
    """Skip B/G only when marker, immutable images, routing, and live state agree."""
    if not isinstance(sha, str) or not FULL_SHA_RE.fullmatch(sha):
        return False
    marker = read_pi5_release_current()
    if not isinstance(marker, dict) or marker.get('sha') != sha:
        return False
    candidate = marker_candidate_for_sha(marker, sha)
    if candidate is None:
        return False
    try:
        phase3 = json.loads(run([str(PHASE3), 'status'], capture=True))
    except Exception:
        return False
    return phase3_matches_marker_candidate(phase3, candidate)


def phase3_status() -> dict[str, Any]:
    """Read the Phase 3 status contract, rejecting malformed output."""
    payload = json.loads(run([str(PHASE3), 'status'], capture=True))
    if not isinstance(payload, dict):
        raise RuntimeError('Pi5 Blue/Green status is malformed')
    return payload


def normalized_pi5_phase3_state(phase3: dict[str, Any]) -> bool:
    """Return whether Phase 3 is a single-slot, post-cleanup state."""
    active = phase3.get('activeSlot')
    gateway = phase3.get('gateway')
    monitor = phase3.get('monitor')
    slots = phase3.get('slots')
    active_state = slots.get(active) if isinstance(slots, dict) and isinstance(active, str) else None
    images = active_state.get('images') if isinstance(active_state, dict) else None
    return bool(
        phase3.get('runtimeStatus') == 'consistent'
        and active in {'blue', 'green'}
        and phase3.get('previousSlot') is None
        and phase3.get('candidateSlot') is None
        and phase3.get('stableUntil') is None
        and isinstance(gateway, dict)
        and gateway.get('mode') == 'application'
        and gateway.get('slot') == active
        and isinstance(monitor, dict)
        and monitor.get('activeSlot') is None
        and monitor.get('rollbackSlot') is None
        and isinstance(images, dict)
        and isinstance(images.get('api'), str)
        and bool(images.get('api'))
        and isinstance(images.get('web'), str)
        and bool(images.get('web'))
    )


def recover_expired_pi5_handoff(state: ReleaseState) -> bool:
    """Complete only a proven-safe expired prior handoff before preparing a new one.

    A release can fail after the five-minute monitor but before the coordinator
    calls cleanup.  Phase 3 then correctly keeps the public slot as scheduler
    standby, so another ``prepare`` cannot start.  Only the exact consistent,
    expired two-slot handoff shape may be completed here; every other state is
    ambiguous and must stop before candidate build or mutation.
    """
    phase3 = phase3_status()
    if phase3.get('state') == 'not-initialized':
        return False
    if phase3.get('runtimeStatus') != 'consistent':
        raise RuntimeError('Pi5 Blue/Green state is not consistent before release preflight')

    active = phase3.get('activeSlot')
    previous = phase3.get('previousSlot')
    candidate = phase3.get('candidateSlot')
    stable_until = phase3.get('stableUntil')
    has_prior_handoff = previous is not None or candidate is not None or stable_until is not None
    if not has_prior_handoff:
        if normalized_pi5_phase3_state(phase3):
            return False
        raise RuntimeError('Pi5 Phase 3 state is not normalized before release preflight')

    gateway = phase3.get('gateway')
    monitor = phase3.get('monitor')
    if (
        active not in {'blue', 'green'}
        or previous not in {'blue', 'green'}
        or candidate != previous
        or previous == active
        or not isinstance(stable_until, int)
        or not isinstance(gateway, dict)
        or gateway.get('mode') != 'application'
        or gateway.get('slot') != active
        or not isinstance(monitor, dict)
        or monitor.get('activeSlot') != active
        or monitor.get('rollbackSlot') != previous
    ):
        raise RuntimeError('Pi5 prior handoff state is incomplete or unsafe; refusing preflight cleanup')
    if stable_until > int(time.time()):
        raise RuntimeError('Pi5 prior stability window is still active; refusing new release preflight')

    print('Pi5 prior handoff is expired and consistent; completing cleanup before new candidate build')
    # The monitor handoff retry is only for the coordinator that created this
    # window.  A later release must treat any lock conflict as a real competing
    # mutation and fail closed rather than retrying it as though it were ours.
    run([str(PHASE3), 'cleanup'])
    if not normalized_pi5_phase3_state(phase3_status()):
        raise RuntimeError('Pi5 cleanup did not produce a normalized Phase 3 state')
    state.payload['pi5HandoffRecovery'] = {
        'state': 'expired-handoff-cleaned',
        'activeSlot': active,
        'previousSlot': previous,
        'completedAt': utc_now(),
    }
    state.save()
    return True


def ensure_pi5_release(sha: str, state: ReleaseState) -> None:
    recover_expired_pi5_handoff(state)
    if pi5_already_current(sha):
        state.payload['pi5'] = {'state': 'already-current', 'sha': sha}
        state.save()
        return
    phase3_release(sha, state)
    wait_for_pi5_stability(state)
    record_pi5_release_current(sha, (state.payload.get('pi5') or {}).get('candidate'))


def rollback_terminal(inventory: str, target_spec: dict[str, str], target: dict[str, Any], run_id: str) -> bool:
    """Restore one failed terminal and decide whether its maintenance may clear."""
    try:
        playbook(inventory, target_spec['host'], target['previousSha'], run_id, rollback=True)
        target['rollback'] = 'success'
        # The old revision and its services are healthy again, so return only
        # this terminal to its normal display.  The release itself still ends
        # in failure and never advances to another target.
        state_command('remove-client', '--run-id', run_id, '--client', target_spec['clientId'])
        target['maintenanceClearedAt'] = utc_now()
        return True
    except Exception as rollback_error:
        target['rollback'] = f'failed: {rollback_error}'
        # An unrecovered terminal must remain visibly in maintenance rather
        # than exposing a partial deployment.
        state_command('set-phase', '--run-id', run_id, '--phase', 'failed')
        return False


def pi5_release_required(sha: str) -> bool:
    """Use the existing path classifier; unknown classification is fail-closed."""
    classification, _ = classify_release_impact(sha, read_pi5_release_current())
    if classification is None:
        return True
    return bool(classification.get('server') or classification.get('migration'))


def apply_auto_minimize(
    targets: list[dict[str, str]],
    inventory: dict[str, Any],
    classification: dict[str, Any] | None,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    """Narrow terminal targets from classification; on doubt, keep or widen scope."""
    if classification is None:
        return targets, {
            'autoMinimize': True,
            'minimized': False,
            'excludedHosts': [],
            'classificationComponents': None,
            'reason': 'classification unavailable',
        }

    components = list(classification.get('components') or [])
    components_set = set(components)
    if 'unknown' in components_set or 'global' in components_set:
        # Fail-closed: unknown/global impact must touch every terminal.
        return targets, {
            'autoMinimize': True,
            'minimized': False,
            'excludedHosts': [],
            'classificationComponents': sorted(components_set),
            'reason': 'unknown or global component',
        }

    include_kiosk = bool(classification.get('kiosk'))
    include_signage = bool(classification.get('signage'))
    kiosk_components = components_set & KIOSK_SCOPE_COMPONENTS
    barcode_only = include_kiosk and kiosk_components == {'barcode-agent'}
    hostvars = (inventory.get('_meta') or {}).get('hostvars')
    # Missing hostvars cannot safely decide barcode ownership → keep all kiosks.
    if barcode_only and not isinstance(hostvars, dict):
        barcode_only = False

    filtered: list[dict[str, str]] = []
    for target in targets:
        terminal_type = target.get('terminalType')
        if terminal_type == 'kiosk':
            if not include_kiosk:
                continue
            if barcode_only:
                values = hostvars.get(target['host']) if isinstance(hostvars, dict) else None
                if not isinstance(values, dict):
                    # Per-host vars missing: fail-closed keep the kiosk.
                    filtered.append(target)
                    continue
                if values.get('barcode_agent_enabled') is True:
                    filtered.append(target)
                continue
            filtered.append(target)
        elif terminal_type == 'signage':
            if include_signage:
                filtered.append(target)
        else:
            filtered.append(target)

    kept = {target['host'] for target in filtered}
    excluded = [target['host'] for target in targets if target['host'] not in kept]
    return filtered, {
        'autoMinimize': True,
        'minimized': bool(excluded),
        'excludedHosts': excluded,
        'classificationComponents': sorted(components_set),
    }


def resolve_release_sha(branch: str) -> tuple[str | None, list[str]]:
    """Resolve branch SHA without mutating the local checkout (print-plan safe).

    Prefer the remote tip so the plan reflects what a deploy would actually
    ship; an unfetched local origin/<branch> ref may be stale.
    """
    try:
        output = run(['git', '-C', str(PROJECT), 'ls-remote', 'origin', branch], capture=True).strip()
        sha = output.split()[0] if output else ''
        if sha:
            return sha, []
    except Exception:
        pass
    try:
        sha = run(['git', '-C', str(PROJECT), 'rev-parse', f'origin/{branch}'], capture=True).strip()
        if sha:
            return sha, [f'used local origin/{branch} ref; remote unreachable']
        return None, [f'could not resolve SHA for branch {branch}']
    except Exception as error:
        return None, [f'could not resolve SHA for branch {branch}: {error}']


def classify_release_impact(
    sha: str,
    release_marker: dict[str, Any] | None,
) -> tuple[dict[str, Any] | None, list[str]]:
    """Classify the delta from the durable last-successful Pi5 release.

    ``origin/main`` is deliberately not a baseline: post-merge main releases
    would compare a commit to itself.  Without a usable durable baseline the
    caller must retain the full scope and require Pi5 (fail-closed).
    """
    base = (release_marker or {}).get('sha')
    if not isinstance(base, str) or not FULL_SHA_RE.fullmatch(base):
        return None, ['classification unavailable: last-successful Pi5 release SHA is missing or invalid']
    if base == sha:
        # Pi5 can have completed while a later terminal or canary step failed.
        # A Pi5-only marker cannot prove that every terminal is already current.
        return None, ['classification unavailable: target matches the Pi5 marker; terminal state is not a safe baseline']
    try:
        run(['git', '-C', str(PROJECT), 'merge-base', '--is-ancestor', base, sha], capture=True)
        result = json.loads(run([
            'python3', str(PROJECT / 'scripts/deploy/classify-deploy-impact.py'),
            '--base', base, '--head', sha,
        ], capture=True))
        return result, []
    except Exception as error:
        return None, [f'classification unavailable: last-successful Pi5 release SHA is not an ancestor of target: {error}']


def resolve_terminal_targets(inventory: str, limit: str) -> tuple[list[dict[str, str]] | None, list[str]]:
    """Resolve rollout-ordered terminals when local ansible is available."""
    try:
        targets = release_targets(inventory_json(inventory), selected_hosts(inventory, limit))
        return targets, []
    except Exception:
        return None, ['ansible-inventory unavailable']


def build_print_plan(branch: str, inventory: str, limit: str, *, auto_minimize: bool = False) -> dict[str, Any]:
    """Auditable shadow plan for --print-plan; always returns JSON-serializable data."""
    warnings: list[str] = []
    sha, sha_warnings = resolve_release_sha(branch)
    warnings.extend(sha_warnings)

    classification: dict[str, Any] | None = None
    pi5_required: bool | None = None
    if sha:
        release_marker, marker_warnings = read_plan_pi5_release_current()
        warnings.extend(marker_warnings)
        classification, class_warnings = classify_release_impact(sha, release_marker)
        warnings.extend(class_warnings)
        if classification is not None:
            pi5_required = bool(classification.get('server') or classification.get('migration'))
        else:
            pi5_required = True

    terminal_targets, target_warnings = resolve_terminal_targets(inventory, limit)
    warnings.extend(target_warnings)

    excluded_hosts: list[str] = []
    minimized = False
    classification_components = (
        list(classification.get('components') or []) if classification is not None else None
    )
    if auto_minimize and terminal_targets is not None:
        try:
            inventory_data = inventory_json(inventory)
        except Exception:
            inventory_data = {}
        terminal_targets, minimize_meta = apply_auto_minimize(
            terminal_targets, inventory_data, classification,
        )
        excluded_hosts = list(minimize_meta.get('excludedHosts') or [])
        minimized = bool(minimize_meta.get('minimized'))
        classification_components = minimize_meta.get('classificationComponents')

    canary_hold = None if terminal_targets is None else should_hold_after_canary(terminal_targets, 0, skip=False)

    return {
        'mode': 'rolling-release',
        'branch': branch,
        'inventory': inventory,
        'limit': limit or None,
        'sha': sha,
        'classification': classification,
        'pi5Required': pi5_required,
        'terminalTargets': terminal_targets,
        'canaryHold': canary_hold,
        'autoMinimize': auto_minimize,
        'minimized': minimized,
        'excludedHosts': excluded_hosts,
        'classificationComponents': classification_components,
        'warnings': warnings,
    }


def _remote_run(args: argparse.Namespace) -> int:
    inventory = str(Path(args.inventory) if Path(args.inventory).is_absolute() else ANSIBLE_DIRECTORY / args.inventory)
    inventory_data = inventory_json(inventory)
    selected = selected_hosts(inventory, args.limit)
    if args.limit and selected == []:
        raise RuntimeError(f'--limit selected no hosts: {args.limit}')
    targets = release_targets(inventory_data, selected)
    # Empty terminals without --limit means inventory selection is broken.
    if not targets and not args.limit:
        raise RuntimeError('no kiosk or signage targets selected')

    classification: dict[str, Any] | None = None
    plan_minimize: dict[str, Any] = {
        'autoMinimize': False,
        'minimized': False,
        'excludedHosts': [],
        'classificationComponents': None,
    }
    if args.auto_minimize:
        classification, _ = classify_release_impact(args.sha, read_pi5_release_current())
        targets, plan_minimize = apply_auto_minimize(targets, inventory_data, classification)

    if classification is not None:
        pi5_required = bool(classification.get('server') or classification.get('migration'))
    else:
        pi5_required = pi5_release_required(args.sha)

    plan = {
        'pi5Required': pi5_required,
        'targets': [target['host'] for target in targets],
        'limit': args.limit or None,
        **plan_minimize,
    }

    # --limit may intentionally select zero terminals; only Pi5 work is valid then.
    # --auto-minimize may also reduce to zero when only server/migration changed.
    if not targets and not pi5_required:
        if args.auto_minimize:
            path = status_file(args.run_id)
            state = ReleaseState(path, {
                'version': 1, 'runId': args.run_id, 'branch': args.branch, 'releaseSha': args.sha,
                'startedAt': utc_now(), 'state': 'success',
                'targets': [],
                'pi5': {'state': 'not-required'},
                'plan': plan,
            })
            state.save()
            return 0
        raise RuntimeError('no kiosk or signage targets selected')

    path = status_file(args.run_id)
    state = ReleaseState(path, {
        'version': 1, 'runId': args.run_id, 'branch': args.branch, 'releaseSha': args.sha,
        'startedAt': utc_now(), 'state': 'running',
        'targets': [{**target, 'state': 'pending'} for target in targets],
        'plan': plan,
    })
    state.save()
    try:
        if pi5_required:
            ensure_pi5_release(args.sha, state)
        else:
            state.payload['pi5'] = {'state': 'not-required'}
            state.save()
        for index, target_spec in enumerate(targets):
            target = state.target(target_spec['host'])
            target['previousSha'] = remote_previous_sha(inventory, target_spec['host'])
            if should_issue_terminal_notice(
                terminal_type=target_spec['terminalType'], emergency_override=args.emergency_override,
            ):
                deliver_terminal_notice(state, target_spec, target, args.run_id)
            else:
                target['notice'] = {
                    'state': 'skipped',
                    'reason': terminal_notice_skip_reason(
                        terminal_type=target_spec['terminalType'], emergency_override=args.emergency_override,
                    ),
                    'skippedAt': utc_now(),
                }
                state.save()
            target['state'] = 'maintenance-requested'
            target['maintenanceStartedAt'] = utc_now()
            state.save()
            state_command('put', '--run-id', args.run_id, '--clients', target_spec['clientId'], '--terminal-type', target_spec['terminalType'])
            if target_spec['terminalType'] == 'signage':
                prestage_signage_maintenance(inventory, target_spec['host'], args.run_id, target_spec['clientId'])
            if not wait_for_ack(args.run_id, target_spec['clientId'], phase='maintenance'):
                if not args.emergency_override:
                    raise RuntimeError(f'maintenance acknowledgement timed out for {target_spec["host"]}')
                target['ackOverrideReason'] = args.reason
            target['acknowledgedAt'] = utc_now()
            target['state'] = 'deploying'
            state.save()
            state_command('set-phase', '--run-id', args.run_id, '--phase', 'deploying')
            try:
                playbook(inventory, target_spec['host'], args.sha, args.run_id)
                target['newSha'] = args.sha
                target['state'] = 'success'
                target['completedAt'] = utc_now()
                state_command('remove-client', '--run-id', args.run_id, '--client', target_spec['clientId'])
                state.save()
            except Exception as error:
                target['state'] = 'rolling-back'
                target['failure'] = str(error)
                state.save()
                rollback_terminal(inventory, target_spec, target, args.run_id)
                target['state'] = 'failed'
                target['completedAt'] = utc_now()
                state.save()
                raise RuntimeError(f'rollout stopped after {target_spec["host"]} failed') from error
            if should_hold_after_canary(targets, index, skip=args.skip_canary_hold):
                wait_for_canary_hold(state, args.run_id, target_spec['host'], args.canary_hold_timeout)
        state.payload['state'] = 'success'
        state.save()
        return 0
    except Exception as error:
        state.payload['state'] = 'failed'
        state.payload['failure'] = str(error)
        state.save()
        raise


def remote_run(args: argparse.Namespace) -> int:
    if os.environ.get(ROLLING_RELEASE_LOCK_ENV) != '1':
        raise RuntimeError('--remote-run requires the outer kernel release lock')
    return _remote_run(args)


def locked_remote_release_command(
    args: argparse.Namespace,
    sha: str,
    run_id: str,
    *,
    remote_project: Path = REMOTE_PROJECT,
) -> str:
    """Build a remote command whose first deployment action is kernel locking."""
    runner = [
        'env', f'{ROLLING_RELEASE_LOCK_ENV}=1',
        'python3', 'scripts/deploy/rolling-release.py', '--remote-run',
        '--branch', args.branch,
        '--sha', sha,
        '--inventory', Path(args.inventory).name,
        '--run-id', run_id,
        '--limit', args.limit or '',
        '--canary-hold-timeout', str(args.canary_hold_timeout),
    ]
    if args.emergency_override:
        runner.extend(['--emergency-override', '--reason', args.reason])
    if args.skip_canary_hold:
        runner.append('--skip-canary-hold')
    if args.auto_minimize:
        runner.append('--auto-minimize')
    # Transitional bridge for origin/main's directory lock. A pre-existing
    # directory is never removed here: stale ownership remains fail-closed
    # until PR 4 replaces both mechanisms with the durable systemd backend.
    legacy_lock = remote_project / 'logs/.rolling-terminal-release.lock.d'
    legacy_guard = (
        f'mkdir -p {shlex.quote(str(legacy_lock.parent))}; '
        f'legacy_lock={shlex.quote(str(legacy_lock))}; '
        'if ! mkdir "$legacy_lock"; then exit 75; fi; '
        'trap \'rmdir "$legacy_lock"\' EXIT'
    )
    release_steps = ' && '.join((
        shlex.join(['git', 'fetch', 'origin', args.branch]),
        shlex.join(['git', 'checkout', '--detach', sha]),
        shlex.join(runner),
    ))
    body = f'{legacy_guard}; {release_steps}'
    lock_file = remote_project / '.git/rolling-release.lock'
    return (
        f'cd {shlex.quote(str(remote_project))} && '
        f'/usr/bin/flock -n {shlex.quote(str(lock_file))} '
        f'/usr/bin/setsid --wait /bin/bash -lc {shlex.quote(body)}'
    )


def local_approve(run_id: str) -> int:
    """Record operator canary approval on Pi5 via the same SSH path as --status."""
    host = os.environ.get('RASPI_SERVER_HOST')
    if not host:
        raise RuntimeError('RASPI_SERVER_HOST is required for --approve')
    remote = (
        'cd /opt/RaspberryPiSystem_002 && '
        'python3 scripts/deploy/deploy-status-state.py '
        '--file config/deploy-status.json approve '
        f'--run-id {shlex.quote(run_id)} '
        f'--client {shlex.quote(OPERATOR_CANARY_APPROVAL_CLIENT)}'
    )
    subprocess.run(['ssh', host, remote], check=True)
    print(json.dumps({'runId': run_id, 'approved': True}, ensure_ascii=False))
    return 0


def local_cancel(args: argparse.Namespace) -> int:
    """Fail closed until PR 4 provides cooperative systemd cancellation."""
    raise RuntimeError(
        '--cancel is disabled until the systemd/cooperative backend is available; '
        f'use --status {args.cancel} and follow the current recovery runbook'
    )


def local_run(args: argparse.Namespace) -> int:
    if args.cancel:
        return local_cancel(args)
    if args.detach or args.job:
        raise RuntimeError('--detach and --job are disabled until the locked systemd backend is available')
    if args.status:
        host = os.environ.get('RASPI_SERVER_HOST')
        if not host:
            raise RuntimeError('RASPI_SERVER_HOST is required for --status')
        command = f'cat /opt/RaspberryPiSystem_002/logs/deploy/release-runs/{shlex.quote(args.status)}.json'
        subprocess.run(['ssh', host, command], check=True)
        return 0
    if args.approve:
        return local_approve(args.approve)
    if not args.branch or not args.inventory:
        raise RuntimeError('branch and inventory are required')
    if args.print_plan:
        print(json.dumps(
            build_print_plan(args.branch, args.inventory, args.limit or '', auto_minimize=args.auto_minimize),
            ensure_ascii=False,
        ))
        return 0
    dirty = (
        subprocess.run(['git', '-C', str(PROJECT), 'diff', '--quiet']).returncode != 0
        or subprocess.run(['git', '-C', str(PROJECT), 'diff', '--cached', '--quiet']).returncode != 0
        or bool(run(['git', '-C', str(PROJECT), 'ls-files', '--others', '--exclude-standard'], capture=True).strip())
    )
    if dirty:
        raise RuntimeError('local repository has uncommitted or untracked changes; refusing deployment')
    run(['git', '-C', str(PROJECT), 'fetch', 'origin', args.branch])
    sha = run(['git', '-C', str(PROJECT), 'rev-parse', f'origin/{args.branch}'], capture=True).strip()
    host = os.environ.get('RASPI_SERVER_HOST')
    if not host:
        raise RuntimeError('RASPI_SERVER_HOST is required for a rolling release')
    run_id = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3)
    remote = locked_remote_release_command(args, sha, run_id)
    subprocess.run(['ssh', host, remote], check=True)
    return 0


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument('branch_positional', nargs='?')
    value.add_argument('inventory_positional', nargs='?')
    # The local wrapper uses positional arguments, while the remote command
    # names them explicitly to avoid ambiguity after its detached checkout.
    # Both forms deliberately populate the same destination.
    value.add_argument('--branch', dest='branch')
    value.add_argument('--inventory', dest='inventory')
    value.add_argument('--limit', default='')
    value.add_argument('--status')
    value.add_argument('--approve')
    value.add_argument('--cancel')
    value.add_argument('--print-plan', '--dry-run', action='store_true')
    # Kept for compatibility with the previous wrapper.  The remote runner
    # records the run state, so callers can continue to use --status.
    value.add_argument('--detach', action='store_true')
    value.add_argument('--job', action='store_true')
    value.add_argument('--follow', action='store_true')
    value.add_argument('--foreground', action='store_true')
    value.add_argument('--profile', action='store_true')
    value.add_argument('--client-only-compatible', action='store_true')
    value.add_argument('--emergency-override', action='store_true')
    value.add_argument('--reason')
    value.add_argument('--remote-run', action='store_true')
    value.add_argument('--sha')
    value.add_argument('--run-id')
    value.add_argument('--skip-canary-hold', action='store_true')
    value.add_argument('--canary-hold-timeout', type=int, default=DEFAULT_CANARY_HOLD_TIMEOUT)
    value.add_argument('--auto-minimize', action='store_true')
    return value


def normalize_arguments(args: argparse.Namespace) -> argparse.Namespace:
    """Accept positional local arguments and named remote arguments safely."""
    for option, positional in (('branch', 'branch_positional'), ('inventory', 'inventory_positional')):
        explicit = getattr(args, option)
        positional_value = getattr(args, positional)
        if explicit and positional_value and explicit != positional_value:
            raise RuntimeError(f'conflicting {option} values')
        setattr(args, option, explicit or positional_value)
    return args


def main() -> int:
    args, unknown = parser().parse_known_args()
    args = normalize_arguments(args)
    if unknown:
        raise RuntimeError(f'unsupported options in canonical rolling release: {" ".join(unknown)}')
    if args.cancel and not args.reason:
        raise RuntimeError('--cancel requires --reason')
    if args.cancel:
        return local_cancel(args)
    if args.detach or args.job:
        raise RuntimeError('--detach and --job are disabled until the locked systemd backend is available')
    if args.emergency_override and not args.reason:
        raise RuntimeError('--emergency-override requires --reason')
    if args.remote_run:
        if not (args.sha and args.run_id and args.inventory and args.branch):
            raise RuntimeError('--remote-run requires branch, inventory, sha and run-id')
        return remote_run(args)
    return local_run(args)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'[ERROR] {error}', file=sys.stderr)
        raise SystemExit(1)
