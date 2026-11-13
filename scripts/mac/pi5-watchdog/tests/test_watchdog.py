import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = ROOT / 'scripts/mac/pi5-watchdog'


class WatchdogTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.home = Path(directory.name)
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, HOME=str(self.home),
                        PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        PYTHONPATH=str(self.home), TEST_HOME=str(self.home))
        self.state = self.home / 'state.json'
        self.env.update(PI5_WATCHDOG_STATE=str(self.state), PI5_WATCHDOG_LOG=str(self.home / 'watch.log'))
        self.env.update(PI5_WATCHDOG_CERT_SHA256=hashlib.sha256(b'test certificate').hexdigest())
        # Never fall back to this Mac's real Tailscale CLI, including in existing tests.
        self.env['PI5_WATCHDOG_TAILSCALE'] = str(self.bin / 'missing-tailscale')
        # Replace only the network layer; the script's own fingerprint check still runs on the fake certificate.
        (self.home / 'sitecustomize.py').write_text('''import http.client, json, os, ssl
from pathlib import Path
home = Path(os.environ['TEST_HOME'])
class Socket:
    def getpeercert(self, binary_form=False): return os.environ.get('TEST_CERT', 'test certificate').encode()
class Response:
    def __init__(self, status, body): self.status, self.body = status, body.encode()
    def read(self, amt=None): return self.body
class Connection:
    def __init__(self, host, port=None, timeout=None, context=None):
        assert timeout == 15 and context.verify_mode == ssl.CERT_NONE
        self.sock = None
    def connect(self): self.sock = Socket()
    def close(self): pass
    def request(self, method, path, headers=None):
        queue = json.loads((home / 'responses.json').read_text())
        self.response = queue.pop(0)
        (home / 'responses.json').write_text(json.dumps(queue))
        if self.response.get('code'): raise OSError('connection failed')
        self.connect()
    def getresponse(self): return Response(int(self.response['http']), self.response['body'])
http.client.HTTPSConnection = Connection
import subprocess
original_run = subprocess.run
def run(args, **kwargs):
    if args[0] == os.environ['PI5_WATCHDOG_TAILSCALE'] and 'TS_STATUS' in os.environ:
        assert kwargs['timeout'] == (10 if args[1] == 'status' else 30)
        if os.environ.get('TS_TIMEOUT') == args[1]:
            raise subprocess.TimeoutExpired(args, kwargs['timeout'],
                                            output=os.environ.get('TS_TIMEOUT_OUTPUT', '').encode())
    return original_run(args, **kwargs)
subprocess.run = run
''')
        for name in ('ssh', 'osascript', 'sleep', 'launchctl'):
            self.stub(name, '''import json, os, sys
from pathlib import Path
home = Path(os.environ['TEST_HOME'])
name = Path(sys.argv[0]).name
with (home / (name + '.jsonl')).open('a') as out: out.write(json.dumps(sys.argv[1:]) + '\\n')
if name == 'launchctl' and sys.argv[1] == 'print':
    sys.exit(0 if (home / 'loaded').exists() else 1)
if name == 'launchctl' and sys.argv[1] == 'bootstrap': (home / 'loaded').touch()
if name == 'launchctl' and sys.argv[1] == 'bootout': (home / 'loaded').unlink()
if name == 'ssh': sys.exit(int(os.environ.get('SSH_EXIT', '0')))
''')

    def stub(self, name, source):
        path = self.bin / name
        path.write_text('#!/usr/bin/env python3\n' + source)
        path.chmod(0o755)

    def response(self, body=None, http='200', code=0):
        return dict(body=json.dumps(body if body is not None else {'status': 'ok', 'checks': {'database': {'status': 'ok'}}}), http=http, code=code)

    def run_watchdog(self, *responses):
        (self.home / 'responses.json').write_text(json.dumps(responses))
        subprocess.run(['bash', str(SCRIPTS / 'pi5-watchdog.sh')], env=self.env, check=True, capture_output=True, timeout=10)
        self.assertEqual(json.loads((self.home / 'responses.json').read_text()), [])

    def calls(self, name):
        path = self.home / (name + '.jsonl')
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def down(self, age=300, notice_age=300):
        self.state.write_text(json.dumps(dict(status='down', down_since=time.time() - age, last_notice=time.time() - notice_age)))

    def tailscale(self, online=True, backend='Running', self_online=True, peers=True,
                  pong=False, ping_exit=1, stderr=False):
        self.env.update(
            PI5_WATCHDOG_TAILSCALE=str(self.bin / 'tailscale'),
            TS_STATUS=json.dumps({'BackendState': backend, 'Self': {'Online': self_online},
                                  'Peer': {'pi5': {'TailscaleIPs': ['100.106.158.2'],
                                                   'Online': online}} if peers else {}}),
            TS_PING='pong from raspberrypi via DERP(tok)\ndirect connection not established' if pong else 'no reply',
            TS_PING_EXIT=str(ping_exit), TS_STDERR='1' if stderr else '0')
        self.stub('tailscale', '''import json, os, sys
from pathlib import Path
home = Path(os.environ['TEST_HOME'])
with (home / 'tailscale.jsonl').open('a') as out: out.write(json.dumps(sys.argv[1:]) + '\\n')
if sys.argv[1:] == ['status', '--json']:
    print(os.environ['TS_STATUS'])
    sys.exit(int(os.environ.get('TS_STATUS_EXIT', '0')))
assert sys.argv[1:] == ['ping', '-c', '3', '--timeout', '5s', '100.106.158.2']
print(os.environ['TS_PING'], file=sys.stderr if os.environ['TS_STDERR'] == '1' else sys.stdout)
sys.exit(int(os.environ['TS_PING_EXIT']))
''')

    def failed_checks(self):
        self.run_watchdog(self.response(code=7), self.response(code=7))

    def assert_path_issue(self):
        state = json.loads(self.state.read_text())
        self.assertEqual(state['status'], 'ok')
        self.assertIsInstance(state['suspect_since'], (int, float))
        self.assertEqual(self.calls('osascript'), [])
        self.assertEqual(self.calls('ssh'), [])
        self.assertTrue((self.home / 'watch.log').read_text().endswith(' path_issue\n'))

    def test_online_without_pong_is_path_issue_and_preserves_first_suspect(self):
        self.tailscale()
        before = time.time()
        self.failed_checks()
        self.assert_path_issue()
        suspect = json.loads(self.state.read_text())['suspect_since']
        self.assertGreaterEqual(suspect, before)
        self.assertLessEqual(suspect, time.time())
        self.failed_checks()
        self.assertEqual(json.loads(self.state.read_text())['suspect_since'], suspect)

    def test_derp_pong_with_rc_one_rechecks_health_before_down(self):
        self.tailscale(pong=True, stderr=True)
        self.run_watchdog(*[self.response(code=7)] * 3)
        self.assertEqual(json.loads(self.state.read_text())['status'], 'down')
        self.assertEqual(len(self.calls('osascript')), 1)
        self.assertTrue((self.home / 'watch.log').read_text().endswith(' down_started\n'))
        self.assertNotIn('DERP', (self.home / 'watch.log').read_text())

    def test_pong_reconnects_health_silently(self):
        self.tailscale(pong=True)
        self.run_watchdog(self.response(code=7), self.response(code=7), self.response())
        self.assertEqual(json.loads(self.state.read_text())['status'], 'ok')
        self.assertEqual(self.calls('osascript'), [])
        self.assertEqual(self.calls('ssh'), [])

    def test_pong_reconnects_existing_down_as_recovery(self):
        self.down()
        self.tailscale(pong=True)
        self.run_watchdog(self.response(code=7), self.response(code=7), self.response())
        self.assertEqual(json.loads(self.state.read_text())['status'], 'ok')
        self.assertEqual(len(self.calls('osascript')), 1)
        self.assertEqual(len(self.calls('ssh')), 1)

    def test_offline_or_missing_peer_is_down_without_ping(self):
        for options in ({'online': False}, {'peers': False}):
            with self.subTest(options=options):
                self.state.unlink(missing_ok=True)
                self.tailscale(**options)
                before = len(self.calls('osascript'))
                self.failed_checks()
                self.assertEqual(json.loads(self.state.read_text())['status'], 'down')
                self.assertEqual(len(self.calls('osascript')), before + 1)
        self.assertTrue(all(call == ['status', '--json'] for call in self.calls('tailscale')))

    def test_mac_not_running_or_online_is_path_issue(self):
        for options in ({'backend': 'Stopped'}, {'self_online': False}):
            with self.subTest(options=options):
                self.tailscale(**options)
                self.failed_checks()
                self.assert_path_issue()
        self.assertTrue(all(call == ['status', '--json'] for call in self.calls('tailscale')))

    def test_unreadable_status_is_path_issue(self):
        self.tailscale()
        for status in ('not json', '[]', '{}'):
            with self.subTest(status=status):
                self.env['TS_STATUS'] = status
                self.failed_checks()
                self.assert_path_issue()
        self.env['TS_STATUS_EXIT'] = '1'
        self.failed_checks()
        self.assert_path_issue()

    def test_missing_explicit_cli_does_not_fall_back_to_path(self):
        self.tailscale()
        self.env['PI5_WATCHDOG_TAILSCALE'] = str(self.bin / 'missing-tailscale')
        self.failed_checks()
        self.assertEqual(json.loads(self.state.read_text())['status'], 'down')
        self.assertEqual(len(self.calls('osascript')), 1)
        self.assertEqual(self.calls('tailscale'), [])

    def test_status_and_ping_timeouts_are_path_issues(self):
        self.tailscale()
        for command in ('status', 'ping'):
            with self.subTest(command=command):
                self.env['TS_TIMEOUT'] = command
                self.failed_checks()
                self.assert_path_issue()

    def test_ping_pong_before_timeout_still_rechecks_health(self):
        self.tailscale()
        self.env.update(TS_TIMEOUT='ping', TS_TIMEOUT_OUTPUT='pong from raspberrypi via DERP(tok)')
        self.run_watchdog(self.response(code=7), self.response(code=7), self.response())
        self.assertEqual(json.loads(self.state.read_text())['status'], 'ok')
        self.assertEqual(self.calls('osascript'), [])

    def test_unexecutable_cli_is_down(self):
        self.tailscale()
        (self.bin / 'tailscale').chmod(0o644)
        self.failed_checks()
        self.assertEqual(json.loads(self.state.read_text())['status'], 'down')
        self.assertEqual(len(self.calls('osascript')), 1)

    def test_down_after_suspect_uses_suspect_time(self):
        self.tailscale()
        self.failed_checks()
        suspect = time.time() - 3600
        state = json.loads(self.state.read_text())
        state['suspect_since'] = suspect
        self.state.write_text(json.dumps(state))
        self.tailscale(online=False)
        self.failed_checks()
        self.assertEqual(json.loads(self.state.read_text())['down_since'], suspect)
        self.assertEqual(len(self.calls('osascript')), 1)

    def test_healthy_clears_suspect_and_path_notice_without_notification(self):
        self.state.write_text(json.dumps(dict(status='ok', down_since=0, last_notice=0,
                                             suspect_since=time.time() - 22000, path_notice_sent=True)))
        self.run_watchdog(self.response())
        state = json.loads(self.state.read_text())
        self.assertNotIn('suspect_since', state)
        self.assertNotIn('path_notice_sent', state)
        self.assertEqual(self.calls('osascript'), [])
        self.assertEqual(self.calls('ssh'), [])

    def test_six_hour_path_notice_only_once_and_resets_after_health(self):
        self.tailscale()
        self.state.write_text(json.dumps(dict(status='ok', down_since=0, last_notice=0,
                                             suspect_since=time.time() - 21500)))
        self.failed_checks()
        self.assertEqual(self.calls('osascript'), [])
        state = json.loads(self.state.read_text())
        state['suspect_since'] = time.time() - 21600
        self.state.write_text(json.dumps(state))
        self.failed_checks()
        self.failed_checks()
        self.assertEqual(len(self.calls('osascript')), 1)
        self.assertEqual(self.calls('osascript')[0][-1],
                         'Macから業務用Pi5へつながりにくい状態が続いています(Pi5の停止ではない可能性が高い)。')
        self.assertTrue(json.loads(self.state.read_text())['path_notice_sent'])
        self.assertEqual(json.loads(self.state.read_text())['status'], 'ok')
        self.assertEqual(self.calls('ssh'), [])
        self.run_watchdog(self.response())
        self.failed_checks()
        self.assertNotIn('path_notice_sent', json.loads(self.state.read_text()))

    def test_path_issue_while_down_suppresses_reminder(self):
        self.down(age=30000, notice_age=30000)
        original = json.loads(self.state.read_text())
        self.tailscale()
        self.failed_checks()
        state = json.loads(self.state.read_text())
        state['suspect_since'] = time.time() - 21600
        self.state.write_text(json.dumps(state))
        self.failed_checks()
        state = json.loads(self.state.read_text())
        for key in original:
            self.assertEqual(state[key], original[key])
        self.assertEqual(self.calls('osascript'), [])
        self.assertEqual(self.calls('ssh'), [])
        self.assertTrue((self.home / 'watch.log').read_text().endswith(' path_issue\n'))

    def test_old_state_without_new_keys_is_accepted(self):
        self.state.write_text(json.dumps(dict(status='ok', down_since=0, last_notice=0)))
        self.run_watchdog(self.response())
        self.assertEqual(self.calls('osascript'), [])

    def test_invalid_new_state_types_are_rejected_without_overwriting(self):
        for key, value in [('suspect_since', 'yesterday'), ('suspect_since', True),
                           ('suspect_since', None), ('path_notice_sent', 1),
                           ('path_notice_sent', 'true'), ('path_notice_sent', None)]:
            with self.subTest(key=key, value=value):
                original = json.dumps(dict(status='ok', down_since=0, last_notice=0, **{key: value}))
                self.state.write_text(original)
                result = subprocess.run(['bash', str(SCRIPTS / 'pi5-watchdog.sh')], env=self.env,
                                        capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(self.state.read_text(), original)
                self.assertTrue((self.home / 'watch.log').read_text().endswith(' invalid_state\n'))

    def test_initial_ok_and_repeated_ok_are_silent(self):
        self.run_watchdog(self.response())
        self.run_watchdog(self.response())
        self.assertEqual(self.calls('osascript'), [])
        self.assertEqual(self.calls('ssh'), [])

    def test_health_failures_require_two_attempts_and_notify_once(self):
        failures = [self.response(http='503'), self.response(code=28), self.response(body={}),
                    self.response(body={'status': 'error'}), self.response(body=[]),
                    self.response(body={'status': 'ok', 'checks': {'database': {'status': 'error'}}}),
                    self.response(body={'status': 'ok', 'checks': {'database': None}})]
        failures.append(dict(body='not json', http='200'))
        for failure in failures:
            with self.subTest(failure=failure):
                self.state.unlink(missing_ok=True)
                before = len(self.calls('osascript'))
                self.run_watchdog(failure, failure)
                self.assertEqual(json.loads(self.state.read_text())['status'], 'down')
                self.assertEqual(len(self.calls('osascript')), before + 1)
                self.run_watchdog(failure, failure)
                self.assertEqual(len(self.calls('osascript')), before + 1)
        self.assertTrue(all(call == ['30'] for call in self.calls('sleep')))
        self.assertEqual(self.calls('ssh'), [])

    def test_transient_failure_does_not_notify(self):
        self.run_watchdog(self.response(code=7), self.response())
        self.assertEqual(json.loads(self.state.read_text())['status'], 'ok')
        self.assertEqual(self.calls('sleep'), [['30']])
        self.assertEqual(self.calls('osascript'), [])

    def test_reminder_only_after_30_minutes(self):
        self.down(notice_age=1790)
        self.run_watchdog(self.response(code=7), self.response(code=7))
        self.assertEqual(self.calls('osascript'), [])
        self.down(notice_age=1800)
        self.run_watchdog(self.response(code=7), self.response(code=7))
        self.run_watchdog(self.response(code=7), self.response(code=7))
        self.assertEqual(len(self.calls('osascript')), 1)

    def test_recovery_records_duration_once_and_ssh_failure_does_not_stop_watch(self):
        self.down(age=3661)
        self.env['SSH_EXIT'] = '1'
        self.run_watchdog(self.response())
        self.run_watchdog(self.response())
        notifications = self.calls('osascript')
        self.assertEqual(len(notifications), 2)
        self.assertIn('1時間1分', notifications[0][-1])
        self.assertIn('フローティングChatに残せませんでした', notifications[1][-1])
        ssh = self.calls('ssh')
        self.assertEqual(len(ssh), 1)
        self.assertEqual(ssh[0][:5], ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'raspi5-tailscale'])
        self.assertIn('WEBHOOK_URL= /opt/RaspberryPiSystem_002/scripts/generate-alert.sh pi5-watchdog-recovered', ssh[0][-1])
        self.assertIn('1時間1分', ssh[0][-1])
        self.assertEqual(json.loads(self.state.read_text())['status'], 'ok')

    def test_successful_recovery_and_log_rotation(self):
        self.down()
        (self.home / 'watch.log').write_text('x' * (1024 * 1024))
        self.run_watchdog(self.response())
        self.assertEqual(len(self.calls('osascript')), 1)
        self.assertEqual(len(self.calls('ssh')), 1)
        self.assertEqual((self.home / 'watch.log.1').stat().st_size, 1024 * 1024)
        self.assertIn('chat_recorded', (self.home / 'watch.log').read_text())

    def test_certificate_mismatch_is_down(self):
        self.env['TEST_CERT'] = 'other certificate'
        self.run_watchdog(self.response(), self.response())
        self.assertEqual(json.loads(self.state.read_text())['status'], 'down')

    def test_url_and_fingerprint_overrides(self):
        self.env.update(PI5_WATCHDOG_URL='https://example.test/health', TEST_CERT='other certificate',
                        PI5_WATCHDOG_CERT_SHA256=hashlib.sha256(b'other certificate').hexdigest().upper())
        self.run_watchdog(self.response())
        self.assertEqual(json.loads(self.state.read_text())['status'], 'ok')

    def test_install_and_uninstall_are_idempotent_using_launchctl_stub(self):
        for _ in range(2):
            subprocess.run(['bash', str(SCRIPTS / 'install.sh')], env=self.env, check=True, capture_output=True)
        plist = self.home / 'Library/LaunchAgents/com.raspi.pi5-watchdog.plist'
        data = plistlib.loads(plist.read_bytes())
        self.assertEqual(data['StartInterval'], 300)
        self.assertTrue(data['RunAtLoad'])
        self.assertTrue(Path(data['ProgramArguments'][1]).exists())
        for _ in range(2):
            subprocess.run(['bash', str(SCRIPTS / 'uninstall.sh')], env=self.env, check=True, capture_output=True)
        self.assertFalse(plist.exists())
        actions = [call[0] for call in self.calls('launchctl')]
        self.assertEqual(actions.count('bootstrap'), 2)
        self.assertEqual(actions.count('bootout'), 2)


if __name__ == '__main__':
    unittest.main()
