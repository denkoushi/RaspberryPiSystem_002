from __future__ import annotations

from scripts.deploy.release_artifact_contract import GHCR_NAMESPACE, SOURCE_REPOSITORY

import argparse
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

import yaml

ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / "scripts/deploy"
SCRIPT = DEPLOY / "standard-ansible-release.py"
sys.path.insert(0, str(DEPLOY))
import controller_gh_verifier
SPEC = importlib.util.spec_from_file_location("standard_ansible_release", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

SHA = "a" * 40
RUN_ID = "20260808-010203-abcdef"


def completed(command: list[str], stdout: str = "", returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr="")


def write_coverage_results(command: list[str]) -> None:
    """Stand in for the coverage playbook: write one passing result file per limited host."""
    if not any(str(item).endswith("release-agent-coverage-check.yml") for item in command):
        return
    variables = json.loads(command[command.index("--extra-vars") + 1])
    for host in command[command.index("--limit") + 1].split(":"):
        (Path(variables["release_agent_guard_out_dir"]) / f"{host}.json").write_text(
            json.dumps({"host": host, "agentsNotUpdated": []}), encoding="utf-8"
        )


def torque_capable_host(serial: str = "702902S") -> dict[str, object]:
    link_name = f"bluetooth-TOHNICHI_{serial}-event-kbd"
    return {
        "torque_agent_enabled": True,
        "torque_connection_lease_enabled": True,
        "torque_agent_api_base_url": "https://pi5.example.test",
        "torque_agent_client_key": f"client-key-{serial}",
        "torque_agent_tls_verify_mode": "system",
        "torque_agent_bluetooth_adapter": {
            "usb_vendor_id": "2357",
            "usb_product_id": "0604",
        },
        "torque_agent_hid_devices": [
            {
                "path": f"/dev/input/by-id/{link_name}",
                "parserProfile": "cem3-btla-hogp-v1",
                "serialNumber": serial,
            }
        ],
        "torque_agent_hid_links": [
            {
                "link_name": link_name,
                "name": f"TOHNICHI_{serial}",
                "uniq": "c4:90:43:98:7e:c3",
                "vendor_id": "2f84",
                "product_id": "0001",
            }
        ],
    }


class StandardAnsibleReleaseTests(unittest.TestCase):
    def test_release_artifact_resolution_and_plan(self):
        parent = "b" * 40
        selection = (("pi5", ("raspberrypi5",)),)
        for fallback in (False, True):
            with self.subTest(fallback=fallback):
                calls = []
                def fake_run(command, **kwargs):
                    calls.append(command)
                    if command[:3] == ["docker", "manifest", "inspect"]:
                        absent = fallback and SHA in command[-1]
                        return subprocess.CompletedProcess(command, int(absent), "", "MANIFEST UNKNOWN" if absent else "")
                    if command[:2] == ["git", "rev-list"]:
                        return completed(command, SHA + "\n" + parent + "\n")
                    if command[:2] == ["git", "diff"]:
                        return completed(command, "M\0docs/guide.md\0")
                    return completed(command)
                args = MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--print-plan", "--limit", "raspberrypi5"])
                with mock.patch.object(MODULE, "config_hash", side_effect=lambda sha, inventory: sha), mock.patch.object(MODULE, "run", side_effect=fake_run):
                    artifact, info = MODULE.resolve_release_artifact_sha(SHA, Path("inventory.yml"), ("pi5",))
                    args.release_artifact_sha, args.release_artifact_fallback = artifact, info
                    document = MODULE.plan(args, SHA, Path("inventory.yml"), MODULE.DEFAULT_INVENTORY, selection)
                self.assertEqual(artifact, parent if fallback else SHA)
                self.assertEqual(document["releaseSha"], SHA)
                self.assertEqual(document["releaseArtifactSha"], artifact)
                self.assertEqual("releaseArtifactFallback" in document, fallback)
                self.assertTrue(all(artifact in ref for ref in document["executionOrder"][0]["images"]))
                self.assertIn("--release-artifact-sha " + artifact, MODULE.remote_script(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi5",)))
                if fallback:
                    self.assertEqual(info, {"reason": f"head {SHA} has no signed release set; changes since {parent} are image-free (docs only)", "candidatesChecked": 1, "changedPaths": ["docs/guide.md"]})
                else:
                    self.assertFalse(any(command[:2] == ["git", "rev-list"] for command in calls))

    def test_release_artifact_resolution_refuses_unsafe_or_missing_candidates(self):
        parent = "b" * 40
        cases = [
            ("unauthorized", "M\0docs/a.md\0", ("pi5",), {}, "unauthorized"),
            ("not found", "M\0apps/api/src/a.ts\0", ("pi5",), {}, parent),
            ("manifest unknown", "M\0docs/a.md\0", ("pi5",), {}, "cap 20"),
            ("not found", "M\0docs/a.md\0", ("pi5", "pi4"), {}, "Pi5-only"),
            ("not found", "M\0docs/a.md\0", ("pi5",), {"torque_cutover": True}, "Pi5-only"),
            ("not found", "M\0docs/a.md\0", ("pi5",), {"first_install": True}, "Pi5-only"),
            ("not found", "D\0docs/a.md\0", ("pi5",), {}, parent),
            ("not found", "R100\0docs/a.md\0docs/b.md\0", ("pi5",), {}, parent),
            ("not found", "M\0infrastructure/ansible/inventory.yml\0", ("pi5",), {}, parent),
            ("not found", "M\0docs/kiosk-operation-guide/README.md\0", ("pi5",), {}, parent),
        ]
        for error, diff, profiles, flags, expected in cases:
            with self.subTest(error=error, diff=diff, profiles=profiles, flags=flags):
                def fake_run(command, **kwargs):
                    if command[0] == "docker":
                        return subprocess.CompletedProcess(command, 1, "", error)
                    if command[1] == "rev-list":
                        return completed(command, SHA + "\n" + parent)
                    return completed(command, diff)
                with mock.patch.object(MODULE, "config_hash", return_value="c" * 64), mock.patch.object(MODULE, "run", side_effect=fake_run) as runner:
                    with self.assertRaisesRegex(RuntimeError, expected):
                        MODULE.resolve_release_artifact_sha(SHA, Path("inventory.yml"), profiles, **flags)
                if error == "unauthorized":
                    self.assertEqual(runner.call_count, 1)

    def test_internal_artifact_sha_requires_sealed_full_identity(self):
        base = ["main", MODULE.DEFAULT_INVENTORY, "--limit", "raspberrypi5"]
        for argv in (base + ["--release-artifact-sha", SHA], base + ["--execute-standard-route", "--sha", SHA, "--run-id", RUN_ID, "--profiles", "pi5", "--release-artifact-sha", "abc"], base + ["--execute-standard-route", "--sha", SHA, "--run-id", RUN_ID, "--profiles", "pi5", "--release-artifact-sha", ""]):
            with self.assertRaises(MODULE.UsageError):
                MODULE.parse_arguments(argv)
        args = MODULE.parse_arguments(base + ["--execute-standard-route", "--sha", SHA, "--run-id", RUN_ID, "--profiles", "pi5"])
        self.assertEqual(args.release_artifact_sha, SHA)

    def test_pi3_only_plan_does_not_require_a_release_set(self):
        args = MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--print-plan", "--limit", "raspberrypi3"])
        selection = (("pi3", ("raspberrypi3",)),)
        with mock.patch.object(MODULE, "parse_arguments", return_value=args), mock.patch.object(
            MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)
        ), mock.patch.object(MODULE, "resolve_sha", return_value=SHA), mock.patch.object(
            MODULE, "inventory_document", return_value={}
        ), mock.patch.object(MODULE, "selected_profiles", return_value=selection), mock.patch.object(
            MODULE, "validate_first_install_selection"
        ), mock.patch.object(MODULE, "server_release_root", return_value=Path("/opt/release")), mock.patch.object(
            MODULE, "hermes_trial_configuration", return_value=(None, {})
        ), mock.patch.object(MODULE, "answer_cache_configuration", return_value=(None, {})), mock.patch.object(
            MODULE, "resolve_release_artifact_sha"
        ) as resolve, mock.patch.object(MODULE, "release_set_artifacts") as artifacts, mock.patch.object(
            MODULE, "plan", return_value={"releaseSha": SHA, "executionOrder": []}
        ), mock.patch.object(MODULE, "unpublished_plan_images", return_value=[]), redirect_stdout(io.StringIO()):
            self.assertEqual(MODULE.main([]), 0)
        resolve.assert_not_called()
        artifacts.assert_not_called()
        self.assertEqual(args.release_artifact_sha, SHA)

    def test_remote_verifies_artifact_before_mutation_and_passes_image_identity(self):
        parent = "b" * 40
        args = argparse.Namespace(inventory=MODULE.DEFAULT_INVENTORY, sha=SHA, release_artifact_sha=parent, run_id=RUN_ID, profiles="pi5", limit="raspberrypi5")
        inventory = {"server": {"hosts": ["raspberrypi5"]}, "_meta": {"hostvars": {"raspberrypi5": {"business_hermes_answer_cache_enabled": True}}}}
        selection = (("pi5", ("raspberrypi5",)),)
        for mode in ("not-ancestor", "api-diff", "valid", "fetch"):
            with self.subTest(mode=mode):
                def fake_run(command, **kwargs):
                    if command[:2] == ["git", "rev-parse"]:
                        return completed(command, SHA)
                    if command[:2] == ["git", "cat-file"]:
                        return completed(command, returncode=int(mode == "fetch"))
                    if command[:2] == ["git", "merge-base"]:
                        return completed(command, returncode=int(mode == "not-ancestor"))
                    if command[:2] == ["git", "diff"]:
                        return completed(command, "M\0" + ("apps/api/src/a.ts" if mode == "api-diff" else "docs/a.md") + "\0")
                    return completed(command)
                with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(MODULE, "inventory_document", return_value=inventory), mock.patch.object(MODULE, "run", side_effect=fake_run) as runner, mock.patch.object(MODULE, "preflight_optional_hosts", return_value=(selection, ())), mock.patch.object(MODULE, "release_set_artifacts", return_value=MODULE.ReleaseArtifacts("api:" + parent, "web:" + parent, None, None, ())) as artifacts, mock.patch.object(MODULE, "_exact_repo_digest", return_value="cache@sha256:" + "c" * 64), mock.patch.object(MODULE, "verify_component_attestation") as verify, mock.patch.object(MODULE, "execute_ansible_with_cleanup", return_value=0) as execute, redirect_stdout(io.StringIO()):
                    if mode in ("valid", "fetch"):
                        self.assertEqual(MODULE.execute_standard_route(args), 0)
                        command = execute.call_args.args[0]
                        variables = json.loads(command[command.index("--extra-vars") + 1])
                        self.assertEqual(variables["release_sha"], SHA)
                        self.assertEqual(variables["release_pi5_image_sha"], parent)
                        self.assertIn(parent, variables["release_pi5_answer_cache_image"])
                        verify.assert_called_once_with("cache@sha256:" + "c" * 64, parent)
                        artifacts.assert_called_once_with(parent, Path("inventory.yml"), require_torque=False)
                    else:
                        with self.assertRaisesRegex(RuntimeError, "not an ancestor|not image-free"):
                            MODULE.execute_standard_route(args)
                        execute.assert_not_called()
                        artifacts.assert_not_called()
                fetches = [call.args[0] for call in runner.call_args_list if call.args[0][:2] == ["git", "fetch"]]
                self.assertEqual(fetches, [["git", "fetch", "--no-tags", "origin", parent]] if mode == "fetch" else [])

    def test_first_install_rejects_unbounded_or_pattern_scope_before_backend(self) -> None:
        for options in (
            ["--full-fleet"], [], ["--limit", "pi4-*"], ["--limit", "kiosk:&all"],
            ["--limit", "@hosts"], ["--limit", "pi4-a,"], ["--limit", "pi4-a:pi4-a"],
            ["--limit", "pi4-a", "--torque-cutover"],
        ):
            with self.subTest(options=options), self.assertRaises(MODULE.UsageError):
                MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--first-install", *options])

    def test_first_install_requires_exact_kiosk_inventory_hosts(self) -> None:
        document = {"kiosk": {"hosts": ["pi4-a", "pi4-b"]}, "server": {"hosts": ["pi5"]}}
        for limit, selection in (
            ("kiosk", (("pi4", ("pi4-a", "pi4-b")),)),
            ("pi5", (("pi5", ("pi5",)),)),
            ("pi3", (("pi3", ("pi3",)),)),
            ("pi4-a:pi5", (("pi5", ("pi5",)), ("pi4", ("pi4-a",)))),
            ("pi4-a:missing", (("pi4", ("pi4-a",)),)),
        ):
            args = MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--first-install", "--limit", limit])
            with self.subTest(limit=limit), self.assertRaises(MODULE.UsageError):
                MODULE.validate_first_install_selection(args, document, selection)
        for limit in ("pi4-a", "pi4-a:pi4-b", "pi4-a,pi4-b"):
            args = MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--first-install", "--limit", limit])
            hosts = tuple(limit.replace(",", ":").split(":"))
            MODULE.validate_first_install_selection(args, document, (("pi4", hosts),))

    def test_first_install_plan_and_remote_forwarding_are_opt_in(self) -> None:
        for enabled in (False, True):
            args = MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--limit", "pi4-a"] + (["--first-install"] if enabled else []))
            commands = []
            with mock.patch.object(MODULE, "run", side_effect=lambda command, **kwargs: commands.append(command) or completed(command)):
                document = MODULE.plan(args, SHA, ROOT / MODULE.DEFAULT_INVENTORY, MODULE.DEFAULT_INVENTORY, (("pi4", ("pi4-a",)),))
            self.assertEqual("firstInstall" in document, enabled)
            if enabled:
                self.assertEqual(document["firstInstall"], {"hosts": ["pi4-a"], "rollbackTarget": "empty"})
            for command in commands:
                variables = json.loads(command[command.index("--extra-vars") + 1])
                self.assertEqual(variables.get("release_kiosk_first_install", False), enabled)
                self.assertEqual("release_kiosk_first_install" in variables, enabled)
            script = MODULE.remote_script(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",))
            self.assertEqual("--first-install" in script, enabled)


    def test_answer_cache_sealed_seed_is_pi5_only_and_checksum_bound(self):
        args = argparse.Namespace(full_fleet=False)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {}
            for name in MODULE.ANSWER_CACHE_FILES:
                data = ('synthetic:' + name).encode()
                (root / name).write_bytes(data)
                files[name] = hashlib.sha256(data).hexdigest()
            (root / 'artifact.json').write_text(json.dumps({'schema': 'hermes-answer-cache/v1',
                'sourceIndexDirectory': 'sources-' + 'a' * 64, 'files': files}))
            with mock.patch.dict(os.environ, {'HERMES_ANSWER_CACHE_ARTIFACT': directory}, clear=True):
                source, environment = MODULE.answer_cache_configuration(args, (('pi5', ('raspberrypi5',)),), MODULE.REMOTE_ROOT, RUN_ID)
                self.assertEqual(source, root.resolve())
                self.assertEqual(environment['HERMES_ANSWER_CACHE_ARTIFACT'], str(MODULE.REMOTE_ROOT / 'storage/hermes-answer-cache-staging' / RUN_ID))
                with self.assertRaisesRegex(MODULE.UsageError, 'raspberrypi5-only'):
                    MODULE.answer_cache_configuration(args, (('pi4', ('private',)),), MODULE.REMOTE_ROOT, RUN_ID)
                (root / 'checks.json').write_text('changed')
                with self.assertRaisesRegex(MODULE.UsageError, 'checksum mismatch'):
                    MODULE.answer_cache_configuration(args, (('pi5', ('raspberrypi5',)),), MODULE.REMOTE_ROOT, RUN_ID)

    def test_hermes_trial_preserves_default_and_rejects_other_targets(self) -> None:
        args = argparse.Namespace(full_fleet=False)
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(MODULE.hermes_trial_configuration(args, (), MODULE.REMOTE_ROOT, RUN_ID), (None, {}))
        with mock.patch.dict(os.environ, {"HERMES_SEARCH_TRIAL_ENABLED": "false"}, clear=True):
            self.assertEqual(MODULE.hermes_trial_configuration(args, (("pi5", ("raspberrypi5",)),), MODULE.REMOTE_ROOT, RUN_ID),
                (None, {"HERMES_SEARCH_TRIAL_ENABLED": "false"}))
            with self.assertRaisesRegex(MODULE.UsageError, "raspberrypi5-only"):
                MODULE.hermes_trial_configuration(args, (("pi4", ("pi4-a",)),), MODULE.REMOTE_ROOT, RUN_ID)

    def test_hermes_trial_maintenance_is_exact_pi5_and_jev_is_not_forwarded(self) -> None:
        args = argparse.Namespace(
            hermes_search_trial_maintenance="on",
            full_fleet=False,
            limit="raspberrypi5",
        )
        with mock.patch.dict(os.environ, {}, clear=True):
            environment = MODULE.hermes_trial_maintenance_configuration(
                args, (("pi5", ("raspberrypi5",)),)
            )
        self.assertEqual(environment, {"HERMES_SEARCH_TRIAL_MAINTENANCE": "on"})

        with mock.patch.dict(os.environ, {"HERMES_SEARCH_TRIAL_JEV_ENABLED": "true"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "JEV_ENABLED=false"):
                MODULE.hermes_trial_maintenance_configuration(
                    args, (("pi5", ("raspberrypi5",)),)
                )

        with mock.patch.dict(os.environ, {"HERMES_SEARCH_TRIAL_ARTIFACT": "/private"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "trial staging"):
                MODULE.hermes_trial_maintenance_configuration(
                    args, (("pi5", ("raspberrypi5",)),)
                )

        with self.assertRaisesRegex(MODULE.UsageError, "exact --limit raspberrypi5"):
            MODULE.parse_arguments([
                "main", MODULE.DEFAULT_INVENTORY, "--limit", "pi5", "--hermes-search-trial-maintenance=off"
            ])

    def test_hermes_trial_maintenance_systemd_boundary_forwards_only_mode(self) -> None:
        args = argparse.Namespace(
            branch="main", inventory=MODULE.DEFAULT_INVENTORY, limit="raspberrypi5",
            full_fleet=False, detach=True, torque_cutover=False,
        )
        command = MODULE.systemd_argv(
            args,
            SHA,
            RUN_ID,
            MODULE.DEFAULT_INVENTORY,
            ("pi5",),
            "pi",
            hermes_environment={"HERMES_SEARCH_TRIAL_MAINTENANCE": "off"},
        )
        rendered = " ".join(command)
        self.assertIn("--setenv=HERMES_SEARCH_TRIAL_MAINTENANCE=off", rendered)
        self.assertNotIn("HERMES_SEARCH_TRIAL_JEV_ENABLED", rendered)
        self.assertNotIn("HERMES_SEARCH_TRIAL_ARTIFACT", rendered)

    def test_maintenance_classification_override_reaches_systemd_without_defaulting(self) -> None:
        args = argparse.Namespace(hermes_search_trial_maintenance="on", branch="main",
                                  limit="raspberrypi5", full_fleet=False, detach=True,
                                  torque_cutover=False)
        key = "HERMES_SEARCH_RECORD_CLASSIFICATION_ENABLED"
        for value in (None, "false", "true"):
            with self.subTest(value=value), mock.patch.dict(os.environ, {} if value is None else {key: value}, clear=True):
                environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
                command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY,
                                             ("pi5",), "pi", hermes_environment=environment)
                if value is None:
                    self.assertNotIn(key, environment)
                    self.assertFalse(any(key in item for item in command))
                else:
                    self.assertEqual(environment[key], value)
                    self.assertIn(f"--setenv={key}={value}", command)
        with mock.patch.dict(os.environ, {key: "0"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "must be true or false"):
                MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))

    def test_maintenance_retrieval_v2_override_reaches_systemd_without_defaulting(self) -> None:
        args = argparse.Namespace(hermes_search_trial_maintenance="on", branch="main",
                                  limit="raspberrypi5", full_fleet=False, detach=True,
                                  torque_cutover=False)
        env_name = "HERMES_RETRIEVAL_V2_ENABLED"
        for value in (None, "false", "true"):
            with self.subTest(value=value), mock.patch.dict(os.environ, {} if value is None else {env_name: value}, clear=True):
                environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
                command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY,
                                             ("pi5",), "pi", hermes_environment=environment)
                if value is None:
                    self.assertNotIn(env_name, environment)
                    self.assertFalse(any(env_name in item for item in command))
                else:
                    self.assertEqual(environment[env_name], value)
                    self.assertIn(f"--setenv={env_name}={value}", command)
        with mock.patch.dict(os.environ, {env_name: "0"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "must be true or false"):
                MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))

    def test_maintenance_enrichment_override_reaches_systemd_without_defaulting(self) -> None:
        args = argparse.Namespace(hermes_search_trial_maintenance="on", branch="main",
                                  limit="raspberrypi5", full_fleet=False, detach=True,
                                  torque_cutover=False)
        for env_name in ("HERMES_RETRIEVAL_ENRICHMENT_ENABLED", "HERMES_RETRIEVAL_CAUSE_ENABLED"):
            for value in (None, "false", "true"):
                with self.subTest(value=value), mock.patch.dict(os.environ, {} if value is None else {env_name: value}, clear=True):
                    environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
                    command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY,
                                                 ("pi5",), "pi", hermes_environment=environment)
                    if value is None:
                        self.assertNotIn(env_name, environment)
                        self.assertFalse(any(env_name in item for item in command))
                    else:
                        self.assertEqual(environment[env_name], value)
                        self.assertIn(f"--setenv={env_name}={value}", command)
            with mock.patch.dict(os.environ, {env_name: "maybe"}, clear=True):
                with self.assertRaisesRegex(MODULE.UsageError, f"{env_name} must be true or false"):
                    MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
        with mock.patch.dict(os.environ, {
            "HERMES_RETRIEVAL_ENRICHMENT_ENABLED": "true",
            "HERMES_RETRIEVAL_CAUSE_ENABLED": "true",
            "HERMES_RETRIEVAL_CAUSE_MAX_TEXTS": "100",
            "HERMES_RETRIEVAL_ENRICHMENT_MAX_RECORDS": "100",
            "HERMES_RETRIEVAL_ENRICHMENT_CONCURRENCY": "1",
            "HERMES_RETRIEVAL_ENRICHMENT_WINDOW": "22-6",
        }, clear=True):
            environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
            self.assertEqual(environment["HERMES_RETRIEVAL_ENRICHMENT_MAX_RECORDS"], "100")
            self.assertEqual(environment["HERMES_RETRIEVAL_CAUSE_ENABLED"], "true")
            self.assertEqual(environment["HERMES_RETRIEVAL_CAUSE_MAX_TEXTS"], "100")
            command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY,
                                         ("pi5",), "pi", hermes_environment=environment)
            self.assertIn("--setenv=HERMES_RETRIEVAL_CAUSE_MAX_TEXTS=100", command)
            self.assertEqual(environment["HERMES_RETRIEVAL_ENRICHMENT_CONCURRENCY"], "1")
            self.assertEqual(environment["HERMES_RETRIEVAL_ENRICHMENT_WINDOW"], "22-6")
        for cap_name in ("HERMES_RETRIEVAL_ENRICHMENT_MAX_RECORDS", "HERMES_RETRIEVAL_CAUSE_MAX_TEXTS"):
            with self.subTest(cap_name=cap_name), mock.patch.dict(os.environ, {cap_name: "0"}, clear=True):
                with self.assertRaisesRegex(MODULE.UsageError, f"{cap_name} must be a positive integer"):
                    MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
        with mock.patch.dict(os.environ, {"HERMES_RETRIEVAL_ENRICHMENT_CONCURRENCY": "3"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "HERMES_RETRIEVAL_ENRICHMENT_CONCURRENCY must be 1 or 2"):
                MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
        with tempfile.TemporaryDirectory() as directory:
            allow = Path(directory) / "ids.txt"
            allow.write_text("11111111-1111-4111-8111-111111111111\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {"HERMES_RETRIEVAL_ENRICHMENT_IDS": str(allow)}, clear=True):
                environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
                self.assertEqual(environment["HERMES_RETRIEVAL_ENRICHMENT_IDS"], MODULE.ENRICHMENT_IDS_CONTAINER)
                command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY,
                                             ("pi5",), "pi", hermes_environment=environment)
                self.assertIn(f"--setenv=HERMES_RETRIEVAL_ENRICHMENT_IDS={MODULE.ENRICHMENT_IDS_CONTAINER}", command)
            allow.write_text("not-an-id\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {"HERMES_RETRIEVAL_ENRICHMENT_IDS": str(allow)}, clear=True):
                with self.assertRaisesRegex(MODULE.UsageError, "only record ids"):
                    MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))

    def test_maintenance_flywheel_settings_reach_systemd_without_defaulting(self) -> None:
        args = argparse.Namespace(hermes_search_trial_maintenance="on", branch="main",
                                  limit="raspberrypi5", full_fleet=False, detach=True,
                                  torque_cutover=False)
        for value in (None, "false", "true"):
            with self.subTest(value=value), mock.patch.dict(os.environ, {} if value is None else {"HERMES_FLYWHEEL_ENABLED": value}, clear=True):
                environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
                command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY,
                                             ("pi5",), "pi", hermes_environment=environment)
                if value is None:
                    self.assertNotIn("HERMES_FLYWHEEL_ENABLED", environment)
                    self.assertFalse(any("HERMES_FLYWHEEL_ENABLED" in item for item in command))
                else:
                    self.assertEqual(environment["HERMES_FLYWHEEL_ENABLED"], value)
                    self.assertIn(f"--setenv=HERMES_FLYWHEEL_ENABLED={value}", command)
        with mock.patch.dict(os.environ, {"HERMES_FLYWHEEL_ENABLED": "true", "HERMES_FLYWHEEL_MAX_QUESTIONS": "100"}, clear=True):
            environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
            command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY,
                                         ("pi5",), "pi", hermes_environment=environment)
            self.assertIn("--setenv=HERMES_FLYWHEEL_MAX_QUESTIONS=100", command)
        with mock.patch.dict(os.environ, {"HERMES_FLYWHEEL_ENABLED": "yes"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "HERMES_FLYWHEEL_ENABLED must be true or false"):
                MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
        with mock.patch.dict(os.environ, {"HERMES_FLYWHEEL_MAX_QUESTIONS": "0"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "HERMES_FLYWHEEL_MAX_QUESTIONS must be a positive integer"):
                MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))

    def test_hermes_flags_without_a_forwarding_path_fail_before_plan_or_mutation(self) -> None:
        # Run 20261003-093810-c3d634 set HERMES_FLYWHEEL_ENABLED on a plain
        # Pi5 release: it succeeded and the flag never reached the API.
        plain = ["main", MODULE.DEFAULT_INVENTORY, "--limit", "raspberrypi5"]
        for name, value in (
            ("HERMES_FLYWHEEL_ENABLED", "true"),
            ("HERMES_FLYWHEEL_MAX_QUESTIONS", "100"),
            ("HERMES_RETRIEVAL_ENRICHMENT_ENABLED", "true"),
            ("HERMES_RETRIEVAL_ENRICHMENT_MAX_RECORDS", "10"),
            ("HERMES_RETRIEVAL_ENRICHMENT_CONCURRENCY", "1"),
            ("HERMES_RETRIEVAL_ENRICHMENT_WINDOW", "0-6"),
            ("HERMES_RETRIEVAL_ENRICHMENT_IDS", "/private/ids.txt"),
            ("HERMES_RETRIEVAL_CAUSE_ENABLED", "true"),
            ("HERMES_RETRIEVAL_CAUSE_MAX_TEXTS", "10"),
            ("HERMES_RETRIEVAL_DENSE_PROVIDER", "dgx"),
            ("HERMES_RETRIEVAL_DENSE_INDEX_ENABLED", "true"),
            ("HERMES_RETRIEVAL_V2_ENABLED", "true"),
            ("HERMES_RETRIEVAL_SOURCES", "nonconformity,knowledge_procedure"),
            ("HERMES_SEARCH_RECORD_CLASSIFICATION_ENABLED", "false"),
        ):
            for mode in (["--detach"], ["--print-plan"], []):
                with self.subTest(name=name, mode=mode), mock.patch.dict(
                    os.environ, {name: value}, clear=True
                ), mock.patch.object(MODULE, "inventory_path") as inventory_path, mock.patch.object(
                    MODULE, "run"
                ) as run:
                    with self.assertRaisesRegex(
                        MODULE.UsageError, f"{name} would not be forwarded.*--hermes-search-trial-maintenance on"
                    ):
                        MODULE.main(plain + mode)
                    inventory_path.assert_not_called()
                    run.assert_not_called()

        environment = {"HERMES_FLYWHEEL_ENABLED": "true"}
        with mock.patch.dict(os.environ, environment, clear=True):
            MODULE.reject_unforwarded_hermes_flags(MODULE.parse_arguments(plain + ["--hermes-search-trial-maintenance", "on"]))
            MODULE.reject_unforwarded_hermes_flags(MODULE.parse_arguments(plain + ["--hermes-search-trial-maintenance", "off"]))
        with mock.patch.dict(os.environ, {**environment, "HERMES_SEARCH_TRIAL_ENABLED": "false"}, clear=True):
            MODULE.reject_unforwarded_hermes_flags(MODULE.parse_arguments(plain))
        with mock.patch.dict(os.environ, {}, clear=True):
            MODULE.reject_unforwarded_hermes_flags(MODULE.parse_arguments(plain))

    def test_maintenance_retrieval_sources_reach_systemd_without_defaulting(self) -> None:
        args = argparse.Namespace(hermes_search_trial_maintenance="on", branch="main",
                                  limit="raspberrypi5", full_fleet=False, detach=True,
                                  torque_cutover=False)
        key = "HERMES_RETRIEVAL_SOURCES"
        for value, expected in (
            (None, None),
            ("", None),
            (" , , ", None),
            ("nonconformity,knowledge_procedure", "nonconformity,knowledge_procedure"),
            (" knowledge_procedure , nonconformity , knowledge_procedure ", "knowledge_procedure,nonconformity"),
        ):
            with self.subTest(value=value), mock.patch.dict(
                os.environ, {"HERMES_SEARCH_TRIAL_JEV_ENABLED": "false", **({} if value is None else {key: value})}, clear=True
            ):
                environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
                command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY,
                                             ("pi5",), "pi", hermes_environment=environment)
                if expected is None:
                    self.assertNotIn(key, environment)
                    self.assertFalse(any(key in item for item in command))
                else:
                    self.assertEqual(environment[key], expected)
                    self.assertIn(f"--setenv={key}={expected}", command)
        with mock.patch.dict(os.environ, {key: "knowledge_procedure,unknown"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "^HERMES_RETRIEVAL_SOURCES contains an unknown source: unknown$"):
                MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))

    def test_retrieval_sources_follow_the_shipped_definitions(self) -> None:
        known = MODULE.retrieval_source_ids()
        self.assertLessEqual({"nonconformity", "knowledge_procedure", "torque_training_session",
                              "torque_training_operator", "torque_training_team"}, known)
        every = ",".join(sorted(known))
        with mock.patch.dict(os.environ, {"HERMES_RETRIEVAL_SOURCES": every}, clear=True):
            self.assertEqual(MODULE.optional_retrieval_sources_setting(), every)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "added-source.json").write_text(
                json.dumps({"schema": "hermes-source-definition/v1", "id": "added_source"}), encoding="utf-8")
            (root / "other-contract.json").write_text(json.dumps({"schema": "other/v1", "id": "ignored"}), encoding="utf-8")
            self.assertEqual(MODULE.retrieval_source_ids(root), frozenset({"added_source"}))
            (root / "bad-id.json").write_text(
                json.dumps({"schema": "hermes-source-definition/v1", "id": "Bad,Id"}), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.UsageError, "invalid id: bad-id.json"):
                MODULE.retrieval_source_ids(root)

    def test_maintenance_dense_provider_reaches_systemd_without_defaulting(self) -> None:
        args = argparse.Namespace(hermes_search_trial_maintenance="on", branch="main",
                                  limit="raspberrypi5", full_fleet=False, detach=True,
                                  torque_cutover=False)
        provider = "HERMES_RETRIEVAL_DENSE_PROVIDER"
        index_flag = "HERMES_RETRIEVAL_DENSE_INDEX_ENABLED"
        for value in (None, "off", "dgx"):
            with self.subTest(value=value), mock.patch.dict(os.environ, {} if value is None else {provider: value}, clear=True):
                environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
                command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY,
                                             ("pi5",), "pi", hermes_environment=environment)
                if value is None:
                    self.assertNotIn(provider, environment)
                    self.assertFalse(any(provider in item for item in command))
                else:
                    self.assertEqual(environment[provider], value)
                    self.assertIn(f"--setenv={provider}={value}", command)
        with mock.patch.dict(os.environ, {provider: "local"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "HERMES_RETRIEVAL_DENSE_PROVIDER must be off or dgx"):
                MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
        with mock.patch.dict(os.environ, {index_flag: "true"}, clear=True):
            environment = MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))
            self.assertEqual(environment[index_flag], "true")
            self.assertNotIn(provider, environment)
        with mock.patch.dict(os.environ, {index_flag: "yes"}, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "HERMES_RETRIEVAL_DENSE_INDEX_ENABLED must be true or false"):
                MODULE.hermes_trial_maintenance_configuration(args, (("pi5", ("raspberrypi5",)),))

    def test_fixed_record_pilot_artifact_is_retired(self) -> None:
        args = argparse.Namespace(full_fleet=False, detach=False, branch="main", limit="raspberrypi5")
        source = ROOT / "scripts/hermes-search/hermes-jev-record-pilot-artifact"
        with mock.patch.dict(os.environ, {
            "HERMES_SEARCH_TRIAL_ENABLED": "true",
            "HERMES_SEARCH_TRIAL_RECORD_PILOT_ARTIFACT": str(source),
        }, clear=True):
            with self.assertRaisesRegex(MODULE.UsageError, "retired"):
                MODULE.hermes_trial_configuration(args, (("pi5", ("raspberrypi5",)),), MODULE.REMOTE_ROOT, RUN_ID)

    def test_record_classification_uses_the_real_sealed_device_artifact(self) -> None:
        self.assertFalse(hasattr(MODULE, "hermes_record_pilot_configuration"))
        self.assertFalse(hasattr(MODULE, "stage_hermes_record_pilot_artifact"))

    def test_hermes_trial_checks_sealed_files_and_passes_only_pi5_local_path(self) -> None:
        args = argparse.Namespace(full_fleet=False, detach=False, branch="main", limit="raspberrypi5")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {}
            for name in ("qmd-index.sqlite", "snapshot.json", "reviewed.json"):
                data = ("synthetic:" + name).encode()
                (root / name).write_bytes(data)
                files[name] = hashlib.sha256(data).hexdigest()
            (root / "artifact.json").write_text(json.dumps({"schema": "hermes-device-index/v1", "files": files}))
            (root / "do-not-transfer.txt").write_text("excluded")
            with mock.patch.dict(os.environ, {"HERMES_SEARCH_TRIAL_ENABLED": "true",
                "HERMES_SEARCH_TRIAL_ARTIFACT": directory, "UNRELATED_SECRET": "must-not-forward"}, clear=True):
                source, environment = MODULE.hermes_trial_configuration(args, (("pi5", ("raspberrypi5",)),), MODULE.REMOTE_ROOT, RUN_ID)
                expected = f"/opt/RaspberryPiSystem_002/storage/hermes-search-staging/{RUN_ID}"
                self.assertEqual(environment["HERMES_SEARCH_TRIAL_ARTIFACT"], expected)
                command = MODULE.systemd_argv(args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi5",), "pi", hermes_environment=environment)
                self.assertIn(f"--setenv=HERMES_SEARCH_TRIAL_ARTIFACT={expected}", command)
                self.assertIn("--setenv=HERMES_SEARCH_TRIAL_ENABLED=true", command)
                self.assertNotIn(directory, " ".join(command))
                self.assertNotIn("must-not-forward", " ".join(command))
                self.assertEqual(source, root.resolve())
                (root / "reviewed.json").write_text("tampered")
                with self.assertRaisesRegex(MODULE.UsageError, "checksum mismatch"):
                    MODULE.hermes_trial_configuration(args, (("pi5", ("raspberrypi5",)),), MODULE.REMOTE_ROOT, RUN_ID)

    def test_hermes_staging_uses_only_fixed_files_and_existing_ansible_auth(self) -> None:
        def inspect(command, **options):
            self.assertEqual(command[:3], ["ansible-playbook", "-i", "inventory.yml"])
            self.assertEqual(command[-2:], ["--limit", "raspberrypi5"])
            self.assertEqual(options["env"]["ANSIBLE_VAULT_PASSWORD_FILE"], "/existing/vault")
            play = json.loads(Path(command[3]).read_text())[0]
            self.assertEqual(play["hosts"], "raspberrypi5")
            self.assertEqual(play["tasks"][0]["ansible.builtin.file"]["mode"], "0700")
            copy = play["tasks"][1]
            self.assertTrue(copy["no_log"])
            self.assertEqual(copy["loop"], ["artifact.json", "qmd-index.sqlite", "snapshot.json", "reviewed.json"])
            self.assertEqual(copy["ansible.builtin.copy"]["mode"], "0600")
            return completed(command)
        with mock.patch.dict(os.environ, {"ANSIBLE_VAULT_PASSWORD_FILE": "/existing/vault"}), mock.patch.object(MODULE, "run", side_effect=inspect):
            MODULE.stage_hermes_trial_artifact(Path("inventory.yml"), Path("/local/sealed"), "/remote/private", "pi")

    def test_server_connection_uses_concrete_deploy_executor_host(self) -> None:
        inventory = {
            "server": {"hosts": ["raspberrypi5"]},
            "_meta": {
                "hostvars": {
                    "raspberrypi5": {
                        "ansible_host": "{{ server_ip }}",
                        "deploy_executor_host": "100.106.158.2",
                        "ansible_user": "denkon5sd02",
                    }
                }
            },
        }

        host, user, port = MODULE.server_connection(inventory)

        self.assertEqual((host, user, port), ("100.106.158.2", "denkon5sd02", 22))
        self.assertEqual(
            MODULE.ssh_argv(host, user, port, ["true"])[-2],
            "denkon5sd02@100.106.158.2",
        )

    def test_server_connection_rejects_missing_or_unresolved_executor_host(self) -> None:
        for host in (
            None,
            "",
            " 100.106.158.2",
            "100.106.158.2 ",
            "100.106. 158.2",
            "{{ server_ip }}",
        ):
            with self.subTest(host=host), self.assertRaisesRegex(
                MODULE.UsageError, "unresolved or malformed"
            ):
                MODULE.server_connection(
                    {
                        "server": {"hosts": ["raspberrypi5"]},
                        "_meta": {
                            "hostvars": {
                                "raspberrypi5": {
                                    "deploy_executor_host": host,
                                    "ansible_user": "denkon5sd02",
                                }
                            }
                        },
                    }
                )

    def test_release_remote_root_defaults_to_production_and_accepts_staging(self) -> None:
        production = {
            "server": {"hosts": ["pi5"]},
            "_meta": {"hostvars": {"pi5": {}}},
        }
        staging = {
            "server": {"hosts": ["staging-pi5"]},
            "_meta": {
                "hostvars": {
                    "staging-pi5": {
                        "release_remote_root": "/opt/RaspberryPiSystem_002-staging"
                    }
                }
            },
        }

        self.assertEqual(MODULE.server_release_root(production), MODULE.REMOTE_ROOT)
        self.assertEqual(
            MODULE.server_release_root(staging),
            Path("/opt/RaspberryPiSystem_002-staging"),
        )

        staging["_meta"]["hostvars"]["staging-pi5"]["release_remote_root"] = (
            "{{ repo_path }}"
        )
        with self.assertRaisesRegex(MODULE.UsageError, "unresolved or malformed"):
            MODULE.server_release_root(staging)

    def test_production_inventory_has_concrete_deploy_executor_host(self) -> None:
        inventory = yaml.safe_load(
            (ROOT / MODULE.DEFAULT_INVENTORY).read_text(encoding="utf-8")
        )
        pi5 = inventory["all"]["children"]["server"]["hosts"]["raspberrypi5"]

        self.assertEqual(pi5["ansible_host"], "{{ server_ip }}")
        self.assertEqual(pi5["deploy_executor_host"], "100.106.158.2")

    def test_parser_rejects_legacy_admission_and_implicit_mutation(self) -> None:
        with self.assertRaisesRegex(MODULE.UsageError, "unsupported"):
            MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--approve", RUN_ID])
        with self.assertRaisesRegex(MODULE.UsageError, "explicit --limit"):
            MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY])

        args = MODULE.parse_arguments(
            ["--branch", "main", "--inventory", MODULE.DEFAULT_INVENTORY, "--full-fleet"]
        )
        self.assertTrue(args.full_fleet)

        with self.assertRaisesRegex(MODULE.UsageError, "internal mutation"):
            MODULE.parse_arguments(
                [
                    "--execute-standard-route", "--branch", "main",
                    "--inventory", MODULE.DEFAULT_INVENTORY, "--sha", SHA,
                    "--run-id", RUN_ID, "--profiles", "pi4",
                ]
            )

    def test_torque_cutover_requires_exact_limit_and_capable_kiosks(self) -> None:
        for scope in ([], ["--full-fleet"]):
            with self.subTest(scope=scope), self.assertRaisesRegex(
                MODULE.UsageError, "exact --limit"
            ):
                MODULE.parse_arguments(
                    ["main", MODULE.DEFAULT_INVENTORY, "--torque-cutover", *scope]
                )

        args = MODULE.parse_arguments(
            [
                "main",
                MODULE.DEFAULT_INVENTORY,
                "--torque-cutover",
                "--limit",
                "raspberrypi5:raspi4-kensaku-stonebase01:raspi4-assembly-01",
            ]
        )
        self.assertTrue(args.torque_cutover)

        document = {
            "server": {"hosts": ["raspberrypi5"]},
            "kiosk": {
                "hosts": [
                    "raspi4-kensaku-stonebase01",
                    "raspi4-assembly-01",
                ]
            },
            "_meta": {
                "hostvars": {
                    "raspberrypi5": {},
                    "raspi4-kensaku-stonebase01": torque_capable_host(),
                    "raspi4-assembly-01": torque_capable_host("702903S"),
                }
            },
        }
        selection = MODULE.selected_profiles(document)
        MODULE.validate_torque_cutover_selection(document, selection)

        document["_meta"]["hostvars"]["raspi4-assembly-01"]["torque_agent_enabled"] = False
        with self.assertRaisesRegex(MODULE.UsageError, "every explicitly selected Pi4"):
            MODULE.validate_torque_cutover_selection(document, selection)

    def test_torque_cutover_accepts_a_future_explicitly_configured_kiosk(self) -> None:
        hosts = ["raspi4-kensaku-stonebase01", "raspi4-assembly-01", "future-kiosk"]
        document = {
            "server": {"hosts": ["raspberrypi5"]},
            "kiosk": {"hosts": hosts},
            "_meta": {
                "hostvars": {
                    "raspberrypi5": {},
                    **{
                        host: torque_capable_host(str(702902 + index) + "S")
                        for index, host in enumerate(hosts)
                    },
                }
            },
        }

        MODULE.validate_torque_cutover_selection(
            document,
            MODULE.selected_profiles(document),
        )

    def test_torque_cutover_rejects_incomplete_hid_identity(self) -> None:
        incomplete = torque_capable_host()
        incomplete["torque_agent_hid_links"] = []
        document = {
            "server": {"hosts": ["raspberrypi5"]},
            "kiosk": {"hosts": ["future-kiosk"]},
            "_meta": {
                "hostvars": {
                    "raspberrypi5": {},
                    "future-kiosk": incomplete,
                }
            },
        }

        with self.assertRaisesRegex(MODULE.UsageError, "complete torque-agent"):
            MODULE.validate_torque_cutover_selection(
                document,
                MODULE.selected_profiles(document),
            )

    def test_torque_cutover_capability_rejects_each_incomplete_setting(self) -> None:
        cases: dict[str, dict[str, object]] = {}
        for name in (
            "lease",
            "api",
            "client-key",
            "adapter",
            "parser",
            "link-match",
            "local-port",
            "browser-origin",
        ):
            cases[name] = torque_capable_host()
        cases["lease"]["torque_connection_lease_enabled"] = False
        cases["api"]["torque_agent_api_base_url"] = ""
        cases["client-key"]["torque_agent_client_key"] = ""
        cases["adapter"]["torque_agent_bluetooth_adapter"] = {
            "usb_vendor_id": "guess",
            "usb_product_id": "0604",
        }
        cases["parser"]["torque_agent_hid_devices"][0]["parserProfile"] = "unknown"
        cases["link-match"]["torque_agent_hid_links"][0]["link_name"] = (
            "bluetooth-TOHNICHI_OTHER-event-kbd"
        )
        cases["local-port"]["torque_agent_local_port"] = 70000
        cases["browser-origin"]["torque_agent_browser_origins"] = ["*"]

        for name, values in cases.items():
            with self.subTest(name=name):
                self.assertFalse(MODULE.torque_cutover_capable(values))

    def test_torque_cutover_capability_allows_only_safe_nested_url_variables(self) -> None:
        templated = torque_capable_host()
        templated["torque_agent_api_base_url"] = "{{ server_base_url }}"
        templated["torque_agent_browser_origins"] = ["{{ server_base_url }}"]
        self.assertTrue(MODULE.torque_cutover_capable(templated))

        templated["torque_agent_api_base_url"] = "{{ lookup('env', 'URL') }}"
        self.assertFalse(MODULE.torque_cutover_capable(templated))

    def test_torque_cutover_image_plan_excludes_unverified_agents(self) -> None:
        images = MODULE.image_plan(
            SHA,
            ("pi5", "pi4"),
            "b" * 64,
            torque_cutover=True,
        )
        self.assertEqual(images["pi4"], [f"release-set-v2:{SHA}:torque-agent"])
        self.assertNotIn("nfc-agent", " ".join(images["pi4"]))
        self.assertNotIn("barcode-agent", " ".join(images["pi4"]))

    def test_target_selection_rejects_empty_and_unsupported_hosts(self) -> None:
        with self.assertRaisesRegex(MODULE.UsageError, "matched no hosts"):
            MODULE.selected_profiles({"_meta": {"hostvars": {}}})
        with self.assertRaisesRegex(MODULE.UsageError, "outside server/kiosk/signage"):
            MODULE.selected_profiles(
                {"_meta": {"hostvars": {"other": {}}}, "other_group": {"hosts": ["other"]}}
            )

        self.assertEqual(
            MODULE.selected_profiles(
                {
                    "_meta": {"hostvars": {"pi4-b": {}, "pi4-a": {}}},
                    "kiosk": {"hosts": ["pi4-b", "pi4-a", "not-selected"]},
                }
            ),
            (("pi4", ("pi4-b", "pi4-a")),),
        )

    def test_optional_preflight_probes_each_terminal_once_and_keeps_pi5_required(self) -> None:
        inventory = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-online", "pi4-offline"]},
            "signage": {"hosts": ["pi3-offline"]},
            "_meta": {
                "hostvars": {
                    "pi5": {},
                    "pi4-online": {"ansible_host": "100.64.0.4", "ansible_port": "22"},
                    "pi4-offline": {"ansible_host": "100.64.0.5"},
                    "pi3-offline": {"ansible_host": "100.64.0.3"},
                }
            },
        }
        calls: list[tuple[tuple[str, int], float]] = []

        class Connection:
            def close(self) -> None:
                pass

        def connect(endpoint: tuple[str, int], *, timeout: float) -> Connection:
            calls.append((endpoint, timeout))
            if endpoint[0] != "100.64.0.4":
                raise TimeoutError
            return Connection()

        reachable, excluded = MODULE.preflight_optional_hosts(
            inventory,
            (
                ("pi5", ("pi5",)),
                ("pi4", ("pi4-online", "pi4-offline")),
                ("pi3", ("pi3-offline",)),
            ),
            connector=connect,
        )

        self.assertEqual(
            reachable,
            (("pi5", ("pi5",)), ("pi4", ("pi4-online",))),
        )
        self.assertEqual(
            excluded,
            (
                {"host": "pi4-offline", "profile": "pi4", "reason": "tcp-unreachable"},
                {"host": "pi3-offline", "profile": "pi3", "reason": "tcp-unreachable"},
            ),
        )
        self.assertEqual(
            [endpoint[0] for endpoint, _timeout in calls],
            ["100.64.0.4", "100.64.0.5", "100.64.0.3"],
        )
        self.assertTrue(
            all(
                timeout == MODULE.OPTIONAL_HOST_CONNECT_TIMEOUT_SECONDS
                for _endpoint, timeout in calls
            )
        )
        self.assertEqual(MODULE.exact_host_limit(reachable), "pi5:pi4-online")

    def test_optional_preflight_rejects_unresolved_addresses(self) -> None:
        with self.assertRaisesRegex(MODULE.UsageError, "unresolved SSH address"):
            MODULE.preflight_optional_hosts(
                {"_meta": {"hostvars": {"pi4": {"ansible_host": "{{ missing }}"}}}},
                (("pi4", ("pi4",)),),
            )

    def test_production_optional_host_expressions_are_supported(self) -> None:
        inventory = yaml.safe_load(
            (ROOT / MODULE.DEFAULT_INVENTORY).read_text(encoding="utf-8")
        )
        all_vars = yaml.safe_load(
            (ROOT / "infrastructure/ansible/group_vars/all.yml").read_text(encoding="utf-8")
        )
        optional_groups = inventory["all"]["children"]["clients"]["children"]

        for group in ("kiosk", "signage"):
            for host, host_values in optional_groups[group]["hosts"].items():
                with self.subTest(host=host):
                    document = {
                        "_meta": {
                            "hostvars": {
                                host: {**all_vars, **(host_values or {})},
                            }
                        }
                    }
                    address, port = MODULE.optional_host_endpoint(document, host)
                    self.assertNotIn("{{", address)
                    self.assertIn(address, all_vars["tailscale_network"].values())
                    self.assertEqual(port, 22)

    def _run_route_with_offline_pi3(
        self, stdout: io.TextIOBase, ansible: Any = 1, *, offline: bool = True, coverage_error: BaseException | None = None,
    ) -> tuple[int, Any, Any, tuple[dict[str, str], ...]]:
        args = argparse.Namespace(
            inventory=MODULE.DEFAULT_INVENTORY,
            sha=SHA,
            run_id=RUN_ID,
            profiles="pi5,pi4,pi3",
            limit="",
            full_fleet=True,
        )
        inventory = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-online"]},
            "signage": {"hosts": ["pi3-offline"]},
            "_meta": {
                "hostvars": {
                    "pi5": {},
                    "pi4-online": {},
                    "pi3-offline": {},
                }
            },
        }
        reachable = (("pi5", ("pi5",)), ("pi4", ("pi4-online",)))
        excluded = (
            {
                "host": "pi3-offline",
                "profile": "pi3",
                "reason": "tcp-unreachable",
            },
        )

        with mock.patch.object(
            MODULE,
            "inventory_path",
            return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY),
        ), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(
            MODULE, "run", return_value=completed(["git"], f"{SHA}\n")
        ), mock.patch.object(
            MODULE,
            "preflight_optional_hosts",
            return_value=(reachable, excluded) if offline else (reachable, ()),
        ), mock.patch.object(
            MODULE,
            "release_set_artifacts",
            return_value=MODULE.ReleaseArtifacts(
                f"api:{SHA}", f"web:{SHA}", None, None
            ),
        ), mock.patch.object(
            MODULE, "signage_identity"
        ) as signage_identity, mock.patch.object(
            MODULE, "run_agent_coverage_check"
        ) as coverage, mock.patch.object(
            MODULE, "execute_ansible_with_cleanup"
        ) as execute, redirect_stdout(stdout):
            self.coverage = coverage
            coverage.side_effect = coverage_error
            def run_ansible(*_: object, **__: object) -> int:
                stdout.lines_at_ansible = len(stdout.getvalue().splitlines())  # type: ignore[attr-defined]
                if isinstance(ansible, BaseException):
                    raise ansible
                return ansible

            execute.side_effect = run_ansible
            try:
                result = MODULE.execute_standard_route(args)
            finally:
                stdout.replaced = sys.stdout is not stdout  # type: ignore[attr-defined]
        return result, execute, signage_identity, excluded

    def test_standard_route_excludes_offline_optional_profiles_before_artifact_pull(self) -> None:
        output = io.StringIO()
        result, execute, signage_identity, excluded = self._run_route_with_offline_pi3(output)
        self.assertEqual(result, 1)

        signage_identity.assert_not_called()
        command = execute.call_args.args[0]
        self.assertEqual(command[command.index("--tags") + 1], "pi5,pi4")
        self.assertEqual(command[-2:], ["--limit", "pi5:pi4-online"])
        lines = output.getvalue().splitlines()
        # Printed before Ansible and again after it, so --status's journal tail keeps it.
        self.assertEqual(output.lines_at_ansible, 1)  # type: ignore[attr-defined]
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0], lines[1])
        event = json.loads(lines[0])
        self.assertEqual(event["excluded"], list(excluded))
        prefix = "2026-11-20T10:00:00+09:00 raspberrypi bash[456]: "
        self.assertEqual(
            MODULE.summarize_release_journal(
                "\n".join(prefix + line for line in lines),
                frozenset({("pi3-offline", "pi3")}),
            ),
            ["excluded offline hosts: pi3-offline(pi3)"],
        )

    def test_standard_route_keeps_ansible_result_when_repeat_cannot_be_written(self) -> None:
        class ClosedAfterFirstEvent(io.StringIO):
            def write(self, text: str) -> int:
                if "optional-host-preflight" in text and "optional-host-preflight" in self.getvalue():
                    raise BrokenPipeError(32, "Broken pipe")
                return super().write(text)

        output = ClosedAfterFirstEvent()
        result, execute, _, _ = self._run_route_with_offline_pi3(output)
        self.assertEqual(result, 1)
        execute.assert_called_once()
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        # The unwritable stream is swapped out so interpreter shutdown cannot fail.
        self.assertTrue(getattr(output, "replaced", False))

    def test_standard_route_prints_preflight_once_when_no_host_was_skipped(self) -> None:
        output = io.StringIO()
        result, _, _, _ = self._run_route_with_offline_pi3(output, offline=False)
        self.assertEqual(result, 1)
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertEqual(json.loads(output.getvalue())["excluded"], [])

    def test_standard_route_repeats_skipped_hosts_when_ansible_raises(self) -> None:
        output = io.StringIO()
        with self.assertRaisesRegex(RuntimeError, "synthetic ansible failure"):
            self._run_route_with_offline_pi3(output, RuntimeError("synthetic ansible failure"))
        lines = output.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0], lines[1])

    def test_standard_route_keeps_ansible_exception_when_repeat_flush_fails(self) -> None:
        class FlushFailsAfterAnsible(io.StringIO):
            def flush(self) -> None:
                if getattr(self, "lines_at_ansible", None) is not None:
                    raise ValueError("I/O operation on closed file")

        output = FlushFailsAfterAnsible()
        with self.assertRaisesRegex(RuntimeError, "synthetic ansible failure"):
            self._run_route_with_offline_pi3(output, RuntimeError("synthetic ansible failure"))
        self.assertTrue(getattr(output, "replaced", False))

    def test_status_allowlist_ignores_other_groups_and_unsafe_names(self) -> None:
        document = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-a", "bad\nname", 7]},
            "signage": {"hosts": ["pi3-a"]},
            "monitoring": {"hosts": ["outside"]},
            "_meta": {"hostvars": {"pi5": {}, "pi4-a": {}, "pi3-a": {}, "outside": {}}},
        }
        self.assertEqual(
            MODULE.status_optional_hosts(document),
            frozenset({("pi4-a", "pi4"), ("pi3-a", "pi3")}),
        )

    def test_ansible_argv_is_exact_and_contains_no_legacy_inputs(self) -> None:
        variables = {
            "release_sha": SHA,
            "release_run_id": RUN_ID,
            "release_signage_artifact_sha256": "b" * 64,
        }
        command = MODULE.ansible_argv(
            MODULE.DEFAULT_INVENTORY, "pi4-a", ("pi4",), variables
        )

        self.assertEqual(command[0], "ansible-playbook")
        self.assertEqual(command[1:3], ["-i", MODULE.DEFAULT_INVENTORY])
        self.assertIn("deploy-release-standard.yml", command[3])
        self.assertEqual(command[command.index("--tags") + 1], "pi4")
        self.assertEqual(command[-2:], ["--limit", "pi4-a"])
        payload = json.loads(command[command.index("--extra-vars") + 1])
        self.assertEqual(payload, variables)
        self.assertFalse(
            {"approve", "claims", "readiness", "fleet_state"} & set(payload)
        )

    def test_release_set_scratch_image_uses_explicit_harmless_command(self) -> None:
        commands: list[list[str]] = []
        release = types.SimpleNamespace(
            api=types.SimpleNamespace(
                repository=f"{GHCR_NAMESPACE}/raspisys-api",
                digest="sha256:" + "1" * 64,
            ),
            web=types.SimpleNamespace(
                repository=f"{GHCR_NAMESPACE}/raspisys-web",
                digest="sha256:" + "2" * 64,
            ),
            torque_agent=None,
            torque_compatibility=None,
        )

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            if command[1] == "create":
                return completed(command, "release-set-container\n")
            if command[1] == "cp":
                Path(command[-1]).write_text("{}", encoding="utf-8")
            return completed(command)

        with mock.patch.object(MODULE, "config_hash", return_value="b" * 64), mock.patch.object(
            MODULE, "parse_release_set", return_value=release
        ), mock.patch.object(MODULE, "validate_release_set"), mock.patch.object(
            MODULE, "_exact_repo_digest", return_value=f"{GHCR_NAMESPACE}/raspisys-release-set@sha256:" + "9" * 64
        ), mock.patch.object(
            MODULE, "verify_component_attestation"
        ), mock.patch.object(
            MODULE, "run", side_effect=fake_run
        ):
            MODULE.release_set_images(SHA, ROOT / MODULE.DEFAULT_INVENTORY)

        create = next(command for command in commands if command[1] == "create")
        self.assertEqual(create[-1], "/release-set.json")
        pull = next(command for command in commands if command[1:3] == ["image", "pull"])
        self.assertNotIn("-torque-v2", pull[-1])

    def test_torque_plan_normalizes_one_verified_tuple_for_all_selected_hosts(self) -> None:
        artifacts = MODULE.ReleaseArtifacts(
            "api@sha256:" + "1" * 64,
            "web@sha256:" + "2" * 64,
            "torque@sha256:" + "3" * 64,
            MODULE.TORQUE_PROTOCOL_VERSION,
        )

        plan = MODULE.normalize_torque_cutover_plan(
            SHA, RUN_ID, ("stonebase", "assembly-01"), artifacts
        )

        self.assertEqual(plan.hosts, ("stonebase", "assembly-01"))
        self.assertEqual(
            plan.ansible_variables()["release_kiosk_service_allowlist"],
            ["torque-agent"],
        )
        self.assertEqual(
            plan.journal_event()["targets"],
            [
                {"host": "stonebase", "component": "torque-agent"},
                {"host": "assembly-01", "component": "torque-agent"},
            ],
        )

    def test_torque_plan_rejects_duplicate_hosts_before_ansible(self) -> None:
        artifacts = MODULE.ReleaseArtifacts("api", "web", "torque", 1)
        with self.assertRaisesRegex(RuntimeError, "plan is incomplete"):
            MODULE.normalize_torque_cutover_plan(
                SHA, RUN_ID, ("stonebase", "stonebase"), artifacts
            )

    def test_v2_release_set_returns_exact_torque_digest_and_verifies_adoption(self) -> None:
        commands: list[list[str]] = []
        torque = types.SimpleNamespace(
            repository=f"{GHCR_NAMESPACE}/raspisys-torque-agent",
            index_digest="sha256:" + "3" * 64,
        )
        compatibility = types.SimpleNamespace(protocol_version=1)
        release = types.SimpleNamespace(
            schema_version=2,
            source_repository=SOURCE_REPOSITORY,
            source_sha=SHA,
            source_ref="refs/heads/main",
            config_hash="b" * 64,
            api=types.SimpleNamespace(
                repository=f"{GHCR_NAMESPACE}/raspisys-api",
                digest="sha256:" + "1" * 64,
            ),
            web=types.SimpleNamespace(
                repository=f"{GHCR_NAMESPACE}/raspisys-web",
                digest="sha256:" + "2" * 64,
            ),
            torque_agent=torque,
            torque_compatibility=compatibility,
            workflow=types.SimpleNamespace(
                path=".github/workflows/ci.yml",
                run_id=123,
                run_attempt=1,
            ),
            composition_workflow=types.SimpleNamespace(
                path=".github/workflows/torque-release.yml",
                run_id=456,
                run_attempt=2,
            ),
            base_release_set=types.SimpleNamespace(
                digest=f"{GHCR_NAMESPACE}/raspisys-release-set@sha256:" + "8" * 64,
            ),
        )
        base_release = types.SimpleNamespace(
            schema_version=1,
            source_repository=SOURCE_REPOSITORY,
            source_sha=SHA,
            source_ref="refs/heads/main",
            config_hash="b" * 64,
            api=release.api,
            web=release.web,
            workflow=release.workflow,
        )

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            if command[1] == "create":
                return completed(command, "release-set-container\n")
            if command[1] == "cp":
                Path(command[-1]).write_text("{}", encoding="utf-8")
            return completed(command)

        with mock.patch.object(MODULE, "config_hash", return_value="b" * 64), mock.patch.object(
            MODULE, "parse_release_set", side_effect=[release, base_release]
        ), mock.patch.object(MODULE, "validate_release_set"), mock.patch.object(
            MODULE, "_exact_repo_digest", return_value=f"{GHCR_NAMESPACE}/raspisys-release-set@sha256:" + "9" * 64
        ), mock.patch.object(
            MODULE, "verify_component_attestation"
        ) as verify, mock.patch.object(MODULE, "run", side_effect=fake_run):
            artifacts = MODULE.release_set_artifacts(
                SHA, ROOT / MODULE.DEFAULT_INVENTORY, require_torque=True
            )

        self.assertEqual(
            artifacts.torque_agent,
            f"{GHCR_NAMESPACE}/raspisys-torque-agent@sha256:" + "3" * 64,
        )
        self.assertEqual(artifacts.torque_protocol_version, 1)
        self.assertEqual(verify.call_count, 3)
        self.assertIn("-torque-v2", commands[0][-1])
        self.assertEqual(
            verify.call_args_list[2].kwargs["adoption_workflow"],
            (".github/workflows/torque-release.yml", 456, 2),
        )
        created_references = [
            command[2] for command in commands if command[1] == "create"
        ]
        self.assertEqual(
            created_references,
            [
                f"{GHCR_NAMESPACE}/raspisys-release-set@sha256:" + "9" * 64,
                f"{GHCR_NAMESPACE}/raspisys-release-set@sha256:" + "8" * 64,
            ],
        )

        mismatches = {
            "source": ("source_sha", "c" * 40),
            "config": ("config_hash", "d" * 64),
            "image": (
                "api",
                types.SimpleNamespace(
                    repository=f"{GHCR_NAMESPACE}/raspisys-api",
                    digest="sha256:" + "7" * 64,
                ),
            ),
        }
        for label, (field, value) in mismatches.items():
            mismatched_base = types.SimpleNamespace(**vars(base_release))
            setattr(mismatched_base, field, value)
            with self.subTest(label=label), mock.patch.object(
                MODULE, "config_hash", return_value="b" * 64
            ), mock.patch.object(
                MODULE, "parse_release_set", side_effect=[release, mismatched_base]
            ), mock.patch.object(
                MODULE, "validate_release_set"
            ), mock.patch.object(
                MODULE,
                "_exact_repo_digest",
                return_value=f"{GHCR_NAMESPACE}/raspisys-release-set@sha256:"
                + "9" * 64,
            ), mock.patch.object(
                MODULE, "verify_component_attestation"
            ), mock.patch.object(
                MODULE, "run", side_effect=fake_run
            ), self.assertRaisesRegex(RuntimeError, "does not match"):
                MODULE.release_set_artifacts(
                    SHA, ROOT / MODULE.DEFAULT_INVENTORY, require_torque=True
                )

    def test_adoption_verifier_selects_the_manifest_bound_run_attempt(self) -> None:
        predicates = [{"attempt": 1}, {"attempt": 2}]
        verifier_environments: list[dict[str, str]] = []
        verifier_directories: list[Path] = []

        def fake_run(
            command: list[str], **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            environment = kwargs.get("env")
            self.assertIsInstance(environment, dict)
            verifier_environments.append(environment)
            verifier_directory = Path(environment["GH_CONFIG_DIR"])
            self.assertTrue(verifier_directory.is_dir())
            verifier_directories.append(verifier_directory)
            if command[1:] == ["--version"]:
                return completed(command, "gh version 2.96.0 (test)\n")
            if command[1:] == ["attestation", "verify", "--help"]:
                return completed(
                    command,
                    "\n".join(controller_gh_verifier.REQUIRED_ATTESTATION_OPTIONS),
                )
            return completed(
                command,
                json.dumps(
                    [
                        {
                            "verificationResult": {
                                "statement": {"predicate": predicate}
                            }
                        }
                        for predicate in predicates
                    ]
                ),
            )

        def validate(predicate: object, **kwargs: object) -> None:
            if predicate != predicates[1] or kwargs["run_attempt"] != 2:
                raise MODULE.AdoptionError("different signed adoption attempt")

        with mock.patch.dict(MODULE.os.environ, {"GITHUB_TOKEN": "must-not-leak"}), mock.patch.object(
            MODULE.shutil, "which", return_value="/usr/bin/gh"
        ), mock.patch.object(
            controller_gh_verifier.platform, "system", return_value="Darwin"
        ), mock.patch.object(
            controller_gh_verifier.platform, "machine", return_value="arm64"
        ), mock.patch.object(
            MODULE, "run", side_effect=fake_run
        ), mock.patch.object(
            MODULE, "validate_adoption_predicate", side_effect=validate
        ) as validator:
            MODULE.verify_component_attestation(
                f"{GHCR_NAMESPACE}/raspisys-torque-agent@sha256:" + "3" * 64,
                SHA,
                predicate_type=MODULE.TORQUE_ADOPTION_PREDICATE_TYPE,
                adoption_workflow=(".github/workflows/ci.yml", 123, 2),
            )

        self.assertEqual(validator.call_count, 2)
        self.assertEqual(len(verifier_environments), 3)
        for environment in verifier_environments:
            self.assertEqual(
                environment["GH_TOKEN"], MODULE.PUBLIC_ATTESTATION_TOKEN
            )
            self.assertNotIn("GITHUB_TOKEN", environment)
            self.assertIn("GH_CONFIG_DIR", environment)
        self.assertTrue(all(not directory.exists() for directory in verifier_directories))

    def test_torque_route_passes_manifest_digest_and_protocol_to_ansible(self) -> None:
        args = argparse.Namespace(
            inventory=MODULE.DEFAULT_INVENTORY,
            sha=SHA,
            run_id=RUN_ID,
            profiles="pi5,pi4",
            limit="pi5:pi4-a",
            full_fleet=False,
            torque_cutover=True,
        )
        inventory = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-a"]},
            "_meta": {
                "hostvars": {
                    "pi5": {},
                    "pi4-a": torque_capable_host(),
                }
            },
        }
        selection = (("pi5", ("pi5",)), ("pi4", ("pi4-a",)))
        torque_reference = f"{GHCR_NAMESPACE}/raspisys-torque-agent@sha256:" + "3" * 64
        artifacts = MODULE.ReleaseArtifacts(
            f"api:{SHA}@sha256:{'1' * 64}",
            f"web:{SHA}@sha256:{'2' * 64}",
            torque_reference,
            1,
        )

        with mock.patch.object(
            MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)
        ), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(
            MODULE, "run", return_value=completed(["git"], f"{SHA}\n")
        ), mock.patch.object(
            MODULE, "preflight_optional_hosts", return_value=(selection, ())
        ), mock.patch.object(
            MODULE, "release_set_artifacts", return_value=artifacts
        ), mock.patch.object(MODULE, "execute_ansible_with_cleanup", return_value=1) as execute, redirect_stdout(io.StringIO()):
            self.assertEqual(MODULE.execute_standard_route(args), 1)

        command = execute.call_args.args[0]
        variables = json.loads(command[command.index("--extra-vars") + 1])
        self.assertEqual(variables["release_kiosk_torque_image"], torque_reference)
        self.assertEqual(variables["release_torque_protocol_version"], 1)

    def test_print_plan_only_lists_ansible_hosts_and_tasks(self) -> None:
        args = argparse.Namespace(
            branch="main", limit="pi4-a", full_fleet=False
        )
        commands: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            return completed(command)

        with mock.patch.object(MODULE, "run", side_effect=fake_run):
            document = MODULE.plan(
                args,
                SHA,
                ROOT / MODULE.DEFAULT_INVENTORY,
                MODULE.DEFAULT_INVENTORY,
                (("pi4", ("pi4-a",)),),
            )

        self.assertEqual(document["executionOrder"][0]["hosts"], ["pi4-a"])
        self.assertEqual(len(commands), 2)
        self.assertEqual({command[-1] for command in commands}, {"--list-hosts", "--list-tasks"})
        self.assertTrue(all(command[0] == "ansible-playbook" for command in commands))

    def test_web_only_image_plan_has_no_pi4_agent_references(self) -> None:
        images = MODULE.image_plan(
            SHA,
            ("pi4",),
            agent_services=(),
        )

        self.assertEqual(images, {"pi4": []})

    def test_subset_image_plan_updates_only_the_signed_agent_services(self) -> None:
        images = MODULE.image_plan(
            SHA,
            ("pi4",),
            agent_services=("barcode-agent",),
        )

        self.assertEqual(
            images,
            {"pi4": [f"{GHCR_NAMESPACE}/raspisys-barcode-agent:{SHA}"]},
        )

    def test_unpublished_plan_images_reports_only_missing_registry_tags(self) -> None:
        document = {
            "executionOrder": [
                {"profile": "pi5", "images": [f"{GHCR_NAMESPACE}/raspisys-api:{SHA}-abc"]},
                {"profile": "pi4", "images": ["release-set-v2:x:torque-agent"]},
                {"profile": "pi3", "images": [f"{GHCR_NAMESPACE}/raspisys-pi3-signage:{SHA}"]},
            ]
        }
        inspected: list[str] = []

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            inspected.append(command[-1])
            return completed(command, returncode=1 if "pi3-signage" in command[-1] else 0)

        with mock.patch.object(MODULE, "run", side_effect=fake_run):
            missing = MODULE.unpublished_plan_images(document)

        self.assertEqual(missing, [f"{GHCR_NAMESPACE}/raspisys-pi3-signage:{SHA}"])
        # The torque cutover placeholder is not a registry reference.
        self.assertEqual(len(inspected), 2)

    def _print_plan(self, artifacts: object, fake_run: object, limit: str, coverage_error: BaseException | None = None) -> tuple[int, str, str]:
        inventory = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-a"]},
            "_meta": {"hostvars": {"pi5": {}, "pi4-a": {}}},
        }
        selected_inventory = {
            "kiosk": {"hosts": ["pi4-a"]},
            "_meta": {"hostvars": {"pi4-a": {}}},
        }
        with mock.patch.object(MODULE, "resolve_release_artifact_sha", return_value=(SHA, None)), mock.patch.object(MODULE, "resolve_sha", return_value=SHA), mock.patch.object(
            MODULE,
            "inventory_path",
            return_value=(Path("infrastructure/ansible/inventory.yml"), MODULE.DEFAULT_INVENTORY),
        ), mock.patch.object(
            MODULE, "inventory_document", side_effect=[inventory, selected_inventory]
        ), mock.patch.object(
            MODULE, "release_set_artifacts", return_value=artifacts
        ), mock.patch.object(MODULE, "run", side_effect=fake_run), mock.patch.object(
            MODULE, "plan_agent_coverage_check", side_effect=coverage_error
        ) as plan_check, redirect_stdout(
            io.StringIO()
        ) as output, redirect_stderr(io.StringIO()) as errors:
            code = MODULE.main(
                ["--branch", "main", "--inventory", MODULE.DEFAULT_INVENTORY, "--limit", limit, "--print-plan"]
            )
        self.plan_check = plan_check
        return code, output.getvalue(), errors.getvalue()

    def test_print_plan_fails_before_any_release_when_an_agent_tag_is_missing(self) -> None:
        artifacts = MODULE.ReleaseArtifacts("api", "web", None, None, ("nfc-agent",))

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            return completed(command, returncode=1 if command[:3] == ["docker", "manifest", "inspect"] else 0)

        with self.assertRaisesRegex(
            RuntimeError,
            f"release artifacts are not published for this SHA: {GHCR_NAMESPACE}/raspisys-nfc-agent:{SHA}",
        ):
            self._print_plan(artifacts, fake_run, "pi4-a")

    def test_print_plan_stops_without_json_when_the_agent_check_fails(self) -> None:
        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            return completed(command)

        artifacts = MODULE.ReleaseArtifacts("api", "web", None, None, ("nfc-agent",))
        code, text, _errors = self._print_plan(artifacts, fake_run, "pi4-a")
        self.assertEqual(code, 0)
        json.loads(text)
        args, _kwargs = self.plan_check.call_args
        variables = args[3]
        self.assertEqual(variables["release_sha"], SHA)
        self.assertEqual(variables["release_kiosk_agent_services"], ["nfc-agent"])
        self.assertNotIn("release_kiosk_first_install", variables)
        code, text, errors = self._print_plan(
            artifacts, fake_run, "pi4-a", MODULE.AgentGuardStop("check-failed", "not updated", 2)
        )
        self.assertEqual(code, 2)
        self.assertEqual(text, "")
        self.assertIn('[agent-guard] stop {"kind": "check-failed"}', errors)

    def test_status_summary_shows_the_agent_guard_stop_line_only(self) -> None:
        prefix = "2026-11-21T10:00:00+09:00 raspberrypi bash[456]: "
        lines = [
            prefix + "[agent-guard] fatal: [pi4-a]: FAILED! secret-detail",
            prefix + '[agent-guard] stop {"kind": "reread-mismatch"}',
            prefix + '[agent-guard] stop {"kind": "made-up"}',
            prefix + '[agent-guard] stop {"kind": "timeout", "extra": 1}',
            prefix + "[agent-guard] pi4-a : ok=1 changed=0 unreachable=0 failed=1 skipped=0 rescued=0 ignored=0",
        ]
        summaries = MODULE.summarize_release_journal("\n".join(lines))
        self.assertEqual(summaries, ["agent guard stopped the release: reread-mismatch"])

    def test_print_plan_says_when_kiosk_files_will_not_be_delivered(self) -> None:
        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            return completed(command)

        code, text, _errors = self._print_plan(
            MODULE.ReleaseArtifacts("api", "web", None, None, ()), fake_run, "pi4-a"
        )
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(text)["pi4ReleaseFiles"].startswith("skipped:"))

        code, text, _errors = self._print_plan(
            MODULE.ReleaseArtifacts("api", "web", None, None, ("nfc-agent",)), fake_run, "pi4-a"
        )
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(text)["pi4ReleaseFiles"], "staged with the listed agents")

    def test_pi4_only_print_plan_uses_signed_empty_agent_services_authority(self) -> None:
        inventory = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-a"]},
            "_meta": {"hostvars": {"pi5": {}, "pi4-a": {}}},
        }
        selected_inventory = {
            "kiosk": {"hosts": ["pi4-a"]},
            "_meta": {"hostvars": {"pi4-a": {}}},
        }
        artifacts = MODULE.ReleaseArtifacts("api", "web", None, None, ())
        commands: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            write_coverage_results(command)
            return completed(command)

        with mock.patch.object(
            MODULE, "resolve_release_artifact_sha", return_value=(SHA, None)
        ), mock.patch.object(
            MODULE, "resolve_sha", return_value=SHA
        ), mock.patch.object(
            MODULE,
            "inventory_path",
            return_value=(Path("infrastructure/ansible/inventory.yml"), MODULE.DEFAULT_INVENTORY),
        ), mock.patch.object(
            MODULE, "inventory_document", side_effect=[inventory, selected_inventory]
        ), mock.patch.object(
            MODULE, "release_set_artifacts", return_value=artifacts
        ) as release_set, mock.patch.object(
            MODULE, "run", side_effect=fake_run
        ), mock.patch.object(
            MODULE, "run_agent_guard_command", side_effect=lambda command, env: fake_run(command)
        ), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(
                MODULE.main(
                    [
                        "--branch",
                        "main",
                        "--inventory",
                        MODULE.DEFAULT_INVENTORY,
                        "--limit",
                        "pi4-a",
                        "--print-plan",
                    ]
                ),
                0,
            )

        release_set.assert_called_once_with(
            SHA,
            Path("infrastructure/ansible/inventory.yml"),
            require_torque=False,
        )
        document = json.loads(output.getvalue())
        self.assertEqual(document["agentServices"], [])
        self.assertEqual(
            document["executionOrder"],
            [{"profile": "pi4", "hosts": ["pi4-a"], "images": []}],
        )
        self.assertEqual(len(commands), 3)
        check = commands[2]
        self.assertTrue(check[check.index("-i") + 2].endswith("release-agent-coverage-check.yml"))
        variables = json.loads(check[check.index("--extra-vars") + 1])
        self.assertEqual(variables["release_kiosk_agent_services"], [])
        self.assertEqual(json.loads(variables["release_allowed_missing_agents_json"]), {})

    def test_torque_print_plan_exposes_manifest_resolution_and_phase_boundaries(
        self,
    ) -> None:
        args = argparse.Namespace(
            branch="main",
            limit="pi5:pi4-a:pi4-b",
            full_fleet=False,
            torque_cutover=True,
        )
        selection = (
            ("pi5", ("pi5",)),
            ("pi4", ("pi4-a", "pi4-b")),
        )

        with mock.patch.object(
            MODULE, "run", return_value=completed(["ansible-playbook"])
        ), mock.patch.object(MODULE, "config_hash", return_value="4" * 64):
            document = MODULE.plan(
                args,
                SHA,
                ROOT / MODULE.DEFAULT_INVENTORY,
                MODULE.DEFAULT_INVENTORY,
                selection,
            )

        self.assertEqual(
            document["artifactResolution"],
            "signed-release-set-v2-before-service-quiesce",
        )
        self.assertEqual(
            [phase["phase"] for phase in document["cutoverPhases"]],
            [
                "PREPARED",
                "QUIESCED",
                "CONTROL_PLANE",
                "AGENTS_STAGED",
                "AGENTS_HEALTHY_OFF",
                "BROWSERS_RESUMED",
            ],
        )
        self.assertEqual(
            document["cutoverPhases"][0],
            {
                "phase": "PREPARED",
                "hosts": ["pi5", "pi4-a", "pi4-b"],
                "serviceImpact": "none",
            },
        )

    def test_notice_cleanup_preserves_ansible_result_and_runs_on_exception(self) -> None:
        for outcome in (subprocess.CompletedProcess(['ansible-playbook'], 0),
                        subprocess.CompletedProcess(['ansible-playbook'], 2),
                        subprocess.CompletedProcess(['ansible-playbook'], -15),
                        OSError('cannot launch')):
            with self.subTest(outcome=outcome), mock.patch.object(
                MODULE.subprocess, 'run', side_effect=[outcome, subprocess.CompletedProcess([], 0)]
            ) as execute:
                if isinstance(outcome, OSError):
                    with self.assertRaises(OSError):
                        MODULE.execute_ansible_with_cleanup(['ansible-playbook'], RUN_ID)
                else:
                    expected = outcome.returncode if outcome.returncode >= 0 else 128 - outcome.returncode
                    self.assertEqual(MODULE.execute_ansible_with_cleanup(['ansible-playbook'], RUN_ID), expected)
                cleanup = execute.call_args_list[-1].args[0]
                self.assertEqual(cleanup[-3:], ['remove-run', '--run-id', RUN_ID])
                self.assertEqual(cleanup[2:4], ['--file', str(MODULE.ROOT / 'config/deploy-status.json')])
        with mock.patch.object(MODULE.subprocess, 'run', side_effect=[
            subprocess.CompletedProcess([], 2), subprocess.TimeoutExpired('cleanup', 15)
        ]), mock.patch('sys.stderr', new_callable=io.StringIO) as errors:
            self.assertEqual(MODULE.execute_ansible_with_cleanup(['ansible-playbook'], RUN_ID), 2)
            self.assertIn('WARNING', errors.getvalue())

    def test_detach_uses_existing_transient_systemd_primitive(self) -> None:
        args = argparse.Namespace(
            branch="main", inventory=MODULE.DEFAULT_INVENTORY, limit="pi4-a",
            full_fleet=False, detach=True,
        )
        command = MODULE.systemd_argv(
            args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",), "pi"
        )
        rendered = " ".join(command)

        self.assertEqual(command[:4], ["/usr/bin/sudo", "-n", "/usr/bin/systemd-run", "--quiet"])
        self.assertNotIn("--wait", command)
        self.assertIn("--property=RemainAfterExit=yes", command)
        self.assertIn("--property=Type=exec", command)
        self.assertIn(f"--property=ExecStopPost=-/usr/bin/python3 {MODULE.REMOTE_ROOT}/scripts/deploy/deploy-status-state.py --file {MODULE.REMOTE_ROOT}/config/deploy-status.json remove-run --run-id {RUN_ID}", command)
        self.assertIn("--uid=pi", command)
        self.assertIn("git checkout --detach", rendered)
        self.assertIn("--execute-standard-route", rendered)
        self.assertNotIn("rolling-release.py", rendered)

        foreground = argparse.Namespace(**{**vars(args), "detach": False})
        foreground_command = MODULE.systemd_argv(
            foreground, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",), "pi"
        )
        self.assertIn("--wait", foreground_command)
        self.assertNotIn("--property=RemainAfterExit=yes", foreground_command)

    def test_staging_systemd_and_remote_script_use_the_inventory_remote_root(self) -> None:
        args = argparse.Namespace(
            branch="feat/assembly-procedure-overlay-editing",
            inventory="infrastructure/ansible/inventory-staging.yml",
            limit="staging-pi5:staging-pi4-kiosk01",
            full_fleet=False,
            detach=True,
        )
        remote_root = Path("/opt/RaspberryPiSystem_002-staging")

        command = MODULE.systemd_argv(
            args,
            SHA,
            RUN_ID,
            args.inventory,
            ("pi5", "pi4"),
            "stageadmin",
            remote_root,
        )
        script = command[-1]

        self.assertIn(
            "--property=WorkingDirectory=/opt/RaspberryPiSystem_002-staging",
            command,
        )
        self.assertIn(f"--property=ExecStopPost=-/usr/bin/python3 {remote_root}/scripts/deploy/deploy-status-state.py --file {remote_root}/config/deploy-status.json remove-run --run-id {RUN_ID}", command)
        self.assertIn("cd /opt/RaspberryPiSystem_002-staging", script)
        self.assertNotIn("cd /opt/RaspberryPiSystem_002\n", script)

    def test_skip_kiosk_notice_is_opt_in_and_forwarded_to_the_pi5_route(self) -> None:
        plain = MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--limit", "pi4-a"])
        skipped = MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--limit", "pi4-a", "--skip-kiosk-notice"])
        self.assertFalse(plain.skip_kiosk_notice)
        self.assertTrue(skipped.skip_kiosk_notice)
        self.assertNotIn("--skip-kiosk-notice", MODULE.remote_script(plain, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",)))
        self.assertIn(" --skip-kiosk-notice --limit pi4-a", MODULE.remote_script(skipped, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",)))
        with self.assertRaises(MODULE.UsageError):
            MODULE.parse_arguments(["--status", RUN_ID, "--skip-kiosk-notice"])

    def test_standard_route_contends_with_legacy_global_lock_before_git(self) -> None:
        args = argparse.Namespace(
            branch="main", inventory=MODULE.DEFAULT_INVENTORY, limit="pi4-a",
            full_fleet=False, detach=True,
        )
        script = MODULE.remote_script(
            args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",)
        )
        self.assertNotIn(".standard-ansible-release.lock", script)
        self.assertLess(
            script.index("fleet-release-state.lock"), script.index("git fetch")
        )
        self.assertIn("/usr/bin/flock -n 9", script)
        self.assertEqual(script.count('test -z "$(git status --porcelain)"'), 2)
        self.assertIn(f'test "$(git rev-parse HEAD)" = {SHA}', script)

        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            lock_path = project / "logs/deploy/fleet-release-state.lock"
            lock_path.parent.mkdir(parents=True)
            descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT, 0o600)
            marker = project / "git-was-reached"
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                contender = subprocess.run(
                    [
                        sys.executable,
                        "-c",
                        "import fcntl,os,sys; "
                        "fd=os.open(sys.argv[1],os.O_WRONLY); "
                        "\ntry: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)"
                        "\nexcept BlockingIOError: raise SystemExit(75)"
                        "\nopen(sys.argv[2],'w').close()",
                        str(lock_path),
                        str(marker),
                    ],
                    check=False,
                )
                self.assertEqual(contender.returncode, 75)
                self.assertFalse(marker.exists())
            finally:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)

    def test_status_journal_excludes_credentials_and_command_continuations(self) -> None:
        prefix = "2026-09-15T19:17:37+09:00 raspberrypi "
        raw = "\n".join([
            prefix + "sudo[123]: COMMAND=TOKEN=synthetic-secret command",
            prefix + "sudo[123]: (command continued) more-synthetic-secret",
            prefix + "bash[456]: TASK [sensitive-template-value] ***",
            prefix + "bash[456]: ok: [raspberrypi5]",
            prefix + 'bash[456]: fatal: [raspberrypi5]: FAILED! {"token": "synthetic-secret"}',
            prefix + 'bash[456]: {"token": "synthetic-secret"}',
            prefix + "bash[456]: PLAY RECAP *****",
            prefix + "bash[456]: raspberrypi5 : ok=1 changed=0 unreachable=0 failed=1 skipped=0 rescued=0 ignored=0",
            "unstructured synthetic-secret",
        ])
        summaries = MODULE.summarize_release_journal(raw)
        self.assertEqual(summaries, [
            "TASK [details omitted]", "ok", "task failed (details omitted)",
            "PLAY RECAP", "ok=1 changed=0 unreachable=0 failed=1 skipped=0 rescued=0 ignored=0",
        ])
        self.assertNotIn("synthetic-secret", "\n".join(summaries))
        self.assertNotIn("sensitive-template-value", "\n".join(summaries))

    def test_release_journal_lists_hosts_skipped_as_offline(self) -> None:
        prefix = "2026-11-20T10:00:00+09:00 raspberrypi "
        event = {
            "event": "optional-host-preflight",
            "excluded": [
                {"host": "raspi4-robodrill01", "profile": "pi4", "reason": "tcp-unreachable"},
                {"host": "raspi4-robodrill01", "profile": "pi4", "reason": "tcp-unreachable"},
                {"host": "bad host;rm", "profile": "pi4", "reason": "tcp-unreachable"},
                {"host": "synthetic-secret", "profile": "pi4", "reason": "tcp-unreachable"},
                {"host": "raspberrypi3", "profile": "pi4", "reason": "tcp-unreachable"},
                {"host": ["raspberrypi3"], "profile": {"pi3": 1}, "reason": "tcp-unreachable"},
                {"host": "raspberrypi3", "profile": "pi3", "reason": "other", "token": "synthetic-secret"},
            ],
            "reachable": [{"hosts": ["raspberrypi5"], "profile": "pi5"}],
        }
        raw = "\n".join([
            prefix + "bash[456]: " + json.dumps(event, sort_keys=True),
            prefix + "bash[456]: PLAY RECAP *****",
        ])
        known = frozenset({("raspi4-robodrill01", "pi4"), ("raspberrypi3", "pi3")})
        summaries = MODULE.summarize_release_journal(raw, known)
        self.assertEqual(summaries, [
            "excluded offline hosts: raspi4-robodrill01(pi4)",
            "PLAY RECAP",
        ])
        self.assertNotIn("synthetic-secret", "\n".join(summaries))
        # Without the inventory pairs no host name is ever shown.
        self.assertEqual(MODULE.summarize_release_journal(raw), ["PLAY RECAP"])

    def test_release_journal_is_unchanged_when_no_host_was_skipped(self) -> None:
        prefix = "2026-11-20T10:00:00+09:00 raspberrypi "
        event = {"event": "optional-host-preflight", "excluded": [], "reachable": []}
        raw = "\n".join([
            prefix + "bash[456]: " + json.dumps(event, sort_keys=True),
            prefix + 'bash[456]: {"event": "optional-host-preflight", broken',
            prefix + 'bash[456]: {"event": "optional-host-preflight", "x": ' + "[" * 100000 + "]" * 100000 + "}",
            prefix + "bash[456]: PLAY RECAP *****",
        ])
        self.assertEqual(
            MODULE.summarize_release_journal(raw, frozenset({("raspberrypi3", "pi3")})),
            ["PLAY RECAP"],
        )

    def test_status_reads_only_systemd_and_journal(self) -> None:
        args = argparse.Namespace(inventory=MODULE.DEFAULT_INVENTORY, status=RUN_ID)
        inventory = {
            "server": {"hosts": ["pi5"]},
            "signage": {"hosts": ["pi3-offline"]},
            "_meta": {
                "hostvars": {
                    "pi5": {
                        "deploy_executor_host": "100.106.158.2",
                        "ansible_user": "pi",
                    },
                    "pi3-offline": {},
                }
            },
        }
        calls: list[list[str]] = []
        event = json.dumps({
            "event": "optional-host-preflight",
            "excluded": [
                {"host": "pi3-offline", "profile": "pi3", "reason": "tcp-unreachable"},
                {"host": "pi5", "profile": "pi3", "reason": "tcp-unreachable"},
                {"host": "synthetic-secret", "profile": "pi4", "reason": "tcp-unreachable"},
            ],
            "reachable": [],
        }, sort_keys=True)

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            if "systemctl" in command[-1]:
                return completed(command, "LoadState=loaded\nActiveState=inactive\nResult=success\nExecMainStatus=0\n")
            return completed(
                command,
                "2026-09-15T19:17:37+09:00 raspberrypi sudo[123]: COMMAND=TOKEN=synthetic-secret\n"
                f"2026-09-15T19:17:38+09:00 raspberrypi bash[456]: {event}\n",
            )

        with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(MODULE, "run", side_effect=fake_run), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(MODULE.status(args), 0)

        payload = json.loads(output.getvalue())
        self.assertEqual(payload["status"]["Result"], "success")
        self.assertEqual(payload["journal"], ["excluded offline hosts: pi3-offline(pi3)"])
        self.assertNotIn("synthetic-secret", output.getvalue())
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][-2], "pi@100.106.158.2")
        self.assertIn("systemctl show", calls[0][-1])
        self.assertIn("journalctl", calls[1][-1])

    def test_status_rejects_missing_unit(self) -> None:
        args = argparse.Namespace(inventory=MODULE.DEFAULT_INVENTORY, status=RUN_ID)
        inventory = {
            "server": {"hosts": ["pi5"]},
            "_meta": {
                "hostvars": {
                    "pi5": {
                        "deploy_executor_host": "100.106.158.2",
                        "ansible_user": "pi",
                    }
                }
            },
        }
        responses = [
            completed([], "LoadState=not-found\nActiveState=inactive\nResult=\n"),
            completed([]),
        ]
        with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(MODULE, "run", side_effect=responses), redirect_stdout(io.StringIO()):
            self.assertEqual(MODULE.status(args), 1)

    def test_launch_result_status_command_preserves_custom_inventory(self) -> None:
        relative = "infrastructure/ansible/custom inventory.yml"
        args = argparse.Namespace(
            execute_standard_route=False, status=None, inventory=relative,
            branch="main", limit="pi4-b", full_fleet=False,
            print_plan=False, detach=True,
        )
        complete = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-b"]},
            "_meta": {
                "hostvars": {
                    "pi5": {"deploy_executor_host": "100.106.158.2", "ansible_user": "pi"},
                    "pi4-b": {},
                }
            },
        }
        selected = {
            "kiosk": {"hosts": ["pi4-b"]},
            "_meta": {"hostvars": {"pi4-b": {}}},
        }
        calls: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            return completed(command)

        with mock.patch.object(MODULE, "parse_arguments", return_value=args), mock.patch.object(
            MODULE, "inventory_path", return_value=(Path("inventory.yml"), relative)
        ), mock.patch.object(MODULE, "resolve_release_artifact_sha", return_value=(SHA, None)), mock.patch.object(MODULE, "resolve_sha", return_value=SHA), mock.patch.object(
            MODULE, "inventory_document", side_effect=[complete, selected]
        ), mock.patch.object(MODULE, "new_run_id", return_value=RUN_ID), mock.patch.object(
            MODULE, "run", side_effect=fake_run
        ), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(MODULE.main([]), 0)

        payload = json.loads(output.getvalue())
        self.assertEqual(
            payload["statusCommand"],
            f"scripts/update-all-clients.sh --status {RUN_ID} --inventory '{relative}'",
        )
        self.assertEqual(calls[0][-2], "pi@100.106.158.2")


PAIR = f"pi4-a:barcode-agent:{'b' * 40}:docker"
DOC = {
    "server": {"hosts": ["pi5"]},
    "kiosk": {"hosts": ["pi4-a", "pi4-b"]},
    "_meta": {"hostvars": {"pi5": {}, "pi4-a": {}, "pi4-b": {}}},
}


def agent_args(**overrides: object) -> argparse.Namespace:
    values: dict[str, object] = dict(
        inventory=MODULE.DEFAULT_INVENTORY, limit="pi5:pi4-a", first_install=False, torque_cutover=False,
        allow_agent_skip=PAIR, allow_agent_skip_sha=SHA,
    )
    values.update(overrides)
    return argparse.Namespace(**values)


def guard_report(host: str, agent: str, image: str, status: str = "running", project: str = "docker") -> dict[str, object]:
    containers: dict[str, list[dict[str, str]]] = {"nfc-agent": [], "barcode-agent": [], "torque-agent": []}
    containers[agent] = [{"image": image, "status": status}] if image else []
    return {
        "host": host, "project": project, "containers": containers,
        "expectedImages": {name: f"ghcr.io/o/raspisys-{name}" for name in containers},
    }


BASE_VARIABLES = {
    "release_sha": SHA, "release_kiosk_agent_services": ["nfc-agent"], "release_kiosk_service_allowlist": [],
}


class AgentSkipGuardTests(unittest.TestCase):
    def test_option_parsing_and_rejected_combinations(self) -> None:
        base = ["main", MODULE.DEFAULT_INVENTORY, "--limit", "pi5:pi4-a"]
        given = ["--allow-agent-skip", PAIR, "--allow-agent-skip-sha", SHA]
        args = MODULE.parse_arguments(base + given)
        self.assertEqual(args.allow_agent_skip, PAIR)
        for argv in (
            base + given[:2], base + given[2:],
            base + ["--allow-agent-skip", "pi4-a:nfc-agent:short:docker", "--allow-agent-skip-sha", SHA],
            base + ["--allow-agent-skip", f"pi4-a:other-agent:{SHA}:docker", "--allow-agent-skip-sha", SHA],
            base + ["--allow-agent-skip", f"pi4-a:nfc-agent:{SHA}:Bad Project", "--allow-agent-skip-sha", SHA],
            base + ["--allow-agent-skip", f"pi4-a:nfc-agent:{SHA}:", "--allow-agent-skip-sha", SHA],
            base + ["--allow-agent-skip", f"{PAIR},{PAIR}", "--allow-agent-skip-sha", SHA],
            base + given + ["--first-install"], base + given + ["--torque-cutover"],
            ["main", MODULE.DEFAULT_INVENTORY, "--full-fleet"] + given,
            ["--status", RUN_ID] + given,
        ):
            with self.assertRaises(MODULE.UsageError, msg=argv):
                MODULE.parse_arguments(argv)
        self.assertEqual(len(MODULE.parse_agent_skip(f"{PAIR},pi4-b:nfc-agent:{SHA}:staging_x-1")), 2)

    def test_selection_must_be_host_names_of_selected_pi4(self) -> None:
        def limited(*hosts: str) -> dict[str, object]:
            return {
                "server": {"hosts": [h for h in hosts if h == "pi5"]},
                "kiosk": {"hosts": [h for h in hosts if h.startswith("pi4")]},
                "_meta": {"hostvars": {h: {} for h in hosts}},
            }

        document = limited("pi5", "pi4-a")
        MODULE.validate_agent_skip_selection(agent_args(), document, MODULE.selected_profiles(document), SHA)
        for overrides, hosts in (
            ({"limit": "kiosk"}, ("pi5", "pi4-a", "pi4-b")),
            ({"limit": "pi5"}, ("pi5",)),
            ({"limit": "pi5:pi4-b"}, ("pi5", "pi4-b")),
            ({"allow_agent_skip_sha": "c" * 40}, ("pi5", "pi4-a")),
            ({"allow_agent_skip_sha": None}, ("pi5", "pi4-a")),
        ):
            document = limited(*hosts)
            with self.assertRaises(MODULE.UsageError, msg=overrides):
                MODULE.validate_agent_skip_selection(
                    agent_args(**overrides), document, MODULE.selected_profiles(document), SHA
                )
        document = limited("pi5", "pi4-a")
        MODULE.validate_agent_skip_selection(
            agent_args(allow_agent_skip=None, allow_agent_skip_sha=None), document, MODULE.selected_profiles(document), SHA
        )

    def test_remote_script_forwards_both_options_before_limit(self) -> None:
        script = MODULE.remote_script(
            argparse.Namespace(branch="main", limit="pi5:pi4-a", allow_agent_skip=PAIR, allow_agent_skip_sha=SHA),
            SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi5", "pi4"),
        )
        self.assertIn("--allow-agent-skip " + PAIR, script)
        self.assertLess(script.index("--allow-agent-skip-sha"), script.index("--limit"))
        plain = MODULE.remote_script(
            argparse.Namespace(branch="main", limit="pi4-a"), SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",)
        )
        self.assertNotIn("allow-agent-skip", plain)

    def _check(self, reports: dict[str, object], *, args: argparse.Namespace | None = None, hosts: tuple[str, ...] = ("pi4-a",), write_coverage: bool = True) -> list[list[str]]:
        calls: list[list[str]] = []

        def executor(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
            calls.append(list(command))
            variables = json.loads(command[command.index("--extra-vars") + 1])
            directory = Path(variables["release_agent_guard_out_dir"])
            if command[3].endswith("release-agent-images-read.yml"):
                for host, report in reports.items():
                    (directory / f"{host}.json").write_text(
                        report if isinstance(report, str) else json.dumps(report), encoding="utf-8"
                    )
            elif write_coverage:
                for host in hosts:
                    (directory / f"{host}.json").write_text(json.dumps({"host": host, "agentsNotUpdated": []}), encoding="utf-8")
            return completed(command)

        MODULE.run_agent_coverage_check(
            args or agent_args(), MODULE.DEFAULT_INVENTORY, "pi5:pi4-a",
            (("pi5", ("pi5",)), ("pi4", hosts)), dict(BASE_VARIABLES), executor,
        )
        return calls

    def test_matching_single_running_container_passes_and_allows_only_that_agent(self) -> None:
        image = f"ghcr.io/o/raspisys-barcode-agent:{'b' * 40}"
        calls = self._check({"pi4-a": guard_report("pi4-a", "barcode-agent", image)})
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][calls[0].index("--limit") + 1], "pi4-a")
        variables = json.loads(calls[1][calls[1].index("--extra-vars") + 1])
        self.assertEqual(json.loads(variables["release_allowed_missing_agents_json"]), {"pi4-a": ["barcode-agent"]})
        self.assertEqual(variables["release_kiosk_agent_services"], ["nfc-agent"])

    def test_reread_mismatches_stop_with_the_right_kind(self) -> None:
        good = f"ghcr.io/o/raspisys-barcode-agent:{'b' * 40}"
        cases = {
            "reread-mismatch": [
                guard_report("pi4-a", "barcode-agent", f"ghcr.io/o/raspisys-barcode-agent:{'c' * 40}"),
                guard_report("pi4-a", "barcode-agent", good, project="other"),
                guard_report("pi4-a", "barcode-agent", good, status="exited"),
                guard_report("pi4-a", "barcode-agent", ""),
                {**guard_report("pi4-a", "barcode-agent", good),
                 "containers": {"nfc-agent": [], "torque-agent": [],
                                "barcode-agent": [{"image": good, "status": "running"}] * 2}},
            ],
            "reread-unreadable": [{}, {"pi4-a": "not json"}],
        }
        for kind, variants in cases.items():
            for variant in variants:
                reports = {"pi4-a": variant} if kind == "reread-mismatch" else variant
                with self.assertRaises(MODULE.AgentGuardStop, msg=variant) as caught:
                    self._check(reports)
                self.assertEqual(caught.exception.kind, kind)

    def test_only_pairs_on_remaining_hosts_are_reread(self) -> None:
        args = agent_args(limit="pi5:pi4-a:pi4-b", allow_agent_skip=PAIR + f",pi4-b:nfc-agent:{'b' * 40}:docker")
        image = f"ghcr.io/o/raspisys-nfc-agent:{'b' * 40}"
        calls: list[list[str]] = []

        def executor(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
            calls.append(list(command))
            directory = Path(json.loads(command[command.index("--extra-vars") + 1])["release_agent_guard_out_dir"])
            if command[3].endswith("release-agent-images-read.yml"):
                (directory / "pi4-b.json").write_text(json.dumps(guard_report("pi4-b", "nfc-agent", image)), encoding="utf-8")
            else:
                (directory / "pi4-b.json").write_text(json.dumps({"host": "pi4-b"}), encoding="utf-8")
            return completed(command)

        MODULE.run_agent_coverage_check(
            args, MODULE.DEFAULT_INVENTORY, "pi5:pi4-b", (("pi5", ("pi5",)), ("pi4", ("pi4-b",))), dict(BASE_VARIABLES), executor,
        )
        self.assertEqual(calls[0][calls[0].index("--limit") + 1], "pi4-b")
        variables = json.loads(calls[1][calls[1].index("--extra-vars") + 1])
        self.assertEqual(json.loads(variables["release_allowed_missing_agents_json"]), {"pi4-b": ["nfc-agent"]})

    def test_coverage_failures_map_to_kinds(self) -> None:
        def stop_kind(executor: object) -> tuple[str, int]:
            with self.assertRaises(MODULE.AgentGuardStop) as caught:
                MODULE.run_agent_coverage_check(
                    agent_args(allow_agent_skip=None, allow_agent_skip_sha=None), MODULE.DEFAULT_INVENTORY, "pi5:pi4-a",
                    (("pi5", ("pi5",)), ("pi4", ("pi4-a",))), dict(BASE_VARIABLES), executor,
                )
            return caught.exception.kind, caught.exception.exit_code

        self.assertEqual(stop_kind(lambda c, e: completed(c, returncode=2)), ("check-failed", 2))
        self.assertEqual(stop_kind(lambda c, e: completed(c)), ("check-result-missing", 1))

        def other_host(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
            directory = Path(json.loads(command[command.index("--extra-vars") + 1])["release_agent_guard_out_dir"])
            (directory / "pi4-z.json").write_text(json.dumps({"host": "pi4-z"}), encoding="utf-8")
            return completed(command)

        self.assertEqual(stop_kind(other_host), ("check-result-missing", 1))

        def refuse(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
            raise FileNotFoundError("ansible-playbook")

        self.assertEqual(stop_kind(refuse), ("check-launch-failed", 1))

        def slow(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
            raise MODULE.AgentGuardTimeout()

        self.assertEqual(stop_kind(slow), ("timeout", 1))

    def test_guard_environment_drops_tag_selection_and_lines_are_prefixed(self) -> None:
        with mock.patch.dict(os.environ, {"ANSIBLE_RUN_TAGS": "x", "ANSIBLE_SKIP_TAGS": "always"}):
            environment = MODULE.agent_guard_environment()
        self.assertNotIn("ANSIBLE_RUN_TAGS", environment)
        self.assertNotIn("ANSIBLE_SKIP_TAGS", environment)
        self.assertEqual(environment["ANSIBLE_HASH_BEHAVIOUR"], "replace")
        errors = io.StringIO()
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(errors):
            MODULE.emit_agent_guard_lines("a\nb", "c")
            MODULE.emit_agent_guard_stop(MODULE.AgentGuardStop("timeout", "slow"))
        self.assertEqual(out.getvalue(), "")
        lines = errors.getvalue().splitlines()
        self.assertEqual(lines[:3], ["[agent-guard] a", "[agent-guard] b", "[agent-guard] c"])
        self.assertEqual(lines[-1], '[agent-guard] stop {"kind": "timeout"}')

    def test_guard_runner_kills_the_process_group_on_timeout(self) -> None:
        process = mock.MagicMock(pid=4242, returncode=None)
        process.communicate.side_effect = [subprocess.TimeoutExpired("ansible", 300), ("", "")]
        with mock.patch.object(MODULE.subprocess, "Popen", return_value=process) as popen, mock.patch.object(
            MODULE.os, "killpg"
        ) as killpg:
            with self.assertRaises(MODULE.AgentGuardTimeout):
                MODULE.run_agent_guard_command(["ansible-playbook"], {})
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        killpg.assert_called_once_with(4242, MODULE.signal.SIGKILL)
        self.assertEqual(MODULE.AGENT_GUARD_TIMEOUT_SECONDS, 300)

    def test_torque_cutover_skips_the_guard(self) -> None:
        executor = mock.Mock()
        MODULE.run_agent_coverage_check(
            agent_args(torque_cutover=True), MODULE.DEFAULT_INVENTORY, "pi5:pi4-a",
            (("pi5", ("pi5",)), ("pi4", ("pi4-a",))), {}, executor,
        )
        executor.assert_not_called()

    def test_agent_images_script_bounds_ansible_and_keeps_stdout_for_json(self) -> None:
        script = MODULE.agent_images_script(Path("/srv/repo"), MODULE.DEFAULT_INVENTORY, "pi4-a:pi4-b")
        self.assertIn("cd /srv/repo ||", script)
        self.assertIn("ANSIBLE_CONFIG=/srv/repo/infrastructure/ansible/ansible.cfg ANSIBLE_HASH_BEHAVIOUR=replace timeout --kill-after=10 300 ansible-playbook", script)
        self.assertIn(f"-i {MODULE.DEFAULT_INVENTORY} ", script)
        self.assertIn(str(MODULE.IMAGES_PLAYBOOK.relative_to(MODULE.ROOT)), script)
        self.assertIn("--limit pi4-a:pi4-b", script)
        self.assertIn(">&2", script)
        self.assertIn("ansibleExitCode", script)

    def test_agent_images_reports_unreadable_hosts_without_mixing_ansible_output(self) -> None:
        report = guard_report("pi4-a", "nfc-agent", "img:" + "a" * 40)
        remote = (
            "PLAY noise\n" + json.dumps(report) + "\n" + json.dumps({"ansibleExitCode": 2}) + "\n"
        )
        args = MODULE.parse_arguments(["--agent-images", "--limit", "pi4-a:pi4-b"])
        self.assertEqual(args.inventory, MODULE.DEFAULT_INVENTORY)
        with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inv.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(
            MODULE, "inventory_document", return_value={**DOC, "_meta": {"hostvars": {}}}
        ), mock.patch.object(MODULE, "server_connection", return_value=("h", "u", 22)), mock.patch.object(
            MODULE.subprocess, "run", return_value=completed(["ssh"], remote)
        ) as ssh, redirect_stdout(io.StringIO()) as out:
            code = MODULE.agent_images(args)
        self.assertEqual(code, 1)
        argv = ssh.call_args.args[0]
        self.assertIn("ServerAliveInterval=15", argv)
        self.assertIn("ServerAliveCountMax=4", argv)
        self.assertGreater(ssh.call_args.kwargs["timeout"], MODULE.AGENT_GUARD_TIMEOUT_SECONDS + 10)
        with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inv.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(
            MODULE, "inventory_document", return_value={**DOC, "_meta": {"hostvars": {}}}
        ), mock.patch.object(MODULE, "server_connection", return_value=("h", "u", 22)), mock.patch.object(
            MODULE.subprocess, "run", side_effect=subprocess.TimeoutExpired("ssh", 340)
        ):
            with self.assertRaisesRegex(RuntimeError, "time limit"):
                MODULE.agent_images(args)
        payload = json.loads(out.getvalue())
        self.assertEqual(payload["hosts"][0]["host"], "pi4-a")
        self.assertEqual(payload["hosts"][1], {"host": "pi4-b", "readable": False})
        for argv in (["--agent-images"], ["--agent-images", "--limit", "kiosk", "--full-fleet"], ["--agent-images", "--limit", "a:a"]):
            with self.assertRaises(MODULE.UsageError, msg=argv):
                MODULE.parse_arguments(argv)

    def test_result_files_count_only_when_they_name_their_own_host(self) -> None:
        def stop_kind(content: dict[str, str]) -> str:
            def executor(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
                directory = Path(json.loads(command[command.index("--extra-vars") + 1])["release_agent_guard_out_dir"])
                for name, text in content.items():
                    (directory / name).write_text(text, encoding="utf-8")
                return completed(command)

            with self.assertRaises(MODULE.AgentGuardStop) as caught:
                MODULE.run_agent_coverage_check(
                    agent_args(allow_agent_skip=None, allow_agent_skip_sha=None), MODULE.DEFAULT_INVENTORY, "pi5:pi4-a",
                    (("pi5", ("pi5",)), ("pi4", ("pi4-a",))), dict(BASE_VARIABLES), executor,
                )
            return caught.exception.kind

        self.assertEqual(stop_kind({"pi4-a.json": "{}"}), "check-result-missing")
        self.assertEqual(stop_kind({"pi4-a.json": "not json"}), "check-result-missing")
        self.assertEqual(stop_kind({"pi4-a.json": json.dumps({"host": "pi4-b"})}), "check-result-missing")
        self.assertEqual(stop_kind({"pi4-a.json": "[]"}), "check-result-missing")
        # A valid file for the host plus a stray one for another host is not the exact selection.
        extra = {"pi4-a.json": json.dumps({"host": "pi4-a"}), "pi4-z.json": json.dumps({"host": "pi4-z"})}
        self.assertEqual(stop_kind(extra), "check-result-missing")

    def test_reread_stops_on_a_failed_ansible_run_or_a_report_for_another_host(self) -> None:
        image = f"ghcr.io/o/raspisys-barcode-agent:{'b' * 40}"
        report = guard_report("pi4-a", "barcode-agent", image)

        def run_reread(returncode: int, body: dict[str, object]) -> str:
            def executor(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
                directory = Path(json.loads(command[command.index("--extra-vars") + 1])["release_agent_guard_out_dir"])
                for name, value in body.items():
                    (directory / name).write_text(json.dumps(value), encoding="utf-8")
                return completed(command, returncode=returncode)

            with self.assertRaises(MODULE.AgentGuardStop) as caught:
                MODULE.reread_agent_images(MODULE.DEFAULT_INVENTORY, MODULE.agent_skip_pairs(agent_args()), executor)
            return caught.exception.kind

        self.assertEqual(run_reread(2, {"pi4-a.json": report}), "reread-unreadable")
        self.assertEqual(run_reread(0, {"pi4-a.json": {**report, "host": "pi4-b"}}), "reread-unreadable")

    def test_guard_timeout_emits_captured_output_with_the_prefix(self) -> None:
        process = mock.MagicMock(pid=1, returncode=None)
        process.communicate.side_effect = [subprocess.TimeoutExpired("ansible", 300), ("line1\nline2\n", "err1\n")]
        with mock.patch.object(MODULE.subprocess, "Popen", return_value=process), mock.patch.object(MODULE.os, "killpg"):
            with self.assertRaises(MODULE.AgentGuardTimeout) as caught:
                MODULE.run_agent_guard_command(["ansible-playbook"], {})
        self.assertEqual((caught.exception.stdout, caught.exception.stderr), ("line1\nline2\n", "err1\n"))
        errors = io.StringIO()
        with redirect_stderr(errors):
            with self.assertRaises(MODULE.AgentGuardStop) as stop:
                MODULE.run_guarded(["x"], mock.Mock(side_effect=caught.exception), "check-launch-failed")
            MODULE.emit_agent_guard_stop(MODULE.AgentGuardStop("check-failed", "first\nsecond"))
        self.assertEqual(stop.exception.kind, "timeout")
        lines = errors.getvalue().splitlines()
        self.assertEqual(lines[:3], ["[agent-guard] line1", "[agent-guard] line2", "[agent-guard] err1"])
        self.assertEqual(lines[3:5], ["[agent-guard] first", "[agent-guard] second"])
        self.assertTrue(all(line.startswith("[agent-guard] ") for line in lines))

    def test_guard_timeout_keeps_partial_output_when_the_second_wait_also_times_out(self) -> None:
        process = mock.MagicMock(pid=1, returncode=None)
        process.communicate.side_effect = [
            subprocess.TimeoutExpired("ansible", 300, output=b"first-out", stderr=b"first-err"),
            subprocess.TimeoutExpired("ansible", 15),
        ]
        with mock.patch.object(MODULE.subprocess, "Popen", return_value=process), mock.patch.object(MODULE.os, "killpg"):
            with self.assertRaises(MODULE.AgentGuardTimeout) as caught:
                MODULE.run_agent_guard_command(["ansible-playbook"], {})
        self.assertEqual((caught.exception.stdout, caught.exception.stderr), ("first-out", "first-err"))
        process.communicate.side_effect = [
            subprocess.TimeoutExpired("ansible", 300, output="a", stderr="b"),
            subprocess.TimeoutExpired("ansible", 15, output="a2", stderr=None),
        ]
        with mock.patch.object(MODULE.subprocess, "Popen", return_value=process), mock.patch.object(MODULE.os, "killpg"):
            with self.assertRaises(MODULE.AgentGuardTimeout) as caught:
                MODULE.run_agent_guard_command(["ansible-playbook"], {})
        self.assertEqual((caught.exception.stdout, caught.exception.stderr), ("a2", "b"))

    def test_guard_timeout_keeps_stdout_and_stderr_apart_without_trailing_newlines(self) -> None:
        process = mock.MagicMock(pid=1, returncode=None)
        process.communicate.side_effect = [subprocess.TimeoutExpired("ansible", 300), ("out-no-newline", "err-no-newline")]
        with mock.patch.object(MODULE.subprocess, "Popen", return_value=process), mock.patch.object(MODULE.os, "killpg"):
            with self.assertRaises(MODULE.AgentGuardTimeout) as caught:
                MODULE.run_agent_guard_command(["ansible-playbook"], {})
        errors = io.StringIO()
        with redirect_stderr(errors):
            with self.assertRaises(MODULE.AgentGuardStop):
                MODULE.run_guarded(["x"], mock.Mock(side_effect=caught.exception), "check-launch-failed")
        self.assertEqual(
            errors.getvalue().splitlines(), ["[agent-guard] out-no-newline", "[agent-guard] err-no-newline"]
        )

    def test_guard_runner_reaps_when_interrupted_during_the_second_wait(self) -> None:
        process = mock.MagicMock(pid=79, returncode=None)
        process.communicate.side_effect = [subprocess.TimeoutExpired("a", 1), KeyboardInterrupt()]
        with mock.patch.object(MODULE.subprocess, "Popen", return_value=process), mock.patch.object(MODULE.os, "killpg") as killpg:
            with self.assertRaises(KeyboardInterrupt):
                MODULE.run_agent_guard_command(["ansible-playbook"], {})
        killpg.assert_called_once_with(79, MODULE.signal.SIGKILL)
        process.stdout.close.assert_called_once()
        process.stderr.close.assert_called_once()
        process.wait.assert_called_once()

    def test_plan_guard_runs_through_the_process_group_runner_with_the_plan_variables(self) -> None:
        calls: list[list[str]] = []

        def runner(command: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
            calls.append(list(command))
            write_coverage_results(command)
            return completed(command)

        variables = {**BASE_VARIABLES, "release_kiosk_first_install": True}
        with mock.patch.object(MODULE, "run_agent_guard_command", side_effect=runner), mock.patch.object(
            MODULE, "run", side_effect=AssertionError("the plan guard must not use run()")
        ):
            MODULE.plan_agent_coverage_check(
                agent_args(allow_agent_skip=None, allow_agent_skip_sha=None, limit="pi4-a"),
                Path("infrastructure/ansible/inventory.yml"), (("pi4", ("pi4-a",)),), variables,
            )
        command = calls[0]
        self.assertEqual(command[command.index("--limit") + 1], "pi4-a")
        sent = json.loads(command[command.index("--extra-vars") + 1])
        directory = sent.pop("release_agent_guard_out_dir")
        self.assertTrue(directory)
        self.assertEqual(sent, {**variables, "release_allowed_missing_agents_json": "{}"})
        with mock.patch.object(
            MODULE, "run_agent_guard_command", side_effect=MODULE.AgentGuardTimeout("x")
        ), redirect_stderr(io.StringIO()):
            with self.assertRaises(MODULE.AgentGuardStop) as caught:
                MODULE.plan_agent_coverage_check(
                    agent_args(allow_agent_skip=None, allow_agent_skip_sha=None, limit="pi4-a"),
                    Path("infrastructure/ansible/inventory.yml"), (("pi4", ("pi4-a",)),), variables,
                )
        self.assertEqual(caught.exception.kind, "timeout")

    def _agent_images_args(self):
        return MODULE.parse_arguments(["--agent-images", "--limit", "pi4-a:pi4-b"])

    def _run_agent_images(self, remote: str, returncode: int = 0) -> tuple[int, dict]:
        with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inv.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(
            MODULE, "inventory_document", return_value={**DOC, "_meta": {"hostvars": {}}}
        ), mock.patch.object(MODULE, "server_connection", return_value=("h", "u", 22)), mock.patch.object(
            MODULE.subprocess, "run", return_value=completed(["ssh"], remote, returncode)
        ), redirect_stdout(io.StringIO()) as out:
            code = MODULE.agent_images(self._agent_images_args())
        return code, json.loads(out.getvalue())

    def test_agent_images_fails_on_duplicate_reports_and_on_ssh_exit_code(self) -> None:
        a = json.dumps(guard_report("pi4-a", "nfc-agent", "img:" + "a" * 40))
        b = json.dumps(guard_report("pi4-b", "nfc-agent", "img:" + "a" * 40))
        done = json.dumps({"ansibleExitCode": 0})
        code, payload = self._run_agent_images("\n".join((a, b, done)) + "\n")
        self.assertEqual(code, 0)
        code, payload = self._run_agent_images("\n".join((a, a, b, done)) + "\n")
        self.assertEqual(code, 1)
        self.assertEqual(payload["hosts"][0], {"host": "pi4-a", "readable": False})
        code, _ = self._run_agent_images("\n".join((a, b, done)) + "\n", returncode=255)
        self.assertEqual(code, 1)

    def test_pi5_script_forwards_only_files_named_after_their_own_host(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "infrastructure/ansible").mkdir(parents=True)
            (root / "infrastructure/ansible/ansible.cfg").write_text("")
            bin_dir = root / "bin"
            bin_dir.mkdir()
            (bin_dir / "timeout").write_text('#!/bin/sh\nshift 2\nexec "$@"\n')
            (bin_dir / "ansible-playbook").write_text(
                '#!/bin/sh\nfor a; do case "$a" in release_agent_guard_out_dir=*) d="${a#*=}";; esac; done\n'
                'echo \'{"host":"pi4-a"}\' > "$d/pi4-a.json"\n'
                'echo \'{"host":"pi4-x"}\' > "$d/pi4-b.json"\n'
                'echo \'not json\' > "$d/pi4-c.json"\n'
            )
            for name in ("timeout", "ansible-playbook"):
                (bin_dir / name).chmod(0o755)
            script = MODULE.agent_images_script(root, MODULE.DEFAULT_INVENTORY, "pi4-a:pi4-b")
            result = subprocess.run(
                ["/bin/bash", "-c", script], text=True, capture_output=True, check=False,
                env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"},
            )
        lines = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(lines, [{"host": "pi4-a"}, {"ansibleExitCode": 0}])

    def test_guard_runner_kills_the_group_on_keyboard_interrupt_and_reaps_after_a_failed_second_wait(self) -> None:
        process = mock.MagicMock(pid=77, returncode=None)
        process.communicate.side_effect = KeyboardInterrupt()
        with mock.patch.object(MODULE.subprocess, "Popen", return_value=process), mock.patch.object(MODULE.os, "killpg") as killpg:
            with self.assertRaises(KeyboardInterrupt):
                MODULE.run_agent_guard_command(["ansible-playbook"], {})
        killpg.assert_called_once_with(77, MODULE.signal.SIGKILL)
        process.wait.assert_called_once()
        process = mock.MagicMock(pid=78, returncode=None)
        process.communicate.side_effect = [subprocess.TimeoutExpired("a", 1), subprocess.TimeoutExpired("a", 15)]
        with mock.patch.object(MODULE.subprocess, "Popen", return_value=process), mock.patch.object(MODULE.os, "killpg"):
            with self.assertRaises(MODULE.AgentGuardTimeout):
                MODULE.run_agent_guard_command(["ansible-playbook"], {})
        process.stdout.close.assert_called_once()
        process.stderr.close.assert_called_once()
        process.wait.assert_called_once()

    def test_real_timeout_kills_children_and_grandchildren_and_removes_temporary_folders(self) -> None:
        # A random marker on the command line of both sleepers, so only this test's own processes are looked for
        # (another worktree running the same test on this machine cannot be mistaken for a leftover).
        marker = "guard-timeout-" + uuid.uuid4().hex
        ready = Path(tempfile.mkdtemp(prefix="guard-timeout-ready-")) / "pids"
        self.addCleanup(shutil.rmtree, ready.parent, ignore_errors=True)
        # The child starts a grandchild as a separate process, records both pids only after the grandchild
        # exists, then sleeps itself. Neither is replaced by exec, so the group kill must reach both.
        script = (
            "import subprocess, sys, time\n"
            "grandchild = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', sys.argv[1]])\n"
            "open(sys.argv[2] + '.tmp', 'w').write(f'{grandchild.pid}')\n"
            "import os; os.rename(sys.argv[2] + '.tmp', sys.argv[2])\n"
            "time.sleep(60)\n"
        )
        command = [sys.executable, "-c", script, marker, str(ready)]

        def alive() -> bool:
            return subprocess.run(["pgrep", "-f", marker], capture_output=True).returncode == 0

        self.assertFalse(alive())
        with mock.patch.object(MODULE, "AGENT_GUARD_TIMEOUT_SECONDS", 3):
            with self.assertRaises(MODULE.AgentGuardTimeout):
                MODULE.run_agent_guard_command(command, os.environ.copy())
        # The grandchild really started before the time-out, and both processes are gone now.
        self.assertTrue(ready.exists(), "the grandchild never started within the time limit")
        grandchild_pid = int(ready.read_text())
        time.sleep(0.3)
        with self.assertRaises(ProcessLookupError):
            os.kill(grandchild_pid, 0)
        self.assertFalse(alive())
        for call in (
            lambda executor: MODULE.run_coverage_playbook(MODULE.DEFAULT_INVENTORY, "pi4-a", ("pi4-a",), {}, {}, executor),
            lambda executor: MODULE.reread_agent_images(MODULE.DEFAULT_INVENTORY, MODULE.agent_skip_pairs(agent_args()), executor),
        ):
            created: list[str] = []

            def executor(cmd: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
                created.append(json.loads(cmd[cmd.index("--extra-vars") + 1]).get("release_agent_guard_out_dir", ""))
                return MODULE.run_agent_guard_command(command, env)

            with mock.patch.object(MODULE, "AGENT_GUARD_TIMEOUT_SECONDS", 1), redirect_stderr(io.StringIO()):
                with self.assertRaises(MODULE.AgentGuardStop) as caught:
                    call(executor)
            self.assertEqual(caught.exception.kind, "timeout")
            self.assertFalse(any(Path(path).exists() for path in created if path))
        time.sleep(0.3)
        self.assertFalse(alive())

    def test_release_variables_follow_the_body_conditions(self) -> None:
        def build(**flags: object) -> dict[str, object]:
            return MODULE.release_variables(
                argparse.Namespace(**flags), sha=SHA, artifact_sha=SHA, run_id=RUN_ID, api="api", web="web",
                pi4_hosts=["pi4-a"], torque_cutover=False, agent_services=("nfc-agent",),
            )

        plain = build(first_install=False, skip_kiosk_notice=False)
        self.assertNotIn("release_kiosk_first_install", plain)
        self.assertNotIn("release_kiosk_notice_enabled", plain)
        self.assertEqual(plain["release_sha"], SHA)
        self.assertEqual(plain["release_kiosk_agent_services"], ["nfc-agent"])
        self.assertTrue(build(first_install=True, skip_kiosk_notice=False)["release_kiosk_first_install"])
        self.assertFalse(build(first_install=False, skip_kiosk_notice=True)["release_kiosk_notice_enabled"])

    def test_route_guard_receives_the_variables_the_body_runs_with(self) -> None:
        helper = StandardAnsibleReleaseTests()
        result, execute, _signage, _excluded = helper._run_route_with_offline_pi3(io.StringIO(), ansible=0)
        self.assertEqual(result, 0)
        guard_args = helper.coverage.call_args.args
        self.assertEqual(guard_args[3], (("pi5", ("pi5",)), ("pi4", ("pi4-online",))))
        self.assertEqual(guard_args[2], "pi5:pi4-online")
        guard = guard_args[4]
        command = execute.call_args.args[0]
        body = json.loads(command[command.index("--extra-vars") + 1])
        self.assertEqual(guard["release_sha"], SHA)
        for key, value in guard.items():
            self.assertEqual(body[key], value, key)
        extra = set(body) - set(guard)
        self.assertLessEqual(extra, {"release_signage_artifact_image", "release_signage_artifact_sha256", "release_pi5_answer_cache_image"} | {k for k in extra if k.startswith("release_torque")})
        self.assertNotIn("release_allowed_missing_agents", body)
        self.assertNotIn("release_agent_guard_out_dir", body)

    def test_route_stops_when_the_guard_raises_something_unexpected(self) -> None:
        helper = StandardAnsibleReleaseTests()
        errors = io.StringIO()
        with mock.patch.object(MODULE, "remove_deploy_status_run") as remove, redirect_stderr(errors):
            result, execute, signage, _ = helper._run_route_with_offline_pi3(
                io.StringIO(), coverage_error=ValueError("boom\nsecond line")
            )
        self.assertEqual(result, 1)
        execute.assert_not_called()
        signage.assert_not_called()
        remove.assert_called_once_with(RUN_ID)
        lines = errors.getvalue().splitlines()
        self.assertTrue(all(line.startswith("[agent-guard] ") for line in lines), lines)
        self.assertIn('[agent-guard] stop {"kind": "check-launch-failed"}', lines)

    def test_stop_in_the_route_runs_nothing_and_cleans_the_run(self) -> None:
        for failure in (
            MODULE.AgentGuardStop("check-failed", "no", 2), MODULE.AgentGuardStop("timeout", "slow"),
            MODULE.AgentGuardStop("check-launch-failed", "x"),
        ):
            helper = StandardAnsibleReleaseTests()
            output = io.StringIO()
            errors = io.StringIO()
            with mock.patch.object(MODULE, "remove_deploy_status_run") as remove, redirect_stderr(errors):
                result, execute, signage, _ = helper._run_route_with_offline_pi3(output, coverage_error=failure)
            self.assertEqual(result, failure.exit_code)
            execute.assert_not_called()
            signage.assert_not_called()
            remove.assert_called_once_with(RUN_ID)
            self.assertIn(f'[agent-guard] stop {{"kind": "{failure.kind}"}}', errors.getvalue())
            # The excluded-host line is printed before the check and again after the stop.
            self.assertEqual(len(output.getvalue().splitlines()), 2)

if __name__ == "__main__":
    unittest.main()
