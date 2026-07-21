from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "terminal-ready-probe.py"
SPEC = importlib.util.spec_from_file_location("terminal_ready_probe", SCRIPT)
assert SPEC and SPEC.loader
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)

RUN_ID = "20260715-165000-abc123"
RELEASE_SHA = "a" * 40
OTHER_SHA = "b" * 40
VERIFICATION_ID = "c" * 32


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


class RawResponse(Response):
    def __init__(self, payload: bytes):
        self.payload = payload


class Opener:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def open(self, request, **kwargs):
        self.calls.append((request, kwargs))
        return self.response


class TerminalReadyProbeTest(unittest.TestCase):
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

    def repo(self, root: Path) -> tuple[Path, str]:
        repo = root / "repo"
        environment = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Probe Test",
            "GIT_AUTHOR_EMAIL": "probe@example.invalid",
            "GIT_COMMITTER_NAME": "Probe Test",
            "GIT_COMMITTER_EMAIL": "probe@example.invalid",
        }
        subprocess.run(["git", "init", "-q", str(repo)], check=True, env=environment)
        subprocess.run(
            ["git", "-C", str(repo), "commit", "--allow-empty", "-q", "-m", "initial"],
            check=True,
            env=environment,
        )
        sha = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            check=True,
            text=True,
            capture_output=True,
        ).stdout.strip()
        return repo, sha

    @staticmethod
    def acknowledgement(release_sha: str) -> dict[str, object]:
        return {
            "acknowledged": True,
            "runId": RUN_ID,
            "phase": "ready",
            "releaseSha": release_sha,
            "verificationId": VERIFICATION_ID,
        }

    def test_local_head_uses_one_safe_repository_and_a_constrained_git_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary) / "repository"
            repository.mkdir()
            completed = subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=RELEASE_SHA + "\n",
                stderr="",
            )
            with patch.object(PROBE.subprocess, "run", return_value=completed) as run:
                self.assertEqual(PROBE._local_head(repository), RELEASE_SHA)

            run.assert_called_once_with(
                [
                    "git",
                    "-c",
                    f"safe.directory={repository}",
                    "-C",
                    str(repository),
                    "rev-parse",
                    "--verify",
                    "HEAD^{commit}",
                ],
                check=True,
                text=True,
                capture_output=True,
                env={
                    "PATH": "/usr/bin:/bin",
                    "LANG": "C",
                    "LC_ALL": "C",
                    "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": "/dev/null",
                    "GIT_ATTR_NOSYSTEM": "1",
                    "GIT_TERMINAL_PROMPT": "0",
                },
            )

    def test_probe_checks_head_and_posts_exact_ready_acknowledgement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = self.config(root)
            repo, release_sha = self.repo(root)
            opener = Opener(Response(self.acknowledgement(release_sha)))
            with patch.object(
                PROBE.urllib.request, "build_opener", return_value=opener
            ):
                result = PROBE.probe(
                    RUN_ID,
                    release_sha,
                    VERIFICATION_ID,
                    "terminal-a",
                    repo,
                    config,
                )

        self.assertEqual(result, self.acknowledgement(release_sha))
        request, arguments = opener.calls[0]
        self.assertEqual(
            request.full_url,
            "https://pi5.example/api/system/deploy-status/ack",
        )
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("X-client-key"), "secret-never-print")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(
            json.loads(request.data),
            {
                "runId": RUN_ID,
                "phase": "ready",
                "releaseSha": release_sha,
                "verificationId": VERIFICATION_ID,
            },
        )
        self.assertEqual(arguments, {"timeout": 10.0})

    def test_head_mismatch_fails_before_any_network_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = self.config(root)
            repo, _release_sha = self.repo(root)
            with patch.object(PROBE.urllib.request, "build_opener") as build_opener:
                with self.assertRaises(RuntimeError):
                    PROBE.probe(
                        RUN_ID,
                        OTHER_SHA,
                        VERIFICATION_ID,
                        "terminal-a",
                        repo,
                        config,
                    )
            build_opener.assert_not_called()

    def test_acknowledgement_response_must_match_every_field_exactly(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = self.config(root)
            repo, release_sha = self.repo(root)
            expected = self.acknowledgement(release_sha)
            malformed = [
                {**expected, "acknowledged": False},
                {**expected, "acknowledged": 1},
                {**expected, "runId": "other-run"},
                {**expected, "releaseSha": OTHER_SHA},
                {**expected, "verificationId": "d" * 32},
                {**expected, "unexpected": True},
                [expected],
            ]
            for payload in malformed:
                with self.subTest(payload=payload), patch.object(
                    PROBE.urllib.request,
                    "build_opener",
                    return_value=Opener(Response(payload)),
                ):
                    with self.assertRaises(RuntimeError):
                        PROBE.probe(
                            RUN_ID,
                            release_sha,
                            VERIFICATION_ID,
                            "terminal-a",
                            repo,
                            config,
                        )

    def test_malformed_inputs_and_config_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo, release_sha = self.repo(root)
            cases = (
                ("bad/run", release_sha, VERIFICATION_ID, "terminal-a", {}),
                (RUN_ID, "A" * 40, VERIFICATION_ID, "terminal-a", {}),
                (RUN_ID, release_sha, "short", "terminal-a", {}),
                (RUN_ID, release_sha, VERIFICATION_ID, "bad client", {}),
                (RUN_ID, release_sha, VERIFICATION_ID, "terminal-a", {"CLIENT_ID": "other"}),
                (RUN_ID, release_sha, VERIFICATION_ID, "terminal-a", {"REQUEST_TIMEOUT": "nan"}),
                (RUN_ID, release_sha, VERIFICATION_ID, "terminal-a", {"TLS_SKIP_VERIFY": "yes"}),
                (
                    RUN_ID,
                    release_sha,
                    VERIFICATION_ID,
                    "terminal-a",
                    {"API_BASE_URL": "https://user:password@pi5.example/api"},
                ),
            )
            for index, (run_id, sha, verification_id, client_id, overrides) in enumerate(cases):
                with self.subTest(index=index):
                    config = self.config(root, **overrides)
                    with self.assertRaises((ValueError, RuntimeError)):
                        PROBE.probe(
                            run_id,
                            sha,
                            verification_id,
                            client_id,
                            repo,
                            config,
                        )

    def test_oversized_response_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = self.config(root)
            repo, release_sha = self.repo(root)
            opener = Opener(RawResponse(b"x" * (PROBE.MAX_RESPONSE_BYTES + 1)))
            with patch.object(
                PROBE.urllib.request, "build_opener", return_value=opener
            ):
                with self.assertRaises(RuntimeError):
                    PROBE.probe(
                        RUN_ID,
                        release_sha,
                        VERIFICATION_ID,
                        "terminal-a",
                        repo,
                        config,
                    )

    def test_redirects_are_rejected_before_the_key_can_be_forwarded(self):
        handler = PROBE._RejectRedirect()
        request = urllib.request.Request(
            "https://pi5.example/api/system/deploy-status/ack",
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
            root = Path(temporary)
            secret = "do-not-disclose-this-key"
            config = self.config(root, CLIENT_KEY=secret, REQUEST_TIMEOUT="0")
            repo, release_sha = self.repo(root)
            command = [
                "python3",
                str(SCRIPT),
                "--run-id",
                RUN_ID,
                "--release-sha",
                release_sha,
                "--verification-id",
                VERIFICATION_ID,
                "--expected-client-id",
                "terminal-a",
                "--repo",
                str(repo),
                "--config",
                str(config),
            ]
            completed = subprocess.run(command, text=True, capture_output=True)

        self.assertNotIn(secret, command)
        self.assertNotEqual(completed.returncode, 0)
        self.assertNotIn(secret, completed.stdout + completed.stderr)
        self.assertEqual(completed.stderr.strip(), "terminal ready verification failed")


if __name__ == "__main__":
    unittest.main()
