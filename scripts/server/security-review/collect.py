#!/usr/bin/env python3
"""Build private review material from local sources; never call the model."""
import argparse
from collections import Counter
from datetime import datetime, timedelta
import fnmatch
import gzip
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import tempfile
import threading
from zoneinfo import ZoneInfo


SENSITIVE = re.compile(
    r'''((?:authorization|proxy-authorization|cookie|set-cookie|[\w-]*(?:token|password|passwd|secret|api[_-]?key|client[_-]?key)[\w-]*)["']?\s*[:=]\s*)[^\r\n]*''', re.I)


REVIEW_CHUNK_BYTES = 8000
# Match material.ts MAX_CHUNKS and its round-robin minimum for changes.
MAX_REVIEW_CHUNKS = 24
CHANGES_CHUNKS = 8
# Leave room for API-added ClientLog errors; larger additions can trim trailing changes,
# which the API counts as truncated.
API_ERRORS_RESERVE_CHUNKS = 2
# Line packing shares chunks across files; the actual chunk count enforces unused line/UTF-8 space.
DEFAULT_CHANGES_BYTE_CAP = REVIEW_CHUNK_BYTES * CHANGES_CHUNKS
DEFAULT_CHANGE_PRIORITY = [
    'apps/api/src/routes/*', 'apps/api/src/*auth*', 'apps/api/src/middleware/*',
    'apps/api/src/config/*', '*Dockerfile*', 'infrastructure/ansible/templates/*',
    'infrastructure/ansible/roles/*/tasks/*', 'clients/*', '*',
    '*.test.*', '*.spec.*', '__tests__/*', '*/__tests__/*', 'tests/*', '*/tests/*',
    'fixtures/*', '*/fixtures/*', '__fixtures__/*', '*/__fixtures__/*',
]


def redact_code(text):
    text = re.sub(r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----", "[REDACTED]", text, flags=re.S)
    text = re.sub(r'(https?://)[^/@\s]+:[^/@\s]+@', r'\1[REDACTED]@', text, flags=re.I)
    return text


def redact(text):
    text = redact_code(text)
    text = re.sub(r'''(^|[\s"'<>(=])((?:https?://|/)[^\s"'<>?]*)\?[^\s"'<>]*''', r'\1\2?[REDACTED]', text, flags=re.I | re.M)
    text = SENSITIVE.sub(r"\1[REDACTED]", text)
    text = re.sub(r"\b(?:Bearer|Basic)\s+\S+", "[REDACTED]", text, flags=re.I)
    return re.sub(r"\b[A-Za-z0-9_+/=-]{32,}\b",
                  lambda match: match[0] if re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})', match[0], re.I) else '[REDACTED]', text)


class Material:
    def __init__(self, cap):
        self.cap = cap
        self.bytes = 0
        self.lines = []
        self.dropped = 0
        self.private_key = False
        self.carry_over = []
        self.carry_over_expired = 0

    def add(self, text, redactor=redact):
        for line in text.splitlines():
            if '-----BEGIN ' in line and 'PRIVATE KEY-----' in line:
                self.private_key = True
            if self.private_key:
                if '-----END ' in line and 'PRIVATE KEY-----' in line:
                    self.private_key = False
                line = '[REDACTED]'
            line = redactor(line) + '\n'
            size = len(line.encode('utf-8'))
            if self.bytes + size > self.cap:
                self.dropped += 1
            else:
                self.lines.append(line)
                self.bytes += size

    def text(self):
        return ''.join(self.lines)


def command(args, check=True):
    result = subprocess.run(args, capture_output=True, text=True, errors='replace', timeout=120)
    if check and result.returncode:
        # Command output can contain secrets; do not echo it into the journal.
        raise RuntimeError('local source command failed')
    return result


def git(repo, *args, check=True):
    return command(['git', '-c', f'safe.directory={repo}', '-C', str(repo), *args], check=check)


def docker_log_lines(container, timeout=120):
    args = ['docker', 'logs', '--since', '24h', container]
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, errors='replace') as process:
        timed_out = threading.Event()
        lines = queue.Queue()

        def read_lines(stream):
            try:
                for line in stream:
                    lines.put(line)
            except Exception as error:
                lines.put(error)
            finally:
                lines.put(None)

        def expire():
            timed_out.set()
            process.kill()

        timer = threading.Timer(timeout, expire)
        readers = []
        try:
            timer.start()
            for stream in (process.stdout, process.stderr):
                reader = threading.Thread(target=read_lines, args=(stream,))
                reader.start()
                readers.append(reader)
            finished = 0
            while finished < len(readers):
                line = lines.get()
                if line is None:
                    finished += 1
                elif isinstance(line, Exception):
                    raise line
                else:
                    yield line
            process.wait()
            if timed_out.is_set():
                raise subprocess.TimeoutExpired(args, timeout)
            if process.returncode:
                raise RuntimeError('local source command failed')
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
            process.wait()
            for reader in readers:
                reader.join()
            timer.join()


def change_range(repo, previous, since, git_call=git):
    head = git_call(repo, 'rev-parse', 'HEAD').stdout.strip()
    if previous and re.fullmatch(r'[a-f0-9]{40,64}', previous):
        ancestor = git_call(repo, 'merge-base', '--is-ancestor', previous, head, check=False)
        if ancestor.returncode == 0:
            return {'from': previous, 'to': head}, [f'{previous}..{head}'], False
    note = 'rollback_or_missing_previous_commit' if previous else 'first_run'
    commits = git_call(repo, 'log', '--since-as-filter=' + since.isoformat(), '--format=%H', '--reverse', head).stdout.splitlines()
    start = ''
    if commits:
        parent = git_call(repo, 'rev-parse', '--verify', commits[0] + '^', check=False)
        if parent.returncode == 0:
            start = parent.stdout.strip()
    return {'from': start, 'to': head, 'note': note}, commits, True


def allowed_file(name, excludes):
    return not any(fnmatch.fnmatch(name, pattern) for pattern in excludes)


def change_priority(name, patterns):
    # Last matching specific pattern wins, so tests inside routes still come last.
    # A bare * supplies the rank for otherwise unmatched files only.
    fallback = patterns.index('*') if '*' in patterns else len(patterns)
    return next((index for index in range(len(patterns) - 1, -1, -1)
                 if patterns[index] != '*' and fnmatch.fnmatchcase(name, patterns[index])), fallback)


def carry_over_file(config):
    return Path(config['state_file']).with_name('changes-carry-over.json')


def split_bytes_chunk_count(text):
    # Match material.ts splitBytes: split on UTF-8 character boundaries, not lines.
    count = size = 0
    for character in text:
        width = len(character.encode('utf-8'))
        if size + width > REVIEW_CHUNK_BYTES:
            count += 1
            size = 0
        size += width
    return count + bool(size)


def pack_change_line(count, size, line):
    # State is completed chunks plus bytes used in the last, open chunk.
    # Match prepareChunks line packing and splitBytes for oversized lines.
    width = len(line.encode('utf-8'))
    if size and size + width > REVIEW_CHUNK_BYTES:
        count += 1
        size = 0
    if width > REVIEW_CHUNK_BYTES:
        for character in line:
            width = len(character.encode('utf-8'))
            if size + width > REVIEW_CHUNK_BYTES:
                count += 1
                size = 0
            size += width
    else:
        size += width
    return count, size


def changes_chunk_count(text):
    count = size = 0
    for line in re.findall(r'[^\n]*\n|[^\n]+', text):
        count, size = pack_change_line(count, size, line)
    return count + bool(size)


def collect_changes(config, material, now, git_call=git, chunk_budget=CHANGES_CHUNKS):
    repo = config['project_dir']
    state = Path(config['state_file'])
    previous = state.read_text().strip() if state.exists() else None
    reviewed, revisions, fallback = change_range(repo, previous, now - timedelta(hours=24), git_call)
    pending_file = carry_over_file(config)
    try:
        pending = json.loads(pending_file.read_text()) if pending_file.exists() else []
        if not isinstance(pending, list):
            raise ValueError('Invalid carry-over list')
    except (OSError, ValueError, KeyError, TypeError):
        material.carry_over_expired += 1
        pending = []
    candidates = []
    ancestors = {}
    for entry in pending:
        try:
            revision, name, since = entry['revision'], entry['file'], entry['since']
            if not all(isinstance(value, str) for value in (revision, name, since)):
                raise TypeError('Invalid carry-over fields')
            if not re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})(?:\.\.(?:[a-f0-9]{40}|[a-f0-9]{64}))?', revision):
                raise ValueError('Invalid carry-over revision')
            if now - timestamp(since, now.tzinfo) > timedelta(days=7) or not allowed_file(name, config['changes_exclude']):
                raise ValueError('Expired or excluded carry-over entry')
        except (OSError, ValueError, KeyError, TypeError):
            material.carry_over_expired += 1
            continue
        tip = revision.split('..')[-1]
        if tip not in ancestors:
            ancestors[tip] = git_call(repo, 'merge-base', '--is-ancestor', tip, reviewed['to'], check=False).returncode == 0
        if not ancestors[tip]:
            material.carry_over_expired += 1
        else:
            candidates.append(entry)
    fresh = []
    for revision in revisions:
        if fallback:
            names = git_call(repo, 'diff-tree', '--root', '-m', '--first-parent', '--no-commit-id', '--no-renames', '--name-only', '-r', '-z', revision).stdout
        else:
            names = git_call(repo, 'diff', '--no-renames', '--name-only', '-z', revision).stdout
        fresh.extend({'revision': revision, 'file': name, 'since': now.isoformat()}
                     for name in names.split('\0') if name and allowed_file(name, config['changes_exclude']))
    patterns = config.get('changes_priority', DEFAULT_CHANGE_PRIORITY)
    candidates.extend(fresh)
    candidates.sort(key=lambda entry: (change_priority(entry['file'], patterns),
                                      timestamp(entry['since'], now.tzinfo), entry['file']))
    seen = set()
    context = int(config.get('changes_context_lines', 1))
    if context < 0 or not 0 < material.cap <= REVIEW_CHUNK_BYTES * chunk_budget:
        raise ValueError('Invalid changes limits')
    count = used = 0
    for line in re.findall(r'[^\n]*\n|[^\n]+', material.text()):
        count, used = pack_change_line(count, used, line)
    for entry in candidates:
        revision, name = entry['revision'], entry['file']
        key = (revision, name)
        if key in seen:
            continue
        seen.add(key)
        if material.bytes >= material.cap and count + bool(used) >= chunk_budget:
            material.carry_over.append(entry)
            continue
        args = (['diff'] if '..' in revision else ['show', '--format=', '--first-parent', '--diff-merges=first-parent'])
        diff = git_call(repo, *args, '--no-ext-diff', '--no-textconv', '--no-renames',
                        f'--unified={context}', revision, '--', ':(literal)' + name).stdout
        # Keep provenance in the file section, not in a separate API chunk.
        if not diff:
            continue
        cleaned = Material(float('inf'))
        cleaned.add(diff, redactor=redact_code)
        cleaned.add('review revision ' + revision, redactor=redact_code)
        text = cleaned.text()
        if cleaned.bytes <= material.cap and changes_chunk_count(text) <= chunk_budget:
            next_count, next_used = count, used
            for line in cleaned.lines:
                next_count, next_used = pack_change_line(next_count, next_used, line)
            if material.bytes + cleaned.bytes > material.cap or next_count + bool(next_used) > chunk_budget:
                material.carry_over.append(entry)
                continue
        else:
            # A too-large file is the only lossy case. Keep a contiguous prefix;
            # if this night is already full, give it a fresh budget next night.
            if material.bytes >= material.cap:
                material.carry_over.append(entry)
                continue
            prefix = []
            size = 0
            next_count, next_used = count, used
            for line in cleaned.lines:
                width = len(line.encode('utf-8'))
                if material.bytes + size + width > material.cap:
                    break
                trial_count, trial_used = pack_change_line(next_count, next_used, line)
                if trial_count + bool(trial_used) > chunk_budget:
                    break
                next_count, next_used = trial_count, trial_used
                prefix.append(line)
                size += width
            if not prefix and material.bytes:
                material.carry_over.append(entry)
                continue
            # The trailing provenance line is not a discarded diff line.
            material.dropped += max(0, len(cleaned.lines) - len(prefix) - 1)
            text = ''.join(prefix)
        if not text:
            continue
        material.lines.append(text)
        material.bytes += len(text.encode('utf-8'))
        count, used = next_count, next_used
    return reviewed


def log_lines(patterns, since=None):
    import glob
    found = False
    for pattern in patterns:
        for filename in sorted(glob.glob(pattern)):
            found = True
            # A rotated file last written before the window holds nothing in it.
            if since is not None and os.path.getmtime(filename) < since.timestamp():
                continue
            opener = gzip.open if filename.endswith('.gz') else open
            with opener(filename, 'rt', encoding='utf-8', errors='replace') as stream:
                yield from stream
    if not found:
        raise FileNotFoundError('source log unavailable')


def timestamp(value, timezone):
    if isinstance(value, (float, int)):
        return datetime.fromtimestamp(value, timezone)
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return parsed.replace(tzinfo=timezone) if parsed.tzinfo is None else parsed


def fail2ban_summary(lines, since, now):
    sources = Counter()
    for line in lines:
        match = re.search(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*\bBan\s+(\S+)', line)
        if match and since <= timestamp(match[1], now.tzinfo) <= now:
            sources[match[2]] += 1
    return {'source': 'fail2ban', 'bans': sum(sources.values()), 'sources': dict(sources)}


def caddy_summary(line_source, since, now, rules):
    sources = Counter()
    statuses = Counter()
    counts = Counter()
    daytime_sources = set()
    first = last = None
    examples = {key: [] for key in ['unusual_hours', 'denied', 'unknown_path', 'oversized']}
    # Read rotations twice so daytime activity can exclude earlier night examples.
    for pass_index in range(2):
        for line in line_source():
            try:
                row = json.loads(line)
                when = timestamp(row['ts'], now.tzinfo).astimezone(now.tzinfo)
                if not since <= when <= now:
                    continue
                request = row.get('request', {})
                address = request.get('remote_ip', 'unknown')
                status = int(row['status'])
                uri = str(request.get('uri', '')).split('?', 1)[0]
                size = max(int(row.get('size', 0)), int(row.get('bytes_read', 0)))
                unusual = when.hour in rules['unusual_hours']
                if pass_index == 0:
                    sources[address] += 1
                    statuses[f'{status // 100}xx'] += 1
                    first = when if first is None else min(first, when)
                    last = when if last is None else max(last, when)
                    if not unusual:
                        daytime_sources.add(address)
                    continue
                matched = {
                    'unusual_hours': unusual and address not in daytime_sources,
                    'denied': status in rules['denied_statuses'],
                    'unknown_path': status in rules['unknown_path_statuses'] or not any(re.search(p, uri) for p in rules['known_path_patterns']),
                    'oversized': size > rules['oversized_bytes'],
                }
                for rule, yes in matched.items():
                    if yes:
                        counts[rule] += 1
                        if len(examples[rule]) < rules['examples_per_rule']:
                            examples[rule].append({'at': when.isoformat(), 'source': address, 'status': status, 'path': redact(uri)})
            except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
                if pass_index == 0:
                    counts['malformed'] += 1
    return {'source': 'caddy', 'sources': dict(sources), 'statusClasses': dict(statuses), 'rules': dict(counts),
            'covered': {'from': first.isoformat() if first else None, 'to': last.isoformat() if last else None},
            'examples': examples, 'droppedExamples': {key: max(0, counts[key] - len(value)) for key, value in examples.items()}}


def monitor_summary(lines, unit, timezone):
    groups = {}
    lifecycle = re.compile(r'(?:Starting|Started|Finished) ' + re.escape(unit) + r'(?: - .*|\.*)$|'
                           + re.escape(unit) + r': (?:Deactivated successfully\.|Succeeded\.|Consumed .+ CPU time.*)$')
    for line in lines:
        if not line.strip():
            continue
        match = re.match(r'^(\S+)\s+\S+\s+([^:]+):\s?(.*)$', line)
        message = line
        at = None
        if match:
            try:
                at = timestamp(match[1], timezone).astimezone(timezone).isoformat()
                message = match[3]
                if re.fullmatch(r'systemd(?:\[\d+\])?', match[2]) and lifecycle.fullmatch(message):
                    continue
            except ValueError:
                pass
        message = redact(message)
        group = groups.setdefault(message, {'source': 'monitor', 'message': message, 'count': 0,
                                            'first': at, 'last': at})
        group['count'] += 1
        if at is not None:
            group['first'] = min(group['first'], at) if group['first'] else at
            group['last'] = max(group['last'], at) if group['last'] else at
    return sorted(groups.values(), key=lambda group: group['count'], reverse=True)


def latest_completed_scan(lines, start_marker, end_marker, timezone):
    # Rotations may be read out of order. Compare completed runs by their timestamps.
    current = None
    latest = None
    for line in lines:
        if start_marker in line:
            current = [line]
        elif current is not None:
            current.append(line)
            if end_marker in line:
                match = re.match(r'\[([^]]+)\]', line)
                if match:
                    try:
                        at = timestamp(match[1], timezone)
                        if latest is None or at > latest[0]:
                            latest = (at, ''.join(current))
                    except ValueError:
                        pass
                current = None
    return latest[1] if latest else None


def docker_errors(lines, container, since, now):
    groups = {}
    for line in lines:
        try:
            row = json.loads(line)
            if not isinstance(row.get('level'), (int, float)) or row['level'] < 50:
                continue
            at = row.get('time')
            when = timestamp(at / 1000 if isinstance(at, (int, float)) else at, now.tzinfo)
            if not since <= when <= now:
                continue
            message = redact(str(row.get('msg', row.get('message', ''))))
            group = groups.setdefault(message, {'source': container, 'message': message, 'count': 0,
                                                'first': when.isoformat(), 'last': when.isoformat()})
            group['count'] += 1
            group['first'] = min(group['first'], when.isoformat())
            group['last'] = max(group['last'], when.isoformat())
        except (ValueError, TypeError, AttributeError, OverflowError):
            continue
    return list(groups.values())


def atomic_write(filename, text, uid, gid):
    descriptor, temporary = tempfile.mkstemp(prefix='.' + filename.name + '.', dir=filename.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            os.fchown(stream.fileno(), uid, gid)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, filename)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def publish_bundle(config, date, materials, manifest):
    root = Path(config['data_dir']) / 'bundles'
    uid, gid = int(config['api_uid']), int(config['api_gid'])
    stage = Path(tempfile.mkdtemp(prefix='.' + date + '.', dir=root))
    previous = None
    try:
        os.chmod(stage, 0o700)
        os.chown(stage, uid, gid)
        for name, material in materials.items():
            atomic_write(stage / (name + '.txt'), material.text(), uid, gid)
        atomic_write(stage / 'manifest.json', json.dumps(manifest, ensure_ascii=False) + '\n', uid, gid)
        target = root / date
        if target.exists():
            previous = root / (stage.name + '.previous')
            os.rename(target, previous)
        try:
            os.rename(stage, target)
        except OSError:
            if previous is not None:
                os.rename(previous, target)
            raise
        # Advance only after every material and the completion manifest are published.
        atomic_write(carry_over_file(config), json.dumps(materials['changes'].carry_over, ensure_ascii=False) + '\n', 0, 0)
        atomic_write(Path(config['state_file']), manifest['reviewedCommits']['to'] + '\n', 0, 0)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        if previous is not None and previous.exists():
            shutil.rmtree(previous)


def collect(config):
    now = datetime.now(ZoneInfo(config['timezone']))
    since = now - timedelta(hours=24)
    materials = {kind: Material(int(config['material_byte_cap'])) for kind in ['security', 'errors']}
    errors = []
    security = materials['security']
    for source, patterns in [('fail2ban', config['fail2ban_logs']), ('caddy', config['caddy_logs'])]:
        try:
            summary = fail2ban_summary(log_lines(patterns), since, now) if source == 'fail2ban' else caddy_summary(lambda: log_lines(patterns, since), since, now, config['caddy_rules'])
            # Keep each aggregate on its own line so a single large source does not discard all summaries.
            for key, value in summary.items():
                security.add(json.dumps({'source': source, key: value}, ensure_ascii=False))
        except (OSError, ValueError):
            errors.append(source + '_unavailable')
    try:
        journal = command(['journalctl', '-u', config['monitor_unit'], '--since', since.isoformat(), '--until', now.isoformat(), '--no-pager', '-o', 'short-iso']).stdout
        for group in monitor_summary(journal.splitlines(), config['monitor_unit'], now.tzinfo):
            security.add(json.dumps(group, ensure_ascii=False))
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        errors.append('monitor_unavailable')
    for scan in config['scans']:
        try:
            completed = latest_completed_scan(log_lines(scan['paths']), scan['start'], scan['end'], now.tzinfo)
            if completed is None:
                errors.append(scan['name'] + '_no_completed_scan')
            else:
                security.add(scan['name'] + '\n' + completed)
        except OSError:
            errors.append(scan['name'] + '_unavailable')
    for container in config['containers']:
        try:
            if command(['docker', 'inspect', '--format', '{{.Id}}', container], check=False).returncode:
                continue
            for group in docker_errors(docker_log_lines(container), container, since, now):
                materials['errors'].add(json.dumps(group, ensure_ascii=False))
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            errors.append(container + '_unavailable')
    chunk_budget = max(CHANGES_CHUNKS, MAX_REVIEW_CHUNKS - API_ERRORS_RESERVE_CHUNKS
                       - split_bytes_chunk_count(materials['security'].text())
                       - split_bytes_chunk_count(materials['errors'].text()))
    materials['changes'] = Material(chunk_budget * REVIEW_CHUNK_BYTES)
    reviewed = collect_changes(config, materials['changes'], now, chunk_budget=chunk_budget)
    manifest = {'reviewedCommits': reviewed, 'droppedLines': {kind: value.dropped for kind, value in materials.items()}, 'sourceErrors': errors,
                'carriedOver': len(materials['changes'].carry_over),
                'carryOverExpired': materials['changes'].carry_over_expired}
    publish_bundle(config, now.date().isoformat(), materials, manifest)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('config', type=Path)
    args = parser.parse_args()
    with args.config.open(encoding='utf-8') as stream:
        config = json.load(stream)
    os.umask(0o077)
    try:
        collect(config)
    except Exception:
        parser.exit(1, 'Security review collection failed; state was not advanced before bundle publication.\n')


if __name__ == '__main__':
    main()
