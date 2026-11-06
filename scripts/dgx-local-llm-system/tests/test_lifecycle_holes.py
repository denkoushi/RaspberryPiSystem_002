"""Local regression evidence for business lifecycle recovery boundaries."""
import fcntl
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import test_control_server as control_tests
import test_gateway_server as gateway_tests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import active_model_state as state
import business_tensorfold as tensorfold
import model_profiles
import resource_state


class PendingGenerationTests(unittest.TestCase):
    def test_pending_stopped_previous_generation_is_recoverable_but_confirmed_is_strict(self):
        lines = 'true\n' + 'false\ntrue\ntrue\ntrue\ntrue\n\nold\n\n2026-11-02T12:00:00+00:00\n' * 2
        with patch.object(tensorfold, 'remote', return_value=lines):
            result = tensorfold.runtime_status('new', pending=True)
            self.assertTrue(result['apiListenerClosed'])
            with self.assertRaisesRegex(RuntimeError, 'generation_mismatch'):
                tensorfold.runtime_status('new')
            for index in (0, 1, 2, 3, 4):
                node = lines.splitlines()
                node[index + 1] = 'true' if index == 0 else 'false'
                with patch.object(tensorfold, 'remote', return_value='\n'.join(node) + '\n'):
                    with self.assertRaisesRegex(RuntimeError, 'pending.*unverified'):
                        tensorfold.runtime_status('new', pending=True)

    def test_pending_rejects_unrelated_generations_and_unavailable_rank(self):
        lines = 'true\n' + 'false\ntrue\ntrue\ntrue\ntrue\n\nold\n\n2026-11-02T12:00:00+00:00\n' * 2
        values = lines.splitlines()
        values[16] = 'unrelated'
        with patch.object(tensorfold, 'remote', return_value='\n'.join(values) + '\n'):
            with self.assertRaisesRegex(RuntimeError, 'pending.*unverified'):
                tensorfold.runtime_status('new', pending=True)
        with patch.object(tensorfold, 'remote', side_effect=subprocess.CalledProcessError(255, ['fake'])):
            with self.assertRaises(subprocess.CalledProcessError):
                tensorfold.stop('new')


class LockTests(unittest.TestCase):
    def test_exclusive_deadline_with_real_shared_open_in_thread(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'state.json')
            Path(path + '.lock').touch()
            entered, release = threading.Event(), threading.Event()
            def reader():
                with open(path + '.lock') as lock:
                    fcntl.flock(lock, fcntl.LOCK_SH)
                    entered.set()
                    release.wait(2)
            thread = threading.Thread(target=reader)
            thread.start()
            try:
                self.assertTrue(entered.wait(1))
                before = time.monotonic()
                with self.assertRaises(state.BusinessLockTimeout):
                    with state.business_state_lock(path, timeout=.05):
                        self.fail('writer acquired a live shared lock')
                self.assertLess(time.monotonic() - before, .5)
            finally:
                release.set()
                thread.join(2)


class ForceRecoveryTests(unittest.TestCase):
    setUp = control_tests.BusinessSwitchContractTests.setUp
    request = control_tests.BusinessSwitchContractTests.request
    state_value = control_tests.BusinessSwitchContractTests.state_value

    def test_force_stop_recovers_missing_or_corrupt_selection_and_blocks_normal_start(self):
        for contents in (None, '{broken'):
            with self.subTest(contents=contents):
                if contents is None:
                    self.state.unlink(missing_ok=True)
                else:
                    self.state.write_text(contents)
                self.calls.clear()
                self.assertEqual(self.request('/stop-force')[0], 200)
                self.assertEqual({c[0] for c in self.calls}, {'blue-stop', 'green-stop'})
                recovered = state.business_selection_state(str(self.state))
                self.assertEqual(recovered['businessTransition'], 'failed')
                self.assertEqual(recovered['businessFailureReason'], 'business_selection_recovery_required')
                self.calls.clear()
                self.assertEqual(self.request('/start')[0], 503)
                self.assertFalse(self.calls)

    def test_force_stop_drain_timeout_does_not_stop_runtime(self):
        with open(str(self.state) + '.lock') as reader, patch.dict(os.environ, {'BUSINESS_FORCE_STOP_DRAIN_SEC': '.05'}):
            fcntl.flock(reader, fcntl.LOCK_SH)
            status, payload = self.request('/stop-force')
        self.assertEqual(status, 503)
        self.assertEqual(payload['code'], 'business_drain_timeout')
        self.assertFalse(self.calls)
        self.assertFalse(Path(str(self.state) + '.drain').exists())


class GatewayDrainTests(unittest.TestCase):
    setUp = gateway_tests.BusinessRoutingContractTests.setUp
    request = gateway_tests.BusinessRoutingContractTests.request

    def test_gateway_rejects_new_requests_during_drain(self):
        Path(str(self.state) + '.drain').write_text(str(time.time() + 10))
        self.assertEqual(self.request()[0], 503)
        self.assertFalse(self.calls)


class GlmResolutionTests(unittest.TestCase):
    def test_glm_inspection_uses_adapter_container_and_port_precedence(self):
        with patch.dict(os.environ, {'BLUE_CONTAINER_NAME': 'custom-glm', 'TRTLLM_CONTAINER_NAME': 'fallback',
                                    'BLUE_SERVER_PORT': '40123', 'TRTLLM_SERVER_PORT': '40124'}), \
                patch.object(resource_state.subprocess, 'run', side_effect=[
                    subprocess.CompletedProcess([], 0, 'false\ntrue\n'),
                    subprocess.CompletedProcess([], 0, 'false\ntrue\n'),
                    subprocess.CompletedProcess([], 0, '')]) as run:
            resource_state.glm_business_runtime('g')
            self.assertIn('custom-glm', run.call_args_list[0].args[0][-1])
            self.assertIn('sport = :40123', run.call_args_list[-1].args[0])


class ManifestIsolationTests(unittest.TestCase):
    def test_invalid_manifest_and_duplicate_id_do_not_disable_other_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def write(folder, body):
                path = root / folder / 'manifest.json'
                path.parent.mkdir()
                path.write_text(json.dumps(body))
            valid = {'id': 'good', 'displayNameJa': 'Good', 'backend': 'blue'}
            write('good', valid)
            write('broken', {'id': 'bad', 'backend': 'invalid'})
            with patch('sys.stderr', new_callable=io.StringIO):
                self.assertEqual(model_profiles.validate_startable_profile(directory, 'good').id, 'good')
                with self.assertRaisesRegex(model_profiles.ModelProfileError, 'invalid'):
                    model_profiles.find_model_profile(directory, 'bad')
                write('duplicate', {**valid, 'id': 'bad'})
                self.assertEqual([p.id for p in model_profiles.load_model_profiles(directory)], ['good'])
                with self.assertRaisesRegex(model_profiles.ModelProfileError, 'ambiguous|invalid'):
                    model_profiles.find_model_profile(directory, 'bad')
                write('duplicate-good', valid)
                with self.assertRaisesRegex(model_profiles.ModelProfileError, 'ambiguous'):
                    model_profiles.find_model_profile(directory, 'good')

class CommandTimeoutTests(unittest.TestCase):
    def test_gateway_forward_timeout_exceeds_request_budget(self):
        module = gateway_tests.load_module()
        with patch.dict(os.environ, {'LLM_RUNTIME_COMMAND_TIMEOUT_SEC': '.1',
                                     'LLM_RUNTIME_REQUEST_BUDGET_SEC': '.4',
                                     'LLM_RUNTIME_FORWARD_MARGIN_SEC': '.2'}), \
                patch.object(module.urllib.request, 'urlopen') as urlopen:
            for path in ('/start', '/stop', '/stop-force'):
                with self.subTest(path=path):
                    module.proxy_request('POST', 'http://127.0.0.1:39090' + path, b'{}', {})
                    timeout = urlopen.call_args.kwargs['timeout']
                    self.assertGreater(timeout, .4)
                    self.assertAlmostEqual(timeout, .6)
            module.proxy_request('GET', 'http://127.0.0.1:39090/healthz', b'', {})
            self.assertEqual(urlopen.call_args.kwargs['timeout'], 120)
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(state.control_request_budget(), 360)

    def test_timeout_kills_process_group_but_preserves_detached_grandchild(self):
        import shlex
        module = control_tests.load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'heartbeat.py').write_text('import pathlib, sys, time\np = pathlib.Path(sys.argv[1])\nwhile True:\n p.write_text(str(time.time_ns())); time.sleep(.01)\n')
            script = root / 'children.py'
            script.write_text('''import os, subprocess, sys, time
from pathlib import Path
root = Path(sys.argv[1])
child = subprocess.Popen([sys.executable, str(root / 'heartbeat.py'), str(root / 'child-beat')])
detached = subprocess.Popen([sys.executable, str(root / 'heartbeat.py'), str(root / 'detached-beat')],
    start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
(root / 'pids').write_text(f'{os.getpid()} {child.pid} {detached.pid}')
time.sleep(.7)
child.terminate()
child.wait()
''')
            command = shlex.join([sys.executable, str(script), str(root)])
            try:
                with patch.dict(os.environ, {'LLM_RUNTIME_COMMAND_TIMEOUT_SEC': '.3'}):
                    with self.assertRaises(subprocess.TimeoutExpired):
                        module.run_shell(command)
                parent, child, detached = map(int, (root / 'pids').read_text().split())
                time.sleep(.05)
                child_before = (root / 'child-beat').read_text()
                detached_before = (root / 'detached-beat').read_text()
                time.sleep(.06)
                self.assertEqual((root / 'child-beat').read_text(), child_before)
                self.assertNotEqual((root / 'detached-beat').read_text(), detached_before)
                with self.assertRaises(ProcessLookupError):
                    os.kill(parent, 0)
            finally:
                if (root / 'pids').exists():
                    for pid in map(int, (root / 'pids').read_text().split()):
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass


class RequestBudgetTests(unittest.TestCase):
    setUp = control_tests.BusinessSwitchContractTests.setUp
    request = control_tests.BusinessSwitchContractTests.request

    def test_two_slow_commands_share_request_budget(self):
        import shlex
        for business, path in ((True, '/start'), (True, '/stop-force'), (False, '/start')):
            with self.subTest(business=business, path=path):
                calls = []
                def runner(command, extra_env=None):
                    calls.append(command)
                    # The first command completes; the second must be killed by
                    # the remaining request budget, before its own .8s limit.
                    delay = '.2' if len(calls) == 1 else '2'
                    self.module.run_shell(shlex.join([sys.executable, '-c',
                                                     'import time; time.sleep(' + delay + ')']), extra_env)
                with patch.dict(os.environ, {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': str(business).lower(),
                                             'DGX_LLM_SINGLE_ACTIVE_GUARD': 'true',
                                             'LLM_RUNTIME_COMMAND_TIMEOUT_SEC': '.8',
                                             'LLM_RUNTIME_REQUEST_BUDGET_SEC': '.45'}):
                    self.handler = self.module.make_handler(self.config, runner)
                    before = time.monotonic()
                    status, payload = self.request(path, modelProfileId=self.profile.id,
                                                   reason='business-model-selection')
                    elapsed = time.monotonic() - before
                self.assertEqual(status, 503)
                self.assertEqual(payload['code'], (
                    'business_runtime_start_failed' if business and path == '/start' else
                    'business_runtime_stop_unverified' if business else 'business_runtime_control_failed'))
                self.assertEqual(len(calls), 2)
                self.assertGreaterEqual(elapsed, .4)
                self.assertLess(elapsed, .75)
                self.assertIsNone(getattr(self.module._control_request, 'deadline', None))

    def test_legacy_stop_paths_use_request_budget(self):
        import shlex
        from dataclasses import replace
        command = shlex.join([sys.executable, '-c', 'import time; time.sleep(2)'])
        config = replace(self.config, blue_stop_cmd=command)
        with patch.dict(os.environ, {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'false',
                                     'LLM_RUNTIME_COMMAND_TIMEOUT_SEC': '.8',
                                     'LLM_RUNTIME_REQUEST_BUDGET_SEC': '.1'}):
            self.handler = self.module.make_handler(config)
            for path in ('/stop', '/stop-force'):
                with self.subTest(path=path):
                    before = time.monotonic()
                    status, payload = self.request(path)
                    self.assertLess(time.monotonic() - before, .5)
                    self.assertEqual(status, 503)
                    self.assertEqual(payload['code'], 'business_runtime_control_failed')

    def test_lock_wait_is_capped_by_request_budget(self):
        for path, code in (('/start', 'business_state_lock_timeout'),
                           ('/stop', 'business_state_lock_timeout'),
                           ('/stop-force', 'business_drain_timeout')):
            with self.subTest(path=path), \
                    patch.dict(os.environ, {'BUSINESS_STATE_LOCK_TIMEOUT_SEC': '1',
                                            'BUSINESS_FORCE_STOP_DRAIN_SEC': '1',
                                            'LLM_RUNTIME_REQUEST_BUDGET_SEC': '.05'}), \
                    open(str(self.state) + '.lock') as reader:
                fcntl.flock(reader, fcntl.LOCK_SH)
                before = time.monotonic()
                status, payload = self.request(path)
                self.assertLess(time.monotonic() - before, .4)
                self.assertEqual((status, payload['code']), (503, code))
                self.assertFalse(self.calls)


class GatewayLifetimeTests(unittest.TestCase):
    setUp = gateway_tests.BusinessRoutingContractTests.setUp

    def test_trickling_stream_and_blocked_write_release_shared_lock(self):
        import http.client
        import socket
        for stream in (True, False):
            with self.subTest(stream=stream):
                downstream, client = socket.socketpair()
                upstream, producer_socket = socket.socketpair()
                downstream.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
                producer_socket.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n')
                response = http.client.HTTPResponse(upstream)
                response.begin()
                stopped = threading.Event()
                def produce():
                    try:
                        while not stopped.wait(.005):
                            producer_socket.sendall(b'data: {"choices":[]}\n\n')
                    except OSError:
                        pass
                producer = threading.Thread(target=produce)
                if stream:
                    producer.start()
                handler = self.module.make_handler(self.config, self.module.proxy_request if stream else
                    lambda *args: (200, json.dumps({'choices': [{'message': {'content': 'x' * 2000000}}]}).encode(), 'application/json'))
                data = json.dumps({'stream': stream, 'messages': []}).encode()
                client.sendall(b'POST /v1/chat/completions HTTP/1.0\r\nAuthorization: Bearer client-key\r\nContent-Length: '
                               + str(len(data)).encode() + b'\r\n\r\n' + data)
                failures = []
                def serve():
                    try:
                        handler(downstream, ('local', 0), object())
                    except Exception as error:
                        failures.append(error)
                worker = threading.Thread(target=serve)
                try:
                    with patch.dict(os.environ, {'BUSINESS_REQUEST_MAX_LIFETIME_SEC': '.15',
                                                 'BUSINESS_RESPONSE_WRITE_TIMEOUT_SEC': '.05'}), \
                            patch.object(self.module, 'business_urlopen', return_value=response):
                        worker.start()
                        worker.join(1)
                        self.assertFalse(worker.is_alive(), 'request kept its shared lock beyond the lifetime')
                        self.assertFalse(failures)
                        with state.business_state_lock(str(self.state), blocking=False):
                            pass
                finally:
                    stopped.set()
                    response.close()
                    for sock in (downstream, client, upstream, producer_socket):
                        sock.close()
                    if stream:
                        producer.join(1)
                    worker.join(1)

class AdapterPhaseTests(unittest.TestCase):
    def test_adapter_retains_pending_on_failed_start_and_confirms_success(self):
        import shutil
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / 'marker.json'
            shutil.copy(ROOT / 'tensorfold-2x-adapter.sh', root)
            (root / 'stop-trtllm-server.sh').write_text('#!/bin/bash\nexit 0\n')
            (root / 'business_tensorfold.py').write_text('''import json, os, sys
from pathlib import Path
if sys.argv[1] == 'start':
    marker = json.loads(Path(os.environ['BLUE_REMOTE_WORKER_MARKER_PATH']).read_text())
    assert marker['startPhase'] == 'pending'
    sys.exit(int(os.environ['FAKE_START_FAIL']))
''')
            for failure in ('1', '0'):
                result = subprocess.run(['bash', str(root / 'tensorfold-2x-adapter.sh')],
                    env={**os.environ, 'BLUE_SERVER_ADAPTER': 'dsv41_tensorfold_2x',
                         'BLUE_MODEL_PROFILE_ID': state.DEEPSEEK_PROFILE,
                         'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'true',
                         'BLUE_WORKER_SSH_TARGET': 'user@fake', 'BLUE_QWEN38_RECIPE_DIR': '/fake',
                         'BLUE_QWEN38_RECIPE_REVISION': 'a' * 40,
                         'BLUE_REMOTE_WORKER_MARKER_PATH': str(marker),
                         'DGX_BUSINESS_GENERATION': 'new', 'FAKE_START_FAIL': failure},
                    capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, int(failure), result.stderr)
                self.assertEqual(json.loads(marker.read_text())['startPhase'], 'pending' if failure == '1' else 'confirmed')

class PendingWiringTests(unittest.TestCase):
    setUp = control_tests.BusinessSwitchContractTests.setUp
    request = control_tests.BusinessSwitchContractTests.request
    state_value = control_tests.BusinessSwitchContractTests.state_value

    def test_pending_marker_reaches_stop_control_status_and_resource_verification(self):
        marker = self.state.parent / 'worker.json'
        marker.write_text(json.dumps({'business': True, 'generation': 'new', 'startPhase': 'pending'}))
        value = self.state_value()
        value.update(modelProfileId=self.deep, selectedBusinessProfileId=self.deep, businessGeneration='new')
        self.state.write_text(json.dumps(value))
        lines = 'true\n' + 'false\ntrue\ntrue\ntrue\ntrue\n\nold\n\n2026-11-02T12:00:00+00:00\n' * 2
        with patch.dict(os.environ, {'BLUE_REMOTE_WORKER_MARKER_PATH': str(marker)}), \
                patch.object(tensorfold, 'remote', return_value=lines):
            self.assertTrue(self.module.business_runtime_status(self.config)['apiListenerClosed'])
            tensorfold.stop('new')
            resource_state.verify_blue_stopped(str(marker), 'unused')
            self.assertTrue(marker.exists())  # Only the verified stop script removes it.
        with patch.object(tensorfold, 'remote', return_value=lines):
            resource_state.verify_blue_stopped(str(marker), 'unused')
        marker.write_text(json.dumps({'business': True, 'generation': 'new', 'startPhase': 'confirmed'}))
        with patch.dict(os.environ, {'BLUE_REMOTE_WORKER_MARKER_PATH': str(marker)}), \
                patch.object(tensorfold, 'remote', return_value=lines):
            with self.assertRaisesRegex(RuntimeError, 'generation_mismatch'):
                tensorfold.stop('new')


class GlmValidationTests(unittest.TestCase):
    def test_glm_defaults_fallbacks_and_invalid_values(self):
        from glm_runtime_config import glm_runtime_config
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(glm_runtime_config(), ('system-prod-trtllm', 38083, 'http://127.0.0.1:38083'))
            with patch.dict(os.environ, {'TRTLLM_CONTAINER_NAME': 'fallback', 'TRTLLM_SERVER_PORT': '54321'}):
                self.assertEqual(glm_runtime_config(), ('fallback', 54321, 'http://127.0.0.1:54321'))
            for name, value in (('BLUE_CONTAINER_NAME', '-unsafe'), ('BLUE_CONTAINER_NAME', 'a;exit'),
                                ('BLUE_SERVER_PORT', '0'), ('BLUE_SERVER_PORT', '65536'),
                                ('BLUE_SERVER_PORT', '123;exit'), ('BLUE_SERVER_PORT', '1.5')):
                with self.subTest(name=name, value=value), patch.dict(os.environ, {name: value}):
                    with self.assertRaises(ValueError):
                        glm_runtime_config()

class GatewayHeaderLifetimeTests(unittest.TestCase):
    setUp = gateway_tests.BusinessRoutingContractTests.setUp

    def test_trickling_headers_are_bounded_before_urlopen_returns(self):
        import socket
        downstream, client = socket.socketpair()
        upstream, producer_socket = socket.socketpair()
        stop = threading.Event()
        def produce():
            try:
                producer_socket.recv(4096)
                producer_socket.sendall(b'HTTP/1.1 200 OK\r\nX-Slow: ')
                while not stop.wait(.005):
                    producer_socket.sendall(b'a')
            except OSError:
                pass
        producer = threading.Thread(target=produce)
        handler = self.module.make_handler(self.config)
        body = b'{"messages":[]}'
        client.sendall(b'POST /v1/chat/completions HTTP/1.0\r\nAuthorization: Bearer client-key\r\nContent-Length: '
                       + str(len(body)).encode() + b'\r\n\r\n' + body)
        failures = []
        def serve():
            try:
                handler(downstream, ('local', 0), object())
            except Exception as error:
                failures.append(error)
        worker = threading.Thread(target=serve)
        def connect(connection):
            connection.sock = upstream
        try:
            with patch.dict(os.environ, {'BUSINESS_REQUEST_MAX_LIFETIME_SEC': '.15'}), \
                    patch.object(self.module.http.client.HTTPConnection, 'connect', connect):
                producer.start()
                worker.start()
                worker.join(1)
                self.assertFalse(worker.is_alive())
                self.assertFalse(failures)
                with state.business_state_lock(str(self.state), blocking=False):
                    pass
        finally:
            stop.set()
            for sock in (downstream, client, upstream, producer_socket):
                sock.close()
            worker.join(1)
            producer.join(1)
