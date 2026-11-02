#!/usr/bin/env bash
set -euo pipefail

exec python3 - <<'PY'
import fcntl
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import shlex
import ssl
import subprocess
import time
from urllib.parse import urlsplit

URL = os.environ.get('PI5_WATCHDOG_URL', 'https://100.106.158.2/api/system/health')
CERT_SHA256 = os.environ.get('PI5_WATCHDOG_CERT_SHA256',
                             '2ea4db2bd91520245b49203f7c72964a29bb848c3aabd99493d217f45efcdb0e').replace(':', '').lower()
STATE = Path(os.environ.get('PI5_WATCHDOG_STATE', str(Path.home() / 'Library/Application Support/raspi-pi5-watchdog/state.json')))
LOG = Path(os.environ.get('PI5_WATCHDOG_LOG', str(Path.home() / 'Library/Logs/raspi-pi5-watchdog.log')))
os.umask(0o077)
STATE.parent.mkdir(parents=True, exist_ok=True)
LOG.parent.mkdir(parents=True, exist_ok=True)


def log(event):
    # Only fixed event names; never record URLs, response bodies or command stderr.
    if LOG.exists() and LOG.stat().st_size >= 1024 * 1024:
        LOG.replace(str(LOG) + '.1')
    with LOG.open('a') as stream:
        stream.write(time.strftime('%Y-%m-%dT%H:%M:%S%z ') + event + '\n')


def notify(message):
    script = '''on run argv
 display notification (item 1 of argv) with title "業務用Pi5の見張り"
end run'''
    try:
        subprocess.run(['osascript', '-e', script, message], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
    except (OSError, subprocess.SubprocessError):
        log('mac_notification_failed')


class PinnedConnection(http.client.HTTPSConnection):
    def connect(self):
        super().connect()
        der = self.sock.getpeercert(binary_form=True)
        if not der or not hmac.compare_digest(hashlib.sha256(der).hexdigest(), CERT_SHA256):
            self.close()
            raise ssl.SSLError('certificate fingerprint mismatch')


def healthy():
    try:
        target = urlsplit(URL)
        if target.scheme != 'https' or not target.hostname or target.username or target.password:
            return False
        # 自己署名で CA 検証が通らないため、証明書全体の SHA-256 を固定値と照合し、一致した同じ接続だけで問い合わせる。
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        connection = PinnedConnection(target.hostname, target.port or 443, timeout=15, context=context)
        try:
            connection.request('GET', (target.path or '/') + ('?' + target.query if target.query else ''),
                               headers={'Accept': 'application/json'})
            response = connection.getresponse()
            if response.status != 200:
                return False
            data = json.loads(response.read(1024 * 1024))
        finally:
            connection.close()
        return (isinstance(data, dict) and data.get('status') == 'ok'
                and isinstance(data.get('checks'), dict)
                and isinstance(data['checks'].get('database'), dict)
                and data['checks']['database'].get('status') == 'ok')
    except (OSError, ValueError, http.client.HTTPException):
        return False


def record_recovery(message):
    # Suppress generate-alert.sh's optional webhook; this alert is for the floating Chat only.
    command = 'WEBHOOK_URL= /opt/RaspberryPiSystem_002/scripts/generate-alert.sh pi5-watchdog-recovered ' + shlex.quote(message)
    try:
        subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                        'raspi5-tailscale', command], check=True, timeout=30,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log('chat_recorded')
    except (OSError, subprocess.SubprocessError):
        log('chat_record_failed')
        notify('Pi5は戻りましたが、フローティングChatに残せませんでした。')


# Also protect manual runs from racing the LaunchAgent. OS releases the lock on exit.
with STATE.with_suffix('.lock').open('a') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(0)
    try:
        state = json.loads(STATE.read_text())
        if (state.get('status') not in ('ok', 'down')
                or not isinstance(state.get('down_since'), (int, float))
                or not isinstance(state.get('last_notice'), (int, float))):
            raise ValueError('invalid state')
    except FileNotFoundError:
        state = {'status': 'ok', 'down_since': 0, 'last_notice': 0}
    except (ValueError, AttributeError):
        # Preserve corrupt state rather than silently losing an outage's start time.
        log('invalid_state')
        notify('Pi5見張りの状態ファイルを読めません。状態ファイルを確認してください。')
        raise SystemExit(1)

    first_check = time.time()
    ok = healthy()
    if not ok:
        subprocess.run(['sleep', '30'], check=True)
        ok = healthy()
    now = time.time()
    event = 'ok' if ok else 'down'
    message = None
    recovered = False
    if not ok and state['status'] == 'ok':
        state = {'status': 'down', 'down_since': first_check, 'last_notice': now}
        event = 'down_started'
        message = '業務用Pi5の健康確認に2回続けて失敗しました。停止または接続・DBの不調が疑われます。'
    elif not ok and now - state['last_notice'] >= 1800:
        state['last_notice'] = now
        event = 'down_reminder'
        message = '業務用Pi5の健康確認に失敗した状態が続いています。'
    elif ok and state['status'] == 'down':
        seconds = max(0, int(now - state['down_since']))
        message = f'業務用Pi5が戻りました（止まっていた時間: {seconds // 3600}時間{seconds % 3600 // 60}分{seconds % 60}秒）。'
        state = {'status': 'ok', 'down_since': 0, 'last_notice': 0}
        event = 'recovered'
        recovered = True
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(state) + '\n')
    temporary.replace(STATE)
    log(event)
    if message:
        notify(message)
    if recovered:
        record_recovery(message)
PY
