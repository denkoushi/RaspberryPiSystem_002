"""Private daily count records, using only temporary files."""
from datetime import date, timedelta
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / 'security-review/triage.py'
spec = importlib.util.spec_from_file_location('triage', SCRIPT)
triage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(triage)


def entry(day='2026-10-28', **counts):
    return {'date': day, **dict.fromkeys(triage.COUNTS, 0), 'status': 'reviewed', **counts}


def test_record_overwrites_date_atomically_with_private_permissions(tmp_path):
    original = entry(findings=5, confirmed=2, false_alarm=3)
    triage.record(tmp_path, original)
    updated = entry(findings=5, confirmed=2, false_alarm=3, fixed=2, report_body='must not persist')
    saved = triage.record(tmp_path, updated)
    target = tmp_path / 'triage/2026-10-28.json'
    assert json.loads(target.read_text()) == saved
    assert saved['fixed'] == 2 and 'report_body' not in saved
    assert target.stat().st_mode & 0o777 == 0o600
    assert target.parent.stat().st_mode & 0o777 == 0o700
    assert list(target.parent.iterdir()) == [target]


def test_summary_counts_calendar_window_including_today_and_ratio(tmp_path):
    today = date(2026, 10, 28)
    for offset in [0, 1, 6, 7, -1]:
        triage.record(tmp_path, entry((today - timedelta(days=offset)).isoformat(),
                      findings=5, confirmed=2, false_alarm=3, known=4, refused_chunks=1, fixed=2))
    result = triage.summary(tmp_path, 7, today)
    assert result == {'from': '2026-10-22', 'to': '2026-10-28', 'nights': 3, 'skipped': 0,
                      'totals': {'findings': 15, 'confirmed': 6, 'false_alarm': 9, 'known': 12,
                                 'refused_chunks': 3, 'fixed': 6}, 'confirmed_ratio': 0.4}
    assert triage.summary(tmp_path, 1, today)['nights'] == 1


def test_summary_empty_has_no_confirmation_ratio(tmp_path):
    result = triage.summary(tmp_path, 7, date(2026, 10, 28))
    assert result['confirmed_ratio'] is None and result['nights'] == 0
    assert all(value == 0 for value in result['totals'].values())


@pytest.mark.parametrize('change', [{'date': '../outside'}, {'date': '2026-02-30'}, {'confirmed': -1}])
def test_record_rejects_invalid_date_or_count(tmp_path, change):
    with pytest.raises(ValueError):
        triage.record(tmp_path, entry(**change))
    assert not (tmp_path / 'triage').exists()


def test_summary_rejects_nonpositive_days(tmp_path):
    with pytest.raises(ValueError):
        triage.summary(tmp_path, 0)


def test_record_preserves_previous_file_if_replace_fails(tmp_path, monkeypatch):
    triage.record(tmp_path, entry())
    monkeypatch.setattr(triage.os, 'replace', lambda *args: (_ for _ in ()).throw(OSError('fixture')))
    with pytest.raises(OSError):
        triage.record(tmp_path, entry(fixed=1))
    assert json.loads((tmp_path / 'triage/2026-10-28.json').read_text())['fixed'] == 0
    assert len(list((tmp_path / 'triage').iterdir())) == 1


def test_triage_requires_data_directory_owner(tmp_path, monkeypatch):
    monkeypatch.setattr(triage.os, 'geteuid', lambda: os.getuid() + 1)
    with pytest.raises(ValueError, match='API runtime user'):
        triage.record(tmp_path, entry())


def test_record_and_summary_cli(tmp_path):
    result = subprocess.run([sys.executable, str(SCRIPT), '--data-dir', str(tmp_path), 'record',
                             '--date', '2026-10-28', '--findings', '2', '--confirmed', '1', '--false-alarm', '1',
                             '--known', '0', '--refused-chunks', '0', '--fixed', '1', '--status', 'reviewed'],
                            capture_output=True, text=True, check=True)
    assert json.loads(result.stdout)['fixed'] == 1
    result = subprocess.run([sys.executable, str(SCRIPT), '--data-dir', str(tmp_path), 'summary', '--days', '7'],
                            capture_output=True, text=True, check=True)
    assert 'confirmed_ratio' in json.loads(result.stdout)


@pytest.mark.parametrize('contents', [
    '{broken', '[]', 'null', '{}',
    json.dumps(entry('2026-10-27', findings=100, fixed='bad')),
    json.dumps(entry('2026-10-27', fixed=-1)),
    json.dumps(entry('2026-10-27', fixed=True)),
    json.dumps(entry('2026-10-27', date=None)),
    json.dumps(entry('2026-10-27', status='')),
    json.dumps(entry('2026-10-26')),
    'unreadable',
])
def test_summary_skips_corrupt_record_without_partial_totals(tmp_path, monkeypatch, contents):
    triage.record(tmp_path, entry(findings=2, confirmed=1, false_alarm=1))
    bad = tmp_path / 'triage/2026-10-27.json'
    bad.write_text(contents)
    if contents == 'unreadable':
        original = Path.read_text

        def read(path, *args, **kwargs):
            if path == bad:
                raise OSError('fixture unreadable')
            return original(path, *args, **kwargs)
        monkeypatch.setattr(Path, 'read_text', read)
    result = triage.summary(tmp_path, 7, date(2026, 10, 28))
    assert result['nights'] == 1
    assert result['skipped'] == 1
    assert result['totals'] == dict.fromkeys(triage.COUNTS, 0) | {
        'findings': 2, 'confirmed': 1, 'false_alarm': 1}
    assert result['confirmed_ratio'] == 0.5


def test_summary_counts_invalid_filename_as_skipped(tmp_path):
    triage.record(tmp_path, entry())
    (tmp_path / 'triage/not-a-date.json').write_text('{}')
    result = triage.summary(tmp_path, 7, date(2026, 10, 28))
    assert result['nights'] == result['skipped'] == 1


@pytest.mark.parametrize('data_args', [[], ['--data-dir', 'missing']])
def test_cli_missing_data_directory_returns_short_error_without_traceback(tmp_path, data_args):
    result = subprocess.run([sys.executable, str(SCRIPT), *data_args, 'summary', '--days', '7'],
                            cwd=tmp_path, capture_output=True, text=True)
    assert result.returncode == 2
    assert 'error:' in result.stderr
    assert 'Traceback' not in result.stderr
    assert result.stdout == ''


def test_summary_cli_includes_skipped_count(tmp_path):
    folder = tmp_path / 'triage'
    folder.mkdir()
    (folder / (triage.datetime.now(triage.ZoneInfo('Asia/Tokyo')).date().isoformat() + '.json')).write_text('{bad')
    result = subprocess.run([sys.executable, str(SCRIPT), '--data-dir', str(tmp_path), 'summary', '--days', '7'],
                            capture_output=True, text=True, check=True)
    assert json.loads(result.stdout)['skipped'] == 1
