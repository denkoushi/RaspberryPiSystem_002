"""Fixture-only checks: no Git repositories, Docker, journal or host logs are opened."""
from datetime import datetime, timedelta
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest


ROOT = Path(__file__).resolve().parents[1] / 'security-review'


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


collector = load('collect')
known = load('known')
NOW = datetime(2026, 10, 26, 6, tzinfo=ZoneInfo('Asia/Tokyo'))
HEAD = 'a' * 40
PREVIOUS = 'b' * 40
PARENT = 'c' * 40


def fake_git(ancestor=0, commits=None):
    calls = []

    def invoke(repo, *args, check=True):
        calls.append(args)
        if args == ('rev-parse', 'HEAD'):
            return SimpleNamespace(stdout=HEAD + '\n', returncode=0)
        if args[0] in ('merge-base', 'cat-file'):
            return SimpleNamespace(stdout='', returncode=ancestor)
        if args[0] == 'log':
            return SimpleNamespace(stdout='\n'.join(commits or [HEAD]), returncode=0)
        if args[:2] == ('rev-parse', '--verify'):
            return SimpleNamespace(stdout=PARENT + '\n', returncode=0)
        raise AssertionError(args)
    return invoke, calls


@pytest.mark.parametrize('text,secret', [
    ('Authorization: Bearer abc123', 'abc123'),
    ('{"Authorization": ["Bearer hidden-header"]}', 'hidden-header'),
    ('Cookie: session=hidden-cookie; x=1', 'hidden-cookie'),
    ('{"X-Client-Key":"hidden-client"}', 'hidden-client'),
    ('password = "hunter-two"', 'hunter-two'),
    ('/login?password=hidden-query&user=x', 'hidden-query'),
    ('Bearer hidden-bearer', 'hidden-bearer'),
    ('token: hidden-token', 'hidden-token'),
    ('https://user:hidden-password@example.test/path', 'hidden-password'),
    ('value=Gz7qR2mNp9Vx4Ks8Tj6Wc3Yh5Lb1Df0Ua2Pe9HrQ', 'Gz7qR2mNp9Vx4Ks8Tj6Wc3Yh5Lb1Df0Ua2Pe9HrQ'),
    ('-----BEGIN ' + 'PRIVATE KEY-----\nprivate-data\n-----END PRIVATE KEY-----', 'private-data'),
])
def test_redaction(text, secret):
    assert secret not in collector.redact(text)
    assert '[REDACTED]' in collector.redact(text)


@pytest.mark.parametrize('text', ['const value = a?.b;', 'foo?: string;', 'const value = x ?? y;',
                                 'commit ' + 'aB01234567' * 4, 'sha256 ' + 'aB012345' * 8])
def test_redaction_preserves_code_and_hashes(text):
    assert collector.redact(text) == text


@pytest.mark.parametrize('text', ['{"uri":"/api/x?token=abc"}', 'GET /api/x?value=abc HTTP/1.1',
                                 'https://example.test/api/x?value=abc', '/?value=abc'])
def test_redaction_removes_request_queries(text):
    assert 'abc' not in collector.redact(text)
    assert '?[REDACTED]' in collector.redact(text)


@pytest.mark.parametrize('kind', ['security', 'errors'])
def test_log_material_keeps_full_redaction(kind):
    materials = {kind: collector.Material(4000)}
    materials[kind].add('Authorization: Bearer hidden-auth\nCookie: session=hidden-cookie\n'
                        'value=Gz7qR2mNp9Vx4Ks8Tj6Wc3Yh5Lb1Df0Ua2Pe9HrQ')
    assert materials[kind].text() == 'Authorization: [REDACTED]\nCookie: [REDACTED]\n[REDACTED]\n'


def test_caddy_uri_redaction_preserves_the_log_record():
    assert collector.redact('{"uri":"/api/x?token=abc","status":403}') == '{"uri":"/api/x?[REDACTED]","status":403}'


def test_collector_timer_check_mode_does_not_enable_unwritten_units():
    tasks = (ROOT.parents[2] / 'infrastructure/ansible/roles/server/tasks/security-review.yml').read_text()
    units = tasks.split('- name: Deliver security review collector units\n')[1].split('\n- name:')[0]
    enable = tasks.split('- name: Apply the collector enable flag\n')[1].split('\n- name:')[0]
    assert 'register: security_review_units' in units
    assert 'when: not (ansible_check_mode and security_review_units is changed)' in enable


def test_release_prepares_private_bind_directories_before_settings():
    roles = ROOT.parents[2] / 'infrastructure/ansible/roles/release_pi5/tasks'
    tasks = (roles / 'security-review.yml').read_text()
    storage, settings = tasks.split('- name: Deliver the lease-controlled security review settings')
    pattern = (roles / 'hermes-search-trial.yml').read_text()
    assert 'ansible.builtin.file:' in storage
    assert 'path: "{{ release_pi5_project_dir }}/storage/security-review/{{ item }}"' in storage
    assert 'state: directory' in storage
    for folder in ['', 'bundles', 'reports', 'queue', 'queue/pending', 'queue/claimed', 'queue/done', 'queue/failed', 'queue/progress']:
        assert folder in storage
    for field in ['owner', 'group', 'mode']:
        assert re.search(rf'^    {field}: .+$', storage, re.M)[0] == re.search(rf'^    {field}: .+$', pattern, re.M)[0]
    assert 'ansible.builtin.lineinfile:' in settings


def test_prepare_playbook_leaves_repo_path_to_inventory():
    playbook = (ROOT.parents[2] / 'infrastructure/ansible/playbooks/prepare-pi5-security-review.yml').read_text()
    assert not re.search(r'^\s+repo_path:', playbook, re.M)


def fake_docker(tmp_path, monkeypatch, source):
    executable = tmp_path / 'docker'
    executable.write_text(f'#!{sys.executable}\n' + source)
    executable.chmod(0o700)
    monkeypatch.setenv('PATH', str(tmp_path) + os.pathsep + os.environ['PATH'])


def test_docker_streams_both_outputs_and_keeps_only_errors(tmp_path, monkeypatch):
    fake_docker(tmp_path, monkeypatch, f'''
import json, sys
assert sys.argv[1:] == ['logs', '--since', '24h', 'api-blue']
for level, stream in [(30, sys.stdout), (40, sys.stderr), (50, sys.stdout), (60, sys.stderr)]:
    for _ in range(2000):
        print(json.dumps({{'level': level, 'time': {NOW.timestamp() * 1000}, 'msg': 'failure'}}), file=stream)
''')
    # The Docker log path must not fall back to buffered subprocess.run.
    monkeypatch.setattr(collector.subprocess, 'run', lambda *args, **kwargs: pytest.fail('buffered logs'))
    groups = collector.docker_errors(collector.docker_log_lines('api-blue'), 'api-blue', NOW - timedelta(days=1), NOW)
    assert len(groups) == 1
    assert groups[0]['count'] == 4000
    material = collector.Material(10)
    for group in groups:
        material.add(json.dumps(group))
    assert material.text() == '' and material.dropped == 1


def test_docker_yields_before_process_exits_and_times_out(tmp_path, monkeypatch):
    fake_docker(tmp_path, monkeypatch, "import time\nprint('first line', flush=True)\ntime.sleep(60)\n")
    lines = collector.docker_log_lines('api-blue', timeout=5)
    assert next(lines) == 'first line\n'
    with pytest.raises(subprocess.TimeoutExpired):
        list(lines)


def test_docker_nonzero_exit_is_a_source_failure(tmp_path, monkeypatch):
    fake_docker(tmp_path, monkeypatch, "import sys\nprint('private diagnostic', file=sys.stderr)\nsys.exit(1)\n")
    with pytest.raises(RuntimeError, match='^local source command failed$'):
        list(collector.docker_log_lines('api-blue'))


@pytest.mark.parametrize('close', [True, False])
def test_docker_cleans_up_on_early_close_or_exception(tmp_path, monkeypatch, close):
    fake_docker(tmp_path, monkeypatch, "import time\nprint('first line', flush=True)\ntime.sleep(60)\n")
    processes = []
    readers = []
    popen = collector.subprocess.Popen
    thread = collector.threading.Thread

    def start_process(*args, **kwargs):
        process = popen(*args, **kwargs)
        processes.append(process)
        return process

    class ReaderThread(thread):
        def __init__(self, *args, **kwargs):
            thread.__init__(self, *args, **kwargs)
            if kwargs.get('target'):
                readers.append(self)

    monkeypatch.setattr(collector.subprocess, 'Popen', start_process)
    monkeypatch.setattr(collector.threading, 'Thread', ReaderThread)
    lines = collector.docker_log_lines('api-blue')
    assert next(lines) == 'first line\n'
    if close:
        lines.close()
    else:
        with pytest.raises(ValueError, match='consumer failed'):
            lines.throw(ValueError('consumer failed'))
    assert processes[0].poll() is not None
    assert processes[0].stdout.closed and processes[0].stderr.closed
    assert len(readers) == 2
    assert all(not reader.is_alive() for reader in readers)


def test_material_bytes_dropped_lines_and_multiline_key():
    material = collector.Material(12)
    material.add('日本語\nmore\n')
    assert len(material.text().encode()) <= 12
    assert material.dropped == 1
    key = collector.Material(1000)
    key.add('-----BEGIN ' + 'PRIVATE KEY-----')
    key.add('hidden\n-----END PRIVATE KEY-----\nvisible')
    assert 'hidden' not in key.text()
    assert 'visible' in key.text()


def test_first_run_uses_commit_date_last_day():
    run, calls = fake_git()
    reviewed, revisions, fallback = collector.change_range('/fixture/repo', None, NOW - timedelta(hours=24), run)
    assert fallback and revisions == [HEAD]
    assert reviewed == {'from': PARENT, 'to': HEAD, 'note': 'first_run'}
    assert any('--since-as-filter=2026-10-25T06:00:00+09:00' in args for args in calls)
    assert not any(args[0] == 'merge-base' for args in calls)


def test_rollback_falls_back_and_records_reason():
    run, calls = fake_git(ancestor=1)
    reviewed, revisions, fallback = collector.change_range('/fixture/repo', PREVIOUS, NOW - timedelta(hours=24), run)
    assert fallback and revisions == [HEAD]
    assert reviewed['note'] == 'rollback_or_missing_previous_commit'
    assert ('merge-base', '--is-ancestor', PREVIOUS, HEAD) in calls


def test_normal_range_and_invalid_state_never_becomes_a_git_option():
    run, _ = fake_git()
    reviewed, revisions, fallback = collector.change_range('/fixture/repo', PREVIOUS, NOW, run)
    assert not fallback and revisions == [PREVIOUS + '..' + HEAD]
    assert reviewed == {'from': PREVIOUS, 'to': HEAD}
    run, calls = fake_git()
    collector.change_range('/fixture/repo', '--bad-option', NOW, run)
    assert not any('--bad-option' in args for args in calls)


def test_git_safe_directory_and_read_only_command(monkeypatch):
    calls = []
    monkeypatch.setattr(collector, 'command', lambda args, **kw: calls.append(args))
    collector.git('/fixture/repo', 'diff', PREVIOUS + '..' + HEAD)
    assert calls == [['git', '-c', 'safe.directory=/fixture/repo', '-C', '/fixture/repo', 'diff', PREVIOUS + '..' + HEAD]]


def test_caddy_counts_rules_caps_and_last_day():
    rules = {'unusual_hours': [5], 'denied_statuses': [401, 403], 'unknown_path_statuses': [404],
             'known_path_patterns': ['^/api/'], 'oversized_bytes': 10, 'examples_per_rule': 1}
    row = {'ts': (NOW - timedelta(minutes=20)).timestamp(), 'request': {'remote_ip': '192.0.2.1', 'uri': '/odd?secret=hidden'}, 'status': 403, 'size': 20}
    old = {**row, 'ts': (NOW - timedelta(days=2)).timestamp()}
    summary = collector.caddy_summary(lambda: (json.dumps(x) for x in [row, row, old]), NOW - timedelta(days=1), NOW, rules)
    assert summary['sources'] == {'192.0.2.1': 2}
    assert summary['statusClasses'] == {'4xx': 2}
    assert summary['rules'] == dict.fromkeys(['unusual_hours', 'denied', 'unknown_path', 'oversized'], 2)
    assert summary['droppedExamples']['denied'] == 1
    assert 'hidden' not in json.dumps(summary)


@pytest.mark.parametrize('reverse', [False, True])
def test_caddy_unusual_hours_only_counts_night_only_sources_and_covers_window(reverse):
    rules = {'unusual_hours': [5], 'denied_statuses': [403], 'unknown_path_statuses': [404],
             'known_path_patterns': ['^/api/'], 'oversized_bytes': 10, 'examples_per_rule': 1}
    night = NOW - timedelta(minutes=20)
    day = NOW - timedelta(hours=12)

    def row(at, source):
        return json.dumps({'ts': at.isoformat(), 'request': {'remote_ip': source, 'uri': '/api/poll'}, 'status': 200})

    rows = [row(night, 'kiosk'), row(night, 'night-only'), row(night + timedelta(minutes=1), 'night-only'),
            row(day, 'kiosk'), row(day, 'day-only'), row(NOW - timedelta(days=2), 'night-only'),
            row(NOW + timedelta(hours=1), 'night-only'), 'not json']
    summary = collector.caddy_summary(lambda: iter(rows[::-1] if reverse else rows), NOW - timedelta(days=1), NOW, rules)
    assert summary['sources'] == {'kiosk': 2, 'night-only': 2, 'day-only': 1}
    assert summary['statusClasses'] == {'2xx': 5}
    assert summary['rules'] == {'unusual_hours': 2, 'malformed': 1}
    assert summary['covered'] == {'from': day.isoformat(), 'to': (night + timedelta(minutes=1)).isoformat()}
    assert len(summary['examples']['unusual_hours']) == 1
    assert summary['examples']['unusual_hours'][0]['source'] == 'night-only'
    assert summary['droppedExamples']['unusual_hours'] == 1


def test_caddy_empty_window_has_no_covered_span():
    summary = collector.caddy_summary(lambda: iter([]), NOW - timedelta(days=1), NOW, {})
    assert summary['covered'] == {'from': None, 'to': None}
    assert summary['sources'] == summary['rules'] == {}


def test_monitor_summary_drops_only_unit_lifecycle_and_counts_failures():
    unit = 'security-monitor.service'
    first = NOW - timedelta(minutes=30)
    rows = [f'{NOW.isoformat()} host systemd[1]: {message}' for message in [
        f'Starting {unit} - Security Monitor...', f'Started {unit} - Security Monitor.',
        f'Finished {unit} - Security Monitor.', f'{unit}: Deactivated successfully.',
        f'{unit}: Consumed 1.234s CPU time.', f'{unit}: Succeeded.',
    ]]
    failed = f'{unit}: Failed with result \'exit-code\'.'
    exited = f'{unit}: Main process exited, code=exited, status=1/FAILURE'
    rows += [f'{NOW.isoformat()} host systemd[1]: {failed}',
             f'{NOW.isoformat()} host systemd[1]: {exited}',
             f'{first.isoformat()} other-host systemd[1]: {failed}',
             f'{NOW.isoformat()} host monitor[42]: WARNING: unexpected listener',
             f'{first.isoformat()} other-host monitor[99]: WARNING: unexpected listener',
             f'{NOW.isoformat()} host monitor[43]: WARNING: unexpected listener',
             f'{NOW.isoformat()} host monitor[43]: ALERT: check failed',
             f'{NOW.isoformat()} host systemd[1]: Started other.service - Other.',
             f'{NOW.isoformat()} host monitor[43]: {unit}: Succeeded.',
             'unparsed warning']
    groups = collector.monitor_summary(rows, unit, NOW.tzinfo)
    assert [group['count'] for group in groups] == [3, 2, 1, 1, 1, 1, 1]
    assert groups[0] == {'source': 'monitor', 'message': 'WARNING: unexpected listener', 'count': 3,
                         'first': first.isoformat(), 'last': NOW.isoformat()}
    assert groups[1] == {'source': 'monitor', 'message': failed, 'count': 2,
                         'first': first.isoformat(), 'last': NOW.isoformat()}
    assert {group['message'] for group in groups[2:]} == {
        exited, 'ALERT: check failed', 'Started other.service - Other.', f'{unit}: Succeeded.', 'unparsed warning'}


def test_collect_writes_monitor_groups_and_caddy_coverage_as_json_lines(monkeypatch):
    captured = {}
    monkeypatch.setattr(collector, 'enqueue_changes', lambda *args, **kwargs: ({'from': PREVIOUS, 'to': HEAD}, dict.fromkeys(['pending', 'claimed', 'done', 'failed'], 0)))
    monkeypatch.setattr(collector, 'log_lines', lambda patterns, since=None: iter([]))
    monkeypatch.setattr(collector, 'command', lambda args: SimpleNamespace(stdout=(
        f'{NOW.isoformat()} host systemd[1]: security-monitor.service: Deactivated successfully.\n'
        f'{NOW.isoformat()} host systemd[1]: security-monitor.service: Failed with result \'exit-code\'.\n')))
    monkeypatch.setattr(collector, 'publish_bundle', lambda config, date, materials, manifest: captured.update(
        security=materials['security'].text(), manifest=manifest))
    collector.collect({'timezone': 'Asia/Tokyo', 'material_byte_cap': 8000, 'fail2ban_logs': [],
                       'caddy_logs': [], 'caddy_rules': {}, 'monitor_unit': 'security-monitor.service',
                       'scans': [], 'containers': []})
    rows = [json.loads(line) for line in captured['security'].splitlines()]
    assert {'source': 'caddy', 'covered': {'from': None, 'to': None}} in rows
    assert [row for row in rows if row['source'] == 'monitor'] == [{
        'source': 'monitor', 'message': "security-monitor.service: Failed with result 'exit-code'.",
        'count': 1, 'first': NOW.isoformat(), 'last': NOW.isoformat()}]
    assert captured['manifest']['sourceErrors'] == []
    assert captured['manifest']['queue'] == dict.fromkeys(['pending', 'claimed', 'done', 'failed'], 0)
    assert 'carriedOver' not in captured['manifest']


def test_caddy_access_log_retention_variants():
    docker = ROOT.parents[2] / 'infrastructure/docker'
    variants = []
    for path in docker.glob('Caddyfile*'):
        blocks = re.findall(r'output file /var/log/caddy/access\.log\s*\{([^}]+)\}', path.read_text())
        for block in blocks:
            variants.append(path.name)
            assert re.search(r'\broll_keep 300\s', block), path.name
            assert re.search(r'\broll_keep_for 168h\s', block), path.name
            assert re.search(r'\broll_size 5MiB\s', block), path.name
    assert len(variants) == 5


def test_fail2ban_last_day_and_latest_completed_scan():
    rows = ['2026-10-26 05:10:00 [sshd] Ban 192.0.2.1', '2026-10-23 05:10:00 [sshd] Ban 192.0.2.2']
    assert collector.fail2ban_summary(rows, NOW - timedelta(days=1), NOW)['bans'] == 1
    scan = ['[2026-10-26T02:00:00] Starting scan\n', 'new complete\n', '[2026-10-26T02:01:00] completed\n',
            '[2026-10-26T03:00:00] Starting scan\n', 'unfinished\n',
            '[2026-10-25T02:00:00] Starting scan\n', 'old complete\n', '[2026-10-25T02:01:00] completed\n']
    result = collector.latest_completed_scan(scan, 'Starting scan', 'completed', NOW.tzinfo)
    assert 'new complete' in result and 'unfinished' not in result and 'old complete' not in result


def test_docker_error_grouping_and_level():
    def row(level, time):
        return json.dumps({'level': level, 'time': time.timestamp() * 1000, 'msg': 'failure'})
    rows = [row(50, NOW - timedelta(minutes=2)), row(60, NOW), row(40, NOW), row(50, NOW - timedelta(days=2)), 'not json']
    groups = collector.docker_errors(rows, 'api-blue', NOW - timedelta(days=1), NOW)
    assert groups == [{'source': 'api-blue', 'message': 'failure', 'count': 2,
                       'first': (NOW - timedelta(minutes=2)).isoformat(), 'last': NOW.isoformat()}]


def test_bundle_publication_is_atomic_and_private(tmp_path, monkeypatch):
    (tmp_path / 'bundles').mkdir()
    state = tmp_path / 'state'
    config = {'data_dir': str(tmp_path), 'state_file': str(state), 'api_uid': os.getuid(), 'api_gid': os.getgid()}
    material = collector.Material(100)
    material.add('fixture')
    manifest = {'reviewedCommits': {'from': PREVIOUS, 'to': HEAD}, 'droppedLines': {}, 'sourceErrors': []}
    original = collector.atomic_write
    calls = []

    def write(filename, text, uid, gid):
        calls.append(filename.name)
        if filename == state:
            assert (tmp_path / 'bundles/2026-10-26/manifest.json').exists()
        original(filename, text, os.getuid(), os.getgid())
    monkeypatch.setattr(collector, 'atomic_write', write)
    collector.publish_bundle(config, '2026-10-26', {'changes': material}, manifest)
    assert calls[-1] == 'manifest.json' and not state.exists()
    assert (tmp_path / 'bundles/2026-10-26').stat().st_mode & 0o777 == 0o700
    assert (tmp_path / 'bundles/2026-10-26/changes.txt').stat().st_mode & 0o777 == 0o600
    # Failed rewrite leaves the prior complete bundle intact.
    monkeypatch.setattr(collector, 'atomic_write', lambda *args: (_ for _ in ()).throw(OSError('fixture')))
    with pytest.raises(OSError):
        collector.publish_bundle(config, '2026-10-26', {'changes': material}, manifest)
    assert not state.exists()
    assert (tmp_path / 'bundles/2026-10-26/manifest.json').exists()


def test_known_add_list_remove_and_normalization(tmp_path):
    digest = known.fingerprint('ERRORS', ' /API:1 ', 'ＦＡＩＬ  one\nTWO')
    assert digest == hashlib.sha256(b'errors|/api:1|fail one two').hexdigest()
    entry = {'fingerprint': digest, 'kind': 'errors', 'location': '/api:1', 'what': 'fail one two', 'reason': 'fixture', 'date': '2026-10-26'}
    file = tmp_path / 'known-findings.json'
    assert known.update(file, 'add', entry) == [entry]
    assert known.update(file, 'add', entry) == [entry]
    assert known.update(file, 'list') == [entry]
    assert file.stat().st_mode & 0o777 == 0o600
    assert known.update(file, 'remove', key=digest) == []


def test_missing_source_is_not_reported_as_clean(tmp_path):
    with pytest.raises(FileNotFoundError):
        list(collector.log_lines([str(tmp_path / 'missing*.log')]))


def test_log_lines_skips_rotations_last_written_before_window(tmp_path):
    old = tmp_path / 'access-old.log'
    new = tmp_path / 'access-new.log'
    old.write_text('old\n')
    new.write_text('new\n')
    os.utime(old, (NOW.timestamp() - 3 * 86400,) * 2)
    os.utime(new, (NOW.timestamp(),) * 2)
    lines = list(collector.log_lines([str(tmp_path / 'access-*.log')], NOW - timedelta(days=1)))
    assert lines == ['new\n']


def file_diff(name, body='+change\n'):
    return f'diff --git a/{name} b/{name}\n{body}'


def test_server_installs_triage_with_known_tool_and_private_api_directory():
    tasks = (ROOT.parents[2] / 'infrastructure/ansible/roles/server/tasks/security-review.yml').read_text()
    assert '{src: known.py, dest: /usr/local/bin/security-review-known.py}' in tasks
    assert '{src: triage.py, dest: /usr/local/bin/security-review-triage.py}' in tasks
    directories = tasks.split('- name: Create root-only collector')[0]
    for folder in ['bundles', 'reports', 'triage', 'queue/pending', 'queue/claimed', 'queue/done', 'queue/failed', 'queue/progress']:
        assert folder in directories
    assert 'owner: "{{ api_runtime_uid | default(1000) }}"' in directories
    assert 'group: "{{ api_runtime_gid | default(1000) }}"' in directories
    assert "mode: '0700'" in directories


def queue_fixture(tmp_path, monkeypatch, diffs=None, commits=None, root_commit=False):
    commits = commits if commits is not None else [HEAD]
    diffs = diffs if diffs is not None else {'src/main.ts': file_diff('src/main.ts')}
    state = tmp_path / 'state'
    state.write_text(PREVIOUS)
    config = {'project_dir': '/fixture', 'state_file': str(state), 'data_dir': str(tmp_path),
              'api_uid': os.getuid(), 'api_gid': os.getgid(), 'changes_exclude': ['.env*', '*.md'],
              'changes_context_lines': 1}
    calls = []
    original = collector.atomic_write
    monkeypatch.setattr(collector, 'atomic_write', lambda filename, text, uid, gid:
                        original(filename, text, os.getuid(), os.getgid()))

    def run(repo, *args, check=True):
        calls.append(args)
        if args == ('rev-parse', 'HEAD'):
            return SimpleNamespace(stdout=HEAD, returncode=0)
        if args[0] in ('merge-base', 'cat-file'):
            return SimpleNamespace(stdout='', returncode=0)
        if args[0] in ('rev-list', 'log'):
            assert '--first-parent' in args and '--reverse' in args
            return SimpleNamespace(stdout='\n'.join(commits), returncode=0)
        if args[:2] == ('rev-parse', '--verify'):
            return SimpleNamespace(stdout='', returncode=1 if root_commit else 0)
        if args[0] == 'show' and '--no-patch' in args:
            return SimpleNamespace(stdout=('' if root_commit else PARENT) + '\n' + NOW.isoformat() + '\n', returncode=0)
        if '--name-only' in args:
            assert '--first-parent' in args
            return SimpleNamespace(stdout='\0'.join(diffs) + '\0', returncode=0)
        if '--' in args:
            assert '--unified=1' in args
            assert '--no-ext-diff' in args and '--no-textconv' in args
            if root_commit:
                assert args[0] == 'show' and '--root' in args
            else:
                assert args[:2] == ('diff', PARENT)
            name = args[-1].removeprefix(':(literal)')
            return SimpleNamespace(stdout=diffs[name], returncode=0)
        raise AssertionError(args)
    return config, run, calls


def queued(config, sha=HEAD, folder='pending'):
    return json.loads((Path(config['data_dir']) / 'queue' / folder / (sha + '.json')).read_text())


@pytest.mark.parametrize('root_commit', [False, True])
def test_enqueue_preserves_entire_redacted_job_and_permissions(tmp_path, monkeypatch, root_commit):
    diff = file_diff('src/main.ts', '+const accessToken = req.headers.authorization;\n' + '+界\n' * 10000)
    diff += '+https://user:hidden-password@example.test/path\n'
    diff += '+-----BEGIN PRIVATE KEY-----\n+private-data\n+-----END PRIVATE KEY-----\n'
    config, run, _ = queue_fixture(tmp_path, monkeypatch, {'src/main.ts': diff}, root_commit=root_commit)
    reviewed, counts = collector.enqueue_changes(config, NOW, run)
    job = queued(config)
    assert set(job) == {'version', 'sha', 'parent', 'committedAt', 'enqueuedAt', 'files', 'bytes', 'omittedFiles'}
    assert job == {'version': 1, 'sha': HEAD, 'parent': None if root_commit else PARENT,
                   'committedAt': NOW.isoformat(), 'enqueuedAt': NOW.isoformat(),
                   'files': [{'path': 'src/main.ts', 'diff': collector.redact_code(diff)}],
                   'bytes': len(collector.redact_code(diff).encode()), 'omittedFiles': 0}
    assert 'private-data' not in job['files'][0]['diff']
    assert 'hidden-password' not in job['files'][0]['diff']
    assert '+界\n' * 10000 in job['files'][0]['diff']
    assert reviewed == {'from': PREVIOUS, 'to': HEAD}
    assert counts == {'pending': 1, 'claimed': 0, 'done': 0, 'failed': 0, 'invalid': 0}
    assert Path(config['state_file']).read_text().strip() == HEAD
    root = tmp_path / 'queue'
    for folder in [root, *(root / name for name in collector.QUEUE_STATES)]:
        assert folder.stat().st_mode & 0o777 == 0o700
        assert folder.stat().st_uid == os.getuid()
    assert (root / 'pending' / (HEAD + '.json')).stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize('folder', collector.QUEUE_STATES)
def test_enqueue_is_idempotent_in_every_state(tmp_path, monkeypatch, folder):
    config, run, calls = queue_fixture(tmp_path, monkeypatch)
    root = collector.queue_directories(config)
    existing = root / folder / (HEAD + '.json')
    existing.write_text('{"fixture":true}')
    collector.enqueue_changes(config, NOW, run)
    collector.enqueue_changes(config, NOW, run)
    assert existing.read_text() == '{"fixture":true}'
    assert not any('--name-only' in call or '--no-patch' in call for call in calls)
    assert len(list(root.glob('*/*.json'))) == 1


def test_enqueue_filters_before_reading_diff_and_counts_omissions(tmp_path, monkeypatch):
    names = ['src/main.ts', '.env', 'docs/x.md', 'src/a.test.ts', 'src/a.test.tsx',
             'src/a.spec.ts', 'src/__tests__/x.ts', 'clients/tests/a.py', 'test_a.py',
             'src/a_test.py', 'e2e/browser.ts']
    config, run, calls = queue_fixture(tmp_path, monkeypatch, {name: file_diff(name) for name in names})
    config['changes_exclude'] += ['*.test.ts', '*.test.tsx', '*.spec.ts', '*/__tests__/*',
                                  '*/tests/*', 'test_*.py', '*_test.py', 'e2e/*']
    collector.enqueue_changes(config, NOW, run)
    assert queued(config)['omittedFiles'] == len(names) - 1
    assert [file['path'] for file in queued(config)['files']] == ['src/main.ts']
    assert [call[-1] for call in calls if '--' in call] == [':(literal)src/main.ts']


def test_enqueue_migrates_all_old_ranges_without_expiration_and_backfills(tmp_path, monkeypatch):
    extra = 'd' * 40
    config, run, calls = queue_fixture(tmp_path, monkeypatch, commits=[HEAD, extra])
    carry = collector.carry_over_file(config)
    carry.write_text(json.dumps([
        {'revision': PREVIOUS + '..' + HEAD, 'file': 'a.ts', 'since': '2000-01-01'},
        {'revision': extra, 'file': 'old.ts', 'since': '2000-01-01'},
        {'revision': extra, 'file': 'duplicate.ts', 'since': '2000-01-01'}]))
    config['changes_backfill'] = [{'from': PARENT, 'to': extra}]
    collector.enqueue_changes(config, NOW, run)
    assert not carry.exists()
    assert queued(config, extra)['sha'] == extra
    assert ('rev-list', '--first-parent', '--reverse', PARENT + '..' + extra) in calls
    assert len(list((tmp_path / 'queue/pending').glob('*.json'))) == 2
    collector.enqueue_changes(config, NOW, run)
    assert len(list((tmp_path / 'queue/pending').glob('*.json'))) == 2


@pytest.mark.parametrize('failure', ['diff', 'write', 'state'])
def test_enqueue_failure_keeps_cursor_and_legacy_and_retry_is_safe(tmp_path, monkeypatch, failure):
    extra = 'd' * 40
    config, run, _ = queue_fixture(tmp_path, monkeypatch, commits=[extra, HEAD])
    carry = collector.carry_over_file(config)
    carry.write_text(json.dumps([{'revision': extra}]))
    original = collector.atomic_write

    def write(filename, text, uid, gid):
        if (failure == 'write' and filename.name == HEAD + '.json') or (failure == 'state' and filename == Path(config['state_file'])):
            raise OSError('fixture write failure')
        if filename == Path(config['state_file']):
            assert all((tmp_path / 'queue/pending' / (sha + '.json')).exists() for sha in [extra, HEAD])
        original(filename, text, uid, gid)

    def git_read(repo, *args, **kwargs):
        if failure == 'diff' and '--' in args and HEAD in args:
            raise OSError('fixture diff failure')
        return run(repo, *args, **kwargs)
    monkeypatch.setattr(collector, 'atomic_write', write)
    with pytest.raises(OSError, match='fixture'):
        collector.enqueue_changes(config, NOW, git_read)
    assert Path(config['state_file']).read_text() == PREVIOUS
    assert carry.exists()
    assert queued(config, extra)['sha'] == extra
    monkeypatch.setattr(collector, 'atomic_write', original)
    collector.enqueue_changes(config, NOW, run)
    assert Path(config['state_file']).read_text().strip() == HEAD
    assert not carry.exists()


@pytest.mark.parametrize('contents', ['{broken', '{}', '[{}]', '[{"revision":"--bad-option"}]'])
def test_invalid_migration_is_preserved_without_advancing_state(tmp_path, monkeypatch, contents):
    config, run, calls = queue_fixture(tmp_path, monkeypatch)
    carry = collector.carry_over_file(config)
    carry.write_text(contents)
    with pytest.raises((ValueError, KeyError)):
        collector.enqueue_changes(config, NOW, run)
    assert carry.read_text() == contents
    assert Path(config['state_file']).read_text() == PREVIOUS
    assert not any('--bad-option' in call for call in calls)


def test_enqueue_mode_never_reads_logs_or_publishes_bundle(tmp_path, monkeypatch):
    config, run, _ = queue_fixture(tmp_path, monkeypatch)
    config['timezone'] = 'Asia/Tokyo'
    original = collector.enqueue_changes
    monkeypatch.setattr(collector, 'enqueue_changes', lambda config, now, **kwargs: original(config, now, run, **kwargs))
    monkeypatch.setattr(collector, 'command', lambda *args: pytest.fail('enqueue must not collect logs'))
    monkeypatch.setattr(collector, 'publish_bundle', lambda *args: pytest.fail('enqueue must not publish bundle'))
    collector.collect(config, mode='enqueue')
    assert queued(config)['sha'] == HEAD
    assert not (tmp_path / 'bundles').exists()


def test_cli_accepts_enqueue_mode(tmp_path, monkeypatch):
    config = tmp_path / 'fixture.json'
    config.write_text('{}')
    calls = []
    monkeypatch.setattr(sys, 'argv', ['collect.py', str(config), '--mode', 'enqueue'])
    monkeypatch.setattr(collector, 'collect', lambda value, mode: calls.append((value, mode)))
    collector.main()
    assert calls == [({}, 'enqueue')]


@pytest.mark.parametrize('source', ['carry', 'backfill'])
def test_unavailable_revision_is_reported_and_other_jobs_continue(tmp_path, monkeypatch, source):
    config, run, calls = queue_fixture(tmp_path, monkeypatch)
    missing = 'e' * 40
    if source == 'carry':
        collector.carry_over_file(config).write_text(json.dumps([{'revision': missing}, {'revision': HEAD}]))
    else:
        config['changes_backfill'] = [{'from': missing, 'to': HEAD}]

    def read(repo, *args, **kwargs):
        if args == ('cat-file', '-e', missing + '^{commit}'):
            return SimpleNamespace(returncode=1, stdout='')
        return run(repo, *args, **kwargs)
    errors = []
    collector.enqueue_changes(config, NOW, read, source_errors=errors)
    assert errors == ['changes_revision_unavailable:' + missing[:12]]
    assert queued(config)['sha'] == HEAD
    assert not (tmp_path / 'queue/pending' / (missing + '.json')).exists()
    assert Path(config['state_file']).read_text().strip() == HEAD


def test_uppercase_shas_are_normalized_before_git_and_filenames(tmp_path, monkeypatch):
    config, run, calls = queue_fixture(tmp_path, monkeypatch, commits=[HEAD.upper()])
    Path(config['state_file']).write_text(PREVIOUS.upper())
    collector.carry_over_file(config).write_text(json.dumps([{'revision': HEAD.upper()}]))
    config['changes_backfill'] = [{'from': PARENT.upper(), 'to': HEAD.upper()}]

    def read(repo, *args, **kwargs):
        result = run(repo, *args, **kwargs)
        if args == ('rev-parse', 'HEAD') or (args[0] == 'show' and '--no-patch' in args):
            result.stdout = result.stdout.upper()
        return result
    collector.enqueue_changes(config, NOW, read)
    assert queued(config)['sha'] == HEAD
    assert queued(config)['parent'] == PARENT
    assert Path(config['state_file']).read_text().strip() == HEAD
    assert ('merge-base', '--is-ancestor', PREVIOUS, HEAD) in calls
    assert ('cat-file', '-e', HEAD + '^{commit}') in calls
    assert list((tmp_path / 'queue/pending').glob('*.json')) == [tmp_path / 'queue/pending' / (HEAD + '.json')]


def test_nightly_publishes_logs_even_when_enqueue_fails_without_advancing_cursor(tmp_path, monkeypatch):
    config, run, _ = queue_fixture(tmp_path, monkeypatch)
    config.update(timezone='Asia/Tokyo', material_byte_cap=8000, fail2ban_logs=[], caddy_logs=[],
                  caddy_rules={}, monitor_unit='monitor', scans=[], containers=[])
    original = collector.enqueue_changes

    def fail(repo, *args, **kwargs):
        if args[0] == 'rev-list':
            raise RuntimeError('cannot enqueue range')
        return run(repo, *args, **kwargs)
    monkeypatch.setattr(collector, 'enqueue_changes', lambda config, now, **kwargs: original(config, now, fail, **kwargs))
    monkeypatch.setattr(collector, 'command', lambda *args, **kwargs: SimpleNamespace(stdout=''))
    monkeypatch.setattr(collector, 'log_lines', lambda *args, **kwargs: iter([]))
    (tmp_path / 'bundles').mkdir()
    collector.collect(config)
    manifests = list((tmp_path / 'bundles').glob('*/manifest.json'))
    assert len(manifests) == 1
    assert 'changes_enqueue_failed' in json.loads(manifests[0].read_text())['sourceErrors']
    assert (manifests[0].parent / 'security.txt').exists()
    assert (manifests[0].parent / 'errors.txt').exists()
    assert Path(config['state_file']).read_text() == PREVIOUS


def test_enqueue_holds_exclusive_state_lock_during_all_work(tmp_path, monkeypatch):
    config, run, _ = queue_fixture(tmp_path, monkeypatch)
    original = collector.fcntl.flock
    locked = []

    def lock(descriptor, operation):
        assert operation == collector.fcntl.LOCK_EX
        original(descriptor, operation)
        locked.append(descriptor)
    monkeypatch.setattr(collector.fcntl, 'flock', lock)

    def read(repo, *args, **kwargs):
        assert locked
        with (tmp_path / 'changes-enqueue.lock').open('a') as competing:
            with pytest.raises(BlockingIOError):
                original(competing.fileno(), collector.fcntl.LOCK_EX | collector.fcntl.LOCK_NB)
        return run(repo, *args, **kwargs)
    collector.enqueue_changes(config, NOW, read)
    with (tmp_path / 'changes-enqueue.lock').open('a') as competing:
        original(competing.fileno(), collector.fcntl.LOCK_EX | collector.fcntl.LOCK_NB)
    assert (tmp_path / 'changes-enqueue.lock').stat().st_mode & 0o777 == 0o600


def test_quarantined_sha_is_not_enqueued_again(tmp_path, monkeypatch):
    config, run, calls = queue_fixture(tmp_path, monkeypatch)
    root = collector.queue_directories(config)
    (root / 'invalid' / ('pending-' + HEAD + '.json')).write_text('{}')
    collector.enqueue_changes(config, NOW, run)
    assert not (root / 'pending' / (HEAD + '.json')).exists()
    assert not any(call[0] == 'show' for call in calls)


@pytest.mark.parametrize('reasons,eligible', [
    (['refused_or_vague'], True),
    (['invalid_model_schema', 'completion_failed'], True),
    (['refused_or_vague', 'timeout_at_minimum_unit'], False),
    ([], False),
])
def test_requeue_failed_filters_reasons_and_rebuilds_job(tmp_path, monkeypatch, capsys, reasons, eligible):
    diffs = {'src/main.ts': file_diff('src/main.ts', '+https://user:password@example.com\n'),
             '.env': 'private', 'docs/x.md': 'excluded'}
    config, run, calls = queue_fixture(tmp_path, monkeypatch, diffs)
    root = collector.queue_directories(config)
    record = root / 'failed' / (HEAD + '.json')
    record.write_text(json.dumps({'sha': HEAD, 'failedUnits': [{'reason': reason} for reason in reasons]}))
    progress = root / 'progress' / record.name
    progress.write_text('old progress')

    def locked_read(repo, *args, **kwargs):
        with (tmp_path / 'changes-enqueue.lock').open('a') as competing:
            with pytest.raises(BlockingIOError):
                collector.fcntl.flock(competing.fileno(), collector.fcntl.LOCK_EX | collector.fcntl.LOCK_NB)
        return run(repo, *args, **kwargs)

    counts = collector.requeue_failed(config, NOW,
        {'refused_or_vague', 'invalid_model_schema', 'completion_failed'}, git_call=locked_read)
    assert counts == {'requeued': int(eligible), 'retained': int(not eligible), 'dryRun': False}
    assert json.loads(capsys.readouterr().out) == counts
    assert record.exists() is not eligible
    assert progress.exists() is not eligible
    assert Path(config['state_file']).read_text() == PREVIOUS
    if eligible:
        job = queued(config)
        assert job['omittedFiles'] == 2
        assert job['files'] == [{'path': 'src/main.ts', 'diff': collector.redact_code(diffs['src/main.ts'])}]
        pending = root / 'pending' / record.name
        assert pending.stat().st_mode & 0o777 == 0o600
        assert pending.stat().st_uid == config['api_uid']
        assert pending.stat().st_gid == config['api_gid']
        assert all((root / state).stat().st_mode & 0o777 == 0o700 for state in collector.QUEUE_STATES)
    else:
        assert calls == []


def test_requeue_failed_dry_run_counts_custom_reason_without_changes(tmp_path, monkeypatch, capsys):
    config, _, _ = queue_fixture(tmp_path, monkeypatch)
    root = collector.queue_directories(config)
    record = root / 'failed' / (HEAD + '.json')
    record.write_text(json.dumps({'sha': HEAD, 'failedUnits': [{'reason': 'custom'}]}))
    progress = root / 'progress' / record.name
    progress.write_text('old progress')
    def no_git(*args, **kwargs):
        pytest.fail('dry-run must only count candidates')
    counts = collector.requeue_failed(config, NOW, {'custom'}, dry_run=True, git_call=no_git)
    assert counts == {'requeued': 1, 'retained': 0, 'dryRun': True}
    assert json.loads(capsys.readouterr().out) == counts
    assert record.exists() and progress.read_text() == 'old progress'
    assert not list((root / 'pending').iterdir())


def test_requeue_failed_retains_unreachable_sha_and_continues(tmp_path, monkeypatch, capsys):
    config, run, _ = queue_fixture(tmp_path, monkeypatch)
    root = collector.queue_directories(config)
    missing = 'f' * 40
    for sha in [missing, HEAD]:
        (root / 'failed' / (sha + '.json')).write_text(json.dumps(
            {'sha': sha, 'failedUnits': [{'reason': 'refused_or_vague'}]}))
    def read(repo, *args, **kwargs):
        if args == ('cat-file', '-e', missing + '^{commit}'):
            return SimpleNamespace(returncode=1)
        return run(repo, *args, **kwargs)
    counts = collector.requeue_failed(config, NOW, {'refused_or_vague'}, git_call=read)
    assert counts == {'requeued': 1, 'retained': 1, 'dryRun': False}
    output = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert output == [{'sha': missing, 'reason': 'commit_unreachable'}, counts]
    assert (root / 'failed' / (missing + '.json')).exists()
    assert queued(config)['sha'] == HEAD


def test_cli_accepts_requeue_failed_options(tmp_path, monkeypatch):
    config = tmp_path / 'fixture.json'
    config.write_text('{"timezone":"Asia/Tokyo"}')
    calls = []
    monkeypatch.setattr(sys, 'argv', ['collect.py', str(config), '--mode', 'requeue-failed',
                                    '--requeue-reasons', 'custom,completion_failed', '--dry-run'])
    monkeypatch.setattr(collector, 'requeue_failed', lambda value, now, reasons, dry_run:
                        calls.append((reasons, dry_run)))
    collector.main()
    assert calls == [({'custom', 'completion_failed'}, True)]
