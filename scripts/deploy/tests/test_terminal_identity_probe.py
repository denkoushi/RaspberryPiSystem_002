from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "terminal-identity-probe.py"
SPEC = importlib.util.spec_from_file_location("terminal_identity_probe", SCRIPT)
assert SPEC and SPEC.loader
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class Response:
    status = 200

    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, _limit):
        return self.payload


class Opener:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def open(self, request, **kwargs):
        self.calls.append((request, kwargs))
        return self.response


class TerminalIdentityProbeTest(unittest.TestCase):
    def config(self, root: Path, **overrides: str) -> Path:
        values = {
            "API_BASE_URL": "https://pi5.example/api",
            "CLIENT_ID": "terminal-a",
            "CLIENT_KEY": "secret-never-print",
            "REQUEST_TIMEOUT": "10",
            "TLS_SKIP_VERIFY": "0",
        }
        values.update(overrides)
        path = root / "status-agent.conf"
        path.write_text(
            "\n".join(f'{key}="{value}"' for key, value in values.items())
            + '\nLOCATION=""\n',
            encoding="utf-8",
        )
        return path

    def test_probe_requires_authenticated_exact_client_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = self.config(Path(temporary))
            response = Response(
                {"authenticated": True, "statusClientId": "terminal-a"}
            )
            opener = Opener(response)
            with patch.object(
                PROBE.urllib.request, "build_opener", return_value=opener
            ):
                result = PROBE.probe("terminal-a", path)

        self.assertEqual(
            result, {"authenticated": True, "statusClientId": "terminal-a"}
        )
        request = opener.calls[0][0]
        self.assertEqual(
            request.full_url,
            "https://pi5.example/api/system/deploy-status/identity",
        )
        self.assertEqual(request.get_header("X-client-key"), "secret-never-print")

    def test_malformed_or_mismatched_identity_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = self.config(Path(temporary))
            for payload in (
                {"authenticated": False, "statusClientId": "terminal-a"},
                {"authenticated": True, "statusClientId": "other"},
                ["not-an-object"],
            ):
                with self.subTest(payload=payload), patch.object(
                    PROBE.urllib.request,
                    "build_opener",
                    return_value=Opener(Response(payload)),
                ):
                    with self.assertRaises(RuntimeError):
                        PROBE.probe("terminal-a", path)

    def test_redirects_are_rejected_before_the_key_can_be_forwarded(self):
        handler = PROBE._RejectRedirect()
        request = urllib.request.Request(
            "https://pi5.example/api/system/deploy-status/identity",
            headers={"x-client-key": "secret-never-forward"},
        )
        with self.assertRaises(urllib.error.HTTPError) as raised:
            handler.redirect_request(
                request,
                None,
                302,
                "Found",
                {"location": "https://attacker.example/collect"},
                "https://attacker.example/collect",
            )
        self.assertEqual(raised.exception.code, 302)

    def test_cli_failure_never_prints_the_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            secret = "do-not-disclose-this-key"
            path = self.config(
                Path(temporary), CLIENT_KEY=secret, REQUEST_TIMEOUT="0"
            )
            completed = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "--expected-client-id",
                    "terminal-a",
                    "--config",
                    str(path),
                ],
                text=True,
                capture_output=True,
            )

        self.assertNotEqual(completed.returncode, 0)
        self.assertNotIn(secret, completed.stdout + completed.stderr)
        self.assertEqual(completed.stderr.strip(), "terminal identity verification failed")


if __name__ == "__main__":
    unittest.main()
