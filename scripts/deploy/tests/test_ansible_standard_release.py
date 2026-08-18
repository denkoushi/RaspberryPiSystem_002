#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import yaml
from jinja2 import Environment, StrictUndefined

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"
PLAYBOOK = (ANSIBLE / "playbooks/deploy-release-standard.yml").read_text(
    encoding="utf-8"
)


def role_text(role: str) -> str:
    root = ANSIBLE / "roles" / role
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(root.rglob("*.yml"))
    )


class StandardReleaseAnsibleTests(unittest.TestCase):
    def test_candidate_status_agent_runtime_closure_executes(self) -> None:
        prepare_tasks = yaml.safe_load(
            (ANSIBLE / "roles/release_kiosk/tasks/prepare.yml").read_text(
                encoding="utf-8"
            )
        )
        runtime_declarations = []
        source_prefix = "{{ playbook_dir }}/../../../"
        for task in prepare_tasks:
            copy_task = task.get("ansible.builtin.copy")
            if not isinstance(copy_task, dict):
                continue
            source = str(copy_task.get("src", ""))
            destination = str(copy_task.get("dest", ""))
            if (
                "{{ release_kiosk_stage_dir }}/" not in destination
                or not source.endswith(".py")
            ):
                continue
            self.assertTrue(source.startswith(source_prefix), source)
            runtime_declarations.append(
                (
                    ROOT / source[len(source_prefix) :],
                    Path(destination.rsplit("/", 1)[-1]),
                )
            )

        self.assertTrue(runtime_declarations)
        prepare_text = (
            ANSIBLE / "roles/release_kiosk/tasks/prepare.yml"
        ).read_text(encoding="utf-8")
        for source_path, destination_name in runtime_declarations:
            self.assertTrue(source_path.is_file(), source_path)
            self.assertIn(
                f"/usr/local/lib/raspi-status-agent/{destination_name}",
                prepare_text,
            )

        with tempfile.TemporaryDirectory() as temporary_root:
            temporary_path = Path(temporary_root)
            runtime_path = temporary_path / "usr/local/lib/raspi-status-agent"
            runtime_path.mkdir(parents=True)
            for source_path, destination_name in runtime_declarations:
                shutil.copy2(source_path, runtime_path / destination_name)

            config_path = temporary_path / "status-agent.conf"
            config_lines = [
                "API_BASE_URL=__API_BASE_URL__",
                "CLIENT_ID=fixture-status-agent",
                "CLIENT_KEY=fixture-key",
                "LOG_FILE=",
                "REQUEST_TIMEOUT=3",
                "STORAGE_HEALTH_ENABLED=0",
                "STORAGE_HEALTH_STATE_FILE="
                + str(temporary_path / "storage-health-state"),
                "TERMINAL_AGENT_HEALTH_NFC_ENABLED=0",
                "TERMINAL_AGENT_HEALTH_BARCODE_ENABLED=0",
                "TERMINAL_AGENT_HEALTH_TORQUE_ENABLED=0",
                "TERMINAL_AGENT_MAINTENANCE_LEASES_JSON={}",
                "TERMINAL_AGENT_HEALTH_STATE_FILE="
                + str(temporary_path / "terminal-agent-health-state.json"),
                "STATUS_AGENT_LOG_SUCCESS=0",
            ]

            class StatusHandler(BaseHTTPRequestHandler):
                received = False

                def do_POST(self) -> None:  # noqa: N802
                    length = int(self.headers.get("Content-Length", "0"))
                    self.rfile.read(length)
                    type(self).received = True
                    self.send_response(200)
                    self.end_headers()

                def log_message(self, *_args: object) -> None:
                    return

            server = None
            command = [
                "/usr/bin/env",
                "python3",
                "-c",
                (
                    "import runpy, sys; "
                    "sys.path.insert(0, str(__import__('pathlib').Path(sys.argv[1]).parent)); "
                    "module = runpy.run_path(sys.argv[1], run_name='status_agent_candidate'); "
                    "module['main'].__globals__['build_payload'] = lambda config, force_storage_health=False: {'logs': []}; "
                    "module['main'].__globals__['post_payload'] = lambda config, payload: None; "
                    "sys.argv = [sys.argv[0]]; "
                    "sys.exit(module['main']())"
                ),
                str(runtime_path / "status-agent.py"),
            ]
            if Path("/proc/stat").is_file():
                server = ThreadingHTTPServer(("127.0.0.1", 0), StatusHandler)
                config_lines[0] = (
                    f"API_BASE_URL=http://127.0.0.1:{server.server_port}/api"
                )
                command = ["/usr/bin/env", "python3", str(runtime_path / "status-agent.py")]
                server_thread = threading.Thread(
                    target=server.serve_forever, daemon=True
                )
                server_thread.start()
            config_path.write_text("\n".join(config_lines), encoding="utf-8")
            environment = os.environ.copy()
            environment["STATUS_AGENT_CONFIG"] = str(config_path)
            try:
                result = subprocess.run(
                    command,
                    env=environment,
                    capture_output=True,
                    text=True,
                    timeout=15,
                    check=False,
                )
            finally:
                if server is not None:
                    server.shutdown()
                    server.server_close()
                    server_thread.join(timeout=2)

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout={result.stdout}\nstderr={result.stderr}",
        )
        if server is not None:
            self.assertTrue(StatusHandler.received)

    def test_release_launcher_uses_shared_firefox_resolution(self) -> None:
        prepare = (ANSIBLE / "roles/release_kiosk/tasks/prepare.yml").read_text(
            encoding="utf-8"
        )
        resolver = (ANSIBLE / "roles/kiosk/tasks/resolve-browser.yml").read_text(
            encoding="utf-8"
        )
        launcher = (ANSIBLE / "templates/kiosk-launch.sh.j2").read_text(
            encoding="utf-8"
        )

        self.assertIn("name: kiosk", prepare)
        self.assertIn("tasks_from: resolve-browser", prepare)
        self.assertIn("kiosk_browser_firefox_binary", resolver)
        self.assertIn("kiosk_browser_exec_path", resolver)

        environment = Environment(undefined=StrictUndefined)
        environment.filters["bool"] = lambda value: str(value).lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        environment.filters["regex_replace"] = lambda value, pattern, replacement: re.sub(
            pattern, replacement, value
        )
        rendered = environment.from_string(launcher).render(
            ansible_user="kiosk",
            kiosk_url="https://server.example/kiosk",
            kiosk_browser_engine="firefox",
            kiosk_browser_exec_path="/usr/bin/firefox",
            kiosk_release_sha="a" * 40,
        )
        self.assertIn('BROWSER_BIN="/usr/bin/firefox"', rendered)
        self.assertNotIn('BROWSER_BIN="/usr/bin/chromium-browser"', rendered)

    def test_display_health_wait_is_bounded_and_fails_after_timeout(self) -> None:
        health = yaml.safe_load(
            (ANSIBLE / "roles/release_kiosk/tasks/health_checks.yml").read_text(
                encoding="utf-8"
            )
        )
        display = health[0]
        self.assertEqual(display["name"], "Verify Pi4 display services")
        self.assertEqual(display["retries"], 10)
        self.assertEqual(display["delay"], 2)
        self.assertEqual(display["until"], "release_kiosk_display_health is succeeded")
        self.assertGreater(display["retries"], 0)
        self.assertGreater(display["delay"], 0)
        status_service = health[2]
        self.assertEqual(
            status_service["name"],
            "Verify the Pi4 status-agent service is loaded and healthy",
        )
        status_until = " ".join(status_service["until"])
        self.assertIn("'LoadState=loaded'", status_until)
        self.assertIn("'Result=success'", status_until)
        self.assertIn("'ExecMainStatus=0'", status_until)

    def test_switch_and_rollback_run_status_agent_before_timer_and_health(self) -> None:
        switch = yaml.safe_load(
            (ANSIBLE / "roles/release_kiosk/tasks/switch.yml").read_text(
                encoding="utf-8"
            )
        )
        switch_names = [task["name"] for task in switch]
        switch_run_index = switch_names.index(
            "Run the staged status-agent service once before its timer"
        )
        switch_timer_index = switch_names.index(
            "Ensure the status-agent timer uses the staged implementation"
        )
        self.assertLess(switch_run_index, switch_timer_index)
        self.assertEqual(
            switch[switch_run_index]["ansible.builtin.systemd"],
            {"name": "status-agent.service", "state": "started"},
        )

        rollback = yaml.safe_load(
            (ANSIBLE / "roles/release_kiosk/tasks/rollback.yml").read_text(
                encoding="utf-8"
            )
        )
        rollback_names = [task["name"] for task in rollback]
        rollback_run_index = rollback_names.index(
            "Run the restored status-agent service once before its timer"
        )
        rollback_timer_index = rollback_names.index(
            "Restart restored Pi4 status-agent timer"
        )
        rollback_health_index = rollback_names.index(
            "Verify the complete restored Pi4 runtime"
        )
        self.assertLess(rollback_run_index, rollback_timer_index)
        self.assertLess(rollback_timer_index, rollback_health_index)
        self.assertEqual(
            rollback[rollback_run_index]["ansible.builtin.systemd"],
            {"name": "status-agent.service", "state": "started"},
        )

    def test_rollback_restores_prerequisites_before_compose_and_deletion(self) -> None:
        rollback_path = ANSIBLE / "roles/release_kiosk/tasks/rollback.yml"
        tasks = yaml.safe_load(rollback_path.read_text(encoding="utf-8"))
        names = [task["name"] for task in tasks]
        prerequisite_index = names.index(
            "Verify rollback prerequisites before agent compose restore"
        )
        compose_index = names.index(
            "Restore Pi4 agents from the captured image tags"
        )
        removal_index = names.index(
            "Remove newly introduced Pi4 files without a backup"
        )
        restore_index = names.index("Restore backed-up Pi4 release files")
        reload_index = names.index("Reload restored Pi4 systemd units")
        self.assertLess(restore_index, removal_index)
        self.assertLess(removal_index, reload_index)
        self.assertLess(reload_index, prerequisite_index)
        self.assertLess(prerequisite_index, compose_index)
        self.assertIn("/etc/raspi-status-agent.conf", " ".join(
            (ANSIBLE / "roles/release_kiosk/tasks/prepare.yml").read_text(
                encoding="utf-8"
            ).splitlines()
        ))
        removal = tasks[removal_index]
        self.assertIn(
            "item.item.dest not in (release_kiosk_rollback_prerequisites | default([]))",
            removal["when"],
        )

    def test_disabled_agent_is_not_a_rollback_health_requirement(self) -> None:
        prepare = yaml.safe_load(
            (ANSIBLE / "roles/release_kiosk/tasks/prepare.yml").read_text(
                encoding="utf-8"
            )
        )
        health = yaml.safe_load(
            (ANSIBLE / "roles/release_kiosk/tasks/health_checks.yml").read_text(
                encoding="utf-8"
            )
        )
        service_selection = next(
            task for task in prepare if task["name"] == "Select agents enabled for this Pi4"
        )
        selection = service_selection["ansible.builtin.set_fact"]["release_kiosk_enabled_services"]
        self.assertIn("barcode_agent_enabled | default(false) | bool", selection)
        barcode_health = next(
            task for task in health if task["name"] == "Verify the Pi4 barcode agent"
        )
        self.assertIn("release_kiosk_enabled_services", barcode_health["when"])

    def test_pi4_rollback_image_capture_uses_unique_compose_labels(self) -> None:
        prepare_tasks = yaml.safe_load(
            (ANSIBLE / "roles/release_kiosk/tasks/prepare.yml").read_text(
                encoding="utf-8"
            )
        )
        capture = next(
            task
            for task in prepare_tasks
            if task["name"] == "Capture current Pi4 agent images as temporary rollback tags"
        )
        shell = capture["ansible.builtin.shell"]
        self.assertNotIn("docker compose", shell)
        self.assertNotIn("release_kiosk_existing_compose", shell)
        self.assertIn(
            "label=com.docker.compose.project={{ release_kiosk_compose_project }}",
            shell,
        )
        self.assertIn(
            "label=com.docker.compose.service={{ item }}",
            shell,
        )
        self.assertIn('container_count="$(printf', shell)
        self.assertIn('[[ "${container_count}" -eq 1 ]]', shell)
        self.assertIn("docker inspect --format", shell)
        self.assertRegex(shell, r"\[\[ \"\$\{image_id\}\" =~ \^sha256:\[0-9a-f\]\{64\}\$ \]\]")
        self.assertIn("docker image tag", shell)
        formatter = next(
            line for line in shell.splitlines() if line.strip().startswith("image_format=")
        )
        generated = subprocess.run(
            ["/bin/bash", "-c", f"{formatter}; printf '%s' \"$image_format\""],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(generated.stdout, "{{.Image}}")
        self.assertEqual(capture["register"], "release_kiosk_rollback_capture")
        self.assertFalse(capture["failed_when"])
        capture_index = next(
            index
            for index, task in enumerate(prepare_tasks)
            if task["name"] == "Capture current Pi4 agent images as temporary rollback tags"
        )
        record = prepare_tasks[capture_index + 1]
        self.assertEqual(record["name"], "Record Pi4 rollback tags created by this run")
        self.assertIn("selectattr('rc', 'equalto', 0)", record["ansible.builtin.set_fact"]["release_kiosk_captured_services"])

    def test_top_level_route_is_explicit_and_serial(self) -> None:
        plays = yaml.safe_load(PLAYBOOK)
        self.assertEqual(PLAYBOOK.count("  serial: 1\n"), 3)
        self.assertLess(PLAYBOOK.index("role: release_pi5"), PLAYBOOK.index("role: release_kiosk"))
        self.assertLess(
            PLAYBOOK.index("role: release_kiosk"),
            PLAYBOOK.index("role: release_signage"),
        )
        self.assertNotIn("terminal-profile-registry", PLAYBOOK)
        self.assertNotIn("rolling_release", PLAYBOOK)
        self.assertEqual(plays[0]["hosts"], "kiosk")
        self.assertIn("torque-cutover", plays[0]["tags"])
        self.assertEqual(plays[1]["hosts"], "server")
        self.assertEqual(plays[1]["connection"], "local")
        self.assertEqual(plays[2]["hosts"], "kiosk")
        self.assertEqual(plays[3]["hosts"], "kiosk")
        self.assertIn("torque-cutover", plays[3]["tags"])
        self.assertEqual(plays[4]["hosts"], "signage")

    def test_torque_cutover_is_quiesce_pi5_stage_then_resume(self) -> None:
        plays = yaml.safe_load(PLAYBOOK)
        self.assertEqual(
            [play["name"] for play in plays[:4]],
            [
                "Quiesce both torque ownership endpoints before the API changes",
                "Prepare and switch the Pi5 control plane",
                "Update Pi4 kiosks one target at a time",
                "Aggregate both torque candidates before ownership resumes",
            ],
        )
        quiesce = role_text("release_torque_cutover")
        self.assertIn("state: stopped", quiesce)
        self.assertIn("intent.json", quiesce)
        self.assertIn("release_torque_lease_ttl_seconds", quiesce)
        self.assertIn("release_torque_guard_grace_seconds", quiesce)
        self.assertIn("torque-bluetooth-adapter --status", quiesce)
        self.assertIn("docker-compose.client.yml", quiesce)
        self.assertIn("release_kiosk_candidate_compose", quiesce)
        self.assertIn("release_torque_all_staged", quiesce)
        self.assertIn("release_torque_all_agents_ready", quiesce)
        self.assertIn("release_torque_all_browsers_ready", quiesce)
        self.assertIn("selfOwnedToken", quiesce)
        self.assertIn("torque-bluetooth-guard.service", quiesce)
        self.assertNotIn("nfc-agent", quiesce)
        self.assertNotIn("barcode-agent", quiesce)

    def test_torque_allowlist_stages_stopped_candidate_and_preserves_other_agents(self) -> None:
        prepare = (ANSIBLE / "roles/release_kiosk/tasks/prepare.yml").read_text(
            encoding="utf-8"
        )
        switch = (ANSIBLE / "roles/release_kiosk/tasks/switch.yml").read_text(
            encoding="utf-8"
        )
        rollback = (ANSIBLE / "roles/release_kiosk/tasks/rollback.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("release_kiosk_service_allowlist", prepare)
        self.assertIn("intersect(release_kiosk_service_allowlist)", prepare)
        self.assertIn("create --force-recreate --no-build torque-agent", switch)
        self.assertIn("not (release_torque_cutover", switch)
        self.assertIn("create --force-recreate --no-build", rollback)
        self.assertIn("without restarting torque ownership", rollback)

    def test_serial_stage_failure_still_reaches_shared_no_browser_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory = root / "inventory.yml"
            playbook = root / "playbook.yml"
            inventory.write_text(
                "all:\n  children:\n    kiosk:\n      hosts:\n        kiosk-a:\n          ansible_connection: local\n        kiosk-b:\n          ansible_connection: local\n",
                encoding="utf-8",
            )
            playbook.write_text(
                """---
- hosts: kiosk
  gather_facts: false
  serial: 1
  max_fail_percentage: 100
  tasks:
    - ansible.builtin.set_fact:
        simulated_stage: false
    - block:
        - ansible.builtin.set_fact:
            simulated_stage: true
          when: inventory_hostname == 'kiosk-a'
        - ansible.builtin.fail:
            msg: simulated second-host stage failure
          when: inventory_hostname == 'kiosk-b'
      rescue:
        - ansible.builtin.set_fact:
            simulated_stage: false
- hosts: kiosk
  gather_facts: false
  tasks:
    - ansible.builtin.set_fact:
        simulated_all_staged: >-
          {{ groups['kiosk'] | map('extract', hostvars, 'simulated_stage') | select('equalto', true) | list | length == groups['kiosk'] | length }}
    - ansible.builtin.debug:
        msg: "AGGREGATE={{ simulated_all_staged }} host={{ inventory_hostname }}"
    - ansible.builtin.debug:
        msg: BROWSER_START_MUST_NOT_APPEAR
      when: simulated_all_staged | bool
    - ansible.builtin.fail:
        msg: aggregate failure after both hosts observed the boundary
      when: not (simulated_all_staged | bool)
""",
                encoding="utf-8",
            )
            result = subprocess.run(
                ["ansible-playbook", "-i", str(inventory), str(playbook)],
                capture_output=True,
                text=True,
                check=False,
            )

        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("AGGREGATE=False host=kiosk-a", output)
        self.assertIn("AGGREGATE=False host=kiosk-b", output)
        self.assertNotIn('"msg": "BROWSER_START_MUST_NOT_APPEAR"', output)

    def test_pi4_and_pi3_use_prepare_block_rescue_always(self) -> None:
        for role in ("release_kiosk", "release_signage"):
            main = yaml.safe_load(
                (ANSIBLE / f"roles/{role}/tasks/main.yml").read_text(
                    encoding="utf-8"
                )
            )
            with self.subTest(role=role):
                self.assertEqual(len(main), 1)
                outer = main[0]
                self.assertEqual(
                    outer["block"][0]["ansible.builtin.import_tasks"],
                    "prepare.yml",
                )
                if role == "release_kiosk":
                    switch_health = outer["block"][1]
                    self.assertEqual(
                        [
                            task["ansible.builtin.import_tasks"]
                            for task in switch_health["block"]
                            if "ansible.builtin.import_tasks" in task
                        ],
                        ["switch.yml", "health.yml"],
                    )
                    rescue = switch_health["rescue"]
                else:
                    self.assertEqual(
                        [
                            task["ansible.builtin.import_tasks"]
                            for task in outer["block"]
                        ],
                        ["prepare.yml", "switch.yml", "health.yml"],
                    )
                    rescue = outer["rescue"]
                self.assertEqual(
                    [task["ansible.builtin.import_tasks"] for task in rescue],
                    ["rollback.yml"],
                )
                self.assertEqual(
                    [
                        task["ansible.builtin.import_tasks"]
                        for task in outer["always"]
                    ],
                    ["cleanup.yml"],
                )
                if role == "release_kiosk":
                    self.assertIn("release_torque_cutover", outer["always"][0]["when"])

    def test_pi3_recovers_failures_after_stopping_before_transfer(self) -> None:
        prepare_tasks = yaml.safe_load(
            (ANSIBLE / "roles/release_signage/tasks/prepare.yml").read_text(
                encoding="utf-8"
            )
        )
        names = [task["name"] for task in prepare_tasks]
        stop_index = names.index(
            "Stop only the Pi3 display and Signage units before transfer"
        )
        self.assertLess(
            stop_index,
            names.index(
                "Transfer the complete Pi3 artifact after releasing display resources"
            ),
        )
        self.assertLess(
            stop_index,
            names.index(
                "Expand the complete Pi3 artifact while display services remain stopped"
            ),
        )

        controller_temp = next(
            task
            for task in prepare_tasks
            if task["name"]
            == "Create a private controller artifact directory for the launcher user"
        )
        extraction = next(
            task
            for task in prepare_tasks
            if task["name"]
            == "Extract the complete Pi3 artifact from GHCR on the controller"
        )
        self.assertFalse(controller_temp["become"])
        self.assertFalse(extraction["become"])

        legacy_cleanup = next(
            task
            for task in prepare_tasks
            if task["name"] == "Remove an incomplete one-time Pi3 legacy snapshot"
        )
        legacy_stat = next(
            task
            for task in prepare_tasks
            if task["name"] == "Inspect currently installed Pi3 payloads"
        )
        legacy_copy = next(
            task
            for task in prepare_tasks
            if task["name"] == "Capture the currently installed Pi3 runtime once"
        )
        legacy_assert = next(
            task
            for task in prepare_tasks
            if task["name"]
            == "Require existing Pi3 legacy payloads to be regular files"
        )
        self.assertEqual(
            legacy_cleanup["ansible.builtin.file"],
            {"path": "{{ release_signage_legacy }}", "state": "absent"},
        )
        self.assertFalse(legacy_stat["ansible.builtin.stat"]["follow"])
        self.assertIn(
            "item.stat.isreg | default(false) | bool",
            legacy_assert["ansible.builtin.assert"]["that"][0],
        )
        self.assertEqual(
            legacy_copy["loop"],
            "{{ release_signage_legacy_payload_stats.results | default([]) }}",
        )
        self.assertEqual(
            legacy_copy["when"], "item.stat.exists | default(false) | bool"
        )

    def test_pi3_release_contains_only_signage_runtime_services(self) -> None:
        signage = role_text("release_signage")
        for forbidden in (
            "nfc-agent",
            "barcode-agent",
            "torque-agent",
            "docker compose",
        ):
            self.assertNotIn(forbidden, signage)
        self.assertIn("signage-lite.service", signage)
        self.assertIn("lightdm.service", signage)

    def test_pi3_health_uses_bounded_cold_display_wait_and_runtime_env(self) -> None:
        health_tasks = yaml.safe_load(
            (ANSIBLE / "roles/release_signage/tasks/health_checks.yml").read_text(
                encoding="utf-8"
            )
        )
        unit_health = next(
            task
            for task in health_tasks
            if task["name"] == "Verify Pi3 display and Signage units"
        )
        endpoint_health = next(
            task
            for task in health_tasks
            if task["name"] == "Verify authenticated Pi3 Signage endpoints"
        )
        self.assertEqual(unit_health["retries"], 7)
        self.assertEqual(unit_health["delay"], 5)
        endpoint_command = endpoint_health["ansible.builtin.script"]["cmd"]
        self.assertIn("--runtime-env", endpoint_command)
        self.assertIn("release_signage_config_root", endpoint_command)

    def test_pi4_builds_are_outside_the_terminal_route(self) -> None:
        kiosk = role_text("release_kiosk")
        prepare = (
            ANSIBLE / "roles/release_kiosk/tasks/prepare.yml"
        ).read_text(encoding="utf-8")
        switch = (
            ANSIBLE / "roles/release_kiosk/tasks/switch.yml"
        ).read_text(encoding="utf-8")
        self.assertNotIn("--build", kiosk)
        self.assertNotRegex(kiosk, r"\bbuild:\s*")
        self.assertIn("docker\n      - image\n      - pull", prepare)
        self.assertIn("up -d --no-build", switch)

    def test_pi4_removes_only_this_run_backups_after_verified_outcome(self) -> None:
        cleanup_path = ANSIBLE / "roles/release_kiosk/tasks/cleanup.yml"
        cleanup_tasks = yaml.safe_load(cleanup_path.read_text(encoding="utf-8"))
        backup_cleanup = next(
            task
            for task in cleanup_tasks
            if task["name"] == "Remove this run's Pi4 file backups after a verified outcome"
        )
        self.assertEqual(
            backup_cleanup["ansible.builtin.file"],
            {"path": "{{ item.backup_file }}", "state": "absent"},
        )
        self.assertEqual(
            backup_cleanup["loop"],
            "{{ release_kiosk_install.results | default([]) }}",
        )
        self.assertEqual(
            backup_cleanup["when"],
            [
                "item.changed | default(false) | bool",
                "item.backup_file is defined",
                "release_kiosk_healthy | default(false) | bool or release_kiosk_rolled_back | default(false) | bool or not (release_kiosk_switch_attempted | default(false) | bool)",
            ],
        )
        self.assertTrue(backup_cleanup["no_log"])

    def test_pi4_cleanup_covers_success_pre_switch_failure_and_preserves_failed_rollback(self) -> None:
        cleanup_tasks = yaml.safe_load(
            (ANSIBLE / "roles/release_kiosk/tasks/cleanup.yml").read_text(
                encoding="utf-8"
            )
        )
        tag_cleanup = cleanup_tasks[0]
        stage_cleanup = cleanup_tasks[-1]
        expected_pre_switch = "not (release_kiosk_switch_attempted | default(false) | bool)"
        self.assertIn("release_kiosk_healthy | default(false) | bool", tag_cleanup["when"])
        self.assertIn("release_kiosk_rolled_back | default(false) | bool", tag_cleanup["when"])
        self.assertIn(expected_pre_switch, tag_cleanup["when"])
        self.assertIn(expected_pre_switch, " ".join(stage_cleanup["when"]))
        self.assertEqual(tag_cleanup["loop"], "{{ release_kiosk_captured_services | default([]) }}")

        rollback = yaml.safe_load(
            (ANSIBLE / "roles/release_kiosk/tasks/rollback.yml").read_text(
                encoding="utf-8"
            )
        )
        names = [task["name"] for task in rollback]
        removal_index = names.index("Remove newly introduced Pi4 files without a backup")
        restore_index = names.index("Restore backed-up Pi4 release files")
        reload_index = names.index("Reload restored Pi4 systemd units")
        prerequisite_index = names.index("Verify rollback prerequisites before agent compose restore")
        compose_index = names.index("Restore Pi4 agents from the captured image tags")
        health_index = names.index("Verify the complete restored Pi4 runtime")
        self.assertLess(restore_index, removal_index)
        self.assertLess(removal_index, reload_index)
        self.assertLess(reload_index, prerequisite_index)
        self.assertLess(prerequisite_index, compose_index)
        self.assertLess(removal_index, compose_index)
        self.assertLess(compose_index, health_index)

    def test_pi3_has_one_target_hash_and_no_target_network_fetch(self) -> None:
        signage = role_text("release_signage")
        prepare = (
            ANSIBLE / "roles/release_signage/tasks/prepare.yml"
        ).read_text(encoding="utf-8")
        switch = (
            ANSIBLE / "roles/release_signage/tasks/switch.yml"
        ).read_text(encoding="utf-8")
        self.assertEqual(signage.count("sha256sum"), 1)
        self.assertIn("delegate_to: localhost", prepare)
        target_section = prepare.split(
            "- name: Select the controller-local Pi3 artifact", 1
        )[1]
        controller_section = prepare.split(
            "- name: Extract the complete Pi3 artifact from GHCR on the controller",
            1,
        )[1].split("- name: Select the controller-local Pi3 artifact", 1)[0]
        self.assertIn(
            'docker image pull --platform linux/arm/v7 "${image}"',
            controller_section,
        )
        for forbidden in ("git fetch", "git clone", "docker image pull", "curl ", "wget "):
            self.assertNotIn(forbidden, target_section)
        self.assertIn("/current", switch)
        self.assertIn("/previous", switch)
        self.assertGreaterEqual(switch.count("mv -Tf"), 2)

    def test_pi3_scratch_artifact_create_has_an_explicit_command(self) -> None:
        prepare_tasks = yaml.safe_load(
            (ANSIBLE / "roles/release_signage/tasks/prepare.yml").read_text(
                encoding="utf-8"
            )
        )
        extraction = next(
            task
            for task in prepare_tasks
            if task["name"] == "Extract the complete Pi3 artifact from GHCR on the controller"
        )
        shell = extraction["ansible.builtin.shell"]
        self.assertIn('docker create "${image}" /signage-release.tar', shell)

    def test_pi3_does_not_rewrite_the_verified_candidate_tree(self) -> None:
        prepare = (
            ANSIBLE / "roles/release_signage/tasks/prepare.yml"
        ).read_text(encoding="utf-8")
        after_hash = prepare.split(
            "- name: Require the Pi3 artifact bytes to match the one expected SHA-256",
            1,
        )[1]
        self.assertNotRegex(
            after_hash,
            r"ansible\.builtin\.(?:copy|template):[\s\S]{0,300}"
            r"dest:.*release_signage_candidate",
        )
        self.assertIn("dest: \"{{ release_signage_config_root }}/runtime.env\"", after_hash)
        self.assertNotIn(".artifact-sha256", after_hash)

    def test_pi3_publishes_only_a_complete_atomic_candidate(self) -> None:
        prepare = (
            ANSIBLE / "roles/release_signage/tasks/prepare.yml"
        ).read_text(encoding="utf-8")
        cleanup_path = (
            ANSIBLE / "roles/release_signage/tasks/cleanup.yml"
        )
        cleanup = cleanup_path.read_text(encoding="utf-8")
        cleanup_tasks = yaml.safe_load(cleanup)
        self.assertIn("validate-layout", prepare)
        self.assertIn('dest: "{{ release_signage_candidate_temp }}"', prepare)
        self.assertNotIn('dest: "{{ release_signage_candidate }}"', prepare)
        self.assertRegex(
            prepare,
            r"(?s)Validate the fixed Pi3 payload allowlist before extraction"
            r".*Expand the complete Pi3 artifact"
            r".*Validate the extracted Pi3 tree against the fixed payload allowlist"
            r".*Make the expanded Pi3 release tree immutable"
            r".*Atomically publish the complete Pi3 candidate directory",
        )
        self.assertIn('path: "{{ release_signage_candidate_temp }}"', cleanup)
        self.assertEqual(
            cleanup_tasks[0]["ansible.builtin.file"],
            {"path": "{{ release_signage_candidate_temp }}", "state": "absent"},
        )
        self.assertNotIn(
            {"path": "{{ release_signage_candidate }}", "state": "absent"},
            [task.get("ansible.builtin.file") for task in cleanup_tasks],
        )

    def test_new_route_has_no_historical_admission_contract(self) -> None:
        route = "\n".join(
            [PLAYBOOK, role_text("release_pi5"), role_text("release_kiosk"), role_text("release_signage")]
        ).lower()
        for forbidden in (
            "readinessadmission",
            "releaseclaims",
            "fleet-release-state",
            "route_preflight",
            "manifestsha256",
            "payloaddigest",
        ):
            self.assertNotIn(forbidden, route)

    def test_pi5_standard_route_has_no_custom_subsystem_or_sealed_evidence(self) -> None:
        pi5 = role_text("release_pi5")
        for forbidden in (
            "pi5-blue-green.sh",
            "lib/pi5-blue-green",
            "validate-expand-only-migrations.py",
            "pi5-release-evidence.py",
            "resource-evidence",
            "migration-plan",
            "--resource-evidence",
            "--migration-plan",
        ):
            self.assertNotIn(forbidden, pi5)
        self.assertIn("prisma migrate deploy", pi5)
        self.assertIn("Require Pi5 memory and disk headroom immediately", pi5)

    def test_pi5_waits_for_post_pull_load_before_candidate_mutation(self) -> None:
        prepare_path = ANSIBLE / "roles/release_pi5/tasks/prepare.yml"
        prepare_tasks = yaml.safe_load(prepare_path.read_text(encoding="utf-8"))
        names = [task["name"] for task in prepare_tasks]
        pull_index = names.index(
            "Pull immutable Pi5 candidate images while active traffic remains live"
        )
        capacity_index = names.index(
            "Require Pi5 memory and disk headroom immediately"
        )
        load_index = names.index("Wait bounded time for post-pull Pi5 load to settle")
        migration_index = names.index("Reject unfinished or rolled-back Prisma ledger before deploy")
        candidate_index = names.index("Start only inactive Pi5 API and Web services")
        self.assertLess(pull_index, capacity_index)
        self.assertLess(capacity_index, load_index)
        self.assertLess(load_index, migration_index)
        self.assertLess(migration_index, candidate_index)

        pull = prepare_tasks[pull_index]
        self.assertEqual(
            pull["loop"],
            ["{{ release_pi5_api_image }}", "{{ release_pi5_web_image }}"],
        )
        self.assertEqual(pull["register"], "release_pi5_pull")
        self.assertEqual(pull["retries"], 3)
        self.assertEqual(pull["delay"], 10)
        self.assertEqual(pull["until"], "release_pi5_pull is succeeded")
        self.assertNotIn("ignore_errors", pull)
        self.assertNotIn("failed_when", pull)

        capacity = prepare_tasks[capacity_index]
        self.assertEqual(
            capacity["ansible.builtin.assert"]["that"],
            [
                "(release_pi5_capacity.stdout | from_json).memoryMb | int >= release_pi5_min_memory_mb | int",
                "(release_pi5_capacity.stdout | from_json).diskGb | int >= release_pi5_min_disk_gb | int",
            ],
        )
        self.assertNotIn("retries", capacity)
        self.assertNotIn("delay", capacity)
        self.assertNotIn("until", capacity)

        load_wait = prepare_tasks[load_index]
        self.assertEqual(load_wait["retries"], "{{ release_pi5_load_retries }}")
        self.assertEqual(load_wait["delay"], "{{ release_pi5_load_delay }}")
        self.assertEqual(load_wait["register"], "release_pi5_load")
        self.assertNotIn("ignore_errors", load_wait)
        self.assertNotIn("failed_when", load_wait)
        self.assertNotIn("no_log", load_wait)
        load_shell = load_wait["ansible.builtin.shell"]
        self.assertIn("/proc/loadavg", load_shell)
        self.assertIn("_NPROCESSORS_ONLN", load_shell)
        self.assertIn("* 0.75", load_shell)
        self.assertIn("{\"load\":%s,\"maxLoad\":%s}", load_shell)
        self.assertNotIn("MemAvailable", load_shell)
        self.assertNotIn("df -", load_shell)
        self.assertIn("release_pi5_load.stdout", load_wait["until"])
        self.assertIn(".load | float", load_wait["until"])
        self.assertIn(".maxLoad | float", load_wait["until"])


class Pi5CanonicalStandardRouteTests(unittest.TestCase):
    ROLE = "release_pi5"

    def task_text(self, name: str) -> str:
        return (ANSIBLE / f"roles/{self.ROLE}/tasks/{name}.yml").read_text(
            encoding="utf-8"
        )

    def test_canonical_launcher_has_one_pi5_standard_route(self) -> None:
        launcher = (ROOT / "scripts/deploy/standard-ansible-release.py").read_text(
            encoding="utf-8"
        )
        wrapper = (ROOT / "scripts/update-all-clients.sh").read_text(encoding="utf-8")
        play = yaml.safe_load(PLAYBOOK)[1]
        self.assertIn('PLAYBOOK = ANSIBLE / "playbooks/deploy-release-standard.yml"', launcher)
        self.assertIn("standard-ansible-release.py", wrapper)
        self.assertEqual(play["roles"], [{"role": "release_pi5"}])
        self.assertEqual(play["hosts"], "server")
        self.assertEqual(play["connection"], "local")
        self.assertFalse(play["gather_facts"])
        self.assertTrue(play["become"])
        self.assertEqual(play["serial"], 1)
        self.assertEqual(play["order"], "inventory")
        self.assertFalse((ANSIBLE / "playbooks/verify-pi5-standard-candidate.yml").exists())
        self.assertFalse((ANSIBLE / "roles/release_pi5_standard_candidate").exists())
        server = (ANSIBLE / "roles/server/tasks/main.yml").read_text(encoding="utf-8")
        self.assertNotIn("pi5-blue-green-reconcile.service", server)
        self.assertFalse(
            (ANSIBLE / "templates/pi5-blue-green-reconcile.service.j2").exists()
        )

    def test_pi5_call_graph_is_direct_ansible_lifecycle(self) -> None:
        main = yaml.safe_load(self.task_text("main"))[0]
        self.assertEqual(
            [task["ansible.builtin.import_tasks"] for task in main["block"]],
            ["prepare.yml", "switch.yml", "health.yml", "commit.yml"],
        )
        self.assertEqual(
            [task["ansible.builtin.import_tasks"] for task in main["rescue"]],
            ["rollback.yml"],
        )
        self.assertEqual(
            [task["ansible.builtin.import_tasks"] for task in main["always"]],
            ["cleanup.yml"],
        )

    def test_pi5_has_no_legacy_subsystem_or_new_framework(self) -> None:
        candidate = role_text(self.ROLE)
        defaults = yaml.safe_load(
            (ANSIBLE / f"roles/{self.ROLE}/defaults/main.yml").read_text()
        )
        canonical = "\n".join((PLAYBOOK, candidate)).lower()
        self.assertEqual(defaults["release_pi5_run_root"], "/var/lib/raspi-release/standard")
        for identifier in (
            "evaluation-only",
            "standard-candidate",
            "release_pi5_standard_candidate",
        ):
            self.assertNotIn(identifier, canonical)
        for forbidden in (
            "pi5-blue-green.sh",
            "lib/pi5-blue-green",
            "validate-expand-only-migrations.py",
            "releaseEvidence",
            "resource-evidence",
            "migration-plan",
            "state.json",
            "reconcile",
            "claims",
            "community.docker",
        ):
            self.assertNotIn(forbidden, candidate)
        self.assertNotRegex(candidate, r"ansible\.builtin\.(?:script|raw):")

    def test_pi5_uses_only_explicit_routes_and_strict_identities(self) -> None:
        defaults = (
            ANSIBLE / f"roles/{self.ROLE}/defaults/main.yml"
        ).read_text(encoding="utf-8")
        prepare = self.task_text("prepare")
        self.assertIn("Caddyfile.gateway.template", defaults)
        self.assertIn("cmp -s", prepare)
        self.assertIn("matches neither known route", prepare)
        self.assertIn("{{.Config.Image}}|{{.Image}}|{{.State.Running}}", prepare)
        self.assertIn("PI5_GATEWAY_IMAGE", prepare)
        self.assertNotIn("reverse_proxy", prepare)
        self.assertNotIn("Caddyfile.gateway.http.template", defaults)

    def test_pi5_first_compose_command_has_complete_image_interpolation(self) -> None:
        prepare = yaml.safe_load(self.task_text("prepare"))
        names = [task["name"] for task in prepare]
        discovery_index = names.index(
            "Read the running Pi5 gateway image before the first Compose command"
        )
        environment_index = names.index(
            "Define complete Pi5 Compose interpolation before the first Compose command"
        )
        compose_index = names.index(
            "Resolve active and opposite Pi5 Compose container IDs"
        )
        exact_index = names.index("Define exact slot-specific Compose images")
        self.assertLess(discovery_index, environment_index)
        self.assertLess(environment_index, compose_index)
        self.assertLess(compose_index, exact_index)

        discovery_argv = prepare[discovery_index]["ansible.builtin.command"]["argv"]
        self.assertEqual(discovery_argv[:2], ["docker", "ps"])
        self.assertNotIn("compose", discovery_argv)
        self.assertIn(
            "label=com.docker.compose.service=gateway",
            discovery_argv,
        )

        required_images = {
            "PI5_BLUE_API_IMAGE",
            "PI5_GREEN_API_IMAGE",
            "PI5_BLUE_WEB_IMAGE",
            "PI5_GREEN_WEB_IMAGE",
            "PI5_GATEWAY_IMAGE",
        }
        initial_environment = prepare[environment_index]["ansible.builtin.set_fact"][
            "release_pi5_compose_environment"
        ]
        self.assertTrue(required_images.issubset(initial_environment))
        self.assertIn("release_pi5_gateway_discovery", initial_environment["PI5_GATEWAY_IMAGE"])

        first_compose = next(
            task
            for task in prepare
            if "release_pi5_compose_argv"
            in str(task.get("ansible.builtin.command", {}).get("argv", ""))
        )
        self.assertIs(first_compose, prepare[compose_index])
        self.assertEqual(
            first_compose["environment"],
            "{{ release_pi5_compose_environment }}",
        )
        exact_environment = prepare[exact_index]["ansible.builtin.set_fact"][
            "release_pi5_compose_environment"
        ]
        self.assertTrue(required_images.issubset(exact_environment))

    def test_every_pi5_compose_command_uses_the_complete_environment(self) -> None:
        task_root = ANSIBLE / f"roles/{self.ROLE}/tasks"
        compose_tasks = []
        for path in sorted(task_root.glob("*.yml")):
            pending = list(yaml.safe_load(path.read_text(encoding="utf-8")) or [])
            while pending:
                task = pending.pop(0)
                for section in ("block", "rescue", "always"):
                    pending.extend(task.get(section, []))
                argv = task.get("ansible.builtin.command", {}).get("argv", "")
                argv_text = str(argv)
                if (
                    "release_pi5_compose_argv" in argv_text
                    or "release_pi5_migration_argv" in argv_text
                    or (isinstance(argv, list) and argv[:2] == ["docker", "compose"])
                ):
                    compose_tasks.append((path.name, task))

        self.assertTrue(compose_tasks)
        for path_name, task in compose_tasks:
            with self.subTest(path=path_name, task=task["name"]):
                expected_environment = (
                    "{{ release_pi5_compose_environment | default({}) }}"
                    if path_name == "cleanup.yml"
                    else "{{ release_pi5_compose_environment }}"
                )
                self.assertEqual(
                    task.get("environment"),
                    expected_environment,
                )

    def test_pi5_fresh_prepare_mutates_only_inactive_services(self) -> None:
        prepare = yaml.safe_load(self.task_text("prepare"))
        start = next(
            task
            for task in prepare
            if task["name"] == "Start only inactive Pi5 API and Web services"
        )
        argv = start["ansible.builtin.command"]["argv"]
        for required in ("--no-build", "never", "--no-deps", "--wait"):
            self.assertIn(required, argv)
        self.assertIn("'api-' + release_pi5_slot", argv)
        self.assertIn("'web-' + release_pi5_slot", argv)
        self.assertEqual(start["when"], "release_pi5_route == 'fresh'")

    def test_pre_switch_fresh_failure_removes_only_inactive_services(self) -> None:
        prepare = yaml.safe_load(self.task_text("prepare"))
        marker = next(
            task
            for task in prepare
            if task["name"] == "Mark the inactive Pi5 candidate startup boundary"
        )
        start = next(
            task
            for task in prepare
            if task["name"] == "Start only inactive Pi5 API and Web services"
        )
        self.assertLess(prepare.index(marker), prepare.index(start))
        self.assertEqual(
            marker["ansible.builtin.set_fact"],
            {"release_pi5_start_attempted": True},
        )

        cleanup = yaml.safe_load(self.task_text("cleanup"))
        incomplete = next(
            task
            for task in cleanup
            if task["name"]
            == "Remove an incomplete fresh Pi5 candidate before traffic switch"
        )
        argv = incomplete["ansible.builtin.command"]["argv"]
        for required in ("'rm'", "'-f'", "'-s'", "'api-'", "'web-'"):
            self.assertIn(required, argv)
        self.assertIn("release_pi5_slot | default('')", argv)
        for forbidden in (
            "release_pi5_active_slot",
            "release_pi5_previous_slot",
            "gateway",
        ):
            self.assertNotIn(forbidden, argv)
        conditions = "\n".join(incomplete["when"])
        self.assertIn("release_pi5_start_attempted | default(false)", conditions)
        self.assertIn("release_pi5_switch_attempted | default(false)", conditions)
        self.assertIn("release_pi5_route | default('') == 'fresh'", conditions)
        self.assertIn("release_pi5_slot | default('') in ['blue', 'green']", conditions)
        self.assertIn("default({})", incomplete["environment"])

    def test_pi5_migration_boundary_is_prisma_and_small_ledger_only(self) -> None:
        prepare = self.task_text("prepare")
        self.assertIn("prisma migrate deploy", prepare)
        self.assertIn("prisma migrate status", prepare)
        self.assertGreaterEqual(
            prepare.count("finished_at IS NULL OR rolled_back_at IS NOT NULL"), 2
        )
        for forbidden in ("git ", "migration manifest", "repair", "checksum"):
            self.assertNotIn(forbidden, prepare.lower())

    def test_pi5_commit_and_rollback_order_is_crash_safe(self) -> None:
        switch = self.task_text("switch")
        commit = self.task_text("commit")
        rollback = self.task_text("rollback")
        self.assertIn("Caddyfile.{{ release_run_id }}", switch)
        self.assertNotIn("mv -Tf", switch)
        self.assertLess(commit.index("mv -Tf"), commit.index("Stop the previous Pi5 API"))
        self.assertLess(
            commit.index("Stop the previous Pi5 API"),
            commit.index("Wait for the committed Pi5 scheduler leader"),
        )
        self.assertLess(
            rollback.index("Restart previous Pi5 API"),
            rollback.index("Wait for restored previous Pi5 scheduler leader"),
        )
        self.assertLess(
            rollback.index("Wait for restored previous Pi5 scheduler leader"),
            rollback.index("Atomically restore previous known Pi5 routing"),
        )
        self.assertLess(
            rollback.index("Atomically restore previous known Pi5 routing"),
            rollback.index("Reload restored canonical Pi5 routing"),
        )

    def test_pi5_distinguishes_three_rerun_states(self) -> None:
        prepare = self.task_text("prepare")
        for required in (
            "fresh",
            "settled",
            "interrupted",
            "same-release leader",
            "old API is already stopped",
            "old leader for interrupted",
            "opposite_api_identity",
            "opposite_web_identity",
        ):
            self.assertIn(required, prepare)
        self.assertIn("release_pi5_route in ['fresh', 'interrupted']", self.task_text("commit"))

    def test_interrupted_health_failure_has_rollback_authority(self) -> None:
        prepare = yaml.safe_load(self.task_text("prepare"))
        marker = next(
            task
            for task in prepare
            if task["name"]
            == "Mark interrupted Pi5 commit as an existing switched recovery boundary"
        )
        self.assertEqual(
            marker["ansible.builtin.set_fact"],
            {"release_pi5_switch_attempted": True},
        )
        self.assertEqual(marker["when"], "release_pi5_route == 'interrupted'")
        rollback = self.task_text("rollback")
        self.assertIn(
            "release_pi5_switch_attempted | default(false) | bool",
            rollback,
        )
        self.assertIn("Restart previous Pi5 API with its captured image", rollback)
        self.assertIn("Atomically restore previous known Pi5 routing", rollback)
        self.assertIn("Reload restored canonical Pi5 routing", rollback)

    def test_settled_rerun_removes_only_opposite_cleanup_residue(self) -> None:
        cleanup = yaml.safe_load(self.task_text("cleanup"))
        retired = next(
            task
            for task in cleanup
            if task["name"]
            == "Remove previous Pi5 slot only after committed healthy handoff"
        )
        self.assertIn("release_pi5_previous_slot | default('')", retired["ansible.builtin.command"]["argv"])
        condition = retired["when"][1]
        self.assertIn("release_pi5_route | default('') == 'settled'", condition)
        self.assertIn("release_pi5_opposite_api_id | default('') | length > 0", condition)
        self.assertIn("release_pi5_opposite_web_id | default('') | length > 0", condition)
        self.assertNotIn("release_pi5_active_slot", retired["ansible.builtin.command"]["argv"])

    def test_pi5_monitor_is_bounded_and_cleanup_has_no_handoff(self) -> None:
        defaults = yaml.safe_load(
            (ANSIBLE / f"roles/{self.ROLE}/defaults/main.yml").read_text()
        )
        health = self.task_text("health")
        sample = self.task_text("health-sample")
        cleanup = self.task_text("cleanup")
        self.assertEqual(defaults["release_pi5_health_sample_count"], 5)
        self.assertEqual(defaults["release_pi5_health_interval_seconds"], 10)
        self.assertIn("range(0", health)
        self.assertIn("release_pi5_health_sample_count", health)
        self.assertIn(
            "(item | int) + 1 < (release_pi5_health_sample_count | int)",
            sample,
        )
        self.assertIn("standby", sample)
        self.assertIn("leader", sample)
        self.assertNotIn(" stop", cleanup)
        self.assertNotIn("caddy, reload", cleanup)


if __name__ == "__main__":
    unittest.main()
