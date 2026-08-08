from __future__ import annotations

import re
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from scripts.deploy.rolling_release import application
from scripts.deploy.rolling_release.backends.command import CommandResult


class RecordingCommandRunner:
    def __init__(self) -> None:
        self.argv = None

    def run(self, argv, **_kwargs):
        self.argv = tuple(argv)
        return CommandResult(self.argv, 0, stdout="{}")


class Runtime:
    FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
    os = SimpleNamespace(
        environ={
            "RASPI_SERVER_HOST": "pi5.example",
            "RASPI_SERVER_SSH_OPTS": "",
        }
    )


class ReleaseApplicationTest(unittest.TestCase):
    def test_server_transport_normalizes_ip_and_honors_configured_options(self):
        runtime = SimpleNamespace(
            os=SimpleNamespace(
                environ={
                    "RASPI_SERVER_HOST": "100.64.1.2",
                    "RASPI_SERVER_SSH_OPTS": "-o ServerAliveInterval=7 -p 2222",
                }
            )
        )
        runner = RecordingCommandRunner()

        remote_user, transport = application.build_server_transport(
            runtime, runner=runner
        )
        transport.run(["cat", "/tmp/state.json"])

        self.assertEqual(remote_user, application.DEFAULT_REMOTE_USER)
        self.assertEqual(
            runner.argv,
            (
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=15",
                "-o",
                "ServerAliveInterval=7",
                "-p",
                "2222",
                "--",
                f"{application.DEFAULT_REMOTE_USER}@100.64.1.2",
                "cat /tmp/state.json",
            ),
        )

    def test_remote_identity_probe_returns_only_client_id_and_never_requests_key(self):
        transport = SimpleNamespace(
            run=Mock(
                return_value=CommandResult(
                    ("ssh",), 0, stdout="raspberrypi5-server\n"
                )
            )
        )
        with patch.object(
            application,
            "build_server_transport",
            return_value=("denkon5sd02", transport),
        ):
            value = application.read_remote_server_client_id(runtime=Runtime)

        self.assertEqual(value, "raspberrypi5-server")
        command = transport.run.call_args.args[0]
        self.assertNotIn("CLIENT_KEY", "\n".join(command))
        self.assertNotIn("cat", command)


if __name__ == "__main__":
    unittest.main()
