#!/usr/bin/env python3
"""Record daily review counts as the API runtime user; never store findings."""
import argparse
from datetime import date, datetime, timedelta
import json
import os
from pathlib import Path
import re
import tempfile
from zoneinfo import ZoneInfo


COUNTS = ('findings', 'confirmed', 'false_alarm', 'known', 'refused_chunks', 'fixed')


def review_date(value):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('date must be YYYY-MM-DD')
    return date.fromisoformat(value)


def triage_dir(data_dir):
    if data_dir.stat().st_uid != os.geteuid():
        raise ValueError('Run as the API runtime user that owns the data directory')
    folder = data_dir / 'triage'
    folder.mkdir(mode=0o700, exist_ok=True)
    if folder.stat().st_uid != os.geteuid():
        raise ValueError('Run as the API runtime user that owns the triage directory')
    os.chmod(folder, 0o700)
    return folder


def validate_entry(entry):
    review_date(entry['date'])
    if any(type(entry[key]) is not int or entry[key] < 0 for key in COUNTS):
        raise ValueError('counts must be nonnegative integers')
    if not isinstance(entry['status'], str) or not entry['status'].strip():
        raise ValueError('status must be nonempty')


def record(data_dir, entry):
    validate_entry(entry)
    # Explicit allowlist: callers cannot accidentally persist report text.
    entry = {key: entry[key] for key in ('date', *COUNTS, 'status')}
    folder = triage_dir(data_dir)
    fd, temporary = tempfile.mkstemp(prefix='.triage-', dir=folder)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            os.fchmod(output.fileno(), 0o600)
            json.dump(entry, output, ensure_ascii=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, folder / (entry['date'] + '.json'))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return entry


def summary(data_dir, days, today=None):
    if days <= 0:
        raise ValueError('days must be positive')
    today = today or datetime.now(ZoneInfo('Asia/Tokyo')).date()
    since = today - timedelta(days=days - 1)
    totals = dict.fromkeys(COUNTS, 0)
    nights = skipped = 0
    for filename in sorted(triage_dir(data_dir).glob('*.json')):
        try:
            day = review_date(filename.stem)
        except ValueError:
            skipped += 1
            continue
        if not since <= day <= today:
            continue
        try:
            entry = json.loads(filename.read_text(encoding='utf-8'))
            validate_entry(entry)
            if entry['date'] != filename.stem:
                raise ValueError('date must match filename')
        except (OSError, ValueError, KeyError, TypeError):
            skipped += 1
            continue
        for key in COUNTS:
            totals[key] += entry[key]
        nights += 1
    judged = totals['confirmed'] + totals['false_alarm']
    return {'from': since.isoformat(), 'to': today.isoformat(), 'nights': nights, 'skipped': skipped,
            'totals': totals, 'confirmed_ratio': totals['confirmed'] / judged if judged else None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    commands = parser.add_subparsers(dest='action', required=True)
    add = commands.add_parser('record')
    add.add_argument('--date', required=True)
    for key in COUNTS:
        add.add_argument('--' + key.replace('_', '-'), type=int, required=True)
    add.add_argument('--status', required=True)
    total = commands.add_parser('summary')
    total.add_argument('--days', type=int, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = (record(args.data_dir, vars(args)) if args.action == 'record'
                  else summary(args.data_dir, args.days))
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
