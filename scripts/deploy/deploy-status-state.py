#!/usr/bin/env python3
import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def load(path):
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    return {'version': 2, 'kioskByClient': dict(data.get('kioskByClient') or {})}


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    put = sub.add_parser('put')
    put.add_argument('--run-id', required=True)
    put.add_argument('--clients', required=True)
    put.add_argument('--phase', default='preparing', choices=['preparing', 'deploying', 'failed'])
    phase = sub.add_parser('set-phase')
    phase.add_argument('--run-id', required=True)
    phase.add_argument('--phase', required=True, choices=['preparing', 'deploying', 'failed'])
    remove = sub.add_parser('remove-run')
    remove.add_argument('--run-id', required=True)
    args = parser.parse_args()
    data = load(args.file)
    entries = data['kioskByClient']
    timestamp = now()
    if args.command == 'put':
        for client in filter(None, (value.strip() for value in args.clients.split(','))):
            previous = entries.get(client) or {}
            entries[client] = {'maintenance': True, 'startedAt': previous.get('startedAt', timestamp),
                               'updatedAt': timestamp, 'runId': args.run_id, 'phase': args.phase}
    elif args.command == 'set-phase':
        for client, entry in entries.items():
            if entry.get('runId') == args.run_id:
                entry.update({'maintenance': True, 'phase': args.phase, 'updatedAt': timestamp})
    else:
        data['kioskByClient'] = {key: value for key, value in entries.items() if value.get('runId') != args.run_id}
    save(args.file, data)


if __name__ == '__main__':
    main()
