"""Fixture-only kiosk fetch checks: never connect to SSH."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1] / 'security-review'


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fetcher = load('kiosk_fetch')
collector = load('collect')
NOW = datetime(2026, 10, 30, 5, tzinfo=timezone.utc)
OLD = 'alert-20261029-010000.json'
NEW = 'alert-20261030-010000-suffix.json'


@pytest.fixture
def config(tmp_path):
    for name in ('state', 'logs', 'alerts'):
        (tmp_path / name).mkdir()
    return dict(kiosks=[dict(name='kiosk-a', address='192.0.2.1', user='pi')],
                state_dir=str(tmp_path / 'state'), summary_path=str(tmp_path / 'logs/summary.log'),
                output_alerts_dir=str(tmp_path / 'alerts'), log_path='/remote/log',
                alerts_dir='/remote/alerts', host_timeout_seconds=60, host_byte_cap=4194304,
                log_byte_cap=262144, alert_byte_cap=32768, alerts_per_host=50, summary_line_cap=2)


def watermark(config, host='kiosk-a'):
    return Path(config['state_dir']) / (host + '.watermark')


def alert(**kwargs):
    return json.dumps(dict(id='20261030-010000', timestamp=NOW.isoformat(), message='hello', **kwargs))


def result(log='', alerts=None, newest=NEW):
    return dict(log=log, alerts=alerts or [], newest=newest)


def run(config, response):
    return fetcher.fetch(config, lambda *args: response, NOW)


def test_first_run_watermark_without_backfill(config):
    calls = []

    def fake(host, request, timeout, byte_cap):
        calls.append(request)
        assert timeout == 60 and byte_cap == config['host_byte_cap']
        return result(alerts=[[NEW, alert()]])

    assert fetcher.fetch(config, fake, NOW) == 0
    assert calls[0]['watermark'] is None
    assert watermark(config).read_text() == NEW
    assert list(Path(config['output_alerts_dir']).iterdir()) == []


def test_empty_first_run_forwards_next_new_alert(config):
    run(config, result(newest=''))
    assert watermark(config).read_text() == ''
    run(config, result(alerts=[[NEW, alert()]]))
    assert len(list(Path(config['output_alerts_dir']).glob('alert-*'))) == 1


@pytest.mark.parametrize('source', [None, {'previous': 'origin'}, 'original source'])
def test_forward_rewrites_and_keeps_original_source(config, source):
    watermark(config).write_text(OLD)
    run(config, result(alerts=[[NEW, alert(source=source)]]))
    path = Path(config['output_alerts_dir']) / 'alert-20261030-010000-suffix-kiosk-a.json'
    value = json.loads(path.read_text())
    assert value['id'] == 'kiosk-a-20261030-010000'
    assert value['source'] == {'host': 'kiosk-a', 'original': source}
    assert value['message'] == 'hello'
    assert path.stat().st_mode & 0o777 == 0o644
    assert watermark(config).read_text() == NEW
    # Existing destination is preserved even if a watermark is restored.
    watermark(config).write_text(OLD)
    run(config, result(alerts=[[NEW, alert(source='changed')]]))
    assert json.loads(path.read_text()) == value
    assert not list(path.parent.glob('.kiosk-fetch-*'))


def test_literal_newline_is_reencoded_as_valid_json(config):
    watermark(config).write_text(OLD)
    text = alert().replace('hello', 'line one\nline two')
    run(config, result(alerts=[[NEW, text]]))
    value = json.loads(next(Path(config['output_alerts_dir']).glob('alert-*')).read_text())
    assert value['message'] == 'line one\nline two'
    assert value['source'] == {'host': 'kiosk-a'}


@pytest.mark.parametrize('text', ['', '{broken', '[' * 2000 + ']' * 2000, '[]', '{}', '{"id":"x"}',
                                  '{"timestamp":"2026-10-30"}',
                                  '{"id":"x","timestamp":"invalid"}',
                                  '{"id":"x","timestamp":5}',
                                  '{"id":"x","timestamp":"2026-10-30","value":NaN}'])
def test_skipped_alert_still_advances_watermark(config, text):
    watermark(config).write_text(OLD)
    run(config, result(alerts=[[NEW, text]]))
    assert watermark(config).read_text() == NEW
    assert list(Path(config['output_alerts_dir']).iterdir()) == []


def test_unreachable_host_does_not_stop_other_hosts_or_summary(config, capsys):
    config['kiosks'].append(dict(name='kiosk-b', address='192.0.2.2', user='pi'))
    calls = []

    def fake(host, *args):
        calls.append(host['name'])
        if host['name'] == 'kiosk-a':
            raise TimeoutError('private SSH diagnostic')
        return result()

    assert fetcher.fetch(config, fake, NOW) == 0
    text = Path(config['summary_path']).read_text()
    assert 'Host: kiosk-a\nStatus: unreachable' in text
    assert 'Host: kiosk-b\nStatus: no_completed_run' in text
    assert calls == ['kiosk-a', 'kiosk-b']
    assert watermark(config, 'kiosk-b').read_text() == NEW
    assert 'private SSH diagnostic' not in capsys.readouterr().out


def test_latest_completed_run_cap_and_collector_contract(config):
    log = ('[2026-10-29T01:00:00] Starting package integrity check...\nold\n'
           '[2026-10-29T01:01:00] Package integrity check completed.\n'
           '[2026-10-30T01:00:00] Starting package integrity check...\none\ntwo\nthree\nfour\n'
           '[2026-10-30T01:01:00] Package integrity check completed.\n'
           '[2026-10-30T02:00:00] Starting package integrity check...\nincomplete\n')
    run(config, result(log=log))
    text = Path(config['summary_path']).read_text()
    assert 'Status: ok\nLatest completed run: 2026-10-30T01:01:00' in text
    assert '  one\n  two\n  ... 2 more lines' in text
    assert 'old' not in text and 'incomplete' not in text
    assert collector.latest_completed_scan(text.splitlines(True), fetcher.START, fetcher.END, timezone.utc) == text


def test_remote_fixed_command_caps_and_orders_without_shell_interpolation(config, tmp_path):
    remote = tmp_path / 'remote alerts'
    remote.mkdir()
    (remote / NEW).write_text(alert())
    (remote / OLD).write_text('x' * 100)
    (remote / 'alert-unsafe;command.json').write_text('ignored')
    log = tmp_path / 'log'
    log.write_text('truncated first line\nlast line\n')
    request = dict(config, watermark='', alerts_dir=str(remote), log_path=str(log),
                   alerts_per_host=1, alert_byte_cap=10, log_byte_cap=15)

    def remote_run(q):
        return json.loads(subprocess.run([sys.executable, '-c', fetcher.REMOTE],
                                         input=json.dumps(q), capture_output=True, text=True, check=True).stdout)

    value = remote_run(request)
    assert value == result(log='last line\n', alerts=[[OLD, '']], newest=NEW)
    request['watermark'] = None
    assert remote_run(request)['alerts'] == []


def test_remote_missing_alerts_dir_still_returns_log(config, tmp_path):
    log = tmp_path / 'log'
    log.write_text('only line\n')
    request = dict(config, watermark='', alerts_dir=str(tmp_path / 'missing'), log_path=str(log))
    value = json.loads(subprocess.run([sys.executable, '-c', fetcher.REMOTE], input=json.dumps(request),
                                      capture_output=True, text=True, check=True).stdout)
    assert value == result(log='only line\n', newest='')


@pytest.mark.parametrize('source,cap,error', [("print('x' * 10000)", 100, ValueError),
                                            ('import time; time.sleep(5)', 100, TimeoutError)])
def test_ssh_runner_bounds_and_reaps_process(monkeypatch, source, cap, error):
    original = subprocess.Popen
    processes = []

    def fake(command, **kwargs):
        assert command[:7] == ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new']
        assert command[-1] == fetcher.REMOTE_COMMAND
        process = original([sys.executable, '-c', source], **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(fetcher.subprocess, 'Popen', fake)
    with pytest.raises(error):
        fetcher.ssh_runner(dict(user='pi', address='192.0.2.1'), {}, 0.1, cap)
    assert processes[0].poll() is not None
    assert processes[0].stdout.closed

