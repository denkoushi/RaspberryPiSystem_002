"""Focused deployment admission and exact argv tests; no host/secret access."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pi5_server_compose as module


class Pi5ServerComposeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.compose = self.root / 'infrastructure/docker'
        (self.compose / 'postgres').mkdir(parents=True)
        self.overlay = self.compose / 'docker-compose.replication-primary.yml'
        self.hba = self.compose / 'postgres/replication-primary-pg_hba.conf'
        self.overlay.touch()
        self.hba.touch()
        self.secret = self.root / 'password'
        self.secret.touch()
        self.marker = self.root / 'config/pi5-replication-primary'
        self.base = ['docker', 'compose', '--env-file', str(self.compose / '.env'),
                     '-f', str(self.compose / 'docker-compose.server.yml')]
        self.model = {'services': {'db': {'environment': {
            'POSTGRES_PASSWORD_FILE': '/run/secrets/password'}, 'volumes': [
                {'type': 'bind', 'target': '/run/secrets/password', 'source': str(self.secret)}]}}}
        self.state = dict(primary=True, wal_level='replica', max_wal_senders='10',
                          max_replication_slots='10', max_slot_wal_keep_size=-1,
                          synchronous_standby_names='', hba_file='/data/pg_hba.conf', pending=False)

    def mark(self):
        self.marker.mkdir(parents=True)
        (self.marker / 'primary.env').write_text(
            'PI5_REPLICATION_PRIMARY_IP=100.64.0.10\nPI5_REPLICATION_STANDBY_IP=100.64.0.11\n')

    def enable(self):
        self.mark()
        self.state.update(max_wal_senders='4', max_replication_slots='4',
                          max_slot_wal_keep_size=1073741824,
                          hba_file='/var/lib/postgresql/18/docker/replication-primary-pg_hba.conf')

    def check(self):
        argv = module.resolve_server_compose(self.root, self.base)
        def read(command):
            if 'config' in command: return json.dumps(self.model)
            if 'ps' in command: return 'fixture-db'
            if 'psql' in command: return json.dumps(self.state)
            if 'test' in command: return ''
            raise AssertionError(command)
        with patch.object(module, '_read_command', side_effect=read):
            module.check_runtime(self.root, argv)

    def test_unmarked_argv_is_exactly_unchanged(self):
        self.assertEqual(module.resolve_server_compose(self.root, self.base), self.base)
        self.check()  # PG18 defaults (including wal_level=replica) are admitted.

    def test_marked_argv_carries_saved_addresses_and_overlay(self):
        self.enable()
        self.assertEqual(module.resolve_server_compose(self.root, self.base), self.base + [
            '--env-file', str(self.marker / 'primary.env'), '-f', str(self.overlay)])
        self.check()

    def test_missing_overlay_hba_or_marker_env_stops_before_docker(self):
        self.mark()
        for path in (self.overlay, self.hba, self.marker / 'primary.env'):
            content = path.read_text()
            path.unlink()
            with self.subTest(path=path), self.assertRaises(module.ReplicationContractError):
                module.resolve_server_compose(self.root, self.base)
            path.write_text(content)

    def test_incomplete_or_invalid_address_marker_is_rejected(self):
        self.mark()
        for content in ('', 'PI5_REPLICATION_PRIMARY_IP=127.0.0.1\n',
                        'PI5_REPLICATION_PRIMARY_IP=100.64.0.10\nPI5_REPLICATION_STANDBY_IP=100.64.0.10\n'):
            (self.marker / 'primary.env').write_text(content)
            with self.subTest(content=content), self.assertRaises(module.ReplicationContractError):
                module.resolve_server_compose(self.root, self.base)

    def test_missing_secret_is_rejected_without_opening_it(self):
        self.enable()
        self.secret.unlink()
        with self.assertRaisesRegex(module.ReplicationContractError, 'secret file is missing'):
            self.check()

    def test_required_secret_is_only_statted(self):
        self.enable()
        original = Path.open
        def guarded(path, *args, **kwargs):
            self.assertNotEqual(path, self.secret)
            return original(path, *args, **kwargs)
        with patch.object(Path, 'open', guarded):
            self.check()

    def test_marker_with_each_mismatching_runtime_setting_is_rejected(self):
        self.enable()
        enabled = dict(self.state)
        for key, value in dict(primary=False, wal_level='minimal', max_wal_senders='10',
                               max_replication_slots='10', max_slot_wal_keep_size=-1,
                               synchronous_standby_names='standby', hba_file='/data/pg_hba.conf',
                               pending=True).items():
            self.state = {**enabled, key: value}
            with self.subTest(setting=key), self.assertRaises(module.ReplicationContractError):
                self.check()

    def test_unmarked_runtime_check_is_a_no_op(self):
        with patch.object(module, '_read_command', side_effect=AssertionError('no Docker call')):
            module.check_runtime(self.root, self.base)

    def test_missing_generated_hba_is_rejected(self):
        self.enable()
        with patch.object(module, '_read_command', side_effect=[
            json.dumps(self.model), 'fixture-db', json.dumps(self.state),
            module.ReplicationContractError('missing HBA')]):
            with self.assertRaises(module.ReplicationContractError):
                module.check_runtime(self.root, self.base)

    def test_missing_or_multiple_db_is_rejected(self):
        self.enable()
        for cid in ('', 'one\ntwo'):
            with self.subTest(cid=cid), patch.object(module, '_read_command', side_effect=[json.dumps(self.model), cid]):
                with self.assertRaises(module.ReplicationContractError):
                    module.check_runtime(self.root, self.base)

    def test_lifecycle_destination_modes_recover_incomplete_marker(self):
        self.mark()
        (self.marker / 'primary.env').unlink()
        self.assertEqual(module.resolve_server_compose(self.root, self.base, mode='base'), self.base)
        self.assertEqual(module.resolve_server_compose(self.root, self.base, mode='apply'),
                         self.base + ['-f', str(self.overlay)])

    def test_diagnostics_do_not_echo_compose_or_sql_output(self):
        from types import SimpleNamespace
        with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(
            returncode=1, stdout='fixture-secret', stderr='fixture-secret')):
            with self.assertRaises(module.ReplicationContractError) as error:
                module._read_command(self.base)
            self.assertNotIn('fixture-secret', str(error.exception))


if __name__ == '__main__':
    unittest.main()
