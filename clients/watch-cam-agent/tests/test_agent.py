import io
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch
import urllib.error
import urllib.request

from watch_cam_agent.capture import capture, MAX_FRAME_BYTES
from watch_cam_agent.config import Config, load_config
from watch_cam_agent.main import run_loop
from watch_cam_agent.notify import sd_notify, watchdog_interval
from watch_cam_agent.sender import HttpClient

JPEG = b"\xff\xd8\xffdata\xff\xd9"
CONFIG = Config("https://example.test", "secret")


class ConfigTests(unittest.TestCase):
    def load(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config"
            path.write_text(text)
            with patch.dict(os.environ, WATCH_CAM_AGENT_CONFIG=str(path)):
                return load_config()

    def test_defaults(self):
        config = self.load('# comment\nAPI_BASE_URL="https://example.test/"\nX_CLIENT_KEY=secret\n')
        self.assertEqual(config, CONFIG)
        self.assertEqual(config.video_device, "/dev/video0")
        self.assertEqual(config.interval_sec, 10)
        self.assertNotIn("secret", repr(config))

    def test_overrides(self):
        config = self.load('API_BASE_URL=http://example.test:8080\nX_CLIENT_KEY=secret\n'
                           'TLS_SKIP_VERIFY=1\nVIDEO_DEVICE=/dev/video2\nINTERVAL_SEC=5\n')
        self.assertTrue(config.tls_skip_verify)
        self.assertEqual(config.video_device, "/dev/video2")
        self.assertEqual(config.interval_sec, 5)

    def test_invalid_config(self):
        base = 'API_BASE_URL=https://example.test\nX_CLIENT_KEY=secret\n'
        for text in ('X_CLIENT_KEY=secret', 'API_BASE_URL=https://example.test',
                     base + 'API_BASE_URL=https://example.test/api',
                     base + 'API_BASE_URL=https://user:secret@example.test',
                     base + 'API_BASE_URL=https://example.test:0',
                     base + 'TLS_SKIP_VERIFY=yes', base + 'INTERVAL_SEC=4',
                     base + 'INTERVAL_SEC=nan', base + 'INTERVAL_SEC=5.5',
                     base + 'VIDEO_DEVICE=', base + 'X_CLIENT_KEY="secret',
                     base + 'X_CLIENT_KEY="secret\t"', base + 'INVALID LINE'):
            with self.subTest(text=text), self.assertRaises(ValueError) as error:
                self.load(text)
            self.assertNotIn("secret", str(error.exception))


class CaptureTests(unittest.TestCase):
    def test_native_jpeg_and_command(self):
        run = Mock(return_value=SimpleNamespace(stdout=JPEG))
        self.assertIs(capture('/dev/video2', run), JPEG)
        args, kwargs = run.call_args
        self.assertEqual(args[0], ["v4l2-ctl", "--device", "/dev/video2",
                         "--set-fmt-video=width=640,height=480,pixelformat=MJPG",
                         "--stream-mmap", "--stream-skip=3", "--stream-count=1", "--stream-to=-"])
        self.assertEqual(kwargs, dict(stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                      timeout=15, check=True))

    def test_size_boundary_and_markers(self):
        frame = b'\xff\xd8\xff' + b'x' * (MAX_FRAME_BYTES - 5) + b'\xff\xd9'
        self.assertIs(capture('/dev/video0', Mock(return_value=SimpleNamespace(stdout=frame))), frame)
        for invalid in (b'', b'no jpeg', JPEG[:-1], b'x' + JPEG, frame + b'x'):
            with self.subTest(size=len(invalid)), self.assertRaises(ValueError):
                capture('/dev/video0', Mock(return_value=SimpleNamespace(stdout=invalid)))

    def test_camera_failures(self):
        for error in (FileNotFoundError(), subprocess.TimeoutExpired('v4l2-ctl', 15),
                      subprocess.CalledProcessError(1, 'v4l2-ctl')):
            with self.subTest(error=error), self.assertRaises(type(error)):
                capture('/dev/video0', Mock(side_effect=error))

    def test_padding_is_trimmed_after_last_end_marker(self):
        for frame in (JPEG, JPEG + b'\xff\xd9'):
            with self.subTest(frame=frame):
                run = Mock(return_value=SimpleNamespace(stdout=frame + b'\x00\x00padding'))
                self.assertEqual(capture('/dev/video0', run), frame)

    def test_padding_without_end_marker_is_rejected(self):
        run = Mock(return_value=SimpleNamespace(stdout=JPEG[:-2] + b'\x00\x00padding'))
        with self.assertRaisesRegex(ValueError, 'Invalid JPEG'):
            capture('/dev/video0', run)


class SenderTests(unittest.TestCase):
    def test_request(self):
        client = HttpClient(CONFIG)
        client.opener = MagicMock()
        client.opener.open.return_value.__enter__.return_value.status = 202
        self.assertEqual(client.post(JPEG), 202)
        request = client.opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://example.test/api/watch-camera/frames')
        self.assertEqual(request.method, 'POST')
        self.assertIs(request.data, JPEG)
        self.assertEqual(request.get_header('Content-type'), 'image/jpeg')
        self.assertEqual(request.get_header('X-client-key'), 'secret')
        self.assertEqual(client.opener.open.call_args.kwargs, {'timeout': 10})

    def test_http_failures_close_and_do_not_retry(self):
        for code in (302, 401, 403, 500):
            client = HttpClient(CONFIG)
            body = io.BytesIO(b'secret')
            client.opener = Mock()
            client.opener.open.side_effect = urllib.error.HTTPError('url', code, 'error', {}, body)
            self.assertEqual(client.post(JPEG), code)
            self.assertTrue(body.closed)
            client.opener.open.assert_called_once()

    def test_redirect_disabled(self):
        client = HttpClient(CONFIG)
        handler = next(h for h in client.opener.handlers
                       if isinstance(h, urllib.request.HTTPRedirectHandler))
        self.assertIsNone(handler.redirect_request(None, None, 302, '', {}, 'https://other.test'))

    def test_tls(self):
        with patch('watch_cam_agent.sender.ssl.create_default_context') as context:
            HttpClient(Config('https://example.test', 'secret', True))
            self.assertFalse(context.return_value.check_hostname)
            self.assertEqual(context.return_value.verify_mode, 0)


class LoopTests(unittest.TestCase):
    def run_sequence(self, statuses, duration=0):
        clock = [0.0]
        times, waits = [], []
        stop = Mock()
        stopped = [False]
        stop.is_set.side_effect = lambda: stopped[0]
        def wait(seconds):
            waits.append(seconds)
            clock[0] += seconds
        stop.wait.side_effect = wait
        def post(frame):
            self.assertIs(frame, JPEG)
            times.append(clock[0])
            clock[0] += duration
            value = statuses[len(times) - 1]
            if len(times) == len(statuses):
                stopped[0] = True
            if isinstance(value, Exception):
                raise value
            return value
        notify = Mock()
        with self.assertLogs('watch_cam_agent.main', level='INFO') as logs:
            run_loop(CONFIG, stop, Mock(return_value=JPEG), post, lambda: clock[0], notify, 3)
        return times, waits, notify, logs.output

    def test_backoff_recovery_and_transition_logs(self):
        times, waits, notify, logs = self.run_sequence([500, 500, 500, 500, 202, 202, 401, 403])
        self.assertEqual(times, [0, 20, 60, 120, 180, 190, 200, 220])
        self.assertLessEqual(max(waits), 3)
        self.assertEqual(notify.call_args_list[0].args, ('READY=1',))
        self.assertTrue(all(c.args == ('WATCHDOG=1',) for c in notify.call_args_list[1:]))
        self.assertEqual(len(logs), 3)
        self.assertTrue(any('ERROR' in log for log in logs))
        self.assertNotIn('secret', str(logs))

    def test_slow_operations_do_not_catch_up(self):
        times, _, _, _ = self.run_sequence([202, 202, 500], duration=12)
        self.assertEqual(times, [0, 22, 44])

    def test_network_exception_dropped(self):
        times, _, _, logs = self.run_sequence([OSError('secret'), 202])
        self.assertEqual(times, [0, 20])
        self.assertNotIn('secret', str(logs))

    def test_capture_failure_and_stop_during_wait(self):
        stop = threading.Event()
        stop.wait = Mock(side_effect=lambda _: stop.set())
        take = Mock(side_effect=OSError('secret'))
        post = Mock()
        with self.assertLogs('watch_cam_agent.main', level='WARNING'):
            run_loop(CONFIG, stop, take, post, lambda: 0, Mock(), 30)
        take.assert_called_once()
        post.assert_not_called()
        stop.wait.assert_called_once_with(20)

    def test_stop_after_capture_skips_post(self):
        stop = threading.Event()
        def take(device):
            stop.set()
            return JPEG
        post = Mock()
        run_loop(CONFIG, stop, take, post, notify=Mock())
        post.assert_not_called()

    def test_sigterm_during_event_lock(self):
        script = '''
import os, signal, threading
from watch_cam_agent.main import install_stop_handlers
stop = threading.Event()
install_stop_handlers(stop)
with stop._cond:
    os.kill(os.getpid(), signal.SIGTERM)
assert stop.wait(3)
'''
        env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
        result = subprocess.run([sys.executable, '-c', script], env=env, timeout=5,
                                capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


class NotifyTests(unittest.TestCase):
    def test_absent_socket(self):
        with patch.dict(os.environ, {}, clear=True), patch('socket.socket') as sock:
            sd_notify('READY=1')
        sock.assert_not_called()

    def test_unix_notification(self):
        with patch.dict(os.environ, NOTIFY_SOCKET='/run/watchcam-notify'), patch('socket.socket') as sock:
            sd_notify('READY=1')
            sock.assert_called_once_with(socket.AF_UNIX, socket.SOCK_DGRAM)
            connection = sock.return_value.__enter__.return_value
            connection.connect.assert_called_once_with('/run/watchcam-notify')
            connection.sendall.assert_called_once_with(b'READY=1')
            connection.settimeout.assert_called_once_with(1)

    def test_abstract_socket_and_unavailable_socket(self):
        with patch.dict(os.environ, NOTIFY_SOCKET='@watchcam'), patch('socket.socket') as sock:
            sd_notify('WATCHDOG=1')
            sock.return_value.__enter__.return_value.connect.assert_called_once_with('\0watchcam')
            sock.return_value.__enter__.return_value.connect.side_effect = OSError()
            sd_notify('WATCHDOG=1')

    def test_watchdog_interval(self):
        for value, expected in [('60000000', 30), ('20000000', 10), ('0', 30), ('bad', 30)]:
            with self.subTest(value=value), patch.dict(os.environ, WATCHDOG_USEC=value):
                self.assertEqual(watchdog_interval(), expected)
