"""Offline RSS, state, inbox and nightly summary contracts."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
import importlib.util
import json
from pathlib import Path
import re
from urllib.error import HTTPError

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('jpcert_fetch', ROOT / 'scripts/server/jpcert-advisories/fetch.py')
f = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(f)
RULES = json.loads((ROOT / 'scripts/server/jpcert-advisories/rules.json').read_text())
FEED = (Path(__file__).parent / 'fixtures/jpcert-20261031.rdf').read_bytes()
NOW = datetime(2026, 10, 31, 0, tzinfo=timezone.utc)


class Response(BytesIO):
    def __init__(self, body=FEED, code=200, headers=None):
        super().__init__(body)
        self.code = code
        self.headers = headers or {}


@pytest.fixture
def config(tmp_path):
    (tmp_path / 'alerts').mkdir()
    (tmp_path / 'jobs/pending').mkdir(parents=True)
    return dict(feed_url='https://example.invalid/feed.rdf',
                rules_path=str(ROOT / 'scripts/server/jpcert-advisories/rules.json'),
                state_path=str(tmp_path / 'state.json'), alerts_dir=str(tmp_path / 'alerts'),
                log_path=str(tmp_path / 'fetch.log'), timeout_seconds=60, initial_lookback_days=7,
                failure_alert_threshold=3, summary_window_hours=24, seen_retention_days=90,
                max_details_chars=8000, jobs_dir=str(tmp_path / 'jobs'), project_dir=str(ROOT))


def run(config, body=FEED, code=200, at=NOW, headers=None):
    return f.fetch(config, lambda request, **kw: Response(body, code, headers) if request.full_url == config['feed_url'] else Response(b'<h3><a name="3">Chrome</a></h3><p>advisory evidence</p>'), lambda: at, lambda argv: 'fake 1.2.3')


def state(config):
    return json.loads(Path(config['state_path']).read_text())


def alerts(config):
    return sorted(Path(config['alerts_dir']).glob('alert-*.json'))


def jobs(config):
    return sorted((Path(config['jobs_dir']) / 'pending').glob('*.json'))


def log(config):
    return Path(config['log_path']).read_text()


def test_parse_real_feed_and_matching():
    items = f.parse_feed(FEED)
    assert len(items) == 21
    matched = [(item, f.matches(item, RULES)) for item in items]
    assert [products for item, products in matched if 'Google Chrome' in item['title']] == [['Chromium']]
    assert [item['title'] for item, products in matched if products] == ['Weekly Report: Google Chromeに複数の脆弱性']
    assert items[0]['date'] == '2026-10-29T15:43+09:00'
    assert items[0]['description'] == ''
    assert items[0]['link'].endswith('at260033.html')


@pytest.mark.parametrize('title,expected', [('DOCKERに脆弱性', ['Docker Engine']),
    ('MyDockerThing Dockerized NodeBB', []), ('Node.jsの問題', ['Node.js']),
    ('Chromiumエンジンに問題', ['Chromium']), ('Google Chromeに問題', ['Chromium'])])
def test_literal_boundaries(title, expected):
    assert f.matches(dict(title=title, description=''), RULES) == expected


def test_description_exclusions_and_one_job_per_item(config):
    rules = [dict(product='one', aliases=['Chrome'], exclude=['Example']),
             dict(product='two', aliases=['Chrome'])]
    assert f.matches(dict(title='Chrome', description='Example'), rules) == ['two']
    item = f.parse_feed(FEED)[11]
    assert f.matches(dict(title='', description='Google Chrome'), RULES) == ['Chromium']
    path = Path(config['rules_path'])
    custom = Path(config['state_path']).with_name('rules.json')
    custom.write_text(json.dumps(rules))
    config['rules_path'] = str(custom)
    assert run(config) == 0
    assert len(jobs(config)) == 1
    assert json.loads(jobs(config)[0].read_text())['products'] == ['one', 'two']
    assert path.exists() and item


def test_rerun_updated_date_atomic_inbox_and_state(config):
    assert run(config) == 0
    original = jobs(config)[0]
    payload = original.read_bytes()
    value = json.loads(payload)
    assert value['version'] == 1 and value['products'] == ['Chromium']
    assert value['detected_at'] == f.utc(NOW)
    assert value['page_text'] == 'Chrome advisory evidence'
    assert 'fake 1.2.3' in value['versions']['Chromium'][0]
    assert re.fullmatch(r'[A-Za-z0-9_-]+\.json', original.name)
    assert original.stat().st_mode & 0o777 == 0o600
    assert not alerts(config)
    assert Path(config['state_path']).stat().st_mode & 0o777 == 0o600
    assert run(config, at=NOW + timedelta(hours=1)) == 0
    assert jobs(config) == [original] and original.read_bytes() == payload
    # Losing state still cannot overwrite the completed inbox file.
    Path(config['state_path']).unlink()
    assert run(config, at=NOW + timedelta(hours=2)) == 0
    assert original.read_bytes() == payload and len(jobs(config)) == 1
    changed = FEED.replace(b'2026-10-28T09:07+09:00', b'2026-10-30T09:07+09:00')
    assert run(config, body=changed) == 0
    assert len(jobs(config)) == 2
    assert any('|2026-10-30T09:07+09:00' in key for key in state(config)['seen'])
    assert not list(original.parent.glob('.jpcert-*'))


def test_conditional_headers_and_304_summary(config):
    headers = {'ETag': '"version1"', 'Last-Modified': 'Fri, 30 Oct 2026 00:00:00 GMT'}
    run(config, headers=headers)
    before = state(config)['seen']

    def opener(request, timeout):
        assert request.get_header('If-none-match') == headers['ETag']
        assert request.get_header('If-modified-since') == headers['Last-Modified']
        assert 'JPCERT' in request.get_header('User-agent') and timeout == 60
        raise HTTPError(request.full_url, 304, 'Not Modified', {}, BytesIO())

    assert f.fetch(config, opener, lambda: NOW + timedelta(hours=1)) == 0
    assert state(config)['seen'] == before and len(jobs(config)) == 1
    latest = log(config).split(f.START)[-1]
    assert 'Fetch result: 304' in latest and 'New items: 0' in latest and 'Google Chrome' in latest
    run(config, code=304, at=NOW + timedelta(hours=25))
    assert 'Google Chrome' not in log(config).split(f.START)[-1]


def test_first_run_lookback_and_seen_pruning(config):
    config['initial_lookback_days'] = 1
    run(config)
    assert not jobs(config) and len(state(config)['seen']) == 21
    run(config, at=NOW + timedelta(hours=1))
    assert not jobs(config)
    run(config, code=304, at=NOW + timedelta(days=91))
    assert not state(config)['seen']


@pytest.mark.parametrize('failure', ['network', '500', 'parse', 'doctype', 'entity', 'utf16'])
def test_failures_alert_once_and_reset(config, failure):
    def opener(*args, **kwargs):
        if failure == 'network':
            raise OSError('private diagnostic must not leak')
        body = {'parse': b'<broken', 'doctype': b'<!DOCTYPE rdf><x/>',
                'entity': b'<!ENTITY boom "x"><x/>',
                'utf16': '<!DOCTYPE x><x/>'.encode('utf-16')}.get(failure, b'')
        return Response(body, 500 if failure == '500' else 200)

    for count in range(1, 6):
        assert f.fetch(config, opener, lambda: NOW) == 1
        assert state(config)['consecutive_failures'] == count
        assert len(alerts(config)) == (0 if count < 3 else 1)
    assert json.loads(alerts(config)[0].read_text())['type'] == 'jpcert-advisory-fetch-error'
    assert 'private diagnostic' not in log(config)
    assert run(config, code=304) == 0
    assert state(config)['consecutive_failures'] == 0
    assert f.fetch(config, opener, lambda: NOW) == 1
    assert state(config)['consecutive_failures'] == 1


@pytest.mark.parametrize('corrupt', ['{broken', '[]', '{"seen":[],"consecutive_failures":0}',
                                    '{"seen":{"x":{}},"consecutive_failures":0}'])
def test_corrupt_state(config, corrupt):
    path = Path(config['state_path'])
    path.write_text(corrupt)
    assert run(config) == 0
    assert Path(str(path) + '.corrupt').read_text() == corrupt
    assert Path(str(path) + '.corrupt').stat().st_mode & 0o777 == 0o600
    assert 'Corrupt state' in log(config) and len(jobs(config)) == 1


def test_log_markers_full_trailing_summary_and_bounding(config):
    Path(config['log_path']).write_text('old line\n' * 2200)
    run(config)
    assert len(log(config).splitlines()) <= 2000
    run(config, code=304, at=NOW + timedelta(hours=23))
    spec = importlib.util.spec_from_file_location('collector', ROOT / 'scripts/server/security-review/collect.py')
    collector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(collector)
    latest = collector.latest_completed_scan(log(config).splitlines(True), f.START, f.END, timezone.utc)
    assert latest.startswith(f'[{(NOW + timedelta(hours=23)).isoformat()}] {f.START}')
    assert latest.endswith(f'{f.END}\n') and 'Chromium' in latest and 'Google Chrome' in latest
    assert len(log(config).splitlines()) <= 2000


def test_non_overwrite(config):
    run(config)
    path = jobs(config)[0]
    before = path.read_bytes()
    f.atomic_write(path, 'replacement', exclusive=True)
    assert path.read_bytes() == before


def test_first_success_after_failure_still_uses_lookback(config):
    config['initial_lookback_days'] = 1
    run(config, code=503)
    assert run(config) == 0
    assert not jobs(config) and state(config)['initialized'] is True


def test_summary_persists_when_item_disappears_and_error_occurs(config):
    run(config)
    empty = b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>'
    run(config, body=empty, at=NOW + timedelta(hours=1))
    assert 'Google Chrome' in log(config).split(f.START)[-1]
    run(config, code=503, at=NOW + timedelta(hours=2))
    assert 'Google Chrome' in log(config).split(f.START)[-1]


def test_fetch_error_uses_detection_time(config):
    for hours in (0, 24, 48):
        run(config, code=503, at=NOW + timedelta(hours=hours))
    alert = alerts(config)[0]
    assert alert.name.startswith('alert-20261102-000000-')
    assert json.loads(alert.read_text())['timestamp'] == f.utc(NOW + timedelta(hours=48))


@pytest.mark.parametrize('link', ['http://www.jpcert.or.jp/a', 'https://jpcert.or.jp/a',
    'https://www.jpcert.or.jp.evil.test/a', 'https://evil.test/a', 'https://www.jpcert.or.jp:443/a'])
def test_page_fetch_restricted_host(link, config):
    def opener(*args, **kwargs):
        pytest.fail('must not fetch')
    assert f.page_text(link, config, opener) == {'page_text': ''}


def test_page_failure_tolerated_in_job(config):
    def opener(request, **kwargs):
        if request.full_url == config['feed_url']:
            return Response()
        raise OSError('page down')
    assert f.fetch(config, opener, lambda: NOW, lambda argv: 'unavailable') == 0
    job = json.loads(jobs(config)[0].read_text())
    assert job['page_text'] == '' and job['page_error'] == 'OSError'
    assert not alerts(config)


def test_fragment_and_html_cleanup(config):
    html = b'<header>header</header><script>bad</script><nav>nav</nav><h3><a name="1">first</a></h3><p>one</p><h3 id="2">second</h3><p>two &amp; more</p><h4>detail</h4><h3 id="3">third</h3><footer>footer</footer>'
    opener = lambda *args, **kwargs: Response(html)
    assert f.page_text('https://www.jpcert.or.jp/wr/a#2', config, opener)['page_text'] == 'second two & more detail'
    whole = f.page_text('https://www.jpcert.or.jp/wr/a#9', config, opener)['page_text']
    assert 'first' in whole and 'third' in whole and 'bad' not in whole and 'footer' not in whole
    assert len(f.page_text('https://www.jpcert.or.jp/a', config, lambda *a, **k: Response(b'a'*13000))['page_text']) == 12000
    assert 'page_error' in f.page_text('https://www.jpcert.or.jp/a', config, lambda *a, **k: Response(b'a'*(2*1024*1024+1)))


def test_probe_absence_and_timeout(monkeypatch):
    def absent(*args, **kwargs):
        assert kwargs['timeout'] == 10 and 'shell' not in kwargs
        raise FileNotFoundError()
    monkeypatch.setattr(f.subprocess, 'run', absent)
    assert f.run_probe(['missing', '--version']) == 'not installed/unavailable'
    def timeout(*args, **kwargs):
        raise f.subprocess.TimeoutExpired(args[0], 10)
    monkeypatch.setattr(f.subprocess, 'run', timeout)
    assert f.run_probe(['missing']) == 'not installed/unavailable'


def test_probe_kinds_and_dependency_specs(config):
    calls = []
    def runner(argv):
        calls.append(argv)
        return '1.2.3'
    probes = [{'kind':'dpkg','packages':['chromium']}, {'kind':'container','containers':['docker-db-1'],'argv':['postgres','--version']},
              {'kind':'command','argv':['trivy','--version']}, {'kind':'uname'}, {'kind':'os_release'},
              {'kind':'package_json','path':'apps/api/package.json','name':'fastify'},
              {'kind':'package_json','path':'apps/api/package.json','name':'not-a-package'}]
    versions = f.probe_versions(['test'], [{'product':'test','probes':probes}], config, runner)['test']
    assert ['docker','exec','docker-db-1','postgres','--version'] in calls
    assert any('dependency spec' in v and 'fastify' in v for v in versions)
    assert versions[-1].endswith('not installed')


def test_completed_job_not_recreated_after_state_loss(config):
    run(config)
    original = jobs(config)[0]
    done = Path(config['jobs_dir']) / 'done'
    done.mkdir()
    original.rename(done / original.name)
    Path(config['state_path']).unlink()
    run(config)
    assert not jobs(config)
