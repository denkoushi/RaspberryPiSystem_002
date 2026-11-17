"""Argument and lifecycle checks with fake Docker/Tailscale; never contact a host."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'scripts/server/pi5-replication.sh'
PGDATA = '/var/lib/postgresql/18/docker'
MANAGED_HBA = PGDATA + '/replication-primary-pg_hba.conf'
FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
a = sys.argv[1:]
p = pathlib.Path(os.environ['FIXTURE'])
with (p/'calls').open('a') as f:
    f.write(json.dumps(a)+'\n')
if a[0] == 'compose':
    if 'config' in a:
        if '--format' in a: print('{"name":"fixture"}')
    elif 'ps' in a: print('fixture-db')
    elif 'up' in a:
        if os.environ.get('FAIL_UP'): sys.exit(1)
        overlay = any(s.endswith('docker-compose.replication-primary.yml') for s in a)
        (p/'hba').write_text('replication-primary-pg_hba.conf' if overlay else 'pg_hba.conf')
    else: sys.exit('unexpected compose call')
elif a[0] == 'exec':
    if 'psql' in a:
        if '-c' not in a:
            statement = sys.stdin.read()
            if 'CREATE ROLE raspi_replicator' in statement:
                assert os.environ['PI5_REPLICATION_PASSWORD'] == "fixture-password-'\\value"
                (p/'bootstrap').touch()
            else: print('settings report|postmaster|f')
        else:
            q = a[a.index('-c')+1]
            if q == 'SELECT pg_is_in_recovery()': print('f')
            elif q == 'SHOW data_directory': print('/var/lib/postgresql/18/docker')
            elif q == 'SHOW hba_file':
                print('/var/lib/postgresql/18/docker/'+((p/'hba').read_text() if (p/'hba').exists() else 'pg_hba.conf'))
            elif "slot_type='physical'" in q: print(os.environ.get('PHYSICAL_SLOTS', '0'))
            elif "wal_status='lost'" in q: print(os.environ.get('LOST_SLOTS', '0'))
            elif 'pg_hba_file_rules' in q: print('0')
            elif "current_setting('synchronous_standby_names')" in q: print('t')
            elif 'pg_stat_replication' in q or 'pg_replication_slots' in q: pass
            else: sys.exit('unexpected SQL')
    else:
        hba = sys.stdin.read()
        assert 'host replication raspi_replicator 100.64.0.11/32 scram-sha-256' in hba
        assert 'include pg_hba.conf' in hba
        (p/'rendered-hba').write_text(hba)
elif a[0] == 'inspect': print('{}')
else: sys.exit('unexpected docker call')
'''


class Pi5ReplicationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name, code in (
            ('docker', FAKE_DOCKER), ('flock', '#!/bin/sh\nexit 0\n'),
            ('tailscale', '#!/bin/sh\necho 100.64.0.10\n'),
        ):
            p = self.bin / name
            p.write_text(code)
            p.chmod(0o755)
        for name in (
            'infrastructure/docker/docker-compose.replication-primary.yml',
            'infrastructure/docker/postgres/replication-primary-pg_hba.conf',
            'scripts/deploy/postgres-replication-bootstrap.sql',
        ):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.password = self.root / 'password'
        self.password.write_text("fixture-password-'\\value\n")
        self.password.chmod(0o600)
        self.env = dict(os.environ, PATH=str(self.bin)+':'+os.environ['PATH'], FIXTURE=str(self.root))
        self.marker = self.root / 'config/pi5-replication-primary'
        self.ips = ['--primary-ip', '100.64.0.10', '--standby-ip', '100.64.0.11']

    def run_cli(self, action, *args):
        return subprocess.run(['bash', str(SCRIPT), action, '--project-dir', str(self.root), *args],
                              env=self.env, capture_output=True, text=True)

    def calls(self):
        path = self.root / 'calls'
        return [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []

    def assert_rejected(self, action, *args):
        r = self.run_cli(action, *args)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.calls(), [], r.stderr)

    def apply(self):
        return self.run_cli('apply', '--yes', *self.ips, '--password-file', str(self.password))

    def test_help_and_unknown_subcommand(self):
        self.assertEqual(self.run_cli('--help').returncode, 0)
        self.assert_rejected('unknown')

    def test_mutations_require_confirmation(self):
        for action in ('apply', 'remove'):
            with self.subTest(action=action): self.assert_rejected(action)

    def test_missing_option_values(self):
        for option in ('--project-dir', '--env-file', '--primary-ip', '--standby-ip', '--password-file'):
            with self.subTest(option=option): self.assert_rejected('plan', option)

    def test_unknown_option(self):
        self.assert_rejected('status', '--unknown')

    def test_invalid_ips(self):
        for value in ('', '0.0.0.0', '192.0.2.1', '::1', '100.64.0.11', '100.64.0.1/32', '100.64.0.1;bad'):
            with self.subTest(value=value):
                self.assert_rejected('plan', '--primary-ip', value, '--standby-ip', '100.64.0.11')

    def test_options_restricted_by_subcommand(self):
        self.assert_rejected('status', '--yes')
        self.assert_rejected('remove', '--yes', *self.ips)
        self.assert_rejected('plan', *self.ips, '--password-file', str(self.password))
        self.assert_rejected('apply', '--yes', *self.ips)

    def test_unprotected_and_multiline_password_rejected(self):
        self.password.chmod(0o644)
        self.assert_rejected('apply', '--yes', *self.ips, '--password-file', str(self.password))
        self.password.chmod(0o600)
        for text in ('', 'first\nsecond\n', 'crlf\r\n'):
            self.password.write_text(text)
            self.assert_rejected('apply', '--yes', *self.ips, '--password-file', str(self.password))

    def test_plan_is_read_only_and_displays_restart(self):
        r = self.run_cli('plan', *self.ips)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('postmaster', r.stdout)
        self.assertIn('recreates db even if values match', r.stdout)
        self.assertFalse(self.marker.exists())
        self.assertFalse(any('up' in a for a in self.calls()))

    def test_apply_is_idempotent_and_keeps_secrets_off_command_line(self):
        for _ in range(2):
            r = self.apply()
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertNotIn(self.password.read_text().strip(), r.stdout+r.stderr)
        self.assertTrue((self.root/'bootstrap').exists())
        self.assertTrue((self.marker/'primary.env').exists())
        self.assertNotIn(self.password.read_text().strip(), (self.root/'calls').read_text())
        up = [a for a in self.calls() if 'up' in a]
        self.assertTrue(all(any(s.endswith('docker-compose.replication-primary.yml') for s in a) for a in up))

    def test_failed_apply_keeps_marker_and_remove_recovers(self):
        self.env['FAIL_UP'] = '1'
        self.assertNotEqual(self.apply().returncode, 0)
        self.assertTrue(self.marker.exists())
        del self.env['FAIL_UP']
        r = self.run_cli('remove', '--yes')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.marker.exists())
        self.assertTrue(self.password.exists())
        for a in self.calls():
            self.assertFalse(any(s in a for s in ('down', '--volumes', 'volume', 'rm')))

    def test_remove_refuses_remaining_slots_and_preserves_marker(self):
        self.assertEqual(self.apply().returncode, 0)
        self.env['PHYSICAL_SLOTS'] = '1'
        r = self.run_cli('remove', '--yes')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('Retire physical replication slots', r.stderr)
        self.assertTrue(self.marker.exists())
        self.assertEqual(len([a for a in self.calls() if 'up' in a]), 1)

    def test_failed_remove_retains_marker(self):
        self.assertEqual(self.apply().returncode, 0)
        self.env['FAIL_UP'] = '1'
        self.assertNotEqual(self.run_cli('remove', '--yes').returncode, 0)
        self.assertTrue(self.marker.exists())

    def test_nonlocal_primary_ip_cannot_publish(self):
        (self.bin/'tailscale').write_text('#!/bin/sh\necho 100.64.0.20\n')
        r = self.apply()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('not assigned by local Tailscale', r.stderr)
        self.assertFalse(self.marker.exists())
        self.assertFalse(any('up' in a for a in self.calls()))

    def test_status_lost_wal_is_a_stop_condition(self):
        self.env['LOST_SLOTS'] = '1'
        r = self.run_cli('status')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('rebuild the standby', r.stderr)
        self.assertFalse(any('up' in a for a in self.calls()))

    def test_hba_has_only_one_restricted_allow_before_original(self):
        text = (ROOT/'infrastructure/docker/postgres/replication-primary-pg_hba.conf').read_text()
        rules = [s.split() for s in text.splitlines() if s and not s.startswith('#')]
        allows = [r for r in rules if r[0] != 'include' and r[-1] != 'reject']
        self.assertEqual(allows, [['host', 'replication', 'raspi_replicator', '@STANDBY_IP@/32', 'scram-sha-256']])
        self.assertEqual(rules[-1], ['include', 'pg_hba.conf'])
        self.assertIn(['host', 'replication', 'all', '0.0.0.0/0', 'reject'], rules)


if __name__ == '__main__':
    unittest.main()
