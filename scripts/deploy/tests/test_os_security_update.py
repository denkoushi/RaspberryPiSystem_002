import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    'os_security_update', ROOT / 'scripts/os-security-update/raspi-os-security-update.py')
UPDATER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPDATER)
REAL_COMMAND = UPDATER.command


def version(number, origin='Debian', label='Debian-Security'):
    return {'version': number, 'origins': [{'origin': origin, 'label': label}]}


def rpi(number):
    return version(number, 'Raspberry Pi Foundation', 'Raspberry Pi Foundation')


def package(name, candidate, versions=(), installed='1'):
    return {'name': name, 'installed': installed, 'candidate': candidate,
            'versions': list(versions)}


class SelectorTests(unittest.TestCase):
    def select(self, packages, blacklist=None, allowlist=None):
        # Version ordering is supplied by apt_pkg in production. These fixtures
        # use numeric installed versions; no python3-apt is needed here.
        return UPDATER.select_updates(packages,
                                      UPDATER.DEFAULT_BLACKLIST if blacklist is None else blacklist,
                                      UPDATER.DEFAULTS['allowlist'] if allowlist is None else allowlist,
                                      lambda left, right: (left > right) - (left < right))

    def test_security_candidate_and_only_newer_installed_packages(self):
        selected, held = self.select([
            package('openssl', version('2')),
            package('not-installed', version('2'), installed=None),
            package('same', version('1')), package('downgrade', version('0')),
            package('no-candidate', None),
            package('base-suite', version('2', label='Debian')),
            package('spoof-label', version('2', origin='Other')),
        ])
        self.assertEqual(selected, [{'name': 'openssl', 'from': '1', 'to': '2'}])
        self.assertEqual(held, [])

    def test_rpi_security_twins_strip_epoch_and_only_trailing_rpt(self):
        for name, candidate, twin in [
            ('openssl', '3.5.7-1~deb13u3+rpt1', '3.5.7-1~deb13u3'),
            ('chromium', '1:155.0.8059.79-1~deb13u1+rpt1', '155.0.8059.79-1~deb13u1'),
            ('vlc', '1:3.0.24-0+deb13u1+rpt2', '2:3.0.24-0+deb13u1'),
        ]:
            with self.subTest(name=name):
                self.assertTrue(UPDATER.eligible_candidate(name, rpi(candidate), [version(twin)], []))
        self.assertFalse(UPDATER.eligible_candidate('openssl', rpi('3+rpt1+other'), [version('3')], []))

    def test_rpi_only_updates_are_excluded(self):
        for name in ('wf-panel-pi', 'pipewire', 'rpd-theme', 'libcamera0', 'rpicam-apps',
                     'gui-updater', 'rpi-connect'):
            self.assertFalse(UPDATER.eligible_candidate(name, rpi('3+rpt4'),
                                                       [version('2'), version('3', label='Debian')], []))

    def test_browser_allowlist_is_origin_restricted(self):
        for name in ('chromium', 'chromium-common', 'rpi-chromium-mods'):
            self.assertTrue(UPDATER.eligible_candidate(name, rpi('3'), [], UPDATER.DEFAULTS['allowlist']))
            self.assertFalse(UPDATER.eligible_candidate(name, version('3', 'Other'), [], UPDATER.DEFAULTS['allowlist']))
        self.assertFalse(UPDATER.eligible_candidate('rpi-chromium-mods-extra', rpi('3'), [], UPDATER.DEFAULTS['allowlist']))

    def test_blacklist_wins_over_security_twins_and_allowlist(self):
        selected, held = self.select([package('chromium', rpi('3+rpt1'), [version('3')]),
                                      package('openssl', version('3'))], ['^chromium', '^openssl$'])
        self.assertEqual(selected, [])
        self.assertEqual(held, ['chromium', 'openssl'])
        for name in ('docker-ce', 'docker-ce-cli', 'docker-ce-rootless-extras', 'containerd.io',
                     'docker-buildx-plugin', 'docker-compose-plugin', 'tailscale', 'linux-image-rpi',
                     'linux-headers-rpi', 'linux-kbuild-6.12', 'raspi-firmware', 'raspberrypi-kernel',
                     'raspberrypi-bootloader', 'rpi-eeprom-images', 'firmware-brcm80211', 'initramfs-tools-core'):
            self.assertTrue(UPDATER.matches(name, UPDATER.DEFAULT_BLACKLIST), name)
        for name in ('chromium', 'openssl', 'containerdXio'):
            self.assertFalse(UPDATER.matches(name, UPDATER.DEFAULT_BLACKLIST), name)

    def test_simulation_checks_transitive_protected_changes_and_removals(self):
        self.assertEqual(UPDATER.simulation_failure('Inst openssl [1] (2 Debian)\nInst docker-ce:arm64 [1] (2)',
                                                   UPDATER.DEFAULT_BLACKLIST), 'blocked_by_protected_package')
        self.assertEqual(UPDATER.simulation_failure('Remv old-library [1]', []), 'would_remove_packages')
        self.assertIsNone(UPDATER.simulation_failure('Inst openssl [1] (2)\nConf openssl (2)', UPDATER.DEFAULT_BLACKLIST))

    def test_night_window_boundaries_and_midnight_wrap(self):
        self.assertEqual([UPDATER.in_night_window(hour, 0, 5) for hour in (0, 4, 5, 23)],
                         [True, True, False, False])
        self.assertEqual([UPDATER.in_night_window(hour, 23, 2) for hour in (22, 23, 0, 1, 2)],
                         [False, True, True, True, False])

    def test_release_marker_age(self):
        self.assertFalse(UPDATER.release_is_active(None, 20000, 14400))
        self.assertFalse(UPDATER.release_is_active(5600, 20000, 14400))
        self.assertTrue(UPDATER.release_is_active(5601, 20000, 14400))
        self.assertTrue(UPDATER.release_is_active(21000, 20000, 14400))

    def test_state_contract_carry_over(self):
        previous = UPDATER.next_state({}, 'dry-run', 'success', 'first', selected=[{'name': 'openssl'}])
        for result in ('skipped_locked', 'skipped_window', 'skipped_release'):
            state = UPDATER.next_state(previous, 'apply', result, 'later')
            self.assertEqual({k: v for k, v in state.items() if k not in ('result', 'lastRunAt')},
                             {k: v for k, v in previous.items() if k not in ('result', 'lastRunAt')})
        failed = UPDATER.next_state(previous, 'apply', 'failed', 'failure', 'apt_update_failed')
        self.assertEqual(failed['lastFailureAt'], 'failure')
        self.assertEqual(failed['lastSuccessAt'], 'first')
        success = UPDATER.next_state(failed, 'apply', 'success', 'recovered')
        self.assertEqual(success['lastFailureAt'], 'failure')
        self.assertEqual(success['lastSuccessAt'], 'recovered')
        self.assertEqual(success['enabledAt'], 'first')
        self.assertEqual(set(success), {'schemaVersion', 'mode', 'result', 'reason', 'lastRunAt',
                                      'lastSuccessAt', 'lastFailureAt', 'enabledAt', 'installed',
                                      'selected', 'heldBack', 'browserRestarted'})


class RunTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.config = {**copy.deepcopy(UPDATER.DEFAULTS), 'mode': 'apply',
                       'stateDir': str(self.root / 'state'), 'lockPath': str(self.root / 'lock'),
                       'releaseMarker': str(self.root / 'active'), 'browserUnit': 'kiosk-browser.service'}
        self.state_path = Path(self.config['stateDir']) / 'state.json'
        self.selected = [{'name': 'chromium', 'from': '1', 'to': '2'}]
        self.calls = []
        self.before_after = iter(['1', '2'])
        self.fail = None
        self.simulation = 'Inst chromium [1] (2 Debian-Security)'
        self.log = self.root / 'update.log'
        self.patches = [mock.patch.object(UPDATER, 'LOG_PATH', self.log),
                        mock.patch.object(UPDATER, 'apt_selection', return_value=(self.selected, ['docker-ce'])),
                        mock.patch.object(UPDATER, 'command', side_effect=self.command),
                        mock.patch.object(UPDATER, 'in_night_window', return_value=True)]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)

    def command(self, argv):
        self.calls.append(argv)
        if argv[0] == 'dpkg-query':
            return SimpleNamespace(returncode=0, stdout=next(self.before_after))
        label = ('simulation' if '-s' in argv else 'install') if argv[0] == 'apt-get' and 'install' in argv else argv[1]
        return SimpleNamespace(returncode=1 if self.fail == label else 0,
                               stdout=self.simulation if label == 'simulation' else '')

    def state(self):
        return json.loads(self.state_path.read_text())

    def test_apply_pins_versions_and_restarts_only_changed_active_browser(self):
        self.assertEqual(UPDATER.run(self.config), 0)
        state = self.state()
        self.assertEqual(state['installed'], self.selected)
        self.assertTrue(state['browserRestarted'])
        install = next(call for call in self.calls if 'install' in call and '-y' in call)
        self.assertEqual(install[-1], 'chromium=2')
        for option in ('--only-upgrade', '--no-install-recommends', 'Dpkg::Options::=--force-confold',
                       'Dpkg::Options::=--force-confdef', 'DPkg::Lock::Timeout=600'):
            self.assertIn(option, install)
        self.assertEqual([call for call in self.calls if call[0] == 'systemctl'],
                         [['systemctl', 'is-active', 'kiosk-browser.service'],
                          ['systemctl', 'restart', 'kiosk-browser.service']])
        self.assertEqual(self.state_path.stat().st_mode & 0o777, 0o644)
        self.assertEqual(list(self.state_path.parent.glob('.state-*')), [])
        self.assertEqual(len(self.log.read_text().splitlines()), 1)
        datetime.fromisoformat(state['lastSuccessAt'])

    def test_dry_run_simulates_but_never_installs_or_restarts(self):
        self.config['mode'] = 'dry-run'
        self.assertEqual(UPDATER.run(self.config), 0)
        self.assertEqual(self.state()['selected'], self.selected)
        self.assertEqual(self.state()['installed'], [])
        self.assertEqual(len(self.calls), 2)
        self.assertIn('-s', self.calls[-1])

    def test_empty_selection_only_refreshes_metadata(self):
        with mock.patch.object(UPDATER, 'apt_selection', return_value=([], [])):
            self.assertEqual(UPDATER.run(self.config), 0)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.state()['result'], 'success')

    def test_each_command_failure_is_reported_and_stops(self):
        for failure, reason in [('update', 'apt_update_failed'), ('simulation', 'apt_simulation_failed'),
                                ('install', 'apt_install_failed'), ('restart', 'browser_restart_failed')]:
            with self.subTest(failure=failure):
                self.calls.clear()
                self.before_after = iter(['1', '2'])
                self.fail = failure
                self.assertEqual(UPDATER.run(self.config), 1)
                self.assertEqual(self.state()['reason'], reason)
                self.assertIsNotNone(self.state()['lastFailureAt'])
                self.assertFalse(self.state()['browserRestarted'])
                if failure != 'restart':
                    self.assertFalse(any(call[0] == 'systemctl' for call in self.calls))

    def test_simulation_gate_blocks_apply_and_dry_run(self):
        for mode in ('apply', 'dry-run'):
            for output, reason in [('Inst linux-image-rpi:arm64 [1] (2)', 'blocked_by_protected_package'),
                                   ('Remv libc6 [1]', 'would_remove_packages')]:
                self.config['mode'] = mode
                self.simulation = output
                self.calls.clear()
                self.assertEqual(UPDATER.run(self.config), 1)
                self.assertEqual(self.state()['reason'], reason)
                self.assertEqual(len(self.calls), 2)

    def test_unchanged_inactive_or_unconfigured_browser_is_not_restarted(self):
        for before, after, unit, inactive in [('1', '1', 'kiosk-browser.service', False),
                                             ('1', '2', '', False),
                                             ('1', '2', 'kiosk-browser.service', True)]:
            self.calls.clear()
            self.before_after = iter([before, after])
            self.config['browserUnit'] = unit
            self.fail = 'is-active' if inactive else None
            self.assertEqual(UPDATER.run(self.config), 0)
            self.assertFalse(self.state()['browserRestarted'])
            self.assertFalse(any(call[:2] == ['systemctl', 'restart'] for call in self.calls))

    def test_real_lock_precedes_window_and_release_guards_even_with_force(self):
        self.assertEqual(UPDATER.run(self.config), 0)
        previous = self.state()
        self.calls.clear()
        with open(self.config['lockPath'], 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(UPDATER.run(self.config, force=True), 0)
        self.assertEqual(self.state()['result'], 'skipped_locked')
        self.assertEqual(self.state()['lastSuccessAt'], previous['lastSuccessAt'])
        self.assertEqual(self.calls, [])

    def test_window_force_and_release_guard_order(self):
        Path(self.config['releaseMarker']).touch()
        with mock.patch.object(UPDATER, 'in_night_window', return_value=False):
            self.assertEqual(UPDATER.run(self.config), 0)
            self.assertEqual(self.state()['result'], 'skipped_window')
            self.assertEqual(UPDATER.run(self.config, force=True), 0)
            self.assertEqual(self.state()['result'], 'skipped_release')
        self.assertEqual(self.calls, [])
        os.utime(self.config['releaseMarker'], (0, 0))
        self.assertEqual(UPDATER.run(self.config, force=True), 0)
        self.assertEqual(self.state()['result'], 'success')

    def test_locked_skip_cannot_overwrite_a_concurrent_success_timestamp(self):
        writing, skip_waiting, release_writer = (threading.Event() for _ in range(3))
        real_write, real_flock = UPDATER.write_state, fcntl.flock

        def slow_write(path, state):
            if state['result'] == 'success':
                writing.set()
                self.assertTrue(release_writer.wait(5))
            real_write(path, state)

        def observe_lock(file, operation):
            if operation == fcntl.LOCK_EX and writing.is_set():
                skip_waiting.set()
            return real_flock(file, operation)

        with mock.patch.object(UPDATER, 'write_state', side_effect=slow_write), \
             mock.patch.object(fcntl, 'flock', side_effect=observe_lock), \
             ThreadPoolExecutor(max_workers=2) as executor:
            active = executor.submit(UPDATER.run, self.config)
            try:
                self.assertTrue(writing.wait(5))
                skipped = executor.submit(UPDATER.run, self.config)
                self.assertTrue(skip_waiting.wait(5))
            finally:
                release_writer.set()
            self.assertEqual(active.result(timeout=5), 0)
            self.assertEqual(skipped.result(timeout=5), 0)
        self.assertEqual(self.state()['result'], 'skipped_locked')
        self.assertIsNotNone(self.state()['lastSuccessAt'])
        self.assertEqual(self.state()['installed'], self.selected)

    def test_subprocess_environment_suppresses_daemon_restarts(self):
        with mock.patch.object(UPDATER.subprocess, 'run') as process:
            # Exercise the actual subprocess adapter, not the per-run fake.
            REAL_COMMAND(['apt-get', 'install', 'openssl=2'])
        env = process.call_args.kwargs['env']
        for key, expected in [('DEBIAN_FRONTEND', 'noninteractive'), ('NEEDRESTART_MODE', 'l'),
                              ('NEEDRESTART_SUSPEND', '1'), ('APT_LISTCHANGES_FRONTEND', 'none'), ('LC_ALL', 'C')]:
            self.assertEqual(env[key], expected)


if __name__ == '__main__':
    unittest.main()
