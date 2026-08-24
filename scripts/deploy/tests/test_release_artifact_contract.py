from __future__ import annotations

import json
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from scripts.deploy.release_artifact_contract import (
    TORQUE_ADOPTED_SOURCE_SHA,
    TORQUE_ADOPTION_PREDICATE_TYPE,
    TORQUE_PROTOCOL_SOURCE_CLOSURE,
    TORQUE_REHEARSAL_CONTRACTS,
    ReleaseArtifactError,
    canonical_release_set_json,
    main,
    parse_release_set,
    validate_torque_composition_reuse,
    validate_release_set,
)

REPOSITORY = "denkoushi/RaspberryPiSystem_002"
SHA = "a" * 40
CONFIG_HASH = "b" * 64
WORKFLOW = ".github/workflows/ci.yml"
COMPOSITION_WORKFLOW = ".github/workflows/torque-release.yml"


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
    document["compositionWorkflow"] = {
        "path": COMPOSITION_WORKFLOW,
        "runId": 5678,
        "runAttempt": 2,
    }
    document["baseReleaseSet"] = {
        "digest": "ghcr.io/denkoushi/raspisys-release-set@sha256:" + "9" * 64,
        "schemaVersion": 1,
        "sourceSha": SHA,
        "configHash": CONFIG_HASH,
        "workflow": {"path": WORKFLOW, "runId": 1234, "runAttempt": 1},
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
                "workflow": {
                    "path": COMPOSITION_WORKFLOW,
                    "runId": 5678,
                    "runAttempt": 2,
                },
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

    def test_explicit_empty_agent_selection_is_signed_and_round_trips(self) -> None:
        document = valid_release_set()
        document["agentServices"] = []
        release_set = parse_release_set(json.dumps(document))
        self.assertEqual(release_set.agent_services, ())
        canonical = canonical_release_set_json(release_set)
        self.assertEqual(parse_release_set(canonical).agent_services, ())

        malformed = valid_release_set()
        malformed["agentServices"] = ["nfc-agent", "nfc-agent"]
        with self.assertRaisesRegex(ReleaseArtifactError, "agentServices"):
            parse_release_set(json.dumps(malformed))

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

    def test_v2_rejects_empty_or_non_torque_agent_selection(self) -> None:
        for services in ([], ["nfc-agent"], ["torque-agent", "nfc-agent"]):
            document = valid_release_set_v2()
            document["agentServices"] = services
            with self.subTest(services=services), self.assertRaisesRegex(
                ReleaseArtifactError, "agentServices"
            ):
                parse_release_set(json.dumps(document))

    def test_v2_separates_base_release_and_composition_workflow_identities(self) -> None:
        release_set = parse_release_set(json.dumps(valid_release_set_v2()))
        self.assertEqual(release_set.workflow.path, WORKFLOW)
        self.assertIsNotNone(release_set.base_release_set)
        assert release_set.base_release_set is not None
        self.assertEqual(
            release_set.base_release_set.digest,
            "ghcr.io/denkoushi/raspisys-release-set@sha256:" + "9" * 64,
        )
        self.assertIsNotNone(release_set.composition_workflow)
        assert release_set.composition_workflow is not None
        self.assertEqual(release_set.composition_workflow.path, COMPOSITION_WORKFLOW)
        self.assertEqual(release_set.composition_workflow.run_id, 5678)
        self.assertEqual(release_set.composition_workflow.run_attempt, 2)

        wrong_composition = valid_release_set_v2()
        wrong_composition["compositionWorkflow"] = {
            "path": ".github/workflows/other.yml",
            "runId": 5678,
            "runAttempt": 2,
        }
        with self.assertRaisesRegex(ReleaseArtifactError, "compatibility"):
            parse_release_set(json.dumps(wrong_composition))

    def test_v2_requires_explicit_composition_workflow_identity(self) -> None:
        missing = valid_release_set_v2()
        missing.pop("compositionWorkflow")
        with self.assertRaisesRegex(ReleaseArtifactError, "unknown or missing"):
            parse_release_set(json.dumps(missing))

        missing_base = valid_release_set_v2()
        missing_base.pop("baseReleaseSet")
        with self.assertRaisesRegex(ReleaseArtifactError, "unknown or missing"):
            parse_release_set(json.dumps(missing_base))

    def test_create_cli_keeps_v1_optional_and_requires_composition_for_v2(self) -> None:
        common = [
            "create",
            "--repository",
            REPOSITORY,
            "--sha",
            SHA,
            "--config-hash",
            CONFIG_HASH,
            "--api-repository",
            "ghcr.io/denkoushi/raspisys-api",
            "--api-digest",
            "sha256:" + "1" * 64,
            "--web-repository",
            "ghcr.io/denkoushi/raspisys-web",
            "--web-digest",
            "sha256:" + "2" * 64,
            "--workflow",
            WORKFLOW,
            "--run-id",
            "1234",
            "--run-attempt",
            "1",
        ]
        output = io.StringIO()
        with redirect_stdout(output):
            main(common)
        self.assertEqual(json.loads(output.getvalue())["schemaVersion"], 1)

        torque_args = common + [
            "--composition-workflow",
            COMPOSITION_WORKFLOW,
            "--composition-run-id",
            "5678",
            "--composition-run-attempt",
            "2",
            "--base-release-digest",
            "ghcr.io/denkoushi/raspisys-release-set@sha256:" + "9" * 64,
            "--torque-repository",
            "ghcr.io/denkoushi/raspisys-torque-agent",
            "--torque-index-digest",
            "sha256:" + "3" * 64,
            "--torque-source-sha",
            TORQUE_ADOPTED_SOURCE_SHA,
            "--torque-arm64-digest",
            "sha256:" + "4" * 64,
            "--torque-armv7-digest",
            "sha256:" + "5" * 64,
            "--torque-adoption-predicate-type",
            TORQUE_ADOPTION_PREDICATE_TYPE,
            "--torque-origin-workflow",
            WORKFLOW,
            "--torque-origin-run-id",
            "32093659078",
            "--torque-origin-job-id",
            "95581851495",
            "--torque-rehearsal-job",
            "torque-release-compatibility",
            "--torque-rehearsal-evidence-digest",
            "sha256:" + "6" * 64,
        ]
        output = io.StringIO()
        with redirect_stdout(output):
            main(torque_args)
        document = json.loads(output.getvalue())
        self.assertEqual(document["schemaVersion"], 2)
        self.assertEqual(
            document["workflow"]["path"], WORKFLOW
        )
        self.assertEqual(
            document["compositionWorkflow"]["path"], COMPOSITION_WORKFLOW
        )

        torque_without_composition = [
            item
            for index, item in enumerate(torque_args)
            if not (
                torque_args.index("--composition-workflow") <= index
                < torque_args.index("--base-release-digest")
            )
        ]
        with self.assertRaisesRegex(ReleaseArtifactError, "composition identity"):
            main(torque_without_composition)

    def test_v2_reuse_allows_only_run_and_evidence_refresh(self) -> None:
        existing = parse_release_set(json.dumps(valid_release_set_v2()))
        candidate_document = valid_release_set_v2()
        candidate_document["compositionWorkflow"]["runId"] = 6789  # type: ignore[index]
        candidate_document["compositionWorkflow"]["runAttempt"] = 3  # type: ignore[index]
        candidate_document["compatibility"]["torqueOwnership"]["rehearsal"][  # type: ignore[index]
            "workflow"
        ]["runId"] = 6789
        candidate_document["compatibility"]["torqueOwnership"]["rehearsal"][  # type: ignore[index]
            "workflow"
        ]["runAttempt"] = 3
        candidate_document["compatibility"]["torqueOwnership"]["rehearsal"][  # type: ignore[index]
            "evidenceDigest"
        ] = "sha256:" + "7" * 64
        candidate = parse_release_set(json.dumps(candidate_document))
        validate_torque_composition_reuse(existing, candidate)

        changed = valid_release_set_v2()
        changed["images"]["api"]["digest"] = "sha256:" + "8" * 64  # type: ignore[index]
        with self.assertRaisesRegex(ReleaseArtifactError, "mismatched"):
            validate_torque_composition_reuse(
                existing, parse_release_set(json.dumps(changed))
            )

    def test_v2_reuse_cli_returns_the_existing_canonical_manifest(self) -> None:
        existing = valid_release_set_v2()
        candidate = valid_release_set_v2()
        candidate["compositionWorkflow"]["runId"] = 6789  # type: ignore[index]
        candidate["compatibility"]["torqueOwnership"]["rehearsal"][  # type: ignore[index]
            "workflow"
        ]["runId"] = 6789
        candidate["compatibility"]["torqueOwnership"]["rehearsal"][  # type: ignore[index]
            "evidenceDigest"
        ] = "sha256:" + "7" * 64
        with tempfile.TemporaryDirectory() as directory:
            existing_path = Path(directory) / "existing.json"
            candidate_path = Path(directory) / "candidate.json"
            existing_path.write_text(json.dumps(existing), encoding="utf-8")
            candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(
                    main(
                        [
                            "verify-torque-reuse",
                            "--existing",
                            str(existing_path),
                            "--candidate",
                            str(candidate_path),
                        ]
                    ),
                    0,
                )
        self.assertEqual(
            output.getvalue(),
            canonical_release_set_json(parse_release_set(json.dumps(existing))) + "\n",
        )

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
