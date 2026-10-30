import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
TEMPLATES = ROOT / 'infrastructure/ansible/templates'
SCRIPT = TEMPLATES / 'pi5-wifi-reconnect.sh.j2'
SERVER_TASKS = ROOT / 'infrastructure/ansible/roles/server/tasks'
DELIVERY_PLAYBOOK = ROOT / 'infrastructure/ansible/playbooks/prepare-pi5-wifi-reconnect.yml'


class Pi5WifiReconnectTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin_dir = self.root / 'bin'
        self.bin_dir.mkdir()
        self.net_dir = self.root / 'net'
        (self.net_dir / 'wlan0').mkdir(parents=True)
        self.uptime = self.root / 'uptime'
        self.uptime.write_text('180.00 100.00\n')
        self.calls = self.root / 'calls.jsonl'
        self.logs = self.root / 'logs.jsonl'
        nmcli = self.bin_dir / 'nmcli'
        nmcli.write_text('''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['STUB_CALLS'], 'a') as stream:
    stream.write(json.dumps(sys.argv[1:]) + '\\n')
args = sys.argv[1:]
if args == ['-t', '-f', 'STATE', 'general']:
    print(os.environ['STUB_STATE'])
elif args == ['-g', 'GENERAL.STATE', 'device', 'show', 'wlan0']:
    print(os.environ['STUB_DEVICE_STATE'])
elif args == ['--wait', '45', 'device', 'connect', 'wlan0']:
    sys.exit(int(os.environ['STUB_CONNECT_RC']))
else:
    sys.exit(99)
''')
        nmcli.chmod(0o755)
        logger = self.bin_dir / 'logger'
        logger.write_text('''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['STUB_LOGS'], 'a') as stream:
    stream.write(json.dumps(sys.argv[1:]) + '\\n')
''')
        logger.chmod(0o755)
        self.env = dict(os.environ,
                        PATH=str(self.bin_dir) + os.pathsep + os.environ['PATH'],
                        NET_CLASS_DIR=str(self.net_dir), UPTIME_FILE=str(self.uptime),
                        STUB_CALLS=str(self.calls), STUB_LOGS=str(self.logs),
                        STUB_STATE='disconnected', STUB_DEVICE_STATE='30 (disconnected)',
                        STUB_CONNECT_RC='0')

    def run_watchdog(self):
        result = subprocess.run(['/bin/bash', str(SCRIPT)], env=self.env,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []
        logs = [json.loads(line) for line in self.logs.read_text().splitlines()] if self.logs.exists() else []
        return calls, logs

    def test_templates_and_server_full_import(self):
        tasks = (SERVER_TASKS / 'wifi-reconnect.yml').read_text()
        for suffix in ('sh', 'service', 'timer'):
            self.assertTrue((TEMPLATES / f'pi5-wifi-reconnect.{suffix}.j2').is_file())
            self.assertIn(f'templates/pi5-wifi-reconnect.{suffix}.j2', tasks)
        self.assertIn('dest: /usr/local/bin/pi5-wifi-reconnect.sh', tasks)
        self.assertIn("mode: '0755'", tasks)
        self.assertRegex(tasks, r'daemon_reload:\s*true')
        self.assertRegex(tasks, r'name: pi5-wifi-reconnect.timer\n\s+enabled: true\n\s+state: started')
        main = (SERVER_TASKS / 'main.yml').read_text()
        self.assertRegex(main, r"import_tasks: wifi-reconnect\.yml\n\s+when: server_release_mode == 'full'")
        self.assertLess(main.index('import_tasks: power-dispatcher.yml'),
                        main.index('import_tasks: wifi-reconnect.yml'))

    def test_delivery_playbook_contract(self):
        delivery = DELIVERY_PLAYBOOK.read_text()
        self.assertRegex(delivery, r'hosts:\s*server')
        self.assertIn('pi5_wifi_reconnect_delivery_approved', delivery)
        self.assertIn('tasks_from: wifi-reconnect.yml', delivery)
        self.assertNotIn('server_release_mode', (SERVER_TASKS / 'wifi-reconnect.yml').read_text())
        self.assertIn(
            'playbooks/prepare-pi5-wifi-reconnect.yml',
            (ROOT / 'scripts/ci/run-deploy-contracts-local.sh').read_text())

    def test_timer_and_service_contract(self):
        timer = (TEMPLATES / 'pi5-wifi-reconnect.timer.j2').read_text()
        for line in ('OnBootSec=3min', 'OnUnitActiveSec=2min',
                     'Unit=pi5-wifi-reconnect.service', 'WantedBy=timers.target'):
            self.assertIn(line, timer.splitlines())
        service = (TEMPLATES / 'pi5-wifi-reconnect.service.j2').read_text()
        self.assertIn('Type=oneshot', service.splitlines())
        self.assertIn('ExecStart=/usr/local/bin/pi5-wifi-reconnect.sh', service.splitlines())
        self.assertNotIn('RemainAfterExit=yes', service)

    def test_bash_syntax(self):
        subprocess.run(['/bin/bash', '-n', str(SCRIPT)], check=True)
        self.assertIn('set -u', SCRIPT.read_text())
        self.assertNotIn('{{', SCRIPT.read_text())

    def test_connected_network_does_nothing(self):
        for state in ('connected', 'connected (site only)', 'connected (local only)'):
            with self.subTest(state=state):
                self.env['STUB_STATE'] = state
                calls, logs = self.run_watchdog()
                self.assertTrue(all(call == ['-t', '-f', 'STATE', 'general'] for call in calls))
                self.assertEqual(logs, [])

    def test_connected_wlan_does_nothing(self):
        self.env['STUB_DEVICE_STATE'] = '100 (connected)'
        calls, logs = self.run_watchdog()
        self.assertEqual(len(calls), 2)
        self.assertEqual(logs, [])

    def test_disconnected_connects_exactly_once(self):
        calls, logs = self.run_watchdog()
        self.assertEqual(calls, [
            ['-t', '-f', 'STATE', 'general'],
            ['-g', 'GENERAL.STATE', 'device', 'show', 'wlan0'],
            ['--wait', '45', 'device', 'connect', 'wlan0'],
        ])
        self.assertEqual(len(logs), 2)
        for log in logs:
            self.assertEqual(log[:2], ['-t', 'pi5-wifi-reconnect'])
            self.assertTrue(log[2].isascii())
        self.assertIn('network=disconnected device=30 (disconnected)', logs[0][2])
        self.assertIn('succeeded', logs[1][2])

    def test_failed_connection_returns_success_without_retry(self):
        self.env['STUB_CONNECT_RC'] = '10'
        calls, logs = self.run_watchdog()
        self.assertEqual(sum(call == ['--wait', '45', 'device', 'connect', 'wlan0'] for call in calls), 1)
        self.assertIn('failed: rc=10', logs[-1][2])

    def test_missing_wlan_does_nothing(self):
        (self.net_dir / 'wlan0').rmdir()
        self.assertEqual(self.run_watchdog(), ([], []))

    def test_missing_nmcli_does_nothing(self):
        (self.bin_dir / 'nmcli').unlink()
        self.env['PATH'] = str(self.bin_dir)
        self.assertEqual(self.run_watchdog(), ([], []))

    def test_uptime_below_180_does_nothing(self):
        self.uptime.write_text('179.99 100.00\n')
        self.assertEqual(self.run_watchdog(), ([], []))


if __name__ == '__main__':
    unittest.main()
