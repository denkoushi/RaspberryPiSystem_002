from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure" / "ansible"


class StagingInventoryBoundaryTest(unittest.TestCase):
    def test_staging_has_only_placeholder_hosts_and_dedicated_runtime_names(self) -> None:
        inventory = (ANSIBLE / "inventory-staging.yml").read_text(encoding="utf-8")
        variables = (ANSIBLE / "group_vars" / "staging.yml").read_text(encoding="utf-8")
        self.assertIn("staging-pi5:", inventory)
        self.assertIn("staging-pi4-kiosk01:", inventory)
        self.assertIn('deploy_executor_host: "{{ staging_pi5_host }}"', inventory)
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

    def test_staging_does_not_reference_production_or_talkplaza_values(self) -> None:
        variables = (ANSIBLE / "group_vars" / "staging.yml").read_text(encoding="utf-8")
        inventory = (ANSIBLE / "inventory-staging.yml").read_text(encoding="utf-8")
        for text in (variables, inventory):
            self.assertNotIn("raspberrypi5", text)
            self.assertNotIn("raspi4-assembly-01", text)
            self.assertNotIn("talkplaza", text.lower())
            self.assertNotIn("100.", text)
            self.assertNotIn("192.168.", text)
        self.assertNotIn("/opt/RaspberryPiSystem_002/", variables)
        self.assertNotIn("borrow_return\n", variables)

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
