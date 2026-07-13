#!/usr/bin/env python3
import argparse
import json
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


OPERATOR_CANARY_APPROVAL_CLIENT = 'operator-canary-approval'


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def epoch_now():
    return int(time.time())


def notice_schedule(timestamp, duration_seconds):
    acknowledged_at = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    return (acknowledged_at + timedelta(seconds=duration_seconds)).isoformat().replace('+00:00', 'Z')


def acknowledgements_for(data, run_id, client):
    acknowledgements = dict(data.get('acknowledgements') or {})
    run_acknowledgements = dict(acknowledgements.get(run_id) or {})
    record = dict(run_acknowledgements.get(client) or {})
    # Flat acknowledgement records are the v2 maintenance shape used before
    # the notice protocol.  Preserve them as a maintenance acknowledgement.
    if 'acknowledgedAt' in record:
        record = {'maintenance': record}
    run_acknowledgements[client] = record
    acknowledgements[run_id] = run_acknowledgements
    return acknowledgements, record


def canary_holds(data):
    value = data.get('canaryHolds')
    if value is None:
        value = {}
        data['canaryHolds'] = value
    if not isinstance(value, dict):
        raise ValueError('canary hold state is malformed')
    return value


def canary_hold_for(data, run_id):
    hold = canary_holds(data).get(run_id)
    if not isinstance(hold, dict):
        raise ValueError('canary hold is not pending for this run')
    return hold


def load(path):
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    data['version'] = 2
    data['kioskByClient'] = dict(data.get('kioskByClient') or {})
    if 'acknowledgements' in data:
        data['acknowledgements'] = dict(data.get('acknowledgements') or {})
    return data


def save(path, data):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    existing_owner = None
    try:
        stat = target.stat()
        existing_owner = (stat.st_uid, stat.st_gid)
    except FileNotFoundError:
        pass
    fd, tmp = tempfile.mkstemp(prefix=f'.{target.name}.', dir=target.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
            handle.flush()
            os.fsync(handle.fileno())
        if existing_owner is not None:
            os.chown(tmp, *existing_owner)
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


class StatusLock:
    """Cross-process lock shared with the Node API through an atomic directory."""

    def __init__(self, path, timeout_seconds=10):
        self.path = Path(f'{path}.lock.d')
        self.timeout_seconds = timeout_seconds

    def __enter__(self):
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            try:
                self.path.mkdir()
                (self.path / 'owner').write_text(str(os.getpid()), encoding='utf-8')
                return self
            except FileExistsError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f'deploy status is locked: {self.path}')
                time.sleep(0.05)

    def __exit__(self, *_exc):
        try:
            (self.path / 'owner').unlink(missing_ok=True)
            self.path.rmdir()
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    put = sub.add_parser('put')
    put.add_argument('--run-id', required=True)
    put.add_argument('--clients', required=True)
    put.add_argument('--terminal-type', choices=['kiosk', 'signage'])
    put.add_argument('--phase', default='preparing', choices=['preparing', 'deploying', 'failed'])
    notice = sub.add_parser('put-notice')
    notice.add_argument('--run-id', required=True)
    notice.add_argument('--clients', required=True)
    notice.add_argument('--terminal-type', choices=['kiosk'], required=True)
    notice.add_argument('--duration-seconds', type=int, required=True)
    phase = sub.add_parser('set-phase')
    phase.add_argument('--run-id', required=True)
    phase.add_argument('--phase', required=True, choices=['preparing', 'deploying', 'failed'])
    remove = sub.add_parser('remove-run')
    remove.add_argument('--run-id', required=True)
    remove_client = sub.add_parser('remove-client')
    remove_client.add_argument('--run-id', required=True)
    remove_client.add_argument('--client', required=True)
    acknowledge = sub.add_parser('ack')
    acknowledge.add_argument('--run-id', required=True)
    acknowledge.add_argument('--client', required=True)
    acknowledge.add_argument('--phase', choices=['notice', 'maintenance'], default='maintenance')
    approve = sub.add_parser('approve')
    approve.add_argument('--run-id', required=True)
    approve.add_argument('--client', required=True)
    open_hold = sub.add_parser('open-canary-hold')
    open_hold.add_argument('--run-id', required=True)
    open_hold.add_argument('--canary', required=True)
    open_hold.add_argument('--expires-at', required=True, type=int)
    hold_state = sub.add_parser('canary-hold-state')
    hold_state.add_argument('--run-id', required=True)
    expire_hold = sub.add_parser('expire-canary-hold')
    expire_hold.add_argument('--run-id', required=True)
    args = parser.parse_args()
    output = None
    with StatusLock(args.file):
        data = load(args.file)
        entries = data['kioskByClient']
        timestamp = now()
        if args.command == 'put':
            for client in filter(None, (value.strip() for value in args.clients.split(','))):
                entries[client] = {
                    'maintenance': True,
                    'startedAt': timestamp,
                    'updatedAt': timestamp,
                    'runId': args.run_id,
                    'phase': args.phase,
                    **({'terminalType': args.terminal_type} if args.terminal_type else {}),
                }
        elif args.command == 'put-notice':
            if args.duration_seconds <= 0:
                raise ValueError('notice duration must be greater than zero')
            for client in filter(None, (value.strip() for value in args.clients.split(','))):
                entries[client] = {
                    'maintenance': False,
                    'noticeStartedAt': timestamp,
                    'updatedAt': timestamp,
                    'runId': args.run_id,
                    'phase': 'notice',
                    'noticeDurationSeconds': args.duration_seconds,
                    'terminalType': args.terminal_type,
                }
        elif args.command == 'set-phase':
            for entry in entries.values():
                if entry.get('runId') == args.run_id:
                    entry.update({'maintenance': True, 'phase': args.phase, 'updatedAt': timestamp})
        elif args.command == 'ack':
            entry = entries.get(args.client)
            if not entry or entry.get('runId') != args.run_id:
                raise ValueError('acknowledgement does not match an active terminal entry')
            if args.phase == 'notice':
                if entry.get('phase') != 'notice' or entry.get('maintenance') is not False:
                    raise ValueError('notice acknowledgement does not match an active notice entry')
                if not isinstance(entry.get('scheduledAt'), str):
                    entry['scheduledAt'] = notice_schedule(timestamp, entry.get('noticeDurationSeconds', 0))
                    entry['updatedAt'] = timestamp
            elif entry.get('maintenance') is not True:
                raise ValueError('maintenance acknowledgement does not match an active terminal maintenance entry')
            acknowledgements, record = acknowledgements_for(data, args.run_id, args.client)
            record.setdefault(args.phase, {'acknowledgedAt': timestamp, 'source': 'controller'})
            data['acknowledgements'] = acknowledgements
        elif args.command == 'approve':
            if args.client != OPERATOR_CANARY_APPROVAL_CLIENT:
                raise ValueError('canary approval client is not allowed')
            hold = canary_hold_for(data, args.run_id)
            state = hold.get('state')
            if state == 'approved':
                pass
            elif state != 'waiting-verification':
                raise ValueError('canary hold is not waiting for verification')
            elif not isinstance(hold.get('expiresAt'), int) or epoch_now() >= hold['expiresAt']:
                raise ValueError('canary hold has expired')
            else:
                hold.update({
                    'state': 'approved',
                    'approvedAt': timestamp,
                    'approvedBy': args.client,
                })
        elif args.command == 'open-canary-hold':
            if not args.canary.strip():
                raise ValueError('canary host is required')
            if args.expires_at <= epoch_now():
                raise ValueError('canary hold expiry must be in the future')
            holds = canary_holds(data)
            if args.run_id in holds:
                raise ValueError('canary hold already exists for this run')
            holds[args.run_id] = {
                'state': 'waiting-verification',
                'canary': args.canary,
                'openedAt': timestamp,
                'expiresAt': args.expires_at,
            }
        elif args.command == 'canary-hold-state':
            output = json.dumps(canary_hold_for(data, args.run_id), ensure_ascii=False)
        elif args.command == 'expire-canary-hold':
            hold = canary_hold_for(data, args.run_id)
            state = hold.get('state')
            if state == 'waiting-verification':
                if not isinstance(hold.get('expiresAt'), int) or epoch_now() < hold['expiresAt']:
                    raise ValueError('canary hold has not expired')
                hold.update({'state': 'expired', 'expiredAt': timestamp})
            elif state not in ('approved', 'expired'):
                raise ValueError('canary hold is not active')
        elif args.command == 'remove-client':
            entry = entries.get(args.client)
            if entry and entry.get('runId') == args.run_id:
                entries.pop(args.client, None)
            acknowledgements = dict(data.get('acknowledgements') or {})
            if args.run_id in acknowledgements:
                acknowledgements[args.run_id].pop(args.client, None)
                if not acknowledgements[args.run_id]:
                    acknowledgements.pop(args.run_id, None)
            if acknowledgements:
                data['acknowledgements'] = acknowledgements
            else:
                data.pop('acknowledgements', None)
        else:
            data['kioskByClient'] = {key: value for key, value in entries.items() if value.get('runId') != args.run_id}
            acknowledgements = dict(data.get('acknowledgements') or {})
            acknowledgements.pop(args.run_id, None)
            if acknowledgements:
                data['acknowledgements'] = acknowledgements
            else:
                data.pop('acknowledgements', None)
        if output is None:
            save(args.file, data)
    if output is not None:
        print(output)


if __name__ == '__main__':
    main()
