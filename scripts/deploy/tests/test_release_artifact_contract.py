from __future__ import annotations

import json
import unittest

from scripts.deploy.release_artifact_contract import (
    TORQUE_ADOPTED_SOURCE_SHA,
    TORQUE_ADOPTION_PREDICATE_TYPE,
    TORQUE_PROTOCOL_SOURCE_CLOSURE,
    TORQUE_REHEARSAL_CONTRACTS,
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


def valid_release_set_v2() -> dict[str, object]:
    document = valid_release_set()
    document["schemaVersion"] = 2
    images = document["images"]
    assert isinstance(images, dict)
    api = images["api"]
    web = images["web"]
    assert isinstance(api, dict) and isinstance(web, dict)
    torque_digest = "sha256:" + "3" * 64
    document["components"] = {
        "torqueAgent": {
            "repository": "ghcr.io/denkoushi/raspisys-torque-agent",
            "indexDigest": torque_digest,
            "sourceSha": TORQUE_ADOPTED_SOURCE_SHA,
            "platforms": [
                {
                    "os": "linux",
                    "architecture": "arm64",
                    "digest": "sha256:" + "4" * 64,
                },
                {
                    "os": "linux",
                    "architecture": "arm",
                    "variant": "v7",
                    "digest": "sha256:" + "5" * 64,
                },
            ],
            "adoption": {
                "predicateType": TORQUE_ADOPTION_PREDICATE_TYPE,
                "originalWorkflow": {
                    "path": WORKFLOW,
                    "runId": 32093659078,
                    "jobId": 95581851495,
                },
            },
        }
    }
    document["compatibility"] = {
        "torqueOwnership": {
            "protocol": {"name": "torque-ownership", "version": 1},
            "components": {
                "api": api["digest"],
                "web": web["digest"],
                "torqueAgent": torque_digest,
            },
            "sourceClosure": {
                "baselineSha": TORQUE_ADOPTED_SOURCE_SHA,
                "releaseSha": SHA,
                "paths": list(TORQUE_PROTOCOL_SOURCE_CLOSURE),
                "unchanged": True,
            },
            "rehearsal": {
                "workflow": {"path": WORKFLOW, "runId": 1234, "runAttempt": 1},
                "job": "torque-release-compatibility",
                "result": "passed",
                "evidenceDigest": "sha256:" + "6" * 64,
                "contracts": list(TORQUE_REHEARSAL_CONTRACTS),
            },
        }
    }
    return document


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

    def test_v2_round_trip_binds_the_exact_compatible_component_tuple(self) -> None:
        release_set = parse_release_set(json.dumps(valid_release_set_v2()))
        self.assertEqual(release_set.schema_version, 2)
        self.assertIsNotNone(release_set.torque_agent)
        self.assertIsNotNone(release_set.torque_compatibility)
        self.assertEqual(
            parse_release_set(canonical_release_set_json(release_set)), release_set
        )
        validate_release_set(release_set, REPOSITORY, SHA, CONFIG_HASH, WORKFLOW)

    def test_v2_rejects_missing_armv7_and_tuple_substitution(self) -> None:
        missing = valid_release_set_v2()
        missing["components"]["torqueAgent"]["platforms"].pop()  # type: ignore[index]
        with self.assertRaisesRegex(ReleaseArtifactError, "component identity"):
            parse_release_set(json.dumps(missing))

        substituted = valid_release_set_v2()
        substituted["compatibility"]["torqueOwnership"]["components"]["torqueAgent"] = (  # type: ignore[index]
            "sha256:" + "9" * 64
        )
        with self.assertRaisesRegex(ReleaseArtifactError, "mismatched"):
            parse_release_set(json.dumps(substituted))

    def test_v2_rejects_wrong_protocol_and_provenance_predicate(self) -> None:
        protocol = valid_release_set_v2()
        protocol["compatibility"]["torqueOwnership"]["protocol"]["version"] = 2  # type: ignore[index]
        with self.assertRaisesRegex(ReleaseArtifactError, "compatibility"):
            parse_release_set(json.dumps(protocol))

        provenance = valid_release_set_v2()
        provenance["components"]["torqueAgent"]["adoption"]["predicateType"] = (  # type: ignore[index]
            "https://slsa.dev/provenance/v1"
        )
        with self.assertRaisesRegex(ReleaseArtifactError, "adoption"):
            parse_release_set(json.dumps(provenance))

    def test_v2_rejects_unproved_source_closure_and_rehearsal_result(self) -> None:
        closure = valid_release_set_v2()
        closure["compatibility"]["torqueOwnership"]["sourceClosure"]["paths"].pop()  # type: ignore[index]
        with self.assertRaisesRegex(ReleaseArtifactError, "compatibility"):
            parse_release_set(json.dumps(closure))

        failed = valid_release_set_v2()
        failed["compatibility"]["torqueOwnership"]["rehearsal"]["result"] = "failed"  # type: ignore[index]
        with self.assertRaisesRegex(ReleaseArtifactError, "compatibility"):
            parse_release_set(json.dumps(failed))

        missing_contract = valid_release_set_v2()
        missing_contract["compatibility"]["torqueOwnership"]["rehearsal"][  # type: ignore[index]
            "contracts"
        ].pop()
        with self.assertRaisesRegex(ReleaseArtifactError, "compatibility"):
            parse_release_set(json.dumps(missing_contract))


if __name__ == "__main__":
    unittest.main()
