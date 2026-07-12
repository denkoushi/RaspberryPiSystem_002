#!/usr/bin/env python3
import argparse
import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


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
    args = parser.parse_args()
    with StatusLock(args.file):
        data = load(args.file)
        entries = data['kioskByClient']
        timestamp = now()
        if args.command == 'put':
            for client in filter(None, (value.strip() for value in args.clients.split(','))):
                previous = entries.get(client) or {}
                entries[client] = {
                    'maintenance': True,
                    'startedAt': previous.get('startedAt', timestamp),
                    'updatedAt': timestamp,
                    'runId': args.run_id,
                    'phase': args.phase,
                    **({'terminalType': args.terminal_type} if args.terminal_type else {}),
                }
        elif args.command == 'set-phase':
            for entry in entries.values():
                if entry.get('runId') == args.run_id:
                    entry.update({'maintenance': True, 'phase': args.phase, 'updatedAt': timestamp})
        elif args.command == 'ack':
            entry = entries.get(args.client)
            if not entry or entry.get('runId') != args.run_id or entry.get('maintenance') is not True:
                raise ValueError('acknowledgement does not match an active terminal maintenance entry')
            acknowledgements = dict(data.get('acknowledgements') or {})
            acknowledgements.setdefault(args.run_id, {})[args.client] = {'acknowledgedAt': timestamp, 'source': 'controller'}
            data['acknowledgements'] = acknowledgements
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
        save(args.file, data)


if __name__ == '__main__':
    main()
