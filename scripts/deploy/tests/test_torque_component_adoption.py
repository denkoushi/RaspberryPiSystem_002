from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

from scripts.deploy import torque_component_adoption as adoption


def index_document(
    *, arm64: str = adoption.ARM64_DIGEST, armv7: str = adoption.ARMV7_DIGEST
) -> bytes:
    return json.dumps(
        {
            "schemaVersion": 2,
            "manifests": [
                {
                    "digest": arm64,
                    "platform": {"os": "linux", "architecture": "arm64"},
                },
                {
                    "digest": armv7,
                    "platform": {"os": "linux", "architecture": "arm", "variant": "v7"},
                },
                {
                    "digest": "sha256:" + "9" * 64,
                    "platform": {"os": "unknown", "architecture": "unknown"},
                },
            ],
        }
    ).encode()


class TorqueComponentAdoptionTests(unittest.TestCase):
    def test_predicate_keeps_build_and_adoption_identity_separate(self) -> None:
        predicate = adoption.adoption_predicate(
            adoption_sha="a" * 40,
            workflow=".github/workflows/ci.yml",
            run_id=123,
            run_attempt=2,
            index_raw=index_document(),
        )

        self.assertEqual(
            predicate["predicateType"], adoption.TORQUE_ADOPTION_PREDICATE_TYPE
        )
        self.assertNotIn("buildType", predicate)
        self.assertEqual(
            predicate["originalBuild"]["sourceSha"], adoption.ORIGINAL_SOURCE_SHA
        )  # type: ignore[index]
        self.assertEqual(predicate["adoption"]["sourceSha"], "a" * 40)  # type: ignore[index]
        self.assertEqual(
            predicate["securityScan"]["results"],  # type: ignore[index]
            [
                {
                    "platform": "linux/arm64",
                    "digest": adoption.ARM64_DIGEST,
                    "result": "passed",
                },
                {
                    "platform": "linux/arm/v7",
                    "digest": adoption.ARMV7_DIGEST,
                    "result": "passed",
                },
            ],
        )
        adoption.validate_adoption_predicate(
            predicate,
            adoption_sha="a" * 40,
            workflow=".github/workflows/ci.yml",
            run_id=123,
            run_attempt=2,
        )
        predicate["securityScan"]["results"][0]["result"] = "unknown"  # type: ignore[index]
        with self.assertRaisesRegex(adoption.AdoptionError, "fixed evidence"):
            adoption.validate_adoption_predicate(
                predicate,
                adoption_sha="a" * 40,
                workflow=".github/workflows/ci.yml",
                run_id=123,
                run_attempt=2,
            )

    def test_rejects_changed_or_incomplete_platform_index(self) -> None:
        with self.assertRaisesRegex(adoption.AdoptionError, "fixed torque"):
            adoption.platform_digests(index_document(armv7="sha256:" + "8" * 64))
        missing = json.dumps(
            {
                "manifests": [
                    {
                        "digest": adoption.ARM64_DIGEST,
                        "platform": {"os": "linux", "architecture": "arm64"},
                    }
                ]
            }
        ).encode()
        with self.assertRaisesRegex(adoption.AdoptionError, "fixed torque"):
            adoption.platform_digests(missing)

    def test_source_closure_requires_ancestry_and_no_path_diff(self) -> None:
        calls: list[list[str]] = []

        def successful(
            command: list[str], **_: object
        ) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

        adoption.verify_source_closure(
            Path("/repo"), "a" * 40, "b" * 40, run=successful
        )
        self.assertEqual(calls[0][:3], ["git", "merge-base", "--is-ancestor"])
        self.assertEqual(calls[1][-2:], list(adoption.SOURCE_CLOSURE))

        def changed(
            command: list[str], **_: object
        ) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(
                command, 0 if command[1] == "merge-base" else 1
            )

        with self.assertRaisesRegex(adoption.AdoptionError, "source closure changed"):
            adoption.verify_source_closure(
                Path("/repo"), "a" * 40, "b" * 40, run=changed
            )


if __name__ == "__main__":
    unittest.main()
