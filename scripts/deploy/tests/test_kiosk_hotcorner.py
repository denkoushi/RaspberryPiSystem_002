from pathlib import Path
import runpy
import signal
import stat
import subprocess
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[3] / 'infrastructure/ansible/roles/release_kiosk/files/kiosk-hotcorner.py'
HOTCORNER = runpy.run_path(str(SOURCE))
PanelPolicy = HOTCORNER['PanelPolicy']
PanelDaemon = HOTCORNER['PanelDaemon']
BUTTON = 1 << 8


class HotcornerPolicyTests(unittest.TestCase):
    def test_corner_dwell_and_single_show(self):
        policy = PanelPolicy()
        self.assertIsNone(policy.decide(3, 3, 0, 0, False))
        self.assertIsNone(policy.decide(3, 3, 0, 0.299, False))
        self.assertEqual(policy.decide(3, 3, 0, 0.3, False), 'show')
        self.assertIsNone(policy.decide(3, 3, 0, 0.4, True))
        self.assertIsNone(policy.decide(3, 3, 0, 0.5, False))

    def test_dwell_requires_continuous_corner_presence(self):
        policy = PanelPolicy()
        policy.decide(0, 0, 0, 0, False)
        policy.decide(4, 0, 0, 0.2, False)
        self.assertIsNone(policy.decide(0, 0, 0, 0.3, False))
        policy.decide(None, None, 0, 0.4, False)
        self.assertIsNone(policy.decide(0, 0, 0, 0.7, False))
        self.assertEqual(policy.decide(0, 0, 0, 1.1, False), 'show')

    def test_page_click_and_panel_click(self):
        for bit in range(8, 13):
            with self.subTest(button=bit):
                policy = PanelPolicy()
                self.assertIsNone(policy.decide(100, 79, 1 << bit, 0, True))
                self.assertEqual(policy.decide(100, 80, 1 << bit, 1, True), 'hide')
        self.assertIsNone(PanelPolicy().decide(100, 100, 1, 0, True))  # Shift isn't a button.

    def test_no_idle_hide_even_on_wayland_popup(self):
        policy = PanelPolicy()
        policy.decide(0, 0, 0, 0, False, True)
        for now in (1, 30, 60, 899):
            self.assertIsNone(policy.decide(None, None, 0, now, True))
        self.assertIsNone(policy.decide(200, 200, 0, 899.9, True))
        self.assertEqual(policy.decide(None, None, 0, 900, True), 'hide')

    def test_sigusr1_shows_once_and_uses_owned_panel(self):
        daemon = PanelDaemon()
        panel = mock.Mock()
        panel.poll.return_value = None
        with mock.patch.dict(PanelDaemon.step.__globals__, {
            'wayland_environment': lambda: {'WAYLAND_DISPLAY': 'wayland-0'},
        }), mock.patch('subprocess.Popen', return_value=panel) as spawn:
            daemon.request_show(signal.SIGUSR1, None)
            daemon.step(500, 500, 0, 0)
            spawn.assert_called_once_with(['/usr/bin/wf-panel-pi'], env={'WAYLAND_DISPLAY': 'wayland-0'},
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            daemon.request_show(signal.SIGUSR1, None)
            daemon.step(None, None, 0, 1)
            self.assertEqual(spawn.call_count, 1)
            daemon.step(500, 80, BUTTON, 2)
            panel.terminate.assert_called_once()

    def test_wayland_socket_discovery_ignores_lock_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'wayland-0.lock').touch()
            (path / 'wayland-0').touch()
            original_stat = Path.stat
            def file_stat(entry, **kwargs):
                if entry.name == 'wayland-0':
                    return SimpleNamespace(st_mode=stat.S_IFSOCK)
                return original_stat(entry, **kwargs)
            with mock.patch.object(Path, 'stat', file_stat), mock.patch.dict(
                'os.environ', {'XDG_RUNTIME_DIR': directory, 'WAYLAND_DISPLAY': 'wayland-1'}
            ):
                self.assertEqual(HOTCORNER['wayland_environment']()['WAYLAND_DISPLAY'], 'wayland-0')

    def test_foreign_respawner_stops_before_child_and_owned_panel_survives(self):
        remove = HOTCORNER['remove_foreign_panels']
        kill = mock.Mock()
        scans = mock.Mock(side_effect=[([10], [11, 12]), ([], [11, 12]), ([], [11, 12])])
        with mock.patch.dict(remove.__globals__, {'panel_processes': scans, 'terminate_pid': kill}), mock.patch('time.sleep'):
            remove(12)
        self.assertEqual(kill.call_args_list, [mock.call(10), mock.call(11)])

    def test_process_matching_ignores_unrelated_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            for pid, argv in {10: b'/usr/bin/lwrespawn\0/usr/bin/wf-panel-pi\0',
                              11: b'/usr/bin/wf-panel-pi\0',
                              12: b'/usr/bin/lwrespawn\0/usr/bin/pcmanfm-pi\0',
                              13: b'python3\0kiosk-hotcorner.py\0',
                              # Measured on the Pi4s: lwrespawn runs as a shell script.
                              14: b'/bin/sh\0/usr/bin/lwrespawn\0/usr/bin/wf-panel-pi\0',
                              15: b'/bin/sh\0/usr/bin/lwrespawn\0/usr/bin/pcmanfm-pi\0'}.items():
                entry = Path(directory) / str(pid)
                entry.mkdir()
                (entry / 'cmdline').write_bytes(argv)
            respawners, panels = HOTCORNER['panel_processes'](Path(directory))
            self.assertEqual((sorted(respawners), panels), ([10, 14], [11]))

    def test_x_open_failure_is_fatal(self):
        lib = mock.Mock()
        lib.XOpenDisplay.return_value = None
        with mock.patch('ctypes.CDLL', return_value=lib), mock.patch('ctypes.util.find_library', return_value='X11'):
            with self.assertRaisesRegex(RuntimeError, 'Cannot open X display'):
                HOTCORNER['XPointer']()


if __name__ == '__main__':
    unittest.main()


def test_labwc_pid_finds_the_users_labwc(tmp_path):
    for pid, comm in (("12", "bash"), ("34", "labwc"), ("self", "x")):
        (tmp_path / pid).mkdir()
        (tmp_path / pid / "comm").write_text(comm + "\n")
    assert HOTCORNER['labwc_pid'](tmp_path) == 34
