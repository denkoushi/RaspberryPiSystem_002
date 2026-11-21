"""Run the Pi4 agent coverage playbook and the agent image read playbook with real Ansible.

The hosts never need to be reachable: every task of the coverage playbook is
controller-local, and the read playbook runs on ``ansible_connection: local``
hosts with a fake ``docker`` first on PATH.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"
COVERAGE = ANSIBLE / "playbooks/release-agent-coverage-check.yml"
IMAGES = ANSIBLE / "playbooks/release-agent-images-read.yml"

FAKE_DOCKER = """#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps(args) + "\\n")
rows = [line.split() for line in open(os.environ["FAKE_TABLE"], encoding="utf-8").read().splitlines() if line]
if args[0] == "ps":
    labels = [item for item in args if item.startswith("label=com.docker.compose.")]
    service = [item.split("=", 2)[2] for item in labels if item.startswith("label=com.docker.compose.service=")][0]
    project = [item.split("=", 2)[2] for item in labels if item.startswith("label=com.docker.compose.project=")][0]
    oneoff = [item.split("=", 2)[2] for item in labels if item.startswith("label=com.docker.compose.oneoff=")]
    for row in rows:
        row_oneoff = row[5] if len(row) > 5 else "False"
        if oneoff and row_oneoff != oneoff[0]:
            continue
        if row[0] == service and row[4] == project:
            print(row[1])
elif args[0] == "inspect":
    if os.environ.get("FAKE_INSPECT_FAIL"):
        sys.exit(1)
    for row in rows:
        if row[1] == args[-1]:
            print(row[2], row[3])
sys.exit(0)
"""


def calls_of(text: str) -> list[list[str]]:
    return [json.loads(line) for line in text.splitlines() if line]


def types_namespace(**values):
    import argparse

    return argparse.Namespace(**values)


@unittest.skipUnless(shutil.which("ansible-playbook"), "ansible-core is required")
class AgentCoverageAnsibleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = Path(tempfile.mkdtemp(prefix="agent-coverage-test-"))
        self.addCleanup(shutil.rmtree, self.directory, ignore_errors=True)

    def _inventory(self, hosts: dict[str, dict], extra: dict | None = None) -> Path:
        document = {"all": {"children": {"kiosk": {"hosts": hosts}}}}
        if extra:
            document["all"]["vars"] = extra
        path = self.directory / "inventory.yml"
        path.write_text(yaml.safe_dump(document), encoding="utf-8")
        return path

    def _run(
        self,
        playbook: Path,
        inventory: Path,
        variables: dict,
        *,
        env: dict[str, str] | None = None,
        limit: str = "",
    ) -> subprocess.CompletedProcess[str]:
        environment = {key: value for key, value in os.environ.items() if key != "ANSIBLE_CONFIG"}
        environment.update(
            ANSIBLE_ROLES_PATH=str(ANSIBLE / "roles"),
            ANSIBLE_PYTHON_INTERPRETER="auto_silent",
            ANSIBLE_NOCOLOR="1",
        )
        environment.update(env or {})
        command = ["ansible-playbook", "-i", str(inventory), str(playbook), "--extra-vars", json.dumps(variables)]
        if limit:
            command.extend(["--limit", limit])
        return subprocess.run(command, cwd=self.directory, env=environment, capture_output=True, text=True, check=False)

    def _check(
        self,
        hosts: dict[str, dict],
        services: list[str],
        allowed: dict[str, list[str]] | None = None,
        *,
        first_install: bool = False,
        env: dict[str, str] | None = None,
        extra: dict | None = None,
        inventory: Path | None = None,
    ) -> tuple[subprocess.CompletedProcess[str], Path]:
        out = self.directory / f"out-{len(list(self.directory.glob('out-*')))}"
        out.mkdir()
        result = self._run(
            COVERAGE,
            inventory or self._inventory(hosts, extra),
            {
                "release_kiosk_agent_services": services,
                "release_allowed_missing_agents_json": json.dumps(allowed if allowed is not None else {}),
                "release_kiosk_first_install": first_install,
                "release_kiosk_service_allowlist": [],
                "release_agent_guard_out_dir": str(out),
            },
            env=env,
        )
        return result, out

    @staticmethod
    def _text(result: subprocess.CompletedProcess[str]) -> str:
        return result.stdout + result.stderr

    NFC = {"ansible_host": "203.0.113.10", "nfc_agent_client_id": "kiosk-a"}
    NFC_BARCODE = {**NFC, "barcode_agent_enabled": True}

    def test_enabled_agents_in_the_set_pass_and_write_a_result_per_host(self) -> None:
        result, out = self._check({"k1": self.NFC, "k2": self.NFC_BARCODE}, ["nfc-agent", "barcode-agent"])
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertEqual(sorted(path.stem for path in out.glob("*.json")), ["k1", "k2"])

    def test_missing_agent_stops_and_names_host_and_agent(self) -> None:
        result, out = self._check({"k1": self.NFC_BARCODE, "k2": self.NFC}, ["nfc-agent"])
        self.assertNotEqual(result.returncode, 0)
        text = self._text(result)
        self.assertIn("k1", text)
        self.assertIn("barcode-agent", text)
        self.assertIn("--allow-agent-skip", text)
        self.assertEqual([path.stem for path in out.glob("*.json")], ["k2"])

    def test_allowance_passes_and_reports_the_agent_left_as_is(self) -> None:
        result, out = self._check({"k1": self.NFC_BARCODE}, ["nfc-agent"], {"k1": ["barcode-agent"]})
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertIn("keeps these agents at their current version", self._text(result))
        self.assertEqual(json.loads((out / "k1.json").read_text())["agentsNotUpdated"], ["barcode-agent"])

    def test_allowance_for_a_different_agent_or_host_still_stops(self) -> None:
        both = {"k1": {**self.NFC_BARCODE, "torque_agent_enabled": True}}
        result, _ = self._check(both, ["nfc-agent"], {"k1": ["barcode-agent"]})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("torque-agent", self._text(result))
        result, _ = self._check({"k1": self.NFC_BARCODE, "k2": self.NFC_BARCODE}, ["nfc-agent"], {"k1": ["barcode-agent"]})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("k2", self._text(result))

    def test_first_install_ignores_the_allowance(self) -> None:
        result, out = self._check({"k1": self.NFC_BARCODE}, ["nfc-agent"], {"k1": ["barcode-agent"]}, first_install=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("--allow-agent-skip ", self._text(result))
        self.assertEqual(list(out.glob("*.json")), [])

    def test_inventory_cannot_override_the_enabled_agent_expression(self) -> None:
        hosts = {"k1": {**self.NFC_BARCODE, "release_kiosk_enabled_agent_services": []}}
        result, _ = self._check(hosts, ["nfc-agent"], extra={"release_kiosk_enabled_agent_services": []})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("barcode-agent", self._text(result))

    def _launcher(self):
        import sys

        sys.path.insert(0, str(ROOT / "scripts/deploy"))
        spec = importlib.util.spec_from_file_location("standard_ansible_release", ROOT / "scripts/deploy/standard-ansible-release.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # The real ansible.cfg wants the vault password file; keep only the tag cleanup under test.
        module.ansible_environment = lambda: {k: v for k, v in os.environ.items() if k != "ANSIBLE_CONFIG"}
        return module

    def test_inherited_run_tags_do_not_skip_the_check(self) -> None:
        result, _ = self._check({"k1": self.NFC_BARCODE}, ["nfc-agent"], env={"ANSIBLE_RUN_TAGS": "pi4"})
        self.assertNotEqual(result.returncode, 0, self._text(result))

    def test_skip_tags_always_makes_bare_ansible_pass_without_a_result_and_the_launcher_stops(self) -> None:
        hosts = {"k1": self.NFC_BARCODE}
        result, out = self._check(hosts, ["nfc-agent"], env={"ANSIBLE_SKIP_TAGS": "always"})
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertEqual(list(out.glob("*.json")), [])
        # Through the launcher the same environment is stripped, so the check runs and stops.
        module = self._launcher()
        inventory = self._inventory(hosts)
        args = types_namespace(limit="k1", first_install=False, torque_cutover=False)
        variables = {"release_kiosk_agent_services": ["nfc-agent"], "release_kiosk_service_allowlist": []}
        with mock.patch.dict(os.environ, {"ANSIBLE_SKIP_TAGS": "always", "ANSIBLE_ROLES_PATH": str(ANSIBLE / "roles")}):
            with self.assertRaises(module.AgentGuardStop) as caught:
                module.run_agent_coverage_check(args, str(inventory), "k1", (("pi4", ("k1",)),), variables)
        self.assertEqual(caught.exception.kind, "check-failed")

    SHA = "a" * 40

    def _plan_with_inventory_allowance(self, allow: str | None, merge_env: str) -> str:
        """Run the launcher's coverage check against an inventory that carries its own allowance dict."""
        hosts = {"k1": self.NFC_BARCODE, "k2": self.NFC_BARCODE}
        inventory = self._inventory(
            hosts,
            {
                # Both the old dict name and the current JSON-string name: neither may widen the human's allowance.
                "release_allowed_missing_agents": {"k1": ["barcode-agent"], "k2": ["barcode-agent"]},
                "release_allowed_missing_agents_json": '{"k1":["barcode-agent"],"k2":["barcode-agent"]}',
            },
        )
        module = self._launcher()
        args = types_namespace(limit="k1:k2", first_install=False, torque_cutover=False, allow_agent_skip=allow)
        variables = {"release_kiosk_agent_services": ["nfc-agent"], "release_kiosk_service_allowlist": []}
        env = {"ANSIBLE_ROLES_PATH": str(ANSIBLE / "roles"), "ANSIBLE_HASH_BEHAVIOUR": merge_env, "ANSIBLE_NOCOLOR": "1"}
        with mock.patch.dict(os.environ, env):
            try:
                module.plan_agent_coverage_check(args, inventory, (("pi4", ("k1", "k2")),), variables)
            except module.AgentGuardStop as stop:
                return stop.kind
        return "passed"

    def test_inventory_allowance_in_both_names_never_widens_the_human_allowance(self) -> None:
        # The inventory carries the allowance as a dict and as a JSON string. The role reads only the JSON
        # string passed as an extra var (which beats the inventory value, so nothing is combined with it);
        # the launcher also forces replace, which the environment tests check. Here the outer environment
        # asks for merge and the human's allowance must still decide alone.
        self.assertEqual(self._plan_with_inventory_allowance(None, "merge"), "check-failed")
        partial = f"k1:barcode-agent:{self.SHA}:docker"
        self.assertEqual(self._plan_with_inventory_allowance(partial, "merge"), "check-failed")
        full = partial + f",k2:barcode-agent:{self.SHA}:docker"
        self.assertEqual(self._plan_with_inventory_allowance(full, "merge"), "passed")

    def test_enabled_flag_that_depends_on_an_extra_var_reaches_the_same_conclusion_as_the_body(self) -> None:
        hosts = {"k1": {**self.NFC, "barcode_agent_enabled": "{{ release_sha == 'on' }}"}}
        inventory = self._inventory(hosts)
        module = self._launcher()
        args = types_namespace(limit="k1", first_install=False, torque_cutover=False)
        base = {"release_kiosk_agent_services": ["nfc-agent"], "release_kiosk_service_allowlist": []}
        with mock.patch.dict(os.environ, {"ANSIBLE_ROLES_PATH": str(ANSIBLE / "roles")}):
            module.run_agent_coverage_check(
                args, str(inventory), "k1", (("pi4", ("k1",)),), {**base, "release_sha": "off"}
            )
            with self.assertRaises(module.AgentGuardStop) as caught:
                module.run_agent_coverage_check(
                    args, str(inventory), "k1", (("pi4", ("k1",)),), {**base, "release_sha": "on"}
                )
        self.assertEqual(caught.exception.kind, "check-failed")
        # Without the variable the flag evaluates differently (agent not enabled), which is why
        # the guard must receive the body's variables rather than a reduced set.
        result, _ = self._check(hosts, ["nfc-agent"])
        self.assertEqual(result.returncode, 0, self._text(result))

    def test_a_skipped_assert_never_leaves_a_result_file_and_the_launcher_stops(self) -> None:
        roles = self.directory / "roles-copy"
        shutil.copytree(ANSIBLE / "roles", roles)
        task_file = roles / "release_kiosk/tasks/agent_coverage.yml"
        text = task_file.read_text(encoding="utf-8")
        marker = "      register: release_kiosk_agent_assert\n"
        self.assertEqual(text.count(marker), 1)
        task_file.write_text(text.replace(marker, marker + "      when: false\n"), encoding="utf-8")
        hosts = {"k1": self.NFC_BARCODE}
        result, out = self._check(hosts, ["nfc-agent"], env={"ANSIBLE_ROLES_PATH": str(roles)})
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertEqual(list(out.glob("*.json")), [])
        module = self._launcher()
        args = types_namespace(limit="k1", first_install=False, torque_cutover=False)
        variables = {"release_kiosk_agent_services": ["nfc-agent"], "release_kiosk_service_allowlist": []}
        with mock.patch.dict(os.environ, {"ANSIBLE_ROLES_PATH": str(roles)}):
            with self.assertRaises(module.AgentGuardStop) as caught:
                module.run_agent_coverage_check(args, str(self._inventory(hosts)), "k1", (("pi4", ("k1",)),), variables)
        self.assertEqual(caught.exception.kind, "check-result-missing")

    def test_empty_release_set_stops_only_hosts_with_enabled_agents(self) -> None:
        result, _ = self._check({"k1": self.NFC}, [])
        self.assertNotEqual(result.returncode, 0)
        result, out = self._check({"k1": {"ansible_host": "203.0.113.10"}}, [])
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertEqual([path.stem for path in out.glob("*.json")], ["k1"])

    def test_staging_style_inventory_is_not_stopped_by_release_playbook_asserts(self) -> None:
        hosts = {"k1": {**self.NFC, "staging_deploy_enabled": False, "release_kiosk_compose_project": "staging-x"}}
        result, _ = self._check(hosts, ["nfc-agent"])
        self.assertEqual(result.returncode, 0, self._text(result))

    def test_vault_encrypted_host_vars_do_not_prevent_the_check(self) -> None:
        key = self.directory / "vault-key"
        key.write_text("test-only-key\n", encoding="utf-8")
        inventory = self._inventory({"k1": self.NFC})
        vars_dir = self.directory / "host_vars/k1"
        vars_dir.mkdir(parents=True)
        plain = vars_dir / "vault.yml"
        plain.write_text("vault_secret: placeholder\n", encoding="utf-8")
        subprocess.run(
            ["ansible-vault", "encrypt", "--vault-password-file", str(key), str(plain)],
            check=True, capture_output=True, cwd=self.directory,
        )
        result, _ = self._check({}, ["nfc-agent"], env={"ANSIBLE_VAULT_PASSWORD_FILE": str(key)}, inventory=inventory)
        self.assertEqual(result.returncode, 0, self._text(result))

    def test_output_settings_and_become_do_not_change_the_result(self) -> None:
        settings = (
            {},
            {"ANSIBLE_DISPLAY_OK_HOSTS": "false", "ANSIBLE_BECOME": "true", "ANSIBLE_CALLBACK_RESULT_FORMAT": "yaml"},
            {"ANSIBLE_DISPLAY_SKIPPED_HOSTS": "false", "ANSIBLE_STDOUT_CALLBACK": "minimal", "ANSIBLE_NO_LOG": "true"},
        )
        outcomes = set()
        for env in settings:
            ok, out = self._check({"k1": self.NFC}, ["nfc-agent"], env=env)
            bad, bad_out = self._check({"k1": self.NFC_BARCODE}, ["nfc-agent"], env=env)
            outcomes.add((
                ok.returncode, tuple(sorted(path.stem for path in out.glob("*.json"))),
                bad.returncode != 0, tuple(path.stem for path in bad_out.glob("*.json")),
            ))
        self.assertEqual(outcomes, {(0, ("k1",), True, ())})

    def test_undefined_output_directory_fails(self) -> None:
        result = self._run(
            COVERAGE, self._inventory({"k1": self.NFC}),
            {"release_kiosk_agent_services": ["nfc-agent"], "release_allowed_missing_agents_json": "{}"},
        )
        self.assertNotEqual(result.returncode, 0)

    def _images(
        self,
        rows: list[str],
        hosts: dict,
        extra: dict | None = None,
        env: dict[str, str] | None = None,
        expected: list[str] | None = None,
        limit: str = "",
    ):
        table = self.directory / "table"
        table.write_text("\n".join(rows) + "\n", encoding="utf-8")
        log = self.directory / "docker.log"
        log.write_text("", encoding="utf-8")
        bin_dir = self.directory / "bin"
        bin_dir.mkdir(exist_ok=True)
        docker = bin_dir / "docker"
        docker.write_text(FAKE_DOCKER, encoding="utf-8")
        docker.chmod(docker.stat().st_mode | stat.S_IXUSR)
        out = self.directory / "images-out"
        out.mkdir(exist_ok=True)
        result = self._run(
            IMAGES, self._inventory(hosts, {"raspisys_github_owner": "owner", **(extra or {})}),
            {
                "release_agent_guard_out_dir": str(out),
                "release_agent_images_expected_hosts_json": json.dumps(list(hosts) if expected is None else expected),
            },
            env={"PATH": f"{bin_dir}:{os.environ['PATH']}", "FAKE_TABLE": str(table), "FAKE_LOG": str(log), **(env or {})},
            limit=limit,
        )
        return result, out, log

    def test_read_playbook_reports_containers_and_expected_names(self) -> None:
        rows = [
            "nfc-agent c1 ghcr.io/o/raspisys-nfc-agent:" + "a" * 40 + " running docker",
            "barcode-agent c2 ghcr.io/o/raspisys-barcode-agent:" + "b" * 40 + " exited docker",
            "barcode-agent c3 ghcr.io/o/raspisys-barcode-agent:" + "c" * 40 + " running docker",
        ]
        result, out, log = self._images(rows, {"k1": {"ansible_connection": "local", "ansible_become": False}})
        self.assertEqual(result.returncode, 0, self._text(result))
        report = json.loads((out / "k1.json").read_text())
        self.assertEqual(report["host"], "k1")
        self.assertEqual(report["project"], "docker")
        for name, image in report["expectedImages"].items():
            self.assertNotRegex(image, r":[^:/]*$", name)
            self.assertIn(f"raspisys-{name}", image)
        self.assertEqual(report["containers"]["torque-agent"], [])
        self.assertEqual(
            [item["status"] for item in report["containers"]["barcode-agent"]], ["exited", "running"]
        )
        self.assertEqual(report["containers"]["nfc-agent"][0]["image"], rows[0].split()[2])
        logged = log.read_text()
        self.assertIn("label=com.docker.compose.project=docker", [item for call in calls_of(logged) for item in call])
        calls = [json.loads(line) for line in logged.splitlines()]
        inspect = [call for call in calls if call[0] == "inspect"]
        self.assertTrue(inspect)
        for call in inspect:
            self.assertEqual(call[1], "--format")
            self.assertEqual(call[2], "{{.Config.Image}} {{.State.Status}}")
            self.assertEqual(len(call), 4)

    def test_one_off_containers_are_not_counted(self) -> None:
        image = "ghcr.io/o/raspisys-nfc-agent:" + "a" * 40
        hosts = {"k1": {"ansible_connection": "local", "ansible_become": False}}
        result, out, log = self._images([f"nfc-agent c1 {image} running docker True"], hosts)
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertEqual(json.loads((out / "k1.json").read_text())["containers"]["nfc-agent"], [])
        self.assertIn("label=com.docker.compose.oneoff=False", [item for call in calls_of(log.read_text()) for item in call])

    def test_a_mix_of_one_off_and_regular_containers_reports_only_the_regular_ones(self) -> None:
        image = "ghcr.io/o/raspisys-nfc-agent:"
        rows = [
            f"nfc-agent c1 {image}{'a' * 40} exited docker False",
            f"nfc-agent c2 {image}{'b' * 40} running docker True",
        ]
        hosts = {"k1": {"ansible_connection": "local", "ansible_become": False}}
        result, out, _log = self._images(rows, hosts)
        self.assertEqual(result.returncode, 0, self._text(result))
        containers = json.loads((out / "k1.json").read_text())["containers"]["nfc-agent"]
        self.assertEqual(containers, [{"image": image + "a" * 40, "status": "exited"}])

    def test_a_failing_docker_inspect_fails_the_task_and_writes_no_report(self) -> None:
        rows = ["nfc-agent c1 ghcr.io/o/raspisys-nfc-agent:" + "a" * 40 + " running docker"]
        result, out, _log = self._images(
            rows, {"k1": {"ansible_connection": "local", "ansible_become": False}}, env={"FAKE_INSPECT_FAIL": "1"}
        )
        self.assertNotEqual(result.returncode, 0, self._text(result))
        self.assertEqual(list(out.glob("*.json")), [])

    def test_read_playbook_fails_before_reading_when_a_group_name_expands_to_other_hosts(self) -> None:
        rows = ["nfc-agent c1 ghcr.io/o/raspisys-nfc-agent:" + "a" * 40 + " running docker"]
        local = {"ansible_connection": "local", "ansible_become": False}
        result, out, log = self._images(rows, {"k1": local, "k2": local}, expected=["kiosk"], limit="kiosk")
        self.assertNotEqual(result.returncode, 0, self._text(result))
        self.assertEqual(list(out.glob("*.json")), [])
        self.assertEqual(log.read_text(), "")

    def test_read_playbook_runs_when_the_selected_hosts_are_exactly_the_named_ones(self) -> None:
        rows = ["nfc-agent c1 ghcr.io/o/raspisys-nfc-agent:" + "a" * 40 + " running docker"]
        local = {"ansible_connection": "local", "ansible_become": False}
        result, out, _log = self._images(rows, {"k1": local, "k2": local}, expected=["k2", "k1"], limit="k1:k2")
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertEqual(sorted(path.stem for path in out.glob("*.json")), ["k1", "k2"])

    def test_read_playbook_asks_for_root_on_the_pi4_itself(self) -> None:
        play = yaml.safe_load(IMAGES.read_text(encoding="utf-8"))[0]
        self.assertIs(play["become"], True)

    def test_read_playbook_uses_the_inventory_project(self) -> None:
        rows = ["nfc-agent c9 ghcr.io/o/raspisys-nfc-agent:" + "d" * 40 + " running staging-x"]
        hosts = {"k1": {"ansible_connection": "local", "ansible_become": False, "release_kiosk_compose_project": "staging-x"}}
        result, out, log = self._images(rows, hosts)
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertIn("label=com.docker.compose.project=staging-x", [item for call in calls_of(log.read_text()) for item in call])
        report = json.loads((out / "k1.json").read_text())
        self.assertEqual(report["project"], "staging-x")
        self.assertEqual(len(report["containers"]["nfc-agent"]), 1)

    def _inventory_with_ssh_localhost(self, hosts: dict[str, dict]) -> Path:
        document = {
            "all": {
                "hosts": {
                    "localhost": {
                        "ansible_connection": "ssh",
                        "ansible_host": "192.0.2.1",
                        "ansible_python_interpreter": "/nonexistent/python",
                        "ansible_become": True,
                        "ansible_become_method": "sudo",
                    }
                },
                "children": {"kiosk": {"hosts": hosts}},
            }
        }
        path = self.directory / "inventory-ssh-localhost.yml"
        path.write_text(yaml.safe_dump(document), encoding="utf-8")
        return path

    def test_result_is_written_on_the_controller_even_if_the_inventory_makes_localhost_an_ssh_host(self) -> None:
        inventory = self._inventory_with_ssh_localhost({"k1": self.NFC})
        result, out = self._check({}, ["nfc-agent"], inventory=inventory)
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertEqual([path.stem for path in out.glob("*.json")], ["k1"])

    def test_image_report_is_written_on_the_controller_even_if_localhost_is_an_ssh_host(self) -> None:
        bin_dir = self.directory / "bin"
        bin_dir.mkdir(exist_ok=True)
        (self.directory / "table").write_text("\n", encoding="utf-8")
        log = self.directory / "docker.log"
        log.write_text("", encoding="utf-8")
        docker = bin_dir / "docker"
        docker.write_text(FAKE_DOCKER, encoding="utf-8")
        docker.chmod(docker.stat().st_mode | stat.S_IXUSR)
        out = self.directory / "images-out"
        out.mkdir()
        inventory = self._inventory_with_ssh_localhost({"k1": {"ansible_connection": "local", "ansible_become": False}})
        document = yaml.safe_load(inventory.read_text())
        document["all"]["vars"] = {"raspisys_github_owner": "owner"}
        inventory.write_text(yaml.safe_dump(document), encoding="utf-8")
        result = self._run(
            IMAGES, inventory,
            {"release_agent_guard_out_dir": str(out), "release_agent_images_expected_hosts_json": '["k1"]'},
            env={"PATH": f"{bin_dir}:{os.environ['PATH']}", "FAKE_TABLE": str(self.directory / "table"), "FAKE_LOG": str(log)},
        )
        self.assertEqual(result.returncode, 0, self._text(result))
        self.assertEqual([path.stem for path in out.glob("*.json")], ["k1"])


if __name__ == "__main__":
    unittest.main()
