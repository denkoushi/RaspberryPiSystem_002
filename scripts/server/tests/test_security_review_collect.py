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
        if args[0] == 'merge-base':
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


@pytest.mark.parametrize('fallback', [False, True])
def test_changes_preserve_diff_and_redact_only_keys_and_url_credentials(tmp_path, fallback):
    name = 'apps/web/src/features/some-long-folder/SomeComponentName.test.tsx'
    diff = f'diff --git a/{name} b/{name}\n--- a/{name}\n+++ b/{name}\n+  const accessToken = req.headers.authorization;\n'
    key = '+-----BEGIN ' + 'PRIVATE KEY-----\n+private-data\n+-----END PRIVATE KEY-----\n'
    url = '+https://user:hidden-password@example.test/path\n'
    assert collector.redact_code(diff) == diff
    assert 'private-data' not in collector.redact_code(key)
    assert collector.redact_code(url) == '+https://[REDACTED]@example.test/path\n'

    def run(repo, *args, check=True):
        if args[0] == 'rev-parse':
            return SimpleNamespace(stdout=HEAD if args[-1] == 'HEAD' else PARENT, returncode=0)
        if args[0] == 'merge-base':
            return SimpleNamespace(stdout='', returncode=0)
        if '--name-only' in args:
            return SimpleNamespace(stdout=name + '\0', returncode=0)
        if '--' in args:
            return SimpleNamespace(stdout=diff + key + url, returncode=0)
        return SimpleNamespace(stdout=HEAD, returncode=0)
    state = tmp_path / 'state'
    if not fallback:
        state.write_text(PREVIOUS)
    material = collector.Material(4000)
    collector.collect_changes({'project_dir': '/fixture', 'state_file': str(state), 'changes_exclude': []}, material, NOW, run)
    assert diff in material.text()
    assert 'private-data' not in material.text()
    assert 'hidden-password' not in material.text()
    assert '+https://[REDACTED]@example.test/path' in material.text()


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
    assert "loop: ['', bundles, reports]" in storage
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


def test_changes_filter_does_not_read_excluded_paths(tmp_path):
    seen = []

    def run(repo, *args, check=True):
        seen.append(args)
        if args[0] == 'rev-parse':
            return SimpleNamespace(stdout=HEAD, returncode=0)
        if args[0] == 'merge-base':
            return SimpleNamespace(stdout='', returncode=0)
        if '--name-only' in args:
            return SimpleNamespace(stdout='src/main.ts\0.env\0docs/x.md\0generated/x.ts\0', returncode=0)
        return SimpleNamespace(stdout='fixture diff', returncode=0)
    state = tmp_path / 'state'
    state.write_text(PREVIOUS)
    collector.collect_changes({'project_dir': '/fixture', 'state_file': str(state),
                               'changes_exclude': ['.env*', 'docs/*', 'generated/*']}, collector.Material(100), NOW, run)
    paths = [args[-1] for args in seen if '--' in args]
    assert paths == ['src/main.ts']


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
    monkeypatch.setattr(collector, 'collect_changes', lambda *args: {'from': PREVIOUS, 'to': HEAD})
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


def test_bundle_publication_state_last_and_permissions(tmp_path, monkeypatch):
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
    assert calls[-1] == 'state' and state.read_text().strip() == HEAD
    assert (tmp_path / 'bundles/2026-10-26').stat().st_mode & 0o777 == 0o700
    assert (tmp_path / 'bundles/2026-10-26/changes.txt').stat().st_mode & 0o777 == 0o600
    # Failed rewrite leaves the prior complete bundle and cursor intact.
    monkeypatch.setattr(collector, 'atomic_write', lambda *args: (_ for _ in ()).throw(OSError('fixture')))
    with pytest.raises(OSError):
        collector.publish_bundle(config, '2026-10-26', {'changes': material}, manifest)
    assert state.read_text().strip() == HEAD
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


def test_fallback_includes_merge_changes_against_first_parent(tmp_path):
    calls = []

    def run(repo, *args, check=True):
        calls.append(args)
        if args[0] == 'rev-parse':
            return SimpleNamespace(stdout=HEAD if args[-1] == 'HEAD' else PARENT, returncode=0)
        if args[0] == 'log':
            return SimpleNamespace(stdout=HEAD, returncode=0)
        if args[0] == 'diff-tree':
            assert '-m' in args and '--first-parent' in args
            return SimpleNamespace(stdout='src/merged.ts\0', returncode=0)
        if '--format=' in args:
            assert '--diff-merges=first-parent' in args
            return SimpleNamespace(stdout='diff --git a/src/merged.ts b/src/merged.ts\n+merged change', returncode=0)
        return SimpleNamespace(stdout='merge fixture', returncode=0)
    material = collector.Material(1000)
    collector.collect_changes({'project_dir': '/fixture', 'state_file': str(tmp_path / 'missing-state'), 'changes_exclude': []}, material, NOW, run)
    assert '+merged change' in material.text()


def test_log_lines_skips_rotations_last_written_before_window(tmp_path):
    old = tmp_path / 'access-old.log'
    new = tmp_path / 'access-new.log'
    old.write_text('old\n')
    new.write_text('new\n')
    os.utime(old, (NOW.timestamp() - 3 * 86400,) * 2)
    os.utime(new, (NOW.timestamp(),) * 2)
    lines = list(collector.log_lines([str(tmp_path / 'access-*.log')], NOW - timedelta(days=1)))
    assert lines == ['new\n']
