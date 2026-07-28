from __future__ import annotations

import json
import unittest

from scripts.deploy.release_artifact_contract import (
    ReleaseArtifactError,
    canonical_release_set_json,
    parse_release_set,
    validate_release_set,
)


REPOSITORY = "denkoushi/RaspberryPiSystem_002"
SHA = "a" * 40
CONFIG_HASH = "b" * 64
WORKFLOW = ".github/workflows/ci.yml"


def valid_release_set() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "source": {
            "repository": REPOSITORY,
            "sha": SHA,
            "ref": "refs/heads/main",
        },
        "configHash": CONFIG_HASH,
        "platform": {"os": "linux", "architecture": "arm64"},
        "images": {
            "api": {
                "repository": "ghcr.io/denkoushi/raspisys-api",
                "digest": "sha256:" + "1" * 64,
            },
            "web": {
                "repository": "ghcr.io/denkoushi/raspisys-web",
                "digest": "sha256:" + "2" * 64,
            },
        },
        "workflow": {"path": WORKFLOW, "runId": 1234, "runAttempt": 1},
    }


class ReleaseArtifactContractTests(unittest.TestCase):
    def test_round_trip_and_exact_policy(self) -> None:
        release_set = parse_release_set(json.dumps(valid_release_set()))
        validate_release_set(
            release_set, REPOSITORY, SHA, CONFIG_HASH, WORKFLOW
        )
        self.assertEqual(
            parse_release_set(canonical_release_set_json(release_set)), release_set
        )

    def test_rejects_duplicate_unknown_and_partial_image_fields(self) -> None:
        duplicate = json.dumps(valid_release_set()).replace(
            '"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'
        )
        with self.assertRaisesRegex(ReleaseArtifactError, "duplicate"):
            parse_release_set(duplicate)

        unknown = valid_release_set()
        unknown["token"] = "forbidden"
        with self.assertRaisesRegex(ReleaseArtifactError, "unknown"):
            parse_release_set(json.dumps(unknown))

        partial = valid_release_set()
        images = partial["images"]
        assert isinstance(images, dict)
        images.pop("web")
        with self.assertRaisesRegex(ReleaseArtifactError, "unknown"):
            parse_release_set(json.dumps(partial))

    def test_rejects_source_config_platform_and_workflow_drift(self) -> None:
        changes = (
            ("source", {"repository": REPOSITORY, "sha": "c" * 40, "ref": "refs/heads/main"}),
            ("configHash", "d" * 64),
            ("platform", {"os": "linux", "architecture": "amd64"}),
            ("workflow", {"path": ".github/workflows/other.yml", "runId": 1234, "runAttempt": 1}),
        )
        for key, value in changes:
            document = valid_release_set()
            document[key] = value
            if key in {"platform"}:
                with self.assertRaises(ReleaseArtifactError):
                    parse_release_set(json.dumps(document))
            else:
                release_set = parse_release_set(json.dumps(document))
                with self.assertRaises(ReleaseArtifactError):
                    validate_release_set(
                        release_set, REPOSITORY, SHA, CONFIG_HASH, WORKFLOW
                    )

    def test_rejects_mutable_tags_and_invalid_digests(self) -> None:
        document = valid_release_set()
        images = document["images"]
        assert isinstance(images, dict)
        api = images["api"]
        assert isinstance(api, dict)
        api["repository"] = "ghcr.io/denkoushi/raspisys-api:latest"
        with self.assertRaisesRegex(ReleaseArtifactError, "malformed"):
            parse_release_set(json.dumps(document))

    def test_rejects_redirected_api_image_repository(self) -> None:
        document = valid_release_set()
        images = document["images"]
        assert isinstance(images, dict)
        api = images["api"]
        assert isinstance(api, dict)
        api["repository"] = "ghcr.io/denkoushi/other-api"

        release_set = parse_release_set(json.dumps(document))
        with self.assertRaisesRegex(ReleaseArtifactError, "API image repository"):
            validate_release_set(
                release_set, REPOSITORY, SHA, CONFIG_HASH, WORKFLOW
            )


if __name__ == "__main__":
    unittest.main()
