#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import contextlib
import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from scripts.deploy.rolling_release import terminal_manifest_capture as capture


SHA = "a" * 40


def arguments(**overrides):
    values = {
        "elevated": True,
        "remote_user": "tools03",
        "remote_home": "/home/tools03",
        "file_root": Path("/var/lib/raspi-release/rollback-manifests"),
        "runtime_root": Path("/var/lib/raspi-release/rollback-runtime"),
        "run_id": "run-123",
        "host": "kiosk-a",
        "repository": Path("/opt/RaspberryPiSystem_002"),
        "expected_head": SHA,
        "path_template": [],
        "path": ["/etc/example", "/home/tools03/.config/example"],
        "unit": ["lightdm.service"],
        "restart_on_restore_unit": [],
        "docker_service": ["nfc-agent"],
        "compose_project": "docker",
        "compose_working_directory": Path(
            "/opt/RaspberryPiSystem_002/infrastructure/docker"
        ),
        "compose_config_file": [
            Path(
                "/opt/RaspberryPiSystem_002/infrastructure/docker/"
                "docker-compose.client.yml"
            )
        ],
        "ansible_marker": True,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


class RuntimeFailure(RuntimeError):
    code = "runtime.stability"


class TerminalManifestCaptureTest(unittest.TestCase):
    def _root_identity(self):
        return (
            mock.patch.object(capture.os, "geteuid", return_value=0),
            mock.patch.object(
                capture.pwd,
                "getpwnam",
                return_value=SimpleNamespace(pw_dir="/home/tools03"),
            ),
        )

    def test_capture_preserves_separate_file_and_runtime_authorities(self):
        file_result = {"manifestSha256": "b" * 64, "authority": "file"}
        runtime_result = {"manifestSha256": "c" * 64, "authority": "runtime"}
        rollback = SimpleNamespace(capture_set=mock.Mock(return_value=file_result))
        runtime = SimpleNamespace(capture=mock.Mock(return_value=runtime_result))
        geteuid, getpwnam = self._root_identity()

        with geteuid, getpwnam:
            result = capture.capture_all(
                arguments(), rollback_module=rollback, runtime_module=runtime
            )

        self.assertEqual(
            result,
            {
                "version": 1,
                "remoteUser": "tools03",
                "remoteHome": "/home/tools03",
                "fileManifest": file_result,
                "runtimeManifest": runtime_result,
            },
        )
        rollback.capture_set.assert_called_once_with(
            root=Path("/var/lib/raspi-release/rollback-manifests"),
            run_id="run-123",
            host="kiosk-a",
            paths=["/etc/example", "/home/tools03/.config/example"],
            repository=Path("/opt/RaspberryPiSystem_002"),
            expected_head=SHA,
        )
        runtime.capture.assert_called_once_with(
            root=Path("/var/lib/raspi-release/rollback-runtime"),
            run_id="run-123",
            host="kiosk-a",
            units=["lightdm.service"],
            docker_services=["nfc-agent"],
            restart_on_restore_units=[],
            compose_project="docker",
            compose_working_directory=Path(
                "/opt/RaspberryPiSystem_002/infrastructure/docker"
            ),
            compose_config_files=[
                Path(
                    "/opt/RaspberryPiSystem_002/infrastructure/docker/"
                    "docker-compose.client.yml"
                )
            ],
        )

    def test_partial_success_is_fail_closed_and_retry_reuses_same_authorities(self):
        file_result = {"manifestSha256": "b" * 64, "authority": "file"}
        runtime_result = {"manifestSha256": "c" * 64, "authority": "runtime"}
        rollback = SimpleNamespace(capture_set=mock.Mock(return_value=file_result))
        runtime = SimpleNamespace(
            capture=mock.Mock(side_effect=[RuntimeFailure("secret"), runtime_result])
        )
        geteuid, getpwnam = self._root_identity()

        with geteuid, getpwnam:
            with self.assertRaisesRegex(
                capture.CaptureEnvelopeError, "runtime manifest capture failed"
            ) as raised:
                capture.capture_all(
                    arguments(), rollback_module=rollback, runtime_module=runtime
                )
            result = capture.capture_all(
                arguments(), rollback_module=rollback, runtime_module=runtime
            )

        self.assertEqual(raised.exception.stage, "runtime")
        self.assertEqual(raised.exception.code, "runtime.stability")
        self.assertNotIn("secret", str(raised.exception))
        self.assertEqual(result["fileManifest"], file_result)
        self.assertEqual(result["runtimeManifest"], runtime_result)
        self.assertEqual(rollback.capture_set.call_count, 2)
        self.assertEqual(runtime.capture.call_count, 2)

    def test_non_root_transport_resolves_identity_before_one_sudo_reexec(self):
        args = arguments(
            elevated=False,
            remote_user=None,
            remote_home=None,
            path=[],
            path_template=[
                "/etc/sudoers.d/@REMOTE_USER@",
                "@REMOTE_HOME@/.config/example",
            ],
        )
        completed = subprocess.CompletedProcess([], 0, "child-output\n", "")
        stdout = io.StringIO()
        with mock.patch.object(
            capture, "_invoking_identity", return_value=("tools03", "/home/tools03")
        ), mock.patch.object(
            capture.subprocess, "run", return_value=completed
        ) as run, mock.patch.object(
            sys, "argv", [capture.__file__]
        ), contextlib.redirect_stdout(stdout):
            code = capture._run_elevated(args)

        self.assertEqual(code, 0)
        self.assertEqual(stdout.getvalue(), "child-output\n")
        command = run.call_args.args[0]
        self.assertEqual(command[:3], ["/usr/bin/sudo", "-n", "/usr/bin/python3"])
        self.assertIn("--elevated", command)
        self.assertIn("/etc/sudoers.d/tools03", command)
        self.assertIn("/home/tools03/.config/example", command)
        self.assertNotIn(capture.REMOTE_USER_TOKEN, " ".join(command))
        self.assertNotIn(capture.REMOTE_HOME_TOKEN, " ".join(command))

    def test_unexpected_failure_marker_never_contains_exception_text(self):
        secret = "DO-NOT-PRINT-MANIFEST-SECRET"
        stdout = io.StringIO()
        stderr = io.StringIO()
        argv = [
            "--elevated",
            "--remote-user",
            "tools03",
            "--remote-home",
            "/home/tools03",
            "--file-root",
            "/var/lib/raspi-release/rollback-manifests",
            "--runtime-root",
            "/var/lib/raspi-release/rollback-runtime",
            "--run-id",
            "run-123",
            "--host",
            "kiosk-a",
            "--repository",
            "/opt/RaspberryPiSystem_002",
            "--expected-head",
            SHA,
            "--path",
            "/etc/example",
            "--ansible-marker",
        ]
        with mock.patch.object(
            capture, "capture_all", side_effect=RuntimeError(secret)
        ), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = capture.main(argv)

        self.assertEqual(code, 1)
        output = stdout.getvalue() + stderr.getvalue()
        self.assertNotIn(secret, output)
        encoded = stdout.getvalue().strip().removeprefix(capture.ERROR_MARKER_PREFIX)
        value = json.loads(base64.urlsafe_b64decode(encoded))
        self.assertEqual(
            value,
            {
                "version": 1,
                "stage": "identity",
                "code": "capture.internal",
                "message": "terminal manifest capture failed",
            },
        )

    def test_path_templates_reject_traversal_and_duplicates(self):
        for templates in (
            ["@REMOTE_HOME@/../root"],
            ["/etc/example", "/etc/example"],
            ["relative/path"],
        ):
            with self.subTest(templates=templates), self.assertRaises(
                capture.CaptureEnvelopeError
            ):
                capture._concrete_paths(templates, "tools03", "/home/tools03")


if __name__ == "__main__":
    unittest.main()
