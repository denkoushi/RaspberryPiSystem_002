#!/usr/bin/env python3
"""Hourly RSS 1.0 collector. Aliases/excludes are literal, case-insensitive strings.

ASCII letters/digits/underscore bound every alias (Japanese suffixes are allowed).
RSS title/description determines which jobs to create. Matched pages are fetched
as untrusted evidence and can add products to those jobs.
"""
from datetime import datetime, timedelta, timezone
import hashlib
from http.client import HTTPException
from html.parser import HTMLParser
import subprocess
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError
from urllib.parse import urlsplit, urldefrag
from urllib.request import Request, build_opener, HTTPRedirectHandler
import xml.etree.ElementTree as ET

START = 'Starting JPCERT advisory check'
END = 'JPCERT advisory check completed.'
NS = {'rss': 'http://purl.org/rss/1.0/', 'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      'dc': 'http://purl.org/dc/elements/1.1/'}
MAX_FEED_BYTES = 4 * 1024 * 1024


USER_AGENT = 'RaspberryPiSystem-JPCERT-Advisories/1.0'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# Never follow an advisory link or redirect to another destination.
urlopen = build_opener(NoRedirect()).open


class PageText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0
        self.stack = []
        self.headings = []
        self.anchor = ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        hide = tag in ('script', 'style', 'nav', 'header', 'footer', 'noscript') or bool(
            re.search(r'(?:^|[-_\s])(nav|header|footer|breadcrumb)(?:$|[-_\s])',
                      attrs.get('class', '') + ' ' + attrs.get('id', ''), re.I))
        if tag not in ('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'):
            self.stack.append((tag, hide))
            self.hidden += int(hide)
        if self.hidden:
            return
        identity = attrs.get('id', attrs.get('name', ''))
        if identity.isdigit():
            self.anchor = identity
        if re.fullmatch(r'h[1-6]', tag):
            self.parts.append('\n')
            self.headings.append((len(self.parts), int(tag[1]), self.anchor))
            self.anchor = ''
        elif tag in ('p', 'div', 'li', 'br', 'section'):
            self.parts.append('\n')
        # Legacy Weekly Report uses <h3><a name="1">...</a></h3>.
        if identity.isdigit() and self.headings and self.stack and any(re.fullmatch(r'h[1-6]', t) for t, _ in self.stack):
            offset, level, _ = self.headings[-1]
            self.headings[-1] = (offset, level, identity)
            self.anchor = ''

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                self.hidden -= sum(int(hide) for _, hide in self.stack[index:])
                del self.stack[index:]
                break
        if not self.hidden:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)

    def text(self, fragment):
        start, end = 0, len(self.parts)
        for index, (offset, level, identity) in enumerate(self.headings):
            if fragment and fragment == identity:
                start = offset
                end = next((o for o, l, _ in self.headings[index + 1:] if l <= level), end)
                break
        return ' '.join(''.join(self.parts[start:end]).split())[:12000]


def page_text(link, config, opener):
    url = urlsplit(link)
    if url.scheme != 'https' or url.netloc != 'www.jpcert.or.jp':
        return {'page_text': ''}
    try:
        with opener(Request(urldefrag(link)[0], headers={'User-Agent': USER_AGENT}),
                    timeout=config['timeout_seconds']) as response:
            if response.code != 200:
                raise ValueError('page HTTP status')
            data = response.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('page size limit')
            # JPCERT publishes UTF-8; accept declared legacy Japanese encodings too.
            charset = re.search(br'charset=["\']?([A-Za-z0-9_-]+)', data[:4096], re.I)
            parser = PageText()
            parser.feed(data.decode(charset[1].decode() if charset else 'utf-8', errors='replace'))
            return {'page_text': parser.text(url.fragment)}
    except (OSError, HTTPException, ValueError, LookupError) as error:
        return {'page_text': '', 'page_error': type(error).__name__}


def run_probe(argv):
    # Spool bounded reads to disk rather than buffering arbitrary command output in RAM.
    try:
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            env = dict(os.environ, LC_ALL='C.UTF-8') if argv[0] == 'dpkg-query' else None
            result = subprocess.run(argv, stdout=output, stderr=errors, env=env,
                                    timeout=10, check=False)
            output.seek(0)
            errors.seek(0)
            stdout = output.read(8001)
            stderr = errors.read(8001)
            if argv[0] == 'dpkg-query' and (len(stdout) > 8000 or len(stderr) > 8000):
                return None, '', ''
            return (result.returncode, stdout[:8000].decode('utf-8', errors='replace'),
                    stderr[:8000].decode('utf-8', errors='replace'))
    except (OSError, subprocess.TimeoutExpired):
        return None, '', ''


def probe_text(returncode, stdout):
    if returncode != 0:
        return 'not installed/unavailable'
    return stdout.strip()[:2000] or 'unavailable'


def probe_dpkg(package, runner):
    code, stdout, stderr = runner(['dpkg-query', '-W', '-f=${db:Status-Abbrev}\t${Version}\n', package])
    if code != 0:
        missing = code == 1 and not stdout.strip() and stderr.strip() == (
            'dpkg-query: no packages found matching ' + package)
        return ('absent' if missing else 'unmeasured'), '', probe_text(code, stdout)

    states, display_versions = [], []
    installed = ''
    for line in stdout.splitlines():
        row = re.fullmatch(r'([a-zA-Z?]{2})([ A-Z]?)\t([0-9A-Za-z.+:~\-]*)', line)
        if row is None:
            states.append('unmeasured')
            continue
        status, error, version = row.groups()
        display_versions.append(version)
        if status == 'ii' and error in ('', ' ') and re.fullmatch(r'[0-9][0-9A-Za-z.+:~\-]*', version):
            installed = installed or version
            continue
        states.append('absent' if status in ('un', 'rc') and error in ('', ' ') else 'unmeasured')
    # The old version-only dpkg format concatenated versions without a separator.
    display = probe_text(code, ''.join(display_versions))
    if installed:
        return 'installed', f'{package}={installed}', display
    if states and all(state == 'absent' for state in states):
        return 'absent', '', display
    return 'unmeasured', '', display


def probe_products(products, rules, config, runner):
    versions = {}
    evidence = {}
    remedies = {}
    for rule in rules:
        product = rule['product']
        if product not in products:
            continue
        results = []
        dpkg_states, installed_versions = [], []
        measured = False
        probes = rule.get('probes', [])
        for probe in probes:
            kind = probe['kind']
            if kind == 'dpkg':
                for package in probe['packages']:
                    state, installed_version, display = probe_dpkg(package, runner)
                    dpkg_states.append(state)
                    if installed_version and len(installed_version) <= 2000:
                        installed_versions.append(installed_version)
                    results.append(package + ': ' + display)
            elif kind in ('command', 'container', 'uname'):
                if kind == 'command':
                    commands = [(' '.join(probe['argv']), probe['argv'])]
                elif kind == 'container':
                    commands = [(name, ['docker', 'exec', name, *probe['argv']]) for name in probe['containers']]
                else:
                    commands = [('kernel', ['uname', '-r'])]
                for label, argv in commands:
                    code, stdout, _ = runner(argv)
                    measured |= code == 0 and bool(stdout.strip())
                    results.append(label + ': ' + probe_text(code, stdout))
            elif kind == 'os_release':
                try:
                    release = Path('/etc/os-release').read_text()
                    measured |= bool(release.strip())
                    results.append(release[:2000])
                except OSError:
                    results.append('OS: unavailable')
            elif kind == 'package_json':
                path = Path(probe['path'])
                if path.is_absolute() or '..' in path.parts or not re.fullmatch(r'apps/[^/]+/package\.json', str(path)):
                    raise ValueError('invalid package_json path')
                try:
                    manifest = json.loads((Path(config['project_dir']) / path).read_text())
                    value = manifest.get('dependencies', {}).get(probe['name']) or manifest.get('devDependencies', {}).get(probe['name'])
                    measured |= bool(value)
                    results.append(probe['name'] + ' (dependency spec): ' + (value or 'not installed'))
                except (OSError, ValueError):
                    results.append(probe['name'] + ': unavailable')
            else:
                raise ValueError('unknown probe kind')
        state = 'unmeasured'
        if 'unmeasured' not in dpkg_states:
            if measured or 'installed' in dpkg_states:
                state = 'installed'
            elif (dpkg_states and rule.get('absence_by_dpkg') is True
                  and all(probe['kind'] == 'dpkg' for probe in probes)):
                state = 'absent'
        if state != 'absent':
            versions[product] = [result[:2000] for result in results[:30]] or ['unavailable']
        evidence[product] = dict(scope=rule.get('scope', 'fleet'), state=state,
                                 versions=installed_versions[:30])
        remedies[product] = rule.get('remedy', {'kind': 'manual'})
    return dict(versions=versions, evidence=evidence, remedies=remedies)


def write_job(config, key, now, item, products, rules, opener, runner):
    identity = hashlib.sha256(key.encode()).hexdigest()
    root = Path(config['jobs_dir'])
    # A replay after state loss must also respect jobs already claimed or completed.
    if any((root / folder / (identity + '.json')).exists() for folder in ('pending', 'claimed', 'done', 'invalid')):
        return
    page = page_text(item['link'], config, opener)
    page_products = matches(item, rules, page['page_text'])
    products = list(dict.fromkeys(products + page_products))[:30]
    value = dict(version=1, id=identity, key=key, **item, products=products, detected_at=utc(now),
                 **page, **probe_products(products, rules, config, runner))
    atomic_write(root / 'pending' / (identity + '.json'), encoded(value), exclusive=True)


def timestamp(value):
    at = datetime.fromisoformat(value)
    if at.tzinfo is None:
        raise ValueError('timezone required')
    return at


def utc(at):
    return at.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False) + '\n'


def atomic_write(path, text, mode=0o600, exclusive=False):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.jpcert-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            # Publish a complete inode without replacing an existing inbox file.
            try:
                os.link(temporary, path)
            except FileExistsError:
                pass
        else:
            os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def parse_feed(data):
    # Remove NULs for declaration detection in UTF-16/32 as well as UTF-8.
    if re.search(br'<!\s*(DOCTYPE|ENTITY)\b', data.replace(b'\x00', b''), re.I):
        raise ValueError('XML declarations forbidden')
    root = ET.fromstring(data)
    if root.tag != '{' + NS['rdf'] + '}RDF':
        raise ValueError('RSS RDF required')
    items = []
    for element in root.findall('rss:item', NS):
        item = {key: element.findtext(tag, default='', namespaces=NS).strip()
                for key, tag in [('title', 'rss:title'), ('description', 'rss:description'), ('date', 'dc:date')]}
        item['link'] = element.attrib.get('{' + NS['rdf'] + '}about', '').strip()
        if not item['link'] or not item['title']:
            raise ValueError('incomplete item')
        timestamp(item['date'])
        items.append(item)
    return items


def matches(item, rules, page=''):
    text = '\n'.join((item['title'], item['description'], page))

    def contains(alias):
        return re.search(r'(?<![A-Za-z0-9_])' + re.escape(alias) + r'(?![A-Za-z0-9_])', text, re.I)

    return [rule['product'] for rule in rules if any(contains(a) for a in rule['aliases'])
            and not any(contains(a) for a in rule.get('exclude', []))]


def load_state(path, lines):
    try:
        state = json.loads(path.read_text(encoding='utf-8'))
        assert isinstance(state, dict) and isinstance(state['seen'], dict)
        assert type(state['consecutive_failures']) is int and state['consecutive_failures'] >= 0
        for entry in state['seen'].values():
            assert isinstance(entry, dict)
            timestamp(entry['first_seen'])
            if 'products' in entry:
                assert isinstance(entry['products'], list)
                for field in ('date', 'title', 'link'):
                    assert isinstance(entry[field], str)
        for field in ('etag', 'last_modified'):
            assert field not in state or isinstance(state[field], str)
        if 'failure_started' in state:
            timestamp(state['failure_started'])
        return state, not state.get('initialized', False)
    except FileNotFoundError:
        pass
    except (ValueError, TypeError, KeyError, AssertionError):
        atomic_write(str(path) + '.corrupt', path.read_text(encoding='utf-8', errors='replace'))
        lines.append('Corrupt state preserved as .corrupt; treating as fresh.')
    return {'seen': {}, 'consecutive_failures': 0}, True


def write_alert(config, key, at, kind, message, details):
    suffix = hashlib.sha256(key.encode()).hexdigest()[:24]
    identity = f"{at.astimezone(timezone.utc):%Y%m%d-%H%M%S}-jpcert-{suffix}"
    value = dict(id=identity, type=kind, message=message[:300],
                 details=details[:config['max_details_chars']], timestamp=utc(at), acknowledged=False)
    atomic_write(Path(config['alerts_dir']) / ('alert-' + identity + '.json'), encoded(value), 0o644, True)


def single_line(value):
    return ' '.join(value.split()).replace(START, 'JPCERT start marker').replace(END, 'JPCERT end marker')


def append_log(path, lines):
    path = Path(path)
    block = '\n'.join(lines) + '\n'
    with path.open('a', encoding='utf-8') as stream:
        stream.write(block)
    # Preserve the entire latest block even in an unusually large matching feed.
    with path.open(encoding='utf-8') as stream:
        from collections import deque
        tail = list(deque(stream, maxlen=max(2000, len(lines))))
    if path.stat().st_size > len(''.join(tail).encode('utf-8')):
        atomic_write(path, ''.join(tail), 0o640)


def fetch(config, opener=urlopen, clock=lambda: datetime.now().astimezone(), probe_runner=run_probe):
    now = clock()
    lines = [f'[{now.isoformat()}] {START}']
    path = Path(config['state_path'])
    state, fresh = load_state(path, lines)
    cutoff = now - timedelta(days=config['seen_retention_days'])
    state['seen'] = {key: entry for key, entry in state['seen'].items()
                     if timestamp(entry['first_seen']) >= cutoff}
    new_items = 0
    result = 0
    try:
        rules = json.loads(Path(config['rules_path']).read_text(encoding='utf-8'))
        headers = {'User-Agent': USER_AGENT}
        for field, header in [('etag', 'If-None-Match'), ('last_modified', 'If-Modified-Since')]:
            if state.get(field):
                headers[header] = state[field]
        try:
            response = opener(Request(config['feed_url'], headers=headers), timeout=config['timeout_seconds'])
        except HTTPError as error:
            if error.code != 304:
                raise
            response = error
        with response:
            status = response.code
            if status == 304:
                lines.append('Fetch result: 304')
            elif status == 200:
                data = response.read(MAX_FEED_BYTES + 1)
                if len(data) > MAX_FEED_BYTES:
                    raise ValueError('feed size limit')
                items = parse_feed(data)
                for item in items:
                    key = item['link'] + '|' + item['date']
                    if key in state['seen']:
                        continue
                    new_items += 1
                    entry = {'first_seen': utc(now)}
                    products = matches(item, rules)
                    if products and (not fresh or timestamp(item['date']) >= now - timedelta(days=config['initial_lookback_days'])):
                        write_job(config, key, now, item, products, rules, opener, probe_runner)
                        entry.update(item, products=products)
                    state['seen'][key] = entry
                for field, header in [('etag', 'ETag'), ('last_modified', 'Last-Modified')]:
                    state[field] = response.headers.get(header, '')
                state['initialized'] = True
                lines.append('Fetch result: 200')
            else:
                raise ValueError('unexpected HTTP status')
        state['consecutive_failures'] = 0
        state.pop('failure_started', None)
    except (OSError, HTTPException, ValueError, TypeError, KeyError, ET.ParseError):
        result = 1
        state['consecutive_failures'] += 1
        state.setdefault('failure_started', utc(now))
        lines.append('Fetch result: error (network, HTTP, feed or local I/O)')
        if state['consecutive_failures'] == config['failure_alert_threshold']:
            write_alert(config, 'fetch-error|' + state['failure_started'], now,
                        'jpcert-advisory-fetch-error', 'JPCERT/CC: RSS取得の連続失敗',
                        f"連続失敗: {state['consecutive_failures']}。接続とサービスログを確認してください。")
    atomic_write(path, encoded(state))
    lines.append(f'New items: {new_items}')
    lines.append(f"Matches in trailing {config['summary_window_hours']} hours (first seen):")
    for entry in state['seen'].values():
        if entry.get('products') and now - timedelta(hours=config['summary_window_hours']) <= timestamp(entry['first_seen']) <= now:
            lines.append('  ' + single_line(f"{entry['date']} | {', '.join(entry['products'])} | {entry['title']} | {entry['link']}"))
    lines.append(f'[{clock().isoformat()}] {END}')
    append_log(config['log_path'], lines)
    return result


def main():
    with open(sys.argv[1], encoding='utf-8') as stream:
        return fetch(json.load(stream))


if __name__ == '__main__':
    sys.exit(main())
