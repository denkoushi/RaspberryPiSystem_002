#!/usr/bin/env python3
"""Focused contract tests for the Pi5 image-retention lifecycle boundary."""

from __future__ import annotations

import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
ROLE = ROOT / "infrastructure/ansible/roles/release_pi5"


class Pi5RetentionStateContractTests(unittest.TestCase):
    def load_tasks(self, name: str) -> list[dict[str, object]]:
        path = ROLE / "tasks" / f"{name}.yml"
        return yaml.safe_load(path.read_text(encoding="utf-8"))

    def test_state_is_published_before_healthy_flag_and_cleanup(self) -> None:
        commit_text = (ROLE / "tasks/commit.yml").read_text(encoding="utf-8")
        cleanup_text = (ROLE / "tasks/cleanup.yml").read_text(encoding="utf-8")
        main_text = (ROLE / "tasks/main.yml").read_text(encoding="utf-8")

        self.assertLess(
            commit_text.index("Persist Pi5 image retention state before retiring previous slot"),
            commit_text.index("Record healthy Pi5 candidate outcome"),
        )
        self.assertLess(
            main_text.index("commit.yml"),
            main_text.index("cleanup.yml"),
        )
        self.assertNotIn("release_pi5_retention", cleanup_text)

        commit = self.load_tasks("commit")
        include = next(
            task
            for task in commit
            if task.get("name")
            == "Persist Pi5 image retention state before retiring previous slot"
        )
        self.assertEqual(
            include["ansible.builtin.include_tasks"], "retention-state.yml"
        )
        self.assertEqual(include["when"], "release_pi5_route in ['fresh', 'interrupted']")

    def test_state_document_and_atomic_permissions_are_explicit(self) -> None:
        tasks = self.load_tasks("retention-state")
        names = [task["name"] for task in tasks]
        self.assertLess(
            names.index("Ensure the Pi5 image retention state directory exists"),
            names.index("Atomically publish the Pi5 image retention state"),
        )

        directory = tasks[0]["ansible.builtin.file"]
        self.assertEqual(directory["path"], "{{ release_pi5_retention_state_dir }}")
        self.assertEqual(directory["owner"], "root")
        self.assertEqual(directory["group"], "root")
        self.assertEqual(directory["mode"], "0755")

        document = next(
            task
            for task in tasks
            if task["name"] == "Build the Pi5 image retention state document"
        )["ansible.builtin.set_fact"]["release_pi5_retention_state"]
        self.assertEqual(document["schemaVersion"], 1)
        self.assertNotIn("releaseSha", document)
        self.assertEqual(set(document["current"]), {"api", "web"})
        self.assertEqual(set(document["previous"]), {"api", "web"})
        for section in (document["current"], document["previous"]):
            for component in section.values():
                self.assertEqual(set(component), {"reference", "imageId", "releaseSha"})
        self.assertEqual(
            document["current"]["api"]["releaseSha"], "{{ release_sha }}"
        )
        self.assertEqual(
            document["current"]["web"]["releaseSha"], "{{ release_sha }}"
        )

        write = next(
            task
            for task in tasks
            if task["name"]
            == "Write the Pi5 image retention state to a root-only temporary file"
        )["ansible.builtin.copy"]
        self.assertEqual(write["dest"], "{{ release_pi5_retention_state_tmp }}")
        self.assertEqual(write["owner"], "root")
        self.assertEqual(write["group"], "root")
        self.assertEqual(write["mode"], "0600")
        self.assertIn("to_nice_json", write["content"])

        publish = next(
            task
            for task in tasks
            if task["name"] == "Atomically publish the Pi5 image retention state"
        )["ansible.builtin.command"]["argv"]
        self.assertEqual(
            publish,
            [
                "mv",
                "-Tf",
                "{{ release_pi5_retention_state_tmp }}",
                "{{ release_pi5_retention_state_path }}",
            ],
        )

    def test_current_and_previous_identities_use_pre_switch_authority(self) -> None:
        text = (ROLE / "tasks/retention-state.yml").read_text(encoding="utf-8")
        self.assertIn("release_pi5_desired_ids.results[0].stdout", text)
        self.assertIn("release_pi5_desired_ids.results[1].stdout", text)
        self.assertIn(
            "release_pi5_active_api_identity if release_pi5_route == 'fresh' else release_pi5_opposite_api_identity",
            text,
        )
        self.assertIn(
            "release_pi5_active_web_identity if release_pi5_route == 'fresh' else release_pi5_opposite_web_identity",
            text,
        )
        self.assertIn("release_pi5_retention_previous_api_sha", text)
        self.assertIn("release_pi5_retention_previous_web_sha", text)
        self.assertIn("release_pi5_retention_previous_api_sha == release_pi5_retention_previous_web_sha", text)
        self.assertIn("@sha256:[0-9a-f]{64}", text)
        defaults = yaml.safe_load(
            (ROLE / "defaults/main.yml").read_text(encoding="utf-8")
        )
        self.assertEqual(defaults["release_pi5_retention_state_dir"], "/var/lib/raspi-release")
        self.assertEqual(
            defaults["release_pi5_retention_state_path"],
            "{{ release_pi5_retention_state_dir }}/image-retention.json",
        )
        self.assertIn(
            "{{ release_pi5_retention_state_path }}.{{ release_run_id }}.tmp",
            defaults["release_pi5_retention_state_tmp"],
        )

    def test_fresh_and_interrupted_routes_select_the_correct_pre_switch_generation(self) -> None:
        tasks = self.load_tasks("retention-state")
        select = next(
            task
            for task in tasks
            if task["name"] == "Select the Pi5 pre-switch image identities for retention"
        )
        values = select["ansible.builtin.set_fact"]
        self.assertEqual(
            values["release_pi5_retention_previous_api_identity"],
            "{{ release_pi5_active_api_identity if release_pi5_route == 'fresh' else release_pi5_opposite_api_identity }}",
        )
        self.assertEqual(
            values["release_pi5_retention_previous_web_identity"],
            "{{ release_pi5_active_web_identity if release_pi5_route == 'fresh' else release_pi5_opposite_web_identity }}",
        )

        pre_switch_validation = next(
            task
            for task in tasks
            if task["name"] == "Require immutable Pi5 pre-switch image references for retention"
        )
        self.assertEqual(
            pre_switch_validation["when"],
            "not (release_pi5_retention_preserve_previous | bool)",
        )
        sha_parse = next(
            task
            for task in tasks
            if task["name"]
            == "Parse Pi5 pre-switch release SHA prefixes from immutable references"
        )
        self.assertEqual(
            sha_parse["when"],
            "not (release_pi5_retention_preserve_previous | bool)",
        )

    def test_same_release_preserves_previous_only_after_state_identity_validation(self) -> None:
        tasks = self.load_tasks("retention-state")
        names = [task["name"] for task in tasks]
        stat_index = names.index("Inspect the existing Pi5 image retention state")
        parse_index = names.index("Parse the existing Pi5 image retention state")
        current_index = names.index(
            "Require existing same-release current identity to match canonical pre-switch Pi5 containers"
        )
        selection_index = names.index("Select the Pi5 previous generation from state or the pre-switch containers")
        build_index = names.index("Build the Pi5 image retention state document")
        self.assertLess(stat_index, parse_index)
        self.assertLess(parse_index, current_index)
        self.assertLess(current_index, selection_index)
        self.assertLess(selection_index, build_index)
        existing_sha_parse_index = names.index(
            "Parse previous release SHAs from an existing Pi5 state"
        )
        existing_sha_check_index = names.index(
            "Require existing previous release SHAs to match immutable references"
        )
        self.assertLess(existing_sha_parse_index, existing_sha_check_index)
        self.assertLess(existing_sha_check_index, current_index)

        preserve = next(
            task
            for task in tasks
            if task["name"]
            == "Detect a same-release Pi5 state eligible to preserve its previous generation"
        )
        self.assertIn(
            "release_pi5_retention_existing_state.current.api.releaseSha == release_sha",
            preserve["ansible.builtin.set_fact"][
                "release_pi5_retention_preserve_previous"
            ],
        )
        self.assertIn(
            "release_pi5_retention_existing_state.current.web.releaseSha == release_sha",
            preserve["ansible.builtin.set_fact"][
                "release_pi5_retention_preserve_previous"
            ],
        )

        identity_check = tasks[current_index]
        self.assertEqual(
            identity_check["when"],
            "release_pi5_retention_preserve_previous | bool",
        )
        identity_assertions = "\n".join(identity_check["ansible.builtin.assert"]["that"])
        for field in (
            "current.api.reference",
            "current.api.imageId",
            "current.web.reference",
            "current.web.imageId",
        ):
            self.assertIn(f"release_pi5_retention_existing_state.{field}", identity_assertions)
        self.assertIn("release_pi5_active_api_identity", identity_assertions)
        self.assertIn("release_pi5_active_web_identity", identity_assertions)
        self.assertNotIn("release_pi5_retention_current_identity", identity_assertions)

        selection = tasks[selection_index]["ansible.builtin.set_fact"]
        self.assertIn(
            "release_pi5_retention_existing_state.previous.api.reference",
            selection["release_pi5_retention_previous_api_reference"],
        )
        self.assertIn(
            "release_pi5_retention_existing_state.previous.api.imageId",
            selection["release_pi5_retention_previous_api_image_id"],
        )
        self.assertIn(
            "release_pi5_retention_existing_previous_api_sha",
            selection["release_pi5_retention_previous_api_sha"],
        )
        self.assertIn(
            "release_pi5_retention_existing_state.previous.web.reference",
            selection["release_pi5_retention_previous_web_reference"],
        )
        self.assertIn(
            "release_pi5_retention_existing_state.previous.web.imageId",
            selection["release_pi5_retention_previous_web_image_id"],
        )
        self.assertIn(
            "release_pi5_retention_existing_previous_web_sha",
            selection["release_pi5_retention_previous_web_sha"],
        )
        existing_sha_check = tasks[existing_sha_check_index]
        existing_sha_assertions = "\n".join(
            existing_sha_check["ansible.builtin.assert"]["that"]
        )
        self.assertIn(
            "release_pi5_retention_existing_previous_api_sha == release_pi5_retention_existing_state.previous.api.releaseSha",
            existing_sha_assertions,
        )
        self.assertIn(
            "release_pi5_retention_existing_previous_web_sha == release_pi5_retention_existing_state.previous.web.releaseSha",
            existing_sha_assertions,
        )
        self.assertIn(
            "release_pi5_retention_existing_previous_api_sha == release_pi5_retention_existing_previous_web_sha",
            existing_sha_assertions,
        )

    def test_failed_rollback_and_settled_paths_never_publish_retention_state(self) -> None:
        commit = self.load_tasks("commit")
        include_index = next(
            index
            for index, task in enumerate(commit)
            if task["name"]
            == "Persist Pi5 image retention state before retiring previous slot"
        )
        self.assertEqual(
            commit[include_index]["when"],
            "release_pi5_route in ['fresh', 'interrupted']",
        )
        self.assertLess(
            include_index,
            next(
                index
                for index, task in enumerate(commit)
                if task["name"] == "Record healthy Pi5 candidate outcome"
            ),
        )
        self.assertNotIn("retention-state.yml", "\n".join(
            task["name"] for task in self.load_tasks("rollback")
        ))
        self.assertNotIn(
            "release_pi5_retention",
            (ROLE / "tasks/cleanup.yml").read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main()
