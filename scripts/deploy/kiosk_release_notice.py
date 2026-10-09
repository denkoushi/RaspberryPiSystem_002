#!/usr/bin/env python3
"""Controller-local save-work notice; all writes go through the state helper."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from terminal_notice import NOTICE_ACK_TIMEOUT_SECONDS, NOTICE_DURATION_SECONDS

POLL_SECONDS = 5
SCHEDULE_GRACE_SECONDS = 5


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.timestamp() if parsed.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


class KioskReleaseNotice:
    def __init__(self, project, run_id, client, *, duration=NOTICE_DURATION_SECONDS,
                 ack_timeout=NOTICE_ACK_TIMEOUT_SECONDS, clock=time.time,
                 monotonic=time.monotonic, sleep=time.sleep, execute=subprocess.run,
                 warn=lambda message: print(f'WARNING: {message}', file=sys.stderr)):
        self.project = Path(project).resolve()
        self.file = self.project / 'config/deploy-status.json'
        self.run_id = run_id
        self.client = client.strip()
        self.duration = duration
        self.ack_timeout = ack_timeout
        self.clock, self.monotonic, self.sleep = clock, monotonic, sleep
        self.execute, self.warn = execute, warn

    def state_command(self, *arguments):
        self.execute([sys.executable, str(self.project / 'scripts/deploy/deploy-status-state.py'),
                      '--file', str(self.file), *arguments], check=True, timeout=15)

    def wait_for_ack(self, phase):
        deadline = self.monotonic() + self.ack_timeout
        while True:
            data = json.loads(self.file.read_text(encoding='utf-8'))
            entry = (data.get('kioskByClient') or {}).get(self.client) or {}
            record = ((data.get('acknowledgements') or {}).get(self.run_id) or {}).get(self.client) or {}
            ack = record.get(phase) or {}
            started = timestamp(entry.get('noticeStartedAt' if phase == 'notice' else 'startedAt'))
            acknowledged = timestamp(ack.get('acknowledgedAt'))
            if (entry.get('runId') == self.run_id and started is not None
                    and acknowledged is not None and acknowledged >= started):
                return entry
            remaining = deadline - self.monotonic()
            if remaining <= 0:
                self.warn(f'{self.client}: {phase} acknowledgement timed out; continuing')
                return None
            self.sleep(min(POLL_SECONDS, remaining))

    def start(self):
        if not self.client:
            self.warn('status_agent_client_id is empty; skipping kiosk notice')
            return
        self.state_command('put-notice', '--run-id', self.run_id, '--clients', self.client,
                           '--terminal-type', 'kiosk', '--duration-seconds', str(self.duration))
        entry = self.wait_for_ack('notice')
        if entry is not None:
            scheduled = timestamp(entry.get('scheduledAt'))
            if scheduled is None:
                self.warn(f'{self.client}: missing/invalid scheduledAt; continuing')
            else:
                # Monotonic deadline also bounds a future/incorrect schedule or wall-clock jump.
                deadline = self.monotonic() + self.duration + SCHEDULE_GRACE_SECONDS
                while True:
                    remaining = min(scheduled - self.clock(), deadline - self.monotonic())
                    if remaining <= 0:
                        break
                    self.sleep(min(POLL_SECONDS, remaining))
        self.state_command('put', '--run-id', self.run_id, '--clients', self.client,
                           '--terminal-type', 'kiosk', '--phase', 'deploying')
        self.wait_for_ack('maintenance')

    def clear(self):
        if self.client:
            self.state_command('remove-client', '--run-id', self.run_id, '--client', self.client)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['start', 'clear'])
    parser.add_argument('--project', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--client', required=True)
    parser.add_argument('--duration-seconds', type=int, default=NOTICE_DURATION_SECONDS)
    parser.add_argument('--ack-timeout-seconds', type=int, default=NOTICE_ACK_TIMEOUT_SECONDS)
    args = parser.parse_args()
    if args.duration_seconds <= 0 or args.ack_timeout_seconds < 0:
        parser.error('duration must be positive and ack timeout must be nonnegative')
    notice = KioskReleaseNotice(args.project, args.run_id, args.client,
                                duration=args.duration_seconds, ack_timeout=args.ack_timeout_seconds)
    try:
        getattr(notice, args.command)()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'WARNING: kiosk notice {args.command} failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
