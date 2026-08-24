from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import yaml

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure" / "ansible"
STANDARD_LAUNCHER = ROOT / "scripts" / "deploy" / "standard-ansible-release.py"
STANDARD_SHA = "a" * 40


def _load_standard_launcher():
    sys.path.insert(0, str(STANDARD_LAUNCHER.parent))
    spec = importlib.util.spec_from_file_location(
        "staging_boundary_standard_release", STANDARD_LAUNCHER
    )
    if spec is None or spec.loader is None:
        raise AssertionError("standard release launcher could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_valid_staging_fixture(root: Path) -> Path:
    """Create a disposable inventory with direct private host vars."""
    group_vars = root / "group_vars"
    group_vars.mkdir(parents=True)
    shutil.copy(ANSIBLE / "group_vars" / "staging.yml", group_vars / "staging.yml")
    shutil.copy(ANSIBLE / "inventory-staging.yml", root / "inventory-staging.yml")
    replacements = (
        (".example.invalid", ".test"),
        ("__SET_STAGING_SSH_USER__", "stageadmin"),
        ("REPLACE_WITH_STAGING_TAILSCALE_CIDR", "100.64.0.0/10"),
        ("REPLACE_WITH_STAGING_TAILSCALE_AUTH_KEY", "staging-ts-key"),
        ("REPLACE_WITH_STAGING_APP_PASSWORD", "staging-app-password"),
        ("REPLACE_WITH_STAGING_MIGRATION_PASSWORD", "staging-migration-password"),
        ("REPLACE_WITH_STAGING_POSTGRES_PASSWORD", "staging-postgres-password"),
        ("REPLACE_WITH_STAGING_ACCESS_SECRET", "s" * 40),
        ("REPLACE_WITH_STAGING_REFRESH_SECRET", "r" * 40),
        ("REPLACE_WITH_STAGING_STATUS_AGENT_KEY", "staging-status-key"),
        ("REPLACE_WITH_STAGING_NFC_SECRET", "staging-nfc-secret"),
        ("staging_deploy_enabled: false", "staging_deploy_enabled: true"),
    )
    for host in ("staging-pi5", "staging-pi4-kiosk01"):
        target = root / "host_vars" / host
        target.mkdir(parents=True)
        content = (ANSIBLE / "host_vars" / host / "vault.yml.example").read_text(
            encoding="utf-8"
        )
        for old, new in replacements:
            content = content.replace(old, new)
        (target / "vault.yml").write_text(content, encoding="utf-8")
    return root / "inventory-staging.yml"


def _inventory_host(inventory: Path, host: str) -> dict[str, object]:
    environment = os.environ.copy()
    environment["ANSIBLE_CONFIG"] = str(ANSIBLE / "ansible.cfg")
    environment["ANSIBLE_VAULT_PASSWORD_FILE"] = str(ANSIBLE / ".vault-pass.example")
    result = subprocess.run(
        ["ansible-inventory", "-i", str(inventory), "--host", host],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


class StagingInventoryBoundaryTest(unittest.TestCase):
    def test_staging_has_only_placeholder_hosts_and_dedicated_runtime_names(self) -> None:
        inventory = (ANSIBLE / "inventory-staging.yml").read_text(encoding="utf-8")
        variables = (ANSIBLE / "group_vars" / "staging.yml").read_text(encoding="utf-8")
        self.assertIn("staging-pi5:", inventory)
        self.assertIn("staging-pi4-kiosk01:", inventory)
        self.assertNotIn("ansible_host:", inventory)
        self.assertNotIn("ansible_user:", inventory)
        self.assertNotIn("deploy_executor_host:", inventory)
        self.assertIn("staging_environment: true", variables)
        self.assertIn("staging_deploy_enabled: false", variables)
        self.assertIn("staging-pi5.invalid", variables)
        self.assertIn("staging-pi4-kiosk01.invalid", variables)
        self.assertIn("/opt/RaspberryPiSystem_002-staging", variables)
        self.assertIn("raspisys-staging-bluegreen", variables)
        self.assertIn("pi5_base_compose_project: raspisys-staging", variables)
        self.assertIn("raspisys-staging-client", variables)
        self.assertIn("raspisys-staging", variables)
        self.assertIn("pi5_certs_dir: /opt/RaspberryPiSystem_002-staging/certs", variables)
        self.assertIn("backup_ssh_private_key_host_path: /opt/RaspberryPiSystem_002-staging/", variables)
        self.assertIn("borrow_return_staging", variables)
        for host in ("staging-pi5", "staging-pi4-kiosk01"):
            example = (ANSIBLE / "host_vars" / host / "vault.yml.example").read_text(
                encoding="utf-8"
            )
            self.assertIn("ansible_host:", example)
            self.assertIn("ansible_user:", example)
            self.assertIn("deploy_executor_host:", example)

    def test_staging_does_not_reference_production_or_talkplaza_values(self) -> None:
        variables = (ANSIBLE / "group_vars" / "staging.yml").read_text(encoding="utf-8")
        inventory = (ANSIBLE / "inventory-staging.yml").read_text(encoding="utf-8")
        for text in (variables, inventory):
            self.assertNotIn("raspi4-assembly-01", text)
            self.assertNotIn("talkplaza", text.lower())
            self.assertNotIn("100.", text)
            self.assertNotIn("192.168.", text)
        self.assertNotIn("/opt/RaspberryPiSystem_002/", variables)
        self.assertNotIn("borrow_return\n", variables)

    def test_staging_explicitly_overrides_all_network_path_and_scan_inputs(self) -> None:
        production = yaml.safe_load(
            (ANSIBLE / "group_vars" / "all.yml").read_text(encoding="utf-8")
        )
        staging = yaml.safe_load(
            (ANSIBLE / "group_vars" / "staging.yml").read_text(encoding="utf-8")
        )
        overridden = (
            "network_mode",
            "local_network",
            "tailscale_network",
            "current_network",
            "server_ip",
            "kiosk_ip",
            "signage_ip",
            "server_base_url",
            "kiosk_full_url",
            "api_base_url",
            "haizen_agent_api_base_url",
            "websocket_agent_url",
            "api_healthcheck_url",
            "status_agent_api_base_url",
            "nfc_agent_api_base_url",
            "docker_server_ip",
            "caddy_log_dir",
            "alert_script_path",
            "clamav_server_scan_paths",
            "clamav_kiosk_scan_paths",
            "trivy_scan_target",
            "trivy_skip_dirs",
            "clamav_server_log_dir",
            "clamav_kiosk_log_dir",
            "trivy_log_dir",
            "rkhunter_log_dir",
            "rkhunter_kiosk_log_dir",
            "security_monitor_state_dir",
            "security_monitor_fail2ban_log",
        )
        for key in overridden:
            self.assertIn(key, staging, key)
            self.assertIn(key, production, key)
            if key != "network_mode":
                self.assertNotEqual(staging[key], production[key], key)
        self.assertEqual(staging["network_mode"], "tailscale")
        staging_text = (ANSIBLE / "group_vars" / "staging.yml").read_text(
            encoding="utf-8"
        )
        for forbidden in (
            "192.168.",
            "100.106.158.2",
            "100.74.144.79",
            "/opt/backups",
            "/var/log/caddy\n",
            "/opt/RaspberryPiSystem_002/",
            "talkplaza",
        ):
            self.assertNotIn(forbidden, staging_text.lower(), forbidden)

    def test_database_role_bootstrap_has_staging_database_and_backup_boundaries(self) -> None:
        playbook_path = ANSIBLE / "playbooks" / "prepare-pi5-database-roles.yml"
        playbook = playbook_path.read_text(encoding="utf-8")
        variables = yaml.safe_load(
            (ANSIBLE / "group_vars" / "staging.yml").read_text(encoding="utf-8")
        )
        self.assertEqual(variables["pi5_database_name"], "borrow_return_staging")
        self.assertEqual(
            variables["pi5_database_compose_project"], "raspisys-staging"
        )
        self.assertEqual(
            variables["pi5_database_role_migration_backup_root"],
            "/opt/raspisys-staging-backups",
        )
        self.assertEqual(
            variables["pi5_database_compose_env_file"],
            "/opt/RaspberryPiSystem_002-staging/infrastructure/docker/.env",
        )
        for marker in (
            "pi5_database_name",
            "pi5_database_compose_project",
            "pi5_database_compose_file",
            "pi5_database_compose_env_file",
            "pi5_database_role_migration_backup_root",
            "regex_escape",
            "raspi_app",
            "raspi_migrator",
        ):
            self.assertIn(marker, playbook)
        self.assertNotIn("match('^/opt/backups/", playbook)
        self.assertNotIn("-d borrow_return", playbook)
        self.assertGreaterEqual(playbook.count("--env-file {{ pi5_database_compose_env_file | quote }}"), 4)

    def test_fresh_database_runbook_reaches_role_bootstrap_without_production_paths(self) -> None:
        runbook = (
            ROOT / "docs" / "runbooks" / "assembly-overlay-staging-hardware-acceptance.md"
        ).read_text(encoding="utf-8")
        server_config = (
            ANSIBLE / "playbooks" / "server-config-release.yml"
        ).read_text(encoding="utf-8")
        for marker in (
            "server-config-release.yml",
            "--limit staging-pi5",
            "--project-name raspisys-staging",
            "--env-file \"$STAGING_ROOT/infrastructure/docker/.env\"",
            '"${COMPOSE[@]}" up -d db',
            "pg_dump -U postgres -d borrow_return_staging",
            "prepare-pi5-database-roles.yml",
            "pi5_database_role_migration_backup_path=$STAGING_DB_BACKUP",
        ):
            self.assertIn(marker, runbook)
        self.assertIn(
            'repo_path: "{{ project_root | default(\'/opt/RaspberryPiSystem_002\') }}"',
            server_config,
        )
        self.assertIn("staging_deploy_enabled", server_config)

    def test_valid_private_host_vars_resolve_effective_hosts_without_placeholder_or_jinja(self) -> None:
        with tempfile.TemporaryDirectory(prefix=".staging-inventory-", dir=ANSIBLE) as directory:
            inventory = _write_valid_staging_fixture(Path(directory))
            for host in ("staging-pi5", "staging-pi4-kiosk01"):
                values = _inventory_host(inventory, host)
                serialized = json.dumps(values, sort_keys=True)
                if host == "staging-pi5":
                    self.assertEqual(values["ansible_host"], values["deploy_executor_host"])
                else:
                    self.assertEqual(values["deploy_executor_host"], "staging-pi5.test")
                self.assertEqual(values["ansible_user"], "stageadmin")
                self.assertNotIn(".invalid", serialized)
                self.assertNotIn("{{", serialized)
                self.assertNotIn("REPLACE_WITH", serialized)
                self.assertNotIn("__SET_", serialized)
                self.assertNotIn("talkplaza", serialized.lower())
                self.assertNotIn("/opt/RaspberryPiSystem_002/", serialized)
                self.assertNotIn("/opt/backups", serialized)
                self.assertNotIn("/var/log/caddy\"", serialized)
                self.assertNotIn("100.106.158.2", serialized)
                self.assertNotIn("100.74.144.79", serialized)
                self.assertNotIn("192.168.", serialized)
                self.assertIn("borrow_return_staging", serialized)
                self.assertIn("raspisys-staging", serialized)
                self.assertTrue(values["staging_deploy_enabled"])

    def test_launcher_print_plan_uses_exact_fixture_targets_and_no_torque_cutover(self) -> None:
        launcher = _load_standard_launcher()
        with tempfile.TemporaryDirectory(prefix=".staging-inventory-", dir=ANSIBLE) as directory:
            inventory = _write_valid_staging_fixture(Path(directory))
            relative = inventory.relative_to(ROOT).as_posix()
            commands: list[list[str]] = []

            def fake_run(command, **kwargs):
                commands.append(list(command))
                if command and command[0] == "ansible-inventory":
                    return subprocess.run(
                        command,
                        cwd=ROOT,
                        env=kwargs.get("env"),
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

            args = launcher.parse_arguments(
                [
                    "--branch",
                    "feat/assembly-procedure-overlay-editing",
                    "--inventory",
                    relative,
                    "--limit",
                    "staging-pi5:staging-pi4-kiosk01",
                    "--print-plan",
                ]
            )
            environment = os.environ.copy()
            environment["ANSIBLE_CONFIG"] = str(ANSIBLE / "ansible.cfg")
            environment["ANSIBLE_VAULT_PASSWORD_FILE"] = str(
                ANSIBLE / ".vault-pass.example"
            )
            with mock.patch.object(launcher, "resolve_sha", return_value=STANDARD_SHA), mock.patch.object(
                launcher, "config_hash", return_value="b" * 64
            ), mock.patch.object(launcher, "ansible_environment", return_value=environment), mock.patch.object(
                launcher, "run", side_effect=fake_run
            ):
                with mock.patch("sys.stdout") as stdout:
                    result = launcher.main(
                        [
                            "--branch",
                            "feat/assembly-procedure-overlay-editing",
                            "--inventory",
                            relative,
                            "--limit",
                            "staging-pi5:staging-pi4-kiosk01",
                            "--print-plan",
                        ]
                    )
            self.assertEqual(result, 0)
            plan = json.loads("".join(call.args[0] for call in stdout.write.call_args_list))
            self.assertEqual(plan["inventory"], relative)
            self.assertEqual(plan["limit"], "staging-pi5:staging-pi4-kiosk01")
            self.assertEqual(plan["remoteRoot"], "/opt/RaspberryPiSystem_002-staging")
            self.assertEqual(
                plan["executionOrder"],
                [
                    {
                        "profile": "pi5",
                        "hosts": ["staging-pi5"],
                        "images": [
                            f"ghcr.io/denkoushi/raspisys-api:{STANDARD_SHA}-bbbbbbbbbbbbbbbb",
                            f"ghcr.io/denkoushi/raspisys-web:{STANDARD_SHA}-bbbbbbbbbbbbbbbb",
                        ],
                    },
                    {
                        "profile": "pi4",
                        "hosts": ["staging-pi4-kiosk01"],
                        "images": [
                            f"ghcr.io/denkoushi/raspisys-nfc-agent:{STANDARD_SHA}",
                            f"ghcr.io/denkoushi/raspisys-barcode-agent:{STANDARD_SHA}",
                            f"ghcr.io/denkoushi/raspisys-torque-agent:{STANDARD_SHA}",
                        ],
                    },
                ],
            )
            self.assertNotIn("--torque-cutover", " ".join(" ".join(item) for item in commands))

    def test_existing_environment_files_do_not_import_staging_boundary(self) -> None:
        existing_environment_files = (
            ANSIBLE / "inventory.yml",
            ANSIBLE / "inventory-talkplaza.yml",
            ANSIBLE / "group_vars" / "all.yml",
            ANSIBLE / "group_vars" / "talkplaza.yml",
        )
        for path in existing_environment_files:
            text = path.read_text(encoding="utf-8").lower()
            self.assertNotIn("staging-pi5", text, path)
            self.assertNotIn("borrow_return_staging", text, path)
            self.assertNotIn("raspisys-staging", text, path)
            self.assertNotIn("raspi4-kiosk01", text, path)

    def test_committed_staging_vault_files_are_examples_only(self) -> None:
        for host in ("staging-pi5", "staging-pi4-kiosk01"):
            vault_dir = ANSIBLE / "host_vars" / host
            self.assertTrue((vault_dir / "vault.yml.example").is_file())
            self.assertFalse((vault_dir / "vault.yml").exists())
            example = (vault_dir / "vault.yml.example").read_text(encoding="utf-8")
            self.assertIn("REPLACE_WITH_STAGING_", example)
            self.assertIn("staging_deploy_enabled: false", example)
            self.assertIn(".example.invalid", example)

    def test_standard_release_has_a_disabled_staging_preflight(self) -> None:
        playbook = (ANSIBLE / "playbooks" / "deploy-release-standard.yml").read_text(encoding="utf-8")
        self.assertIn("- always", playbook)
        self.assertIn("staging_deploy_enabled", playbook)
        self.assertIn("before this mutation playbook can run", playbook)
        self.assertNotIn("ansible_connection: local", (ANSIBLE / "inventory-staging.yml").read_text(encoding="utf-8"))

    def test_release_contract_renderer_targets_server_group(self) -> None:
        renderer = (ROOT / "scripts" / "ci" / "render-release-build-contract.sh").read_text(encoding="utf-8")
        self.assertIn("--limit server", renderer)
        self.assertNotIn("--limit raspberrypi5", renderer)

    def test_server_compose_has_backward_compatible_defaults_and_staging_hooks(self) -> None:
        compose = (ROOT / "infrastructure" / "docker" / "docker-compose.server.yml").read_text(encoding="utf-8")
        self.assertIn("${PI5_VOLUME_PREFIX:-docker}_db-data", compose)
        self.assertIn("name: ${PI5_BASE_COMPOSE_PROJECT:-docker}", compose)
        self.assertIn("${PI5_CERTS_DIR:-/opt/RaspberryPiSystem_002/certs}:/srv/certs:ro", compose)
        self.assertIn("${PI5_CADDY_LOG_DIR:-/var/log/caddy}:/var/log/caddy", compose)
        self.assertIn("${PI5_BACKUP_DIR:-/opt/backups}:/opt/backups", compose)
        self.assertIn("${BACKUP_SSH_PRIVATE_KEY_HOST_PATH:-/opt/RaspberryPiSystem_002/secrets/backup-ssh/id_ed25519}", compose)
        self.assertIn("${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}/storage/photos", compose)
        self.assertIn("${POSTGRES_DB:-borrow_return}", compose)
        self.assertNotIn("device: /opt/RaspberryPiSystem_002/storage/", compose)


if __name__ == "__main__":
    unittest.main()
