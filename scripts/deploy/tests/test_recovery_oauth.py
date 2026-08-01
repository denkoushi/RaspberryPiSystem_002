import json
import os
import subprocess
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PROJECT = Path(__file__).parents[3]
PLAYBOOK = Path(__file__).parent / 'fixtures/recovery-oauth-provider-check.yml'
SENTINELS = (
    'sentinel-long-lived-oauth-secret',
    'sentinel-access-token',
    'sentinel-one-use-auth-key',
)


class OAuthHandler(BaseHTTPRequestHandler):
    server_version = 'RecoveryOAuthTest/1'

    def log_message(self, _format, *_args):
        return

    def _request_body(self):
        length = int(self.headers.get('Content-Length', '0'))
        return self.rfile.read(length)

    def _json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = self._request_body()
        self.server.requests.append({
            'path': self.path,
            'authorization': self.headers.get('Authorization'),
            'body': body.decode('utf-8'),
        })
        scenario = self.server.scenario
        if self.path == '/api/v2/oauth/token':
            self.server.token_attempts += 1
            if scenario == 'unauthorized':
                self._json(401, {'message': 'invalid client'})
                return
            if scenario == 'transient' and self.server.token_attempts == 1:
                self._json(429, {'message': 'rate limited'})
                return
            if scenario == 'transient' and self.server.token_attempts == 2:
                self._json(503, {'message': 'temporary'})
                return
            self._json(200, {
                'access_token': 'sentinel-access-token',
                'token_type': 'Bearer',
                'expires_in': 3600,
                'scope': 'auth_keys',
            })
            return
        if self.path == '/api/v2/tailnet/-/keys':
            self.server.key_attempts += 1
            if scenario == 'malformed-key':
                self._json(200, {'key': 'sentinel-one-use-auth-key'})
                return
            capabilities = {
                'devices': {
                    'create': {
                        'reusable': False,
                        'ephemeral': False,
                        'preauthorized': True,
                        'tags': ['tag:kiosk'],
                    }
                }
            }
            self._json(200, {
                'key': 'sentinel-one-use-auth-key',
                'capabilities': capabilities,
            })
            return
        self._json(404, {'message': 'not found'})


class RecoveryOAuthProviderTest(unittest.TestCase):
    def run_provider(self, scenario):
        server = ThreadingHTTPServer(('127.0.0.1', 0), OAuthHandler)
        server.scenario = scenario
        server.requests = []
        server.token_attempts = 0
        server.key_attempts = 0
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        result_path = Path(temporary.name) / 'result.json'
        environment = os.environ.copy()
        environment['ANSIBLE_CONFIG'] = str(
            PROJECT / 'infrastructure/ansible/ansible.cfg'
        )
        environment['ANSIBLE_ROLES_PATH'] = str(
            PROJECT / 'infrastructure/ansible/roles'
        )
        try:
            completed = subprocess.run(
                [
                    'ansible-playbook',
                    '-i',
                    'localhost,',
                    str(PLAYBOOK),
                    '-e',
                    f'tailscale_recovery_oauth_base_url=http://127.0.0.1:{server.server_port}',
                    '-e',
                    f'recovery_oauth_test_result_path={result_path}',
                ],
                cwd=PROJECT / 'infrastructure/ansible',
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )
            requests = list(server.requests)
            counts = (server.token_attempts, server.key_attempts)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
        combined_output = completed.stdout + completed.stderr
        for sentinel in SENTINELS:
            self.assertNotIn(sentinel, combined_output)
        return completed, result_path, requests, counts

    def test_provider_creates_exact_one_use_kiosk_key_without_leaking_secrets(self):
        completed, result_path, requests, counts = self.run_provider('success')

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertEqual(json.loads(result_path.read_text()), {
            'configured': True,
            'tag': 'tag:kiosk',
        })
        self.assertEqual(counts, (1, 1))
        token_form = urllib.parse.parse_qs(requests[0]['body'])
        self.assertEqual(token_form['scope'], ['auth_keys'])
        self.assertEqual(token_form['tags'], ['tag:kiosk'])
        key_body = json.loads(requests[1]['body'])
        self.assertEqual(key_body['expirySeconds'], 600)
        self.assertEqual(key_body['capabilities']['devices']['create'], {
            'reusable': False,
            'ephemeral': False,
            'preauthorized': True,
            'tags': ['tag:kiosk'],
        })
        self.assertEqual(requests[1]['authorization'], 'Bearer sentinel-access-token')
        for sentinel in SENTINELS:
            self.assertNotIn(sentinel, result_path.read_text())

    def test_provider_retries_only_transient_statuses_within_bound(self):
        completed, result_path, _requests, counts = self.run_provider('transient')

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertTrue(result_path.exists())
        self.assertEqual(counts, (3, 1))

    def test_provider_does_not_retry_authentication_rejection(self):
        completed, result_path, _requests, counts = self.run_provider('unauthorized')

        self.assertNotEqual(completed.returncode, 0)
        self.assertFalse(result_path.exists())
        self.assertEqual(counts, (1, 0))

    def test_provider_rejects_malformed_key_capabilities(self):
        completed, result_path, _requests, counts = self.run_provider('malformed-key')

        self.assertNotEqual(completed.returncode, 0)
        self.assertFalse(result_path.exists())
        self.assertEqual(counts, (1, 1))


if __name__ == '__main__':
    unittest.main()
