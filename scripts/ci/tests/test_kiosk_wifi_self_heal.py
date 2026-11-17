import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
ROLE = ROOT / 'infrastructure/ansible/roles/kiosk'
TEMPLATES = ROLE / 'templates'
SCRIPT = TEMPLATES / 'kiosk-wifi-self-heal.sh.j2'
PI5_IP = '192.168.10.230'


class KioskWifiSelfHealTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin_dir = self.root / 'bin'
        self.bin_dir.mkdir()
        self.net_dir = self.root / 'net'
        (self.net_dir / 'wlan0').mkdir(parents=True)
        self.uptime = self.root / 'uptime'
        self.uptime.write_text('300.00 100.00\n')
        self.state = self.root / 'state'
        self.history = self.root / 'persistent/reboots'
        self.calls = self.root / 'calls.jsonl'
        self.logs = self.root / 'logs.jsonl'
        self.script = self.root / 'watchdog.sh'
        self.script.write_text(SCRIPT.read_text().replace(
            '{{ local_network.raspberrypi5_ip }}', PI5_IP))
        stub = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
command = Path(sys.argv[0]).name
args = sys.argv[1:]
output = 'STUB_LOGS' if command == 'logger' else 'STUB_CALLS'
with open(os.environ[output], 'a') as stream:
    stream.write(json.dumps([command] + args) + '\\n')
if command == 'nmcli':
    if args == ['-g', 'GENERAL.STATE', 'device', 'show', 'wlan0']:
        print(os.environ['STUB_DEVICE_STATE'])
        sys.exit(int(os.environ.get('STUB_NMCLI_RC', '0')))
    elif args == ['device', 'disconnect', 'wlan0']:
        sys.exit(int(os.environ.get('STUB_DISCONNECT_RC', '0')))
    elif args == ['--wait', '45', 'device', 'connect', 'wlan0']:
        sys.exit(int(os.environ.get('STUB_CONNECT_RC', '0')))
    else:
        sys.exit(99)
elif command == 'ip':
    assert args == ['-4', 'route', 'show', 'default', 'dev', 'wlan0']
    print(os.environ['STUB_ROUTE'])
elif command == 'ping':
    assert len(args) == 7 and args[:6] == ['-c', '3', '-W', '2', '-I', 'wlan0']
    sys.exit(0 if args[-1] in os.environ['STUB_REACHABLE'].split() else 1)
elif command == 'systemctl':
    assert args == ['reboot']
    assert os.environ['NOW_SECONDS'] in Path(os.environ['REBOOT_HISTORY_FILE']).read_text().splitlines()
    sys.exit(int(os.environ.get('STUB_REBOOT_RC', '0')))
'''
        for name in ('nmcli', 'ping', 'ip', 'logger', 'systemctl'):
            path = self.bin_dir / name
            path.write_text(stub)
            path.chmod(0o755)
        self.env = dict(os.environ,
                        PATH=str(self.bin_dir) + os.pathsep + os.environ['PATH'],
                        NET_CLASS_DIR=str(self.net_dir), UPTIME_FILE=str(self.uptime),
                        STATE_DIR=str(self.state), REBOOT_HISTORY_FILE=str(self.history),
                        NOW_SECONDS='200000', STUB_CALLS=str(self.calls), STUB_LOGS=str(self.logs),
                        STUB_DEVICE_STATE='100 (connected)',
                        STUB_ROUTE='default via 192.168.10.1 dev wlan0 proto dhcp',
                        STUB_REACHABLE='')

    def run_watchdog(self, now=None):
        if now is not None:
            self.env['NOW_SECONDS'] = str(now)
        for path in (self.calls, self.logs):
            if path.exists():
                path.unlink()
        result = subprocess.run(['/bin/bash', str(self.script)], env=self.env,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []
        logs = [json.loads(line) for line in self.logs.read_text().splitlines()] if self.logs.exists() else []
        for log in logs:
            self.assertEqual(log[:3], ['logger', '-t', 'kiosk-wifi-self-heal'])
            self.assertNotIn('\n', log[3])
        return calls, logs

    def seed_state(self):
        self.state.mkdir(exist_ok=True)
        (self.state / 'first_failure').write_text('199400\n')
        (self.state / 'reconnected').write_text('199700\n')

    def write_history(self, timestamps):
        self.history.parent.mkdir(exist_ok=True)
        self.history.write_text(''.join(f'{value}\n' for value in timestamps))

    def assert_no_action(self, calls):
        self.assertFalse(any(call[0] == 'systemctl' or
                             (call[0] == 'nmcli' and 'GENERAL.STATE' not in call) for call in calls))

    def test_bash_syntax(self):
        self.assertNotIn('{{', self.script.read_text())
        self.assertIn('export LC_ALL=C', self.script.read_text())
        subprocess.run(['/bin/bash', '-n', str(self.script)], check=True)

    def test_task_and_delivery_contract(self):
        tasks = (ROLE / 'tasks/wifi-self-heal.yml').read_text()
        for suffix, dest in (('sh', '/usr/local/bin'), ('service', '/etc/systemd/system'),
                             ('timer', '/etc/systemd/system')):
            self.assertTrue((TEMPLATES / f'kiosk-wifi-self-heal.{suffix}.j2').is_file())
            self.assertIn(f'src: kiosk-wifi-self-heal.{suffix}.j2', tasks)
            self.assertIn(f'dest: {dest}/kiosk-wifi-self-heal.{suffix}', tasks)
        self.assertIn("mode: '0755'", tasks)
        self.assertEqual(tasks.count("mode: '0644'"), 2)
        self.assertEqual(tasks.count('owner: root'), 3)
        self.assertRegex(tasks, r'daemon_reload:\s*true')
        self.assertIn('enabled: "{{ kiosk_wifi_self_heal_enabled | bool }}"', tasks)
        self.assertIn("'started' if (kiosk_wifi_self_heal_enabled | bool) else 'stopped'", tasks)
        self.assertIn('kiosk_wifi_self_heal_enabled: true', (ROLE / 'defaults/main.yml').read_text())
        self.assertIn('import_tasks: wifi-self-heal.yml', (ROLE / 'tasks/main.yml').read_text())
        release = (ROOT / 'infrastructure/ansible/roles/release_kiosk/tasks/main.yml').read_text()
        self.assertRegex(release, r'include_role:\n\s+name: kiosk\n\s+tasks_from: wifi-self-heal')
        standard = (ROOT / 'infrastructure/ansible/playbooks/deploy-release-standard.yml').read_text()
        self.assertIn('- role: release_kiosk', standard)
        self.assertIn("{{ local_network.raspberrypi5_ip }}", SCRIPT.read_text())
        self.assertNotIn('server_ip', SCRIPT.read_text())

    def test_units(self):
        timer = (TEMPLATES / 'kiosk-wifi-self-heal.timer.j2').read_text().splitlines()
        for line in ('OnBootSec=5min', 'OnUnitActiveSec=1min',
                     'Unit=kiosk-wifi-self-heal.service', 'WantedBy=timers.target'):
            self.assertIn(line, timer)
        service = (TEMPLATES / 'kiosk-wifi-self-heal.service.j2').read_text()
        for line in ('Type=oneshot', 'User=root', 'ExecStart=/usr/local/bin/kiosk-wifi-self-heal.sh'):
            self.assertIn(line, service.splitlines())
        self.assertNotIn('RemainAfterExit=yes', service)

    def test_healthy_is_silent(self):
        self.env['STUB_REACHABLE'] = f'192.168.10.1 {PI5_IP}'
        calls, logs = self.run_watchdog()
        self.assert_no_action(calls)
        self.assertEqual(logs, [])
        self.assertFalse(self.state.exists())
        self.assertEqual(sum(call[0] == 'ping' for call in calls), 2)

    def test_disconnected_clears_state(self):
        self.seed_state()
        self.env['STUB_DEVICE_STATE'] = '30 (disconnected)'
        calls, logs = self.run_watchdog()
        self.assertEqual(len(calls), 1)
        self.assertEqual(logs, [])
        self.assertEqual(list(self.state.iterdir()), [])

    def test_missing_wlan(self):
        (self.net_dir / 'wlan0').rmdir()
        self.assertEqual(self.run_watchdog(), ([], []))

    def test_missing_nmcli(self):
        (self.bin_dir / 'nmcli').unlink()
        self.env['PATH'] = str(self.bin_dir)
        self.assertEqual(self.run_watchdog(), ([], []))

    def test_early_boot(self):
        self.uptime.write_text('299.99 100.00\n')
        self.assertEqual(self.run_watchdog(), ([], []))

    def test_first_failure_only_records(self):
        calls, logs = self.run_watchdog()
        self.assert_no_action(calls)
        self.assertEqual((self.state / 'first_failure').read_text(), '200000\n')
        self.assertFalse((self.state / 'reconnected').exists())
        self.assertEqual(len(logs), 1)

    def test_staged_recovery_and_boundaries(self):
        self.run_watchdog(200000)
        calls, logs = self.run_watchdog(200299)
        self.assert_no_action(calls)
        self.assertEqual(logs, [])
        calls, logs = self.run_watchdog(200300)
        self.assertEqual(calls[-2:], [['nmcli', 'device', 'disconnect', 'wlan0'],
                                     ['nmcli', '--wait', '45', 'device', 'connect', 'wlan0']])
        self.assertEqual((self.state / 'reconnected').read_text(), '200300\n')
        calls, logs = self.run_watchdog(200599)
        self.assert_no_action(calls)
        calls, logs = self.run_watchdog(200600)
        self.assertEqual(calls[-1], ['systemctl', 'reboot'])
        self.assertEqual(self.history.read_text(), '200600\n')

    def test_hour_limit(self):
        self.seed_state()
        self.write_history([199999])
        calls, logs = self.run_watchdog()
        self.assert_no_action(calls)
        self.assertIn('limit reached', logs[0][3])
        self.assertEqual(self.history.read_text(), '199999\n')

    def test_day_limit(self):
        self.seed_state()
        self.write_history([120000, 150000, 190000])
        calls, logs = self.run_watchdog()
        self.assert_no_action(calls)
        self.assertIn('last 24h=3', logs[0][3])

    def test_expired_history_pruned_before_reboot(self):
        self.seed_state()
        self.write_history([100000, 150000, 190000])
        calls, logs = self.run_watchdog()
        self.assertEqual(calls[-1], ['systemctl', 'reboot'])
        self.assertEqual(self.history.read_text(), '150000\n190000\n200000\n')

    def test_either_target_clears_state(self):
        for reachable in ('192.168.10.1', PI5_IP):
            with self.subTest(reachable=reachable):
                self.seed_state()
                self.env['STUB_REACHABLE'] = reachable
                calls, logs = self.run_watchdog()
                self.assert_no_action(calls)
                self.assertEqual(logs, [])
                self.assertEqual(list(self.state.iterdir()), [])

    def test_missing_gateway_counts_as_failure(self):
        self.env['STUB_ROUTE'] = ''
        calls, logs = self.run_watchdog()
        self.assertEqual([call[-1] for call in calls if call[0] == 'ping'], [PI5_IP])
        self.assertIn('gateway=missing', logs[0][3])

    def test_missing_gateway_but_pi5_reachable(self):
        self.seed_state()
        self.env.update(STUB_ROUTE='', STUB_REACHABLE=PI5_IP)
        calls, logs = self.run_watchdog()
        self.assert_no_action(calls)
        self.assertEqual(logs, [])
        self.assertEqual(list(self.state.iterdir()), [])

    def test_failed_reconnect_is_recorded_without_retry(self):
        self.run_watchdog()
        self.env.update(STUB_CONNECT_RC='10', STUB_DISCONNECT_RC='10')
        calls, logs = self.run_watchdog(200300)
        self.assertEqual(sum('connect' in call for call in calls), 1)
        self.assertTrue((self.state / 'reconnected').exists())
        self.assertIn('failed: rc=10', logs[-1][3])

    def test_history_write_failure_blocks_reboot(self):
        self.seed_state()
        self.history.parent.mkdir()
        self.history.with_suffix('.tmp').mkdir()
        calls, logs = self.run_watchdog()
        self.assert_no_action(calls)
        self.assertIn('command failed', logs[-1][3])

    def test_invalid_history_blocks_reboot(self):
        self.seed_state()
        self.write_history(['invalid'])
        calls, logs = self.run_watchdog()
        self.assert_no_action(calls)
        self.assertIn('invalid reboot history', logs[-1][3])

    def test_nmcli_failure_returns_zero(self):
        self.env['STUB_NMCLI_RC'] = '10'
        calls, logs = self.run_watchdog()
        self.assert_no_action(calls)
        self.assertIn('command failed rc=10', logs[-1][3])

    def test_reboot_failure_returns_zero(self):
        self.seed_state()
        self.env['STUB_REBOOT_RC'] = '1'
        calls, logs = self.run_watchdog()
        self.assertEqual(calls[-1], ['systemctl', 'reboot'])
        self.assertEqual(self.history.read_text(), '200000\n')
        self.assertIn('command failed rc=1', logs[-1][3])


if __name__ == '__main__':
    unittest.main()
