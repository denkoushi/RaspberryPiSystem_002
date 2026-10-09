import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = ROOT / 'infrastructure/ansible/templates/pi5-power-dispatcher.sh.j2'
PLAYBOOK = ROOT / 'infrastructure/ansible/playbooks/power-control.yml'


class Pi5PowerDispatcherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.queue = self.root / 'power-actions'
        self.queue.mkdir()
        (self.root / 'infrastructure/ansible').mkdir(parents=True)
        self.script = self.root / 'dispatcher.sh'
        rendered = re.sub(r'^REPO_ROOT=.*$', f'REPO_ROOT="{self.root}"',
                          TEMPLATE.read_text(), flags=re.MULTILINE)
        rendered = re.sub(r'^INVENTORY=.*$', f'INVENTORY="{self.root}/inventory.yml"',
                          rendered, flags=re.MULTILINE)
        self.script.write_text(rendered)
        self.calls = self.root / 'calls.jsonl'
        self.codes = self.root / 'codes.json'
        self.codes.write_text('[]')
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        stub = bin_dir / 'ansible-playbook'
        stub.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
calls = Path(os.environ['STUB_CALLS'])
count = len(calls.read_text().splitlines()) if calls.exists() else 0
request_files = [arg.split('=', 1)[1] for arg in sys.argv[1:] if arg.startswith('power_request_file=')]
request_ids = ['requestId=' + json.loads(Path(name).read_text())['requestId'] for name in request_files]
with calls.open('a') as stream:
    stream.write(json.dumps(sys.argv[1:] + request_ids) + '\\n')
codes = json.loads(Path(os.environ['STUB_CODES']).read_text())
sys.exit(codes[count] if count < len(codes) else 0)
''')
        stub.chmod(0o755)
        self.env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
                        STUB_CALLS=str(self.calls), STUB_CODES=str(self.codes))
        self.env.pop('POWER_ACTION_MAX_AGE_SECONDS', None)
        self.key = 'test-credential-do-not-log'

    def request(self, prefix='001', **overrides):
        data = dict(action='reboot', clientKey=self.key, clientDeviceId='device-1',
                    requestId='request-' + prefix,
                    requestedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        data.update(overrides)
        path = self.queue / f'{prefix}-{self.key}.json'
        path.write_text(json.dumps(data))
        return path

    def run_dispatcher(self, trigger=None):
        result = subprocess.run(['/bin/bash', str(self.script)] +
                                ([str(trigger)] if trigger is not None else []),
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        debug = (self.root / 'logs/power-actions/dispatcher-debug.log').read_text() if (self.root / 'logs/power-actions/dispatcher-debug.log').exists() else ''
        self.assertNotIn(self.key, debug)
        return [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def assert_retired(self, path, directory, suffix=''):
        self.assertFalse(path.exists())
        self.assertTrue((self.queue / directory / (path.name + suffix)).exists())

    def test_fresh_request_and_redacted_debug_log(self):
        path = self.request()
        calls = self.run_dispatcher()
        self.assertEqual(len(calls), 1)
        self.assertIn('power_action=reboot', calls[0])
        self.assertIn('requestId=request-001', calls[0])
        copies = [arg.split('=', 1)[1] for arg in calls[0] if arg.startswith('power_request_file=')]
        self.assertEqual(len(copies), 1)
        self.assertFalse(Path(copies[0]).exists())
        self.assertNotIn('--limit', calls[0])
        self.assertNotIn(self.key, json.dumps(calls[0]))
        self.assert_retired(path, 'processed')
        debug = (self.root / 'logs/power-actions/dispatcher-debug.log').read_text()
        self.assertNotIn(self.key, debug)
        self.assertNotIn(path.name, debug)
        for value in ('device-1', 'request-001', 'reboot', 'processed'):
            self.assertIn(value, debug)

    def test_stale_request(self):
        old = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
        path = self.request(requestedAt=old.isoformat())
        self.assertEqual(self.run_dispatcher(), [])
        self.assert_retired(path, 'failed', '.expired')

    def test_failed_ansible_continues_in_name_order(self):
        second = self.request('002')
        first = self.request('001')
        self.codes.write_text('[1, 0]')
        calls = self.run_dispatcher()
        self.assertEqual(len(calls), 2)
        self.assertIn('requestId=request-001', calls[0])
        self.assertIn('requestId=request-002', calls[1])
        self.assertNotIn(self.key, json.dumps(calls))
        self.assert_retired(first, 'failed')
        self.assert_retired(second, 'processed')
        self.assertIn('failed rc=1', (self.root / 'logs/power-actions/dispatcher-debug.log').read_text())

    def test_invalid_json_and_action_continue(self):
        invalid_json = self.request('001')
        invalid_json.write_text('{broken')
        invalid_action = self.request('002', action='invalid')
        fresh = self.request('003')
        self.assertEqual(len(self.run_dispatcher()), 1)
        self.assert_retired(invalid_json, 'failed')
        self.assert_retired(invalid_action, 'failed')
        self.assert_retired(fresh, 'processed')

    def test_missing_invalid_and_future_timestamps(self):
        timestamps = [None, 'not-a-date',
                      (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=2)).isoformat()]
        paths = [self.request(str(i), requestedAt=value) for i, value in enumerate(timestamps)]
        missing = self.request('missing')
        data = json.loads(missing.read_text())
        del data['requestedAt']
        missing.write_text(json.dumps(data))
        self.assertEqual(self.run_dispatcher(), [])
        for path in paths + [missing]:
            self.assert_retired(path, 'failed', '.expired')

    def test_max_age_override_and_single_file(self):
        old = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10)
        path = self.request(requestedAt=old.isoformat())
        self.env['POWER_ACTION_MAX_AGE_SECONDS'] = '900'
        self.assertEqual(len(self.run_dispatcher(path)), 1)
        self.assert_retired(path, 'processed')

    def test_empty_queue_and_rendered_bash_syntax(self):
        self.assertEqual(self.run_dispatcher(self.queue), [])
        subprocess.run(['/bin/bash', '-n', str(self.script)], check=True)
        self.assertNotIn('{{', self.script.read_text())

    def test_playbook_resolves_request_in_ansible(self):
        text = PLAYBOOK.read_text()
        self.assertIn('power_request_file', text)
        self.assertRegex(text, r'no_log:\s*true')
        self.assertRegex(text, r'hosts:\s*power_target')
        self.assertIn("groups['clients']", text)
        self.assertNotIn('power_action: "{{ power_action', text)


if __name__ == '__main__':
    unittest.main()
