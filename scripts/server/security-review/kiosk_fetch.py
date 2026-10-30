#!/usr/bin/env python3
"""Bounded, read-only kiosk fetch; run as the Pi5 login user, without sudo."""
import json
import os
from pathlib import Path
import re
import selectors
import shlex
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

START = 'Starting kiosk package integrity summary'
END = 'Kiosk package integrity summary completed.'
ALERT_NAME = re.compile(r'alert-\d{8}-\d{6}(?:[ -][A-Za-z0-9_-]+)?\.json\Z')
# All remote inputs are JSON on stdin, never shell syntax. Only read operations.
REMOTE = r'''
import json, pathlib, re, sys
q = json.load(sys.stdin)
result = {'log': '', 'alerts': []}
try:
    with open(q['log_path'], 'rb') as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - q['log_byte_cap']))
        data = f.read(q['log_byte_cap'])
        if size > q['log_byte_cap']:
            data = data.partition(b'\n')[2]
        result['log'] = data.decode('utf-8', 'replace')
except FileNotFoundError:
    pass
pattern = re.compile(r'alert-\d{8}-\d{6}(?:[ -][A-Za-z0-9_-]+)?\.json\Z')
directory = pathlib.Path(q['alerts_dir'])
names = sorted(p.name for p in directory.iterdir() if pattern.fullmatch(p.name) and p.is_file()) if directory.is_dir() else []
result['newest'] = names[-1] if names else ''
if q['watermark'] is not None:
    for name in [n for n in names if n > q['watermark']][:q['alerts_per_host']]:
        with (directory / name).open('rb') as f:
            data = f.read(q['alert_byte_cap'] + 1)
        result['alerts'].append([name, data.decode('utf-8', 'replace') if len(data) <= q['alert_byte_cap'] else ''])
json.dump(result, sys.stdout)
'''
REMOTE_COMMAND = 'python3 -c ' + shlex.quote(REMOTE)


def ssh_runner(host, request, timeout, byte_cap):
    """Drain a bounded stdout stream, with one deadline for the entire host."""
    command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
               '-o', 'StrictHostKeyChecking=accept-new',
               f"{host['user']}@{host['address']}", REMOTE_COMMAND]
    deadline = time.monotonic() + timeout
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL) as process:
        try:
            process.stdin.write(json.dumps(request).encode())
            process.stdin.close()
            output = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise TimeoutError('host timeout')
                    chunk = os.read(process.stdout.fileno(), min(65536, byte_cap - len(output) + 1))
                    if not chunk:
                        break
                    output.extend(chunk)
                    if len(output) > byte_cap:
                        raise ValueError('host byte cap')
            if process.wait(timeout=max(0.001, deadline - time.monotonic())) != 0:
                raise OSError('ssh failed')
            return json.loads(output)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()


def atomic_write(path, text, mode=0o640):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.kiosk-fetch-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(text)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def latest_run(text):
    current = None
    latest = None
    for line in text.splitlines():
        if 'Starting package integrity check...' in line:
            current = []
        elif current is not None:
            match = re.fullmatch(r'\[([^]]+)\] Package integrity check completed\.', line)
            if match:
                try:
                    at = datetime.fromisoformat(match[1]).replace(tzinfo=timezone.utc)
                    if latest is None or at > latest[0]:
                        latest = (at, match[1], current)
                except ValueError:
                    pass
                current = None
            else:
                current.append(line)
    return latest


def forward(text, host, name, directory):
    try:
        alert = json.loads(text, strict=False)
        if not isinstance(alert, dict) or not isinstance(alert.get('id'), str) or not alert['id']:
            return False
        datetime.fromisoformat(alert['timestamp'])
        # Reject non-finite numbers, too: output must be strict JSON.
        source = {'host': host}
        if 'source' in alert:
            source['original'] = alert['source']
        alert['source'] = source
        alert['id'] = host + '-' + alert['id']
        encoded = json.dumps(alert, ensure_ascii=False, allow_nan=False) + '\n'
    except (ValueError, TypeError, KeyError, RecursionError):
        return False
    destination = Path(directory) / (name[:-5] + '-' + host + '.json')
    if not destination.exists():
        # Match the world-readable files the Pi5 API container already ingests.
        atomic_write(destination, encoded, 0o644)
        return True
    return False


def fetch(config, runner=ssh_runner, now=None):
    now = now or datetime.now().astimezone()
    lines = [f'[{now.isoformat()}] {START}']
    for host in config['kiosks']:
        name = host['name']
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', name):
            raise ValueError('invalid inventory hostname')
        state = Path(config['state_dir']) / (name + '.watermark')
        status, completed, body, forwarded = 'unreachable', '-', [], 0
        try:
            watermark = state.read_text().strip() if state.exists() else None
            request = {key: config[key] for key in ('log_path', 'alerts_dir', 'log_byte_cap',
                       'alert_byte_cap', 'alerts_per_host')}
            request['watermark'] = watermark
            result = runner(host, request, config['host_timeout_seconds'], config['host_byte_cap'])
            latest = latest_run(result['log'])
            status = 'ok' if latest else 'no_completed_run'
            if latest:
                _, completed, body = latest
            if watermark is None:
                atomic_write(state, result['newest'], 0o600)
            else:
                for remote_name, text in result['alerts']:
                    if not ALERT_NAME.fullmatch(remote_name) or remote_name <= watermark:
                        continue
                    forwarded += forward(text, name, remote_name, config['output_alerts_dir'])
                    atomic_write(state, remote_name, 0o600)
                    watermark = remote_name
        except (OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired):
            status = 'unreachable'
        lines.extend([f'Host: {name}', f'Status: {status}', f'Latest completed run: {completed}'])
        cap = config['summary_line_cap']
        # Indent remote lines so they cannot act as collector run delimiters.
        lines.extend('  ' + line for line in body[:cap])
        if len(body) > cap:
            lines.append(f'  ... {len(body) - cap} more lines')
        print(f'{name}: {status}, forwarded={forwarded}')
    lines.append(f'[{now.isoformat()}] {END}')
    atomic_write(config['summary_path'], '\n'.join(lines) + '\n')
    return 0


def main():
    with open(sys.argv[1], encoding='utf-8') as stream:
        return fetch(json.load(stream))


if __name__ == '__main__':
    sys.exit(main())
