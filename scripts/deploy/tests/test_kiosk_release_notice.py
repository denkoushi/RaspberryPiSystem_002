from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kiosk_release_notice import KioskReleaseNotice


class Clock:
    def __init__(self):
        self.now = 1_800_000_000.0
        self.elapsed = 0.0
        self.sleeps = []

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds
        self.elapsed += seconds

    def iso(self, offset=0):
        return datetime.fromtimestamp(self.now + offset, timezone.utc).isoformat()


def protocol(tmp_path, *, notice_ack=True, maintenance_ack=True, schedule=60):
    clock = Clock()
    warnings, calls = [], []
    file = tmp_path / 'config/deploy-status.json'
    file.parent.mkdir()

    def execute(argv, **kwargs):
        calls.append(argv)
        assert kwargs == {'check': True, 'timeout': 15}
        command = argv[4]
        phase = 'notice' if command == 'put-notice' else 'maintenance'
        entry = {'runId': 'run', 'phase': 'notice' if phase == 'notice' else 'deploying',
                 'noticeStartedAt' if phase == 'notice' else 'startedAt': clock.iso()}
        if phase == 'notice' and schedule is not None:
            entry['scheduledAt'] = clock.iso(schedule) if isinstance(schedule, int) else schedule
        ack = notice_ack if phase == 'notice' else maintenance_ack
        file.write_text(json.dumps({'kioskByClient': {'client': entry}, 'acknowledgements': {
            'run': {'client': {phase: {'acknowledgedAt': clock.iso()} if ack else {}}}}}))

    notice = KioskReleaseNotice(tmp_path, 'run', 'client', clock=lambda: clock.now,
                                monotonic=lambda: clock.elapsed, sleep=clock.sleep,
                                execute=execute, warn=warnings.append)
    return notice, clock, warnings, calls


def test_acknowledged_notice_waits_until_schedule_then_maintenance(tmp_path):
    notice, clock, warnings, calls = protocol(tmp_path)
    notice.start()
    assert clock.elapsed == 60
    assert max(clock.sleeps) <= 5
    assert not warnings
    assert [call[4] for call in calls] == ['put-notice', 'put']
    assert calls[0][-2:] == ['--duration-seconds', '60']
    assert calls[1][-2:] == ['--phase', 'deploying']


def test_no_acks_skips_schedule_and_continues_after_bounded_ack_waits(tmp_path):
    notice, clock, warnings, calls = protocol(tmp_path, notice_ack=False, maintenance_ack=False)
    notice.start()
    assert clock.elapsed == 60  # two 30-second ack probes; no 60-second schedule wait
    assert len(warnings) == 2
    assert [call[4] for call in calls] == ['put-notice', 'put']


@pytest.mark.parametrize('schedule', [None, 'invalid', '2026-10-09T00:00:00'])
def test_missing_or_invalid_schedule_does_not_wait(tmp_path, schedule):
    notice, clock, warnings, _ = protocol(tmp_path, schedule=schedule)
    notice.start()
    assert clock.elapsed == 0
    assert 'scheduledAt' in warnings[0]


def test_schedule_is_bounded_even_when_far_in_future(tmp_path):
    notice, clock, _, _ = protocol(tmp_path, schedule=3600)
    notice.start()
    assert clock.elapsed == 65


@pytest.mark.parametrize('failure', [subprocess.CalledProcessError(1, 'helper'),
                                    subprocess.TimeoutExpired('helper', 15), OSError('permission denied')])
def test_helper_failure_stops_before_switch_and_allows_clear(tmp_path, failure):
    notice, _, _, _ = protocol(tmp_path)
    notice.execute = mock.Mock(side_effect=failure)
    with pytest.raises(type(failure)):
        notice.start()
    assert notice.execute.call_count == 1
    notice.execute = mock.Mock()
    notice.clear()
    assert notice.execute.call_args.args[0][-5:] == ['remove-client', '--run-id', 'run', '--client', 'client']


def test_empty_client_never_writes_or_waits(tmp_path):
    notice, clock, warnings, calls = protocol(tmp_path)
    notice.client = '   '.strip()
    notice.start()
    notice.clear()
    assert not calls
    assert clock.elapsed == 0
    assert 'empty' in warnings[0]


def test_clear_is_idempotent_and_preserves_other_run(tmp_path):
    project = Path(__file__).resolve().parents[3]
    notice = KioskReleaseNotice(project, 'run', 'client')
    notice.file = tmp_path / 'deploy-status.json'
    notice.state_command('put', '--run-id', 'run', '--clients', 'client')
    notice.state_command('put', '--run-id', 'other', '--clients', 'other-client')
    notice.clear()
    notice.clear()
    assert set(json.loads(notice.file.read_text())['kioskByClient']) == {'other-client'}


def test_stale_ack_from_same_run_is_not_reused(tmp_path):
    notice, clock, warnings, _ = protocol(tmp_path)
    notice.state_command('put-notice')
    data = json.loads(notice.file.read_text())
    data['acknowledgements']['run']['client']['notice']['acknowledgedAt'] = clock.iso(-1)
    notice.file.write_text(json.dumps(data))
    assert notice.wait_for_ack('notice') is None
    assert clock.elapsed == 30
    assert warnings
