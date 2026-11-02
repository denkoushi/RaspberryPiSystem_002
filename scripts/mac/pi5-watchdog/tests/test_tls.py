"""Loopback-only TLS verification; never contacts the Pi5 or runs launchctl."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('openssl'), 'TLS fixture needs openssl')
class TlsTest(unittest.TestCase):
    def test_certificate_fingerprint_is_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            cert, key = home / 'cert.pem', home / 'key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-keyout', str(key), '-out', str(cert), '-subj', '/CN=localhost',
                            '-addext', 'subjectAltName=DNS:localhost'], check=True, capture_output=True)
            pin = hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()

            class Handler(BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"status":"ok","checks":{"database":{"status":"ok"}}}')

                def log_message(self, *args):
                    pass

            try:
                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            except PermissionError:
                self.skipTest('sandbox disallows loopback bind; run TLS fixture outside sandbox')
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                bin_dir = home / 'bin'
                bin_dir.mkdir()
                for name in ('osascript', 'ssh', 'sleep'):
                    stub = bin_dir / name
                    stub.write_text('#!/bin/bash\nexit 0\n')
                    stub.chmod(0o755)
                env = dict(os.environ, HOME=str(home), PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
                           PI5_WATCHDOG_STATE=str(home / 'state.json'), PI5_WATCHDOG_LOG=str(home / 'log'),
                           PI5_WATCHDOG_URL=f'https://localhost:{server.server_port}/health', PI5_WATCHDOG_CERT_SHA256=pin)
                # No injection from the command-stub test environment.
                env.pop('PYTHONPATH', None)
                for requested_pin, status in [(pin, 'ok'), ('0' * 64, 'down'), (pin, 'ok')]:
                    env['PI5_WATCHDOG_CERT_SHA256'] = requested_pin
                    subprocess.run(['bash', str(SCRIPTS / 'pi5-watchdog.sh')], env=env, check=True,
                                   capture_output=True, timeout=15)
                    self.assertEqual(json.loads((home / 'state.json').read_text())['status'], status)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
