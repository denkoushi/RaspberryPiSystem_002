from __future__ import annotations

import argparse
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.deploy.rolling_release import signage_artifact_preflight as preflight
from scripts.deploy.rolling_release import signage_artifact_stage as stage
from scripts.deploy.rolling_release.backends.command import CommandResult


SOURCE_SHA = "a" * 40
OCI_DIGEST = "sha256:" + "d" * 64
PREFLIGHT_ID = "20260806-160000-abcdef"
HOST = "raspberrypi3"


def inventory() -> dict[str, object]:
    return {
        "server": {"hosts": ["raspberrypi5"]},
        "clients": {"children": ["signage"]},
        "kiosk": {"hosts": []},
        "signage": {"hosts": [HOST]},
        "kiosk_canary": {"hosts": []},
        "signage_canary": {"hosts": [HOST]},
        "_meta": {
            "hostvars": {
                "raspberrypi5": {
                    "status_agent_client_id": "raspberrypi5-server",
                },
                HOST: {
                    "ansible_host": "100.64.0.3",
                    "ansible_user": "signageras3",
                    "status_agent_client_id": "raspberrypi3-signage1",
                    "manage_signage_lite": True,
                    "tailscale_enabled": True,
                },
            }
        },
    }


def passing_stage_report() -> dict[str, object]:
    root = stage.DEFAULT_STAGING_ROOT
    paths = stage._stage_paths(root, PREFLIGHT_ID)
    checked = [
        str(paths[key])
        for key in (
            "incomingArtifact",
            "incomingDescriptor",
            "readyArtifact",
            "readyDescriptor",
            "incoming",
            "ready",
            "run",
            "root",
        )
    ]
    report = stage._empty_report(
        f"{stage.ARTIFACT_REPOSITORY}:{SOURCE_SHA}",
        {"host": HOST},
        PREFLIGHT_ID,
        root,
        False,
    )
    report.update(
        {
            "status": "passed",
            "lifecycle": [
                "acquired",
                "attested",
                "controller-verified",
                "target-prepared",
                "transferred",
                "temporary-verified",
                "atomically-promoted",
                "ready-verified",
                "cleaned",
            ],
            "artifact": {
                "reference": f"{stage.ARTIFACT_REPOSITORY}:{SOURCE_SHA}",
                "exactReference": f"{stage.ARTIFACT_REPOSITORY}@{OCI_DIGEST}",
                "ociDigest": OCI_DIGEST,
                "sourceSha": SOURCE_SHA,
                "artifactSha256": "1" * 64,
                "manifestSha256": "2" * 64,
                "payloadDigest": "3" * 64,
            },
            "cleanupReceipt": {
                "schemaVersion": 1,
                "runId": PREFLIGHT_ID,
                "host": HOST,
                "artifactDigest": "1" * 64,
                "stagingPath": str(paths["run"]),
                "checkedPaths": checked,
                "removedPaths": [str(paths["run"])],
                "residuePaths": [],
                "residue": False,
                "status": "passed",
            },
        }
    )
    return report


class FakeRuntime:
    PROJECT = Path("/tmp/project")
    ANSIBLE_DIRECTORY = PROJECT / "infrastructure/ansible"
    os = SimpleNamespace(
        environ={"RASPI_SERVER_HOST": "denkon5sd02@100.106.158.2"}
    )

    @staticmethod
    def run(command, *, cwd=None, capture=False, env=None):
        if command[-2:] == ["status", "--porcelain"]:
            return ""
        if command[-2:] == ["rev-parse", "HEAD"]:
            return SOURCE_SHA + "\n"
        if command[-2:] == ["rev-parse", "origin/main"]:
            return SOURCE_SHA + "\n"
        raise AssertionError(f"unexpected command: {command}")


class FakeBackend:
    calls: list[dict[str, object]] = []

    def __init__(self, _transport):
        pass

    def preflight_pi3_signage_artifact(self, **kwargs):
        self.calls.append(dict(kwargs))
        return CommandResult(
            ("ssh",), 0, json.dumps(passing_stage_report()), ""
        )


class SignageArtifactPreflightTest(unittest.TestCase):
    def setUp(self) -> None:
        FakeBackend.calls.clear()

    def request(self) -> argparse.Namespace:
        return argparse.Namespace(
            source_sha=SOURCE_SHA,
            oci_digest=OCI_DIGEST,
            preflight_id=PREFLIGHT_ID,
            inventory="infrastructure/ansible/inventory.yml",
        )

    def test_dedicated_entry_returns_explicit_non_deploy_envelope(self):
        with (
            patch.object(preflight, "SystemdBackend", FakeBackend),
            patch.object(preflight, "_inventory_path", return_value=Path("/tmp/inventory.yml")),
            patch.object(preflight, "read_only_inventory_json", return_value=inventory()),
            patch.object(
                preflight.application,
                "validate_remote_server_identity",
                return_value={
                    "host": "raspberrypi5",
                    "clientId": "raspberrypi5-server",
                },
            ),
            patch.object(
                preflight.application,
                "build_server_transport",
                return_value=("denkon5sd02", object()),
            ),
        ):
            code, report = preflight.execute(self.request(), runtime=FakeRuntime())

        self.assertEqual(code, 0)
        self.assertEqual(report["mode"], "pi3-signage-artifact-preflight")
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["preflightId"], PREFLIGHT_ID)
        self.assertEqual(report["targetHost"], HOST)
        self.assertEqual(report["inputAuthority"]["ociDigest"], OCI_DIGEST)
        self.assertFalse(report["deployAuthority"]["runCreated"])
        self.assertFalse(report["deployAuthority"]["fleetStateMutated"])
        self.assertFalse(report["deployAuthority"]["claimsMutated"])
        self.assertEqual(
            report["stageReport"]["artifact"]["manifestSha256"], "2" * 64
        )
        self.assertFalse(report["stageReport"]["cleanupReceipt"]["residue"])
        self.assertEqual(len(FakeBackend.calls), 1)
        self.assertEqual(FakeBackend.calls[0]["oci_digest"], OCI_DIGEST)

    def test_entry_rejects_non_exact_main_without_contacting_pi5(self):
        class WrongHeadRuntime(FakeRuntime):
            @staticmethod
            def run(command, *, cwd=None, capture=False, env=None):
                if command[-2:] == ["status", "--porcelain"]:
                    return ""
                if command[-2:] == ["rev-parse", "HEAD"]:
                    return "b" * 40 + "\n"
                return SOURCE_SHA + "\n"

        with patch.object(
            preflight,
            "read_only_inventory_json",
            side_effect=AssertionError("inventory must not be loaded"),
        ):
            code, report = preflight.execute(
                self.request(), runtime=WrongHeadRuntime()
            )

        self.assertEqual(code, 78)
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["failure"]["code"], "source-not-exact-main")
        self.assertEqual(FakeBackend.calls, [])

    def test_cli_requires_digest_source_inventory_and_preflight_id(self):
        with self.assertRaises(SystemExit):
            preflight.parse_args([])
        args = preflight.parse_args(
            [
                "--source-sha",
                SOURCE_SHA,
                "--oci-digest",
                OCI_DIGEST,
                "--preflight-id",
                PREFLIGHT_ID,
                "--inventory",
                "infrastructure/ansible/inventory.yml",
            ]
        )
        self.assertEqual(args.oci_digest, OCI_DIGEST)


if __name__ == "__main__":
    unittest.main()
