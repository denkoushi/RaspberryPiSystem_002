#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PROOF = ROOT / "scripts/deploy/signage-runtime-proof.py"
JPEG = b"\xff\xd8authenticated signage image\xff\xd9"


class EndpointHandler(BaseHTTPRequestHandler):
    expected_key = "signage-image-secret"
    image = JPEG
    scheduler_running = True
    requests: list[tuple[str, str | None]] = []

    def log_message(self, _format, *_args):
        return

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler API
        key = self.headers.get("x-client-key")
        type(self).requests.append((self.path, key))
        if key != type(self).expected_key:
            self.send_response(401)
            self.end_headers()
            return
        if self.path == "/api/signage/render/status":
            body = (
                b'{"isRunning":true,"intervalSeconds":60}'
                if type(self).scheduler_running
                else b'{"isRunning":false,"intervalSeconds":60}'
            )
            content_type = "application/json"
        elif self.path == "/api/signage/current-image":
            body = type(self).image
            content_type = "image/jpeg"
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class SignageRuntimeProofTest(unittest.TestCase):
    def setUp(self):
        EndpointHandler.requests = []
        EndpointHandler.expected_key = "signage-image-secret"
        EndpointHandler.image = JPEG
        EndpointHandler.scheduler_running = True
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), EndpointHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.cache = self.base / "cache"
        self.cache.mkdir(mode=0o755)
        self.script = self.base / "signage-update.sh"
        self._write_script("signage-image-secret")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temporary.cleanup()

    def _write_script(self, image_key: str) -> None:
        host, port = self.server.server_address
        self.script.write_text(
            "#!/usr/bin/env bash\n"
            f'SERVER_URL="http://{host}:{port}"\n'
            f'IMAGE_CLIENT_KEY="{image_key}"\n'
            'STATUS_CLIENT_KEY="independent-status-secret"\n'
            "CURL_OPTIONS=(-sS -f)\n",
            encoding="utf-8",
        )
        self.script.chmod(0o755)

    def _run(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                str(PROOF),
                "--config-script",
                str(self.script),
                "--cache-dir",
                str(self.cache),
                *arguments,
            ],
            check=False,
            text=True,
            capture_output=True,
            env={"PATH": os.environ.get("PATH", "")},
        )

    def _seal(self, image: bytes) -> subprocess.CompletedProcess[str]:
        temporary = self.cache / "current.tmp.jpg"
        temporary.write_bytes(image)
        return self._run(
            "--run-id",
            "run-123",
            "--seal-maintenance-image",
            str(temporary),
            "--ansible-marker",
        )

    def test_host_local_key_proves_endpoints_and_replaces_maintenance_image(self):
        maintenance = b"rendered maintenance artifact"
        sealed = self._seal(maintenance)
        self.assertEqual(sealed.returncode, 0, sealed.stderr)
        self.assertIn("SIGNAGE_MAINTENANCE_SEALED:", sealed.stdout)
        current = self.cache / "current.jpg"
        current.write_bytes(maintenance)

        refreshed = self._run(
            "--run-id",
            "run-123",
            "--refresh-image",
            "--ansible-marker",
        )

        self.assertEqual(refreshed.returncode, 0, refreshed.stderr)
        self.assertEqual(current.read_bytes(), JPEG)
        self.assertFalse(
            (self.cache / "release-run-123-maintenance.sha256").exists()
        )
        self.assertIn("SIGNAGE_RUNTIME_PROOF_OK:", refreshed.stdout)
        self.assertNotIn("signage-image-secret", refreshed.stdout + refreshed.stderr)
        self.assertEqual(
            EndpointHandler.requests,
            [
                ("/api/signage/render/status", "signage-image-secret"),
                ("/api/signage/current-image", "signage-image-secret"),
            ],
        )

        EndpointHandler.requests = []
        repeated = self._run(
            "--run-id",
            "run-123",
            "--refresh-image",
            "--ansible-marker",
        )
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertEqual(current.read_bytes(), JPEG)

    def test_status_agent_success_cannot_mask_rejected_signage_key(self):
        self._write_script("rejected-signage-key")

        result = self._run("--check-endpoints", "--ansible-marker")

        self.assertEqual(result.returncode, 1)
        self.assertNotIn("rejected-signage-key", result.stdout + result.stderr)
        self.assertEqual(
            EndpointHandler.requests,
            [("/api/signage/render/status", "rejected-signage-key")],
        )

    def test_download_equal_to_run_maintenance_artifact_fails_before_write(self):
        EndpointHandler.image = JPEG
        sealed = self._seal(JPEG)
        self.assertEqual(sealed.returncode, 0, sealed.stderr)
        current = self.cache / "current.jpg"
        current.write_bytes(JPEG)

        result = self._run(
            "--run-id", "run-123", "--refresh-image", "--ansible-marker"
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("still matches", result.stderr)
        self.assertEqual(current.read_bytes(), JPEG)

    def test_stopped_renderer_fails_closed_before_image_fetch(self):
        EndpointHandler.scheduler_running = False

        result = self._run("--check-endpoints", "--ansible-marker")

        self.assertEqual(result.returncode, 1)
        self.assertIn("contract is malformed", result.stderr)
        self.assertEqual(
            EndpointHandler.requests,
            [("/api/signage/render/status", "signage-image-secret")],
        )


if __name__ == "__main__":
    unittest.main()
