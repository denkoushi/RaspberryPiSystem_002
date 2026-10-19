#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ENTRYPOINT_PATH = ROOT / "scripts/server/docker-release-image-maintenance.py"


NOW = "2026-09-01T00:00:00Z"
CURRENT_SHA = "1" * 40
PREVIOUS_SHA = "2" * 40


FAKE_DOCKER = r'''#!/usr/bin/env python3
import json
import sys
from pathlib import Path

state_path = Path(__STATE_PATH__)
state = json.loads(state_path.read_text(encoding="utf-8"))
args = sys.argv[1:]

def save():
    state_path.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")

if args[:5] == ["image", "ls", "--all", "--no-trunc", "--format"]:
    print("\n".join(sorted(state["images"])))
elif args[:3] == ["image", "inspect", "--format"]:
    inspect_template = args[-2]
    image_id = args[-1]
    image = state["images"].get(image_id)
    if image is None and "@sha256:" in image_id:
        # Docker resolves an immutable tag@digest reference to the image
        # addressed by its digest even when the inspect metadata exposes the
        # tag and digest separately.
        digest_id = "sha256:" + image_id.rsplit("@sha256:", 1)[1]
        image = state["images"].get(digest_id)
        if image is not None:
            image_id = digest_id
    if image is None:
        raise SystemExit(1)
    if "labels" not in image and 'index .Config "Labels"' not in inspect_template:
        # Match Docker's template behavior when Config has no Labels key.
        raise SystemExit(1)
    print(json.dumps({
        "id": image_id,
        "created": image["created"],
        "size": image["size"],
        "repoTags": image.get("repoTags"),
        "repoDigests": image.get("repoDigests"),
        "labels": image.get("labels"),
    }, separators=(",", ":")))
elif args[:4] == ["ps", "--all", "--quiet", "--no-trunc"]:
    print("\n".join(sorted(state.get("containers", {}))))
elif args[:3] == ["ps", "--quiet", "--no-trunc"]:
    print("\n".join(sorted(state.get("runningContainers", {}))))
elif args[:4] == ["inspect", "--type", "container", "--format"]:
    container_id = args[-1]
    image_id = state.get("containers", {}).get(container_id)
    if image_id is None:
        raise SystemExit(1)
    print(json.dumps(image_id))
elif args[:2] == ["image", "rm"] and len(args) == 3:
    image_id = args[2]
    state.setdefault("rm", []).append(image_id)
    if image_id in state.get("refuse", []):
        save()
        raise SystemExit(1)
    state["images"].pop(image_id, None)
    if "runningAfterRm" in state:
        state["runningContainers"] = state["runningAfterRm"]
    save()
else:
    raise SystemExit(97)
'''


def full_id(hex_digit: str) -> str:
    return "sha256:" + hex_digit * 64


def release_reference(repository: str, release_sha: str, digest: str) -> str:
    return f"{repository}:{release_sha}-aaaaaaaaaaaaaaaa@{digest}"


class FakeDockerFixture:
    def __init__(self, root: Path) -> None:
        self.state_path = root / "docker-state.json"
        self.executable = root / "docker"
        script = FAKE_DOCKER.replace("__STATE_PATH__", repr(str(self.state_path)))
        self.executable.write_text(script, encoding="utf-8")
        self.executable.chmod(0o700)

    def write(self, state: dict) -> None:
        self.state_path.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")

    def read(self) -> dict:
        return json.loads(self.state_path.read_text(encoding="utf-8"))


class DockerImageRetentionCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.state_path = self.root / "image-retention.json"
        self.plan_path = self.root / "image-retention-plan.json"
        self.fake = FakeDockerFixture(self.root)
        self._write_retention_state()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write_retention_state(self) -> None:
        current_api = full_id("1")
        current_web = full_id("2")
        previous_api = full_id("3")
        previous_web = full_id("4")
        self.state_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "current": {
                        "api": {
                            "reference": release_reference(
                                "ghcr.io/denkoushi/raspisys-api", CURRENT_SHA, current_api
                            ),
                            "imageId": current_api,
                            "releaseSha": CURRENT_SHA,
                        },
                        "web": {
                            "reference": release_reference(
                                "ghcr.io/denkoushi/raspisys-web", CURRENT_SHA, current_web
                            ),
                            "imageId": current_web,
                            "releaseSha": CURRENT_SHA,
                        },
                    },
                    "previous": {
                        "api": {
                            "reference": release_reference(
                                "ghcr.io/denkoushi/raspisys-api", PREVIOUS_SHA, previous_api
                            ),
                            "imageId": previous_api,
                            "releaseSha": PREVIOUS_SHA,
                        },
                        "web": {
                            "reference": release_reference(
                                "ghcr.io/denkoushi/raspisys-web", PREVIOUS_SHA, previous_web
                            ),
                            "imageId": previous_web,
                            "releaseSha": PREVIOUS_SHA,
                        },
                    },
                },
                sort_keys=True,
            ),
            encoding="utf-8",
        )

    def _image(
        self,
        digit: str,
        repository: str,
        *,
        release_sha: str | None = None,
        created: str = "2026-08-30T00:00:00Z",
        aliases: list[str] | None = None,
    ) -> tuple[str, dict]:
        image_id = full_id(digit)
        tag = (
            f"{repository}:{release_sha}-bbbbbbbbbbbbbbbb"
            if release_sha is not None
            else f"{repository}:old"
        )
        return image_id, {
            "created": created,
            "size": int(digit, 16) * 100 + 100,
            "repoTags": aliases or [tag],
            "repoDigests": [f"{repository}@{image_id}"],
            "labels": {},
        }

    def _base_docker_state(self) -> dict:
        images: dict[str, dict] = {}
        for digit, repository, sha in (
            ("1", "ghcr.io/denkoushi/raspisys-api", CURRENT_SHA),
            ("2", "ghcr.io/denkoushi/raspisys-web", CURRENT_SHA),
            ("3", "ghcr.io/denkoushi/raspisys-api", PREVIOUS_SHA),
            ("4", "ghcr.io/denkoushi/raspisys-web", PREVIOUS_SHA),
        ):
            image_id, image = self._image(digit, repository, release_sha=sha)
            images[image_id] = image
        current_containers = {
            "1" * 12: full_id("1"),
            "2" * 12: full_id("2"),
        }
        return {
            "images": images,
            "containers": current_containers,
            "runningContainers": dict(current_containers),
            "rm": [],
        }

    def _run(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        command = [
            sys.executable,
            str(ENTRYPOINT_PATH),
            *arguments,
            "--state-file",
            str(self.state_path),
            "--docker-path",
            str(self.fake.executable),
            "--now",
            NOW,
        ]
        if arguments and arguments[0] == "plan":
            command.extend(
                ["--output", str(self.plan_path), "--minimum-age-hours", "24"]
            )
        elif arguments and arguments[0] == "apply":
            command.extend(["--plan", str(self.plan_path)])
        return subprocess.run(
            command,
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def _output(self, result: subprocess.CompletedProcess[str]) -> dict:
        self.assertTrue(result.stdout, result.stderr)
        return json.loads(result.stdout)

    def test_plan_allowlist_and_all_safety_exclusions(self) -> None:
        state = self._base_docker_state()
        images = state["images"]
        for digit, repository in (
            ("5", "ghcr.io/denkoushi/raspisys-api"),
            ("6", "ghcr.io/denkoushi/raspisys-web"),
            ("7", "ghcr.io/denkoushi/raspisys-release-set"),
            ("8", "raspi-system-api"),
            ("9", "raspi-system-web"),
            ("a", "docker-api"),
            ("b", "docker-web"),
        ):
            image_id, image = self._image(digit, repository)
            images[image_id] = image
        young_id, young = self._image(
            "c", "ghcr.io/denkoushi/raspisys-api", created="2026-08-31T12:01:00Z"
        )
        images[young_id] = young
        release_set_current_id, release_set_current = self._image(
            "d", "ghcr.io/denkoushi/raspisys-release-set", release_sha=CURRENT_SHA
        )
        images[release_set_current_id] = release_set_current
        other_id, other = self._image("e", "ghcr.io/denkoushi/other")
        images[other_id] = other
        alias_id, alias = self._image(
            "f",
            "ghcr.io/denkoushi/raspisys-api",
            aliases=[
                "ghcr.io/denkoushi/raspisys-api:old",
                "ghcr.io/denkoushi/other:old",
            ],
        )
        images[alias_id] = alias
        container_id, container_image = self._image("0", "docker-web")
        images[container_id] = container_image
        state["containers"]["c" * 12] = container_id
        self.fake.write(state)

        result = self._run("plan")

        self.assertEqual(result.returncode, 0, result.stderr)
        summary = self._output(result)
        self.assertEqual(summary["status"], "ok")
        plan = json.loads(self.plan_path.read_text(encoding="utf-8"))
        candidates = set(plan["candidateIds"])
        expected = {
            full_id(digit)
            for digit in ("5", "6", "7", "8", "9", "a", "b")
        }
        self.assertEqual(candidates, expected)
        self.assertNotIn(full_id("1"), candidates)
        self.assertNotIn(full_id("2"), candidates)
        self.assertNotIn(full_id("3"), candidates)
        self.assertNotIn(full_id("4"), candidates)
        self.assertNotIn(young_id, candidates)
        self.assertNotIn(release_set_current_id, candidates)
        self.assertNotIn(other_id, candidates)
        self.assertNotIn(alias_id, candidates)
        self.assertNotIn(container_id, candidates)
        self.assertEqual(self.fake.read().get("rm", []), [])

    def test_default_read_mode_and_plan_never_remove(self) -> None:
        state = self._base_docker_state()
        old_id, old = self._image("5", "ghcr.io/denkoushi/raspisys-api")
        state["images"][old_id] = old
        self.fake.write(state)

        read_result = self._run()
        self.assertEqual(read_result.returncode, 0, read_result.stderr)
        self.assertEqual(self._output(read_result)["dryRun"], True)
        self.assertFalse(self.plan_path.exists())
        self.assertEqual(self.fake.read().get("rm", []), [])

        plan_result = self._run("plan")
        self.assertEqual(plan_result.returncode, 0, plan_result.stderr)
        self.assertTrue(self.plan_path.is_file())
        self.assertEqual(self.fake.read().get("rm", []), [])
        self.assertEqual(self.plan_path.stat().st_mode & 0o777, 0o600)

        second_plan = self._run("plan")
        self.assertNotEqual(second_plan.returncode, 0)
        self.assertEqual(self.fake.read().get("rm", []), [])

    def test_plan_accepts_image_without_config_labels(self) -> None:
        state = self._base_docker_state()
        database_id, database = self._image("5", "pgvector/pgvector")
        database.pop("labels")
        state["images"][database_id] = database
        self.fake.write(state)

        result = self._run("plan")

        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(self.plan_path.read_text(encoding="utf-8"))
        self.assertNotIn(database_id, plan["candidateIds"])
        self.assertEqual(self.fake.read().get("rm", []), [])

    def test_invalid_state_blocks_apply_before_docker_mutation(self) -> None:
        state = self._base_docker_state()
        old_id, old = self._image("5", "ghcr.io/denkoushi/raspisys-api")
        state["images"][old_id] = old
        self.fake.write(state)
        self.assertEqual(self._run("plan").returncode, 0)
        self.state_path.write_text('{"schemaVersion":1}', encoding="utf-8")

        result = self._run("apply")

        self.assertNotEqual(result.returncode, 0)
        summary = self._output(result)
        self.assertEqual(summary["status"], "blocked")
        self.assertEqual(summary["reason"], "invalid_state")
        self.assertEqual(self.fake.read().get("rm", []), [])

    def test_apply_requires_sealed_plan_and_rejects_state_drift(self) -> None:
        state = self._base_docker_state()
        old_id, old = self._image("5", "ghcr.io/denkoushi/raspisys-api")
        state["images"][old_id] = old
        self.fake.write(state)
        self.assertEqual(self._run("plan").returncode, 0)

        changed = self.fake.read()
        changed["images"][old_id]["size"] += 1
        self.fake.write(changed)
        result = self._run("apply")

        self.assertNotEqual(result.returncode, 0)
        summary = self._output(result)
        self.assertEqual(summary["reason"], "snapshot_changed")
        self.assertEqual(self.fake.read().get("rm", []), [])

    def test_apply_removes_only_full_ids_individually_and_reports_refusal(self) -> None:
        state = self._base_docker_state()
        first_id, first = self._image("5", "ghcr.io/denkoushi/raspisys-api")
        second_id, second = self._image("6", "ghcr.io/denkoushi/raspisys-web")
        state["images"].update({first_id: first, second_id: second})
        state["refuse"] = [second_id]
        self.fake.write(state)
        plan_result = self._run("plan")
        self.assertEqual(plan_result.returncode, 0, plan_result.stderr)

        result = self._run("apply")

        self.assertNotEqual(result.returncode, 0)
        summary = self._output(result)
        self.assertEqual(summary["status"], "partial_failure")
        self.assertEqual(summary["deletedCount"], 1)
        self.assertEqual(summary["unresolvedCount"], 1)
        self.assertEqual(self.fake.read().get("rm"), [first_id, second_id])
        self.assertNotIn(first_id, self.fake.read()["images"])
        self.assertIn(second_id, self.fake.read()["images"])
        self.assertTrue(all(item.startswith("sha256:") for item in self.fake.read()["rm"]))

    def test_exactly_24_hours_old_is_eligible_but_younger_is_not(self) -> None:
        state = self._base_docker_state()
        exact_id, exact = self._image(
            "5", "ghcr.io/denkoushi/raspisys-api", created="2026-08-31T00:00:00Z"
        )
        young_id, young = self._image(
            "6", "ghcr.io/denkoushi/raspisys-web", created="2026-08-31T00:00:00.000001Z"
        )
        state["images"].update({exact_id: exact, young_id: young})
        self.fake.write(state)

        result = self._run("plan")

        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(self.plan_path.read_text(encoding="utf-8"))
        self.assertIn(exact_id, plan["candidateIds"])
        self.assertNotIn(young_id, plan["candidateIds"])

    def test_current_ids_must_be_referenced_by_running_containers(self) -> None:
        state = self._base_docker_state()
        old_id, old = self._image("5", "ghcr.io/denkoushi/raspisys-api")
        state["images"][old_id] = old
        # Keep the stopped-container set complete, but omit current Web from
        # the running set.  Current identity validation must use running
        # containers only while deletion protection still uses all containers.
        state["runningContainers"] = {"1" * 12: full_id("1")}
        self.fake.write(state)

        result = self._run("plan")

        self.assertNotEqual(result.returncode, 0)
        summary = self._output(result)
        self.assertEqual(summary["status"], "blocked")
        self.assertEqual(summary["reason"], "state_mismatch")
        self.assertEqual(self.fake.read().get("rm", []), [])
        self.assertFalse(self.plan_path.exists())

    def test_retention_reference_must_resolve_to_recorded_image_id(self) -> None:
        state = self._base_docker_state()
        document = json.loads(self.state_path.read_text(encoding="utf-8"))
        # The fake Docker resolver follows the digest in the immutable
        # reference.  Point current API at the previous API digest while the
        # recorded imageId remains the current API ID.
        document["current"]["api"]["reference"] = release_reference(
            "ghcr.io/denkoushi/raspisys-api", CURRENT_SHA, full_id("3")
        )
        self.state_path.write_text(json.dumps(document), encoding="utf-8")
        self.fake.write(state)

        result = self._run("plan")

        self.assertNotEqual(result.returncode, 0)
        summary = self._output(result)
        self.assertEqual(summary["status"], "blocked")
        self.assertEqual(summary["reason"], "state_mismatch")
        self.assertEqual(self.fake.read().get("rm", []), [])

    def test_current_and_previous_release_shas_must_match_within_generation(self) -> None:
        original = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.fake.write(self._base_docker_state())
        for generation, service, image_id, release_sha in (
            ("current", "web", full_id("2"), PREVIOUS_SHA),
            ("previous", "web", full_id("4"), CURRENT_SHA),
        ):
            document = json.loads(json.dumps(original))
            document[generation][service]["releaseSha"] = release_sha
            repository = (
                "ghcr.io/denkoushi/raspisys-web"
                if service == "web"
                else "ghcr.io/denkoushi/raspisys-api"
            )
            document[generation][service]["reference"] = release_reference(
                repository, release_sha, image_id
            )
            self.state_path.write_text(json.dumps(document), encoding="utf-8")

            result = self._run()

            self.assertNotEqual(result.returncode, 0)
            summary = self._output(result)
            self.assertEqual(summary["status"], "blocked")
            self.assertEqual(summary["reason"], "invalid_state")
            self.assertEqual(self.fake.read().get("rm", []), [])

    def test_retention_state_requires_release_sha_tag_and_digest(self) -> None:
        original = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.fake.write(self._base_docker_state())
        invalid_references = (
            "ghcr.io/denkoushi/raspisys-api:" + CURRENT_SHA,
            "ghcr.io/denkoushi/raspisys-api:" + PREVIOUS_SHA + "-aaaaaaaaaaaaaaaa@" + full_id("1"),
        )
        for reference in invalid_references:
            document = json.loads(json.dumps(original))
            document["current"]["api"]["reference"] = reference
            self.state_path.write_text(json.dumps(document), encoding="utf-8")

            result = self._run()

            self.assertNotEqual(result.returncode, 0)
            summary = self._output(result)
            self.assertEqual(summary["status"], "blocked")
            self.assertEqual(summary["reason"], "invalid_state")
            self.assertEqual(self.fake.read().get("rm", []), [])
        self.state_path.write_text(json.dumps(original), encoding="utf-8")

    def test_apply_rechecks_current_running_ids_after_deletion(self) -> None:
        state = self._base_docker_state()
        old_id, old = self._image("5", "ghcr.io/denkoushi/raspisys-api")
        state["images"][old_id] = old
        state["runningAfterRm"] = {"1" * 12: full_id("1")}
        self.fake.write(state)
        self.assertEqual(self._run("plan").returncode, 0)

        result = self._run("apply")

        self.assertNotEqual(result.returncode, 0)
        summary = self._output(result)
        self.assertEqual(summary["status"], "partial_failure")
        self.assertEqual(summary["deletedCount"], 1)
        self.assertEqual(summary["unresolvedCount"], 1)
        self.assertEqual(summary["unresolved"][0]["reason"], "state_mismatch")
        self.assertNotIn(old_id, self.fake.read()["images"])


if __name__ == "__main__":
    unittest.main()
