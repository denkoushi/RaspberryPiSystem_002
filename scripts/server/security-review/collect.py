#!/usr/bin/env python3
"""Build private review material from local sources; never call the model."""
import argparse
from collections import Counter
from datetime import datetime, timedelta
import fcntl
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


QUEUE_STATES = ('pending', 'claimed', 'done', 'failed', 'progress', 'invalid')
SHA = r'(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})'


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
    head = git_call(repo, 'rev-parse', 'HEAD').stdout.strip().lower()
    previous = previous.lower() if previous else None
    if previous and re.fullmatch(SHA, previous):
        ancestor = git_call(repo, 'merge-base', '--is-ancestor', previous, head, check=False)
        if ancestor.returncode == 0:
            return {'from': previous, 'to': head}, [f'{previous}..{head}'], False
    note = 'rollback_or_missing_previous_commit' if previous else 'first_run'
    commits = git_call(repo, 'log', '--since-as-filter=' + since.isoformat(), '--format=%H', '--reverse', '--first-parent', head).stdout.lower().splitlines()
    start = ''
    if commits:
        parent = git_call(repo, 'rev-parse', '--verify', commits[0] + '^', check=False)
        if parent.returncode == 0:
            start = parent.stdout.strip().lower()
    return {'from': start, 'to': head, 'note': note}, commits, True


def allowed_file(name, excludes):
    return not any(fnmatch.fnmatch(name, pattern) for pattern in excludes)


def carry_over_file(config):
    return Path(config['state_file']).with_name('changes-carry-over.json')


def range_commits(repo, revision, git_call):
    if not isinstance(revision, str) or not re.fullmatch(SHA + r'(?:\.\.' + SHA + r')?', revision):
        raise ValueError('Invalid change revision')
    revision = revision.lower()
    if '..' not in revision:
        return [revision]
    return git_call(repo, 'rev-list', '--first-parent', '--reverse', revision).stdout.lower().splitlines()


def queue_directories(config):
    root = Path(config['data_dir']) / 'queue'
    uid, gid = int(config['api_uid']), int(config['api_gid'])
    for folder in [root, *(root / state for state in QUEUE_STATES)]:
        folder.mkdir(mode=0o700, exist_ok=True)
        os.chmod(folder, 0o700)
        os.chown(folder, uid, gid)
    return root


def queue_counts(root):
    return {state: sum(1 for _ in (root / state).glob('*.json'))
            for state in QUEUE_STATES if state != 'progress'}


def enqueue_changes(config, now, git_call=git, source_errors=None):
    state = Path(config['state_file'])
    state.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # The lock covers cursor reads, all queue writes and the cursor update.
    with (state.parent / 'changes-enqueue.lock').open('a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        return _enqueue_changes(config, now, git_call, source_errors if source_errors is not None else [])


def _enqueue_changes(config, now, git_call, source_errors):
    """Persist entire first-parent commits before moving the collection cursor."""
    repo = config['project_dir']
    state = Path(config['state_file'])
    previous = state.read_text().strip() if state.exists() else None
    reviewed, revisions, _ = change_range(repo, previous, now - timedelta(hours=24), git_call)
    root = queue_directories(config)
    carry = carry_over_file(config)
    legacy = json.loads(carry.read_text()) if carry.exists() else []
    if not isinstance(legacy, list):
        raise ValueError('Invalid carry-over list')
    # Never expire or silently discard migration entries. Invalid input leaves the
    # old file and cursor intact so an operator can repair it.
    extra_revisions = [entry['revision'] for entry in legacy]
    for span in config.get('changes_backfill', []):
        extra_revisions.append(span['from'] + '..' + span['to'])
    commits = dict.fromkeys(sha.lower() for revision in revisions
                            for sha in range_commits(repo, revision, git_call))
    for revision in extra_revisions:
        if not isinstance(revision, str) or not re.fullmatch(SHA + r'(?:\.\.' + SHA + r')?', revision):
            raise ValueError('Invalid change revision')
        revision = revision.lower()
        missing = [sha for sha in revision.split('..')
                   if git_call(repo, 'cat-file', '-e', sha + '^{commit}', check=False).returncode]
        if missing:
            source_errors.extend('changes_revision_unavailable:' + sha[:12] for sha in missing)
            continue
        for sha in range_commits(repo, revision, git_call):
            commits[sha.lower()] = None
    context = int(config.get('changes_context_lines', 1))
    if context < 0:
        raise ValueError('Invalid changes context')
    uid, gid = int(config['api_uid']), int(config['api_gid'])
    for sha in commits:
        if not re.fullmatch(SHA, sha):
            raise ValueError('Invalid commit SHA')
        if any((root / folder / (sha + '.json')).exists() for folder in QUEUE_STATES) or any(
                (root / 'invalid' / (folder + '-' + sha + '.json')).exists() for folder in QUEUE_STATES):
            continue
        job = build_job(config, now, sha, git_call)
        atomic_write(root / 'pending' / (sha + '.json'), json.dumps(job, ensure_ascii=False) + '\n', uid, gid)
    # Partial enqueue is safe to retry because every SHA is checked in every state.
    atomic_write(state, reviewed['to'] + '\n', 0, 0)
    if carry.exists():
        carry.unlink()
    return reviewed, queue_counts(root)


def build_job(config, now, sha, git_call):
    repo = config['project_dir']
    context = int(config.get('changes_context_lines', 1))
    if context < 0:
        raise ValueError('Invalid changes context')
    metadata = git_call(repo, 'show', '--no-patch', '--format=%P%n%cI', sha).stdout.splitlines()
    parent = metadata[0].split()[0].lower() if metadata[0].strip() else None
    committed_at = metadata[1]
    if parent is not None and not re.fullmatch(SHA, parent):
        raise ValueError('Invalid parent SHA')
    timestamp(committed_at, now.tzinfo)
    names = git_call(repo, 'diff-tree', '--root', '-m', '--first-parent', '--no-commit-id',
                     '--no-renames', '--name-only', '-r', '-z', sha).stdout
    files = []
    omitted = 0
    for name in dict.fromkeys(name for name in names.split('\0') if name):
        if not allowed_file(name, config['changes_exclude']):
            omitted += 1
            continue
        args = ['diff', parent, sha] if parent else ['show', '--format=', '--root', sha]
        diff = git_call(repo, *args, '--no-ext-diff', '--no-textconv', '--no-renames',
                        f'--unified={context}', '--', ':(literal)' + name).stdout
        files.append({'path': name, 'diff': redact_code(diff)})
    job = {'version': 1, 'sha': sha, 'parent': parent, 'committedAt': committed_at,
           'enqueuedAt': now.isoformat(), 'files': files,
           'bytes': sum(len(file['diff'].encode('utf-8')) for file in files), 'omittedFiles': omitted}
    return job


def requeue_failed(config, now, reasons, dry_run=False, git_call=git):
    state = Path(config['state_file'])
    state.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state.parent / 'changes-enqueue.lock').open('a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        root = Path(config['data_dir']) / 'queue' if dry_run else queue_directories(config)
        counts = {'requeued': 0, 'retained': 0, 'dryRun': dry_run}
        for record in sorted((root / 'failed').glob('*.json')):
            try:
                result = json.loads(record.read_text())
                sha = record.stem
                units = result.get('failedUnits')
                eligible = (re.fullmatch(SHA, sha) and result.get('sha') == sha and
                            isinstance(units, list) and bool(units) and
                            all(isinstance(unit, dict) and isinstance(unit.get('reason'), str) and
                                unit['reason'] in reasons for unit in units))
            except (ValueError, AttributeError):
                eligible = False
            if not eligible:
                counts['retained'] += 1
                continue
            if dry_run:
                counts['requeued'] += 1
                continue
            if git_call(config['project_dir'], 'cat-file', '-e', sha + '^{commit}', check=False).returncode:
                print(json.dumps({'sha': sha, 'reason': 'commit_unreachable'}))
                counts['retained'] += 1
                continue
            # Do not overwrite work that the API already owns.
            if any((root / folder / record.name).exists() for folder in ('pending', 'claimed', 'done')):
                counts['retained'] += 1
                continue
            job = build_job(config, now, sha, git_call)
            atomic_write(root / 'pending' / record.name, json.dumps(job, ensure_ascii=False) + '\n',
                         int(config['api_uid']), int(config['api_gid']))
            record.unlink()
            (root / 'progress' / record.name).unlink(missing_ok=True)
            counts['requeued'] += 1
        print(json.dumps(counts))
        return counts


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
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        if previous is not None and previous.exists():
            shutil.rmtree(previous)


def collect(config, mode='nightly'):
    now = datetime.now(ZoneInfo(config['timezone']))
    errors = []
    try:
        reviewed, counts = enqueue_changes(config, now, source_errors=errors)
    except Exception:
        if mode == 'enqueue':
            raise
        errors.append('changes_enqueue_failed')
        reviewed, counts = {'from': '', 'to': ''}, None
    if mode == 'enqueue':
        return
    since = now - timedelta(hours=24)
    materials = {kind: Material(int(config['material_byte_cap'])) for kind in ['security', 'errors']}
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
    manifest = {'reviewedCommits': reviewed, 'droppedLines': {kind: value.dropped for kind, value in materials.items()},
                'sourceErrors': errors}
    if counts is not None:
        manifest['queue'] = counts
    publish_bundle(config, now.date().isoformat(), materials, manifest)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('config', type=Path)
    parser.add_argument('--mode', choices=['nightly', 'enqueue', 'requeue-failed'], default='nightly')
    parser.add_argument('--requeue-reasons', default='refused_or_vague,invalid_model_schema,completion_failed')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    with args.config.open(encoding='utf-8') as stream:
        config = json.load(stream)
    os.umask(0o077)
    try:
        if args.mode == 'requeue-failed':
            requeue_failed(config, datetime.now(ZoneInfo(config['timezone'])),
                           set(args.requeue_reasons.split(',')), args.dry_run)
        else:
            collect(config, args.mode)
    except Exception:
        parser.exit(1, 'Security review collection failed; the cursor advances only after all queue jobs are durable.\n')


if __name__ == '__main__':
    main()
