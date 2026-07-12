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
import secrets
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

PROJECT = Path(__file__).resolve().parents[2]
ANSIBLE_DIRECTORY = PROJECT / 'infrastructure/ansible'
STATUS_TOOL = PROJECT / 'scripts/deploy/deploy-status-state.py'
PHASE3 = PROJECT / 'scripts/deploy/pi5-blue-green.sh'
CANDIDATE_BUILD = PROJECT / 'scripts/deploy/pi5-candidate-build.sh'
RUN_DIRECTORY = PROJECT / 'logs/deploy/release-runs'


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
    hosts = (inventory.get('_meta') or {}).get('hostvars') or {}
    selected_set = set(selected or hosts)
    canary_hosts = set((inventory.get('kiosk_canary') or {}).get('hosts') or [])
    kiosks: list[dict[str, str]] = []
    signage: list[dict[str, str]] = []
    for host, values in hosts.items():
        if host not in selected_set:
            continue
        client_id = values.get('status_agent_client_id')
        if values.get('manage_kiosk_browser') is True and client_id:
            kiosks.append({'host': host, 'clientId': client_id, 'terminalType': 'kiosk'})
        elif values.get('manage_signage_lite') is True and client_id:
            signage.append({'host': host, 'clientId': client_id, 'terminalType': 'signage'})
    # ansible-inventory retains the inventory declaration order.  Preserve it
    # after moving only the explicit canary to the front.
    return [item for item in kiosks if item['host'] in canary_hosts] + [
        item for item in kiosks if item['host'] not in canary_hosts
    ] + signage


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


def acknowledgement_received(run_id: str, client_id: str) -> bool:
    try:
        value = json.loads((PROJECT / 'config/deploy-status.json').read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return False
    return client_id in ((value.get('acknowledgements') or {}).get(run_id) or {})


def wait_for_ack(run_id: str, client_id: str, timeout: int = 30) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if acknowledgement_received(run_id, client_id):
            return True
        time.sleep(5)
    return acknowledgement_received(run_id, client_id)


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
    run([str(PHASE3), 'cleanup'])
    state.payload['pi5']['state'] = 'stable'
    state.save()


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
    try:
        base = run(['git', '-C', str(PROJECT), 'merge-base', 'origin/main', sha], capture=True).strip()
        result = json.loads(run([
            'python3', str(PROJECT / 'scripts/deploy/classify-deploy-impact.py'),
            '--base', base, '--head', sha,
        ], capture=True))
        return bool(result.get('server') or result.get('migration'))
    except Exception:
        return True


def _remote_run(args: argparse.Namespace) -> int:
    inventory = str(Path(args.inventory) if Path(args.inventory).is_absolute() else ANSIBLE_DIRECTORY / args.inventory)
    targets = release_targets(inventory_json(inventory), selected_hosts(inventory, args.limit))
    if not targets:
        raise RuntimeError('no kiosk or signage targets selected')
    path = status_file(args.run_id)
    state = ReleaseState(path, {
        'version': 1, 'runId': args.run_id, 'branch': args.branch, 'releaseSha': args.sha,
        'startedAt': utc_now(), 'state': 'running', 'targets': [{**target, 'state': 'pending'} for target in targets],
    })
    state.save()
    try:
        if pi5_release_required(args.sha):
            phase3_release(args.sha, state)
            wait_for_pi5_stability(state)
        else:
            state.payload['pi5'] = {'state': 'not-required'}
            state.save()
        for target_spec in targets:
            target = state.target(target_spec['host'])
            target['previousSha'] = remote_previous_sha(inventory, target_spec['host'])
            target['state'] = 'maintenance-requested'
            target['maintenanceStartedAt'] = utc_now()
            state.save()
            state_command('put', '--run-id', args.run_id, '--clients', target_spec['clientId'], '--terminal-type', target_spec['terminalType'])
            if target_spec['terminalType'] == 'signage':
                prestage_signage_maintenance(inventory, target_spec['host'], args.run_id, target_spec['clientId'])
            if not wait_for_ack(args.run_id, target_spec['clientId']):
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
        state.payload['state'] = 'success'
        state.save()
        return 0
    except Exception as error:
        state.payload['state'] = 'failed'
        state.payload['failure'] = str(error)
        state.save()
        raise


def remote_run(args: argparse.Namespace) -> int:
    lock = PROJECT / 'logs/.rolling-terminal-release.lock.d'
    try:
        lock.mkdir()
        (lock / 'owner').write_text(json.dumps({'pid': os.getpid(), 'runId': args.run_id, 'startedAt': utc_now()}), encoding='utf-8')
    except FileExistsError as error:
        raise RuntimeError(f'another rolling terminal release is active: {lock}') from error
    try:
        return _remote_run(args)
    finally:
        try:
            (lock / 'owner').unlink(missing_ok=True)
            lock.rmdir()
        except OSError:
            pass


def local_run(args: argparse.Namespace) -> int:
    if args.status:
        host = os.environ.get('RASPI_SERVER_HOST')
        if not host:
            raise RuntimeError('RASPI_SERVER_HOST is required for --status')
        command = f'cat /opt/RaspberryPiSystem_002/logs/deploy/release-runs/{shlex.quote(args.status)}.json'
        subprocess.run(['ssh', host, command], check=True)
        return 0
    if not args.branch or not args.inventory:
        raise RuntimeError('branch and inventory are required')
    if args.print_plan:
        print(json.dumps({'mode': 'rolling-release', 'branch': args.branch, 'inventory': args.inventory, 'limit': args.limit or None}, ensure_ascii=False))
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
    emergency = ''
    if args.emergency_override:
        emergency = f' --emergency-override --reason {shlex.quote(args.reason)}'
    remote = (
        'cd /opt/RaspberryPiSystem_002 && '
        f'git fetch origin {shlex.quote(args.branch)} && git checkout --detach {shlex.quote(sha)} && '
        f'python3 scripts/deploy/rolling-release.py --remote-run --branch {shlex.quote(args.branch)} '
        f'--sha {shlex.quote(sha)} --inventory {shlex.quote(Path(args.inventory).name)} --run-id {shlex.quote(run_id)} '
        f'--limit {shlex.quote(args.limit or "")}{emergency}'
    )
    if args.detach or args.job:
        log_path = f'/opt/RaspberryPiSystem_002/logs/deploy/release-runs/{run_id}.log'
        detached = (
            f'mkdir -p /opt/RaspberryPiSystem_002/logs/deploy/release-runs && '
            f'nohup /bin/bash -lc {shlex.quote(remote)} > {shlex.quote(log_path)} 2>&1 & echo $!'
        )
        subprocess.run(['ssh', host, detached], check=True)
        print(json.dumps({'runId': run_id, 'state': 'started', 'logFile': log_path}, ensure_ascii=False))
        return 0
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
