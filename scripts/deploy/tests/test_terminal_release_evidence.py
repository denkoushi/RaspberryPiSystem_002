#!/usr/bin/env python3
from __future__ import annotations

import base64
import contextlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest import mock

from scripts.deploy.rolling_release import terminal_release_evidence as evidence


SHA = "a" * 40


class TerminalReleaseEvidenceTest(unittest.TestCase):
    def test_collect_composes_the_existing_proofs_without_weakening_them(self):
        commands: list[list[str]] = []
        health_arguments = []

        def run(command, *, cwd=None):
            del cwd
            commands.append(command)
            if command[:3] == ["git", "-C", "/candidate"]:
                return SHA + "\n"
            if command[:3] == ["systemctl", "show", "--property=Result"]:
                return "success\n"
            return ""

        identity = SimpleNamespace(
            probe=mock.Mock(
                return_value={"authenticated": True, "statusClientId": "tools03"}
            )
        )

        def stable_probe(arguments):
            health_arguments.append(arguments)
            return arguments.port or 7073

        health = SimpleNamespace(
            _validate_arguments=mock.Mock(),
            _stable_probe=mock.Mock(side_effect=stable_probe),
        )

        def import_module(name):
            return {
                "terminal_identity_probe": identity,
                "terminal_agent_health_probe": health,
            }[name]

        with mock.patch.object(evidence, "_run", side_effect=run), mock.patch.object(
            evidence.importlib, "import_module", side_effect=import_module
        ):
            result = evidence.collect(
                expected_client_id="tools03",
                services=["lightdm.service", "status-agent.timer"],
                check_status_agent_result=True,
                agent_specs=["nfc-agent:7071:1", "torque-agent:auto:0"],
                repository=evidence.Path("/candidate"),
                compose_file=evidence.Path("/candidate/compose.yml"),
            )

        self.assertEqual(
            result,
            {
                "version": 1,
                "currentSha": SHA,
                "activeSystemdUnits": [
                    "lightdm.service",
                    "status-agent.timer",
                ],
                "oneshotServices": ["status-agent.service"],
                "identity": {
                    "authenticated": True,
                    "statusClientId": "tools03",
                },
                "agentContainers": ["nfc-agent", "torque-agent"],
                "authenticatedAgentEndpoints": [
                    {"agent": "nfc-agent", "port": 7071},
                    {"agent": "torque-agent", "port": 7073},
                ],
                "pcscdRequired": True,
            },
        )
        identity.probe.assert_called_once_with("tools03")
        self.assertEqual(
            [command for command in commands if command[:2] == ["systemctl", "is-active"]],
            [
                ["systemctl", "is-active", "--quiet", "lightdm.service"],
                ["systemctl", "is-active", "--quiet", "status-agent.timer"],
            ],
        )
        self.assertEqual(
            [(item.agent, item.port, item.require_pcscd) for item in health_arguments],
            [("nfc-agent", 7071, True), ("torque-agent", None, False)],
        )

    def test_agent_contract_requires_pcscd_exactly_for_nfc(self):
        for value in ("nfc-agent:7071:0", "barcode-agent:7072:1"):
            with self.subTest(value=value), self.assertRaises(evidence.EvidenceError):
                evidence._parse_agent_spec(value)

    def test_identity_or_health_disagreement_fails_closed(self):
        identity = SimpleNamespace(
            probe=mock.Mock(
                return_value={"authenticated": True, "statusClientId": "other"}
            )
        )
        with mock.patch.object(evidence, "_current_sha", return_value=SHA), mock.patch.object(
            evidence, "_run", return_value=""
        ), mock.patch.object(evidence.importlib, "import_module", return_value=identity):
            with self.assertRaisesRegex(evidence.EvidenceError, "identity proof"):
                evidence.collect(
                    expected_client_id="tools03",
                    services=["lightdm.service"],
                    check_status_agent_result=False,
                    agent_specs=[],
                )

    def test_marker_is_canonical_and_unexpected_error_text_is_not_emitted(self):
        result = {
            "version": 1,
            "currentSha": SHA,
            "activeSystemdUnits": ["lightdm.service"],
            "oneshotServices": [],
            "identity": {"authenticated": True, "statusClientId": "tools03"},
            "agentContainers": [],
            "authenticatedAgentEndpoints": [],
            "pcscdRequired": False,
        }
        stdout = io.StringIO()
        with mock.patch.object(
            evidence, "collect", return_value=result
        ), contextlib.redirect_stdout(stdout):
            code = evidence.main(
                [
                    "--expected-client-id",
                    "tools03",
                    "--service",
                    "lightdm.service",
                    "--ansible-marker",
                ]
            )
        self.assertEqual(code, 0)
        encoded = stdout.getvalue().strip().removeprefix(evidence.MARKER_PREFIX)
        decoded = base64.urlsafe_b64decode(encoded).decode("utf-8")
        self.assertEqual(json.loads(decoded), result)
        self.assertEqual(
            base64.urlsafe_b64encode(decoded.encode("utf-8")).decode("ascii"), encoded
        )

        stdout = io.StringIO()
        stderr = io.StringIO()
        secret = "DO-NOT-PRINT-RELEASE-SECRET"
        with mock.patch.object(
            evidence, "collect", side_effect=RuntimeError(secret)
        ), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = evidence.main(
                [
                    "--expected-client-id",
                    "tools03",
                    "--service",
                    "lightdm.service",
                    "--ansible-marker",
                ]
            )
        self.assertEqual(code, 1)
        self.assertNotIn(secret, stdout.getvalue() + stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
