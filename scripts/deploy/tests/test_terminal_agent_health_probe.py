#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PROBE = ROOT / "scripts/deploy/terminal-agent-health-probe.py"


class AgentHandler(BaseHTTPRequestHandler):
    port = 0
    requests = 0

    def log_message(self, _format, *_args):
        return

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler API
        type(self).requests += 1
        if self.path != "/api/agent/status":
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(
            {
                "readerConnected": True,
                "message": "ready",
                "restPort": type(self).port,
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class TerminalAgentHealthProbeTest(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), AgentHandler)
        AgentHandler.port = self.server.server_port
        AgentHandler.requests = 0
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.repository = self.base / "repository"
        self.repository.mkdir()
        self.compose = self.repository / "compose.yml"
        self.compose.write_text("services: {}\n", encoding="utf-8")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temporary.cleanup()

    def _docker(self, body: str) -> None:
        path = self.bin / "docker"
        path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body, encoding="utf-8")
        path.chmod(0o755)

    def _run(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                str(PROBE),
                "--agent",
                "barcode-agent",
                "--port",
                str(self.server.server_port),
                "--repository",
                str(self.repository),
                "--compose-file",
                str(self.compose),
                "--ansible-marker",
            ],
            check=False,
            text=True,
            capture_output=True,
            env={"PATH": f"{self.bin}:{os.environ.get('PATH', '')}"},
        )

    def test_running_container_and_live_status_contract_emit_exact_marker(self):
        self._docker("printf '%064d\\n' 0 | tr 0 a\n")

        result = self._run()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            f"TERMINAL_AGENT_HEALTH_OK:barcode-agent:{self.server.server_port}",
        )
        self.assertEqual(AgentHandler.requests, 1)

    def test_container_death_before_final_observation_fails_before_endpoint(self):
        self._docker("exit 0\n")

        result = self._run()

        self.assertEqual(result.returncode, 1)
        self.assertIn("not uniquely running", result.stderr)
        self.assertEqual(AgentHandler.requests, 0)


if __name__ == "__main__":
    unittest.main()
