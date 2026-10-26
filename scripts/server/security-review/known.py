#!/usr/bin/env python3
"""Maintain known findings as the API runtime user, without model actions."""
import argparse
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import unicodedata
from zoneinfo import ZoneInfo


def fingerprint(kind, location, what):
    values = [re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', value).strip().lower()) for value in (kind, location, what)]
    return hashlib.sha256('|'.join(values).encode('utf-8')).hexdigest()


def update(filename, action, entry=None, key=None):
    if filename.parent.stat().st_uid != os.geteuid():
        raise ValueError('Run as the API runtime user that owns the data directory')
    lock = filename.with_suffix('.lock')
    with lock.open('a') as stream:
        os.chmod(lock, 0o600)
        fcntl.flock(stream, fcntl.LOCK_EX)
        entries = json.loads(filename.read_text()) if filename.exists() else []
        if action == 'list':
            return entries
        if action == 'add':
            entries = [item for item in entries if item['fingerprint'] != entry['fingerprint']] + [entry]
        else:
            entries = [item for item in entries if item['fingerprint'] != key]
        fd, temporary = tempfile.mkstemp(prefix='.known-', dir=filename.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                os.fchmod(output.fileno(), 0o600)
                json.dump(entries, output, ensure_ascii=False, indent=2)
                output.write('\n')
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, filename)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    commands = parser.add_subparsers(dest='action', required=True)
    add = commands.add_parser('add')
    add.add_argument('--kind', choices=['changes', 'security', 'errors'], required=True)
    for name in ['location', 'what', 'reason']:
        add.add_argument('--' + name, required=True)
    commands.add_parser('list')
    remove = commands.add_parser('remove')
    remove.add_argument('fingerprint')
    args = parser.parse_args()
    os.umask(0o077)
    entry = None
    if args.action == 'add':
        for name, limit in [('location', 500), ('what', 1000), ('reason', 500)]:
            if not 0 < len(getattr(args, name)) <= limit:
                parser.error(f'{name} must be 1..{limit} characters')
        entry = {'kind': args.kind, 'location': args.location, 'what': args.what, 'reason': args.reason, 'date': datetime.now(ZoneInfo('Asia/Tokyo')).date().isoformat(),
                 'fingerprint': fingerprint(args.kind, args.location, args.what)}
    print(json.dumps(update(args.data_dir / 'known-findings.json', args.action, entry, getattr(args, 'fingerprint', None)), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
