from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[3]
SERVER_COMPOSE = (ROOT / "infrastructure/docker/docker-compose.server.yml").read_text()
PHASE3_COMPOSE = (ROOT / "infrastructure/docker/docker-compose.phase3.yml").read_text()
MAC_OVERRIDE = (
    ROOT / "infrastructure/docker/docker-compose.mac-local.override.yml"
).read_text()
API_ENV = (ROOT / "infrastructure/ansible/templates/api.env.j2").read_text()
SERVER_ROLE = (
    ROOT / "infrastructure/ansible/roles/server/tasks/main.yml"
).read_text()
STORAGE_ROLE = (
    ROOT / "infrastructure/ansible/roles/pi5_storage/tasks/main.yml"
).read_text()
STORAGE_CONTRACT = yaml.safe_load(
    (ROOT / "infrastructure/ansible/vars/pi5-storage-contract.yml").read_text()
)["pi5_phase3_storage_contract"]
SERVER_MODEL = yaml.safe_load(
    (ROOT / "infrastructure/docker/docker-compose.server.yml").read_text()
)
PHASE3_MODEL = yaml.safe_load(
    (ROOT / "infrastructure/docker/docker-compose.phase3.yml").read_text()
)
RELEASE_PREPARE = (
    ROOT / "infrastructure/ansible/roles/release_pi5/tasks/prepare.yml"
).read_text()
RELEASE_PREFETCH = (
    ROOT / "infrastructure/ansible/roles/release_pi5/tasks/prefetch.yml"
).read_text()
RELEASE_STORAGE_PREPARE = (
    ROOT / "infrastructure/ansible/roles/release_pi5/tasks/prepare-storage.yml"
).read_text()
VOLUME_MATERIALIZER = (
    ROOT / "scripts/deploy/pi5_volume_materializer.py"
).read_text()
BACKUP_SCRIPT = (ROOT / "scripts/server/backup.sh").read_text()
RUNTIME_PERMISSIONS = (
    ROOT / "infrastructure/ansible/playbooks/prepare-pi5-runtime-permissions.yml"
).read_text()


class FileStorageContractTest(unittest.TestCase):
    def test_server_compose_mounts_catalog_and_csv_on_the_existing_host_root(self):
        self.assertIn("FILE_STORAGE_ROOT: /app/storage", SERVER_COMPOSE)
        self.assertIn(
            "csv-dashboard-storage:/app/storage/csv-dashboards", SERVER_COMPOSE
        )
        self.assertIn(
            "file-integrity-storage:/app/storage/.integrity", SERVER_COMPOSE
        )
        self.assertIn(
            "part-measurement-drawings-derivatives-storage:"
            "/app/storage/part-measurement-drawings-derivatives",
            SERVER_COMPOSE,
        )
        self.assertIn(
            "assembly-procedure-assets-storage:/app/storage/assembly-procedure-assets",
            SERVER_COMPOSE,
        )
        self.assertIn(
            "device: ${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}/storage/csv-dashboards",
            SERVER_COMPOSE,
        )
        self.assertIn(
            "device: ${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}/storage/.integrity",
            SERVER_COMPOSE,
        )
        self.assertIn(
            "device: ${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}/storage/"
            "part-measurement-drawings-derivatives",
            SERVER_COMPOSE,
        )
        self.assertIn(
            "device: ${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}/storage/assembly-procedure-assets",
            SERVER_COMPOSE,
        )

    def test_blue_green_and_mac_overlays_keep_the_same_storage_boundaries(self):
        for value in (
            "csv-dashboard-storage:/app/storage/csv-dashboards",
            "file-integrity-storage:/app/storage/.integrity",
            "part-measurement-drawings-derivatives-storage:"
            "/app/storage/part-measurement-drawings-derivatives",
            "assembly-procedure-assets-storage:/app/storage/assembly-procedure-assets",
        ):
            self.assertIn(value, PHASE3_COMPOSE)
        self.assertIn(
            "name: ${PI5_VOLUME_PREFIX:-docker}_"
            "part-measurement-drawings-derivatives-storage",
            PHASE3_COMPOSE,
        )
        self.assertIn(
            "../../.docker/local/storage/csv-dashboards:/app/storage/csv-dashboards",
            MAC_OVERRIDE,
        )
        self.assertIn(
            "../../.docker/local/storage/.integrity:/app/storage/.integrity",
            MAC_OVERRIDE,
        )
        self.assertIn(
            "../../.docker/local/storage/part-measurement-drawings-derivatives:"
            "/app/storage/part-measurement-drawings-derivatives",
            MAC_OVERRIDE,
        )
        self.assertIn(
            "../../.docker/local/storage/assembly-procedure-assets:"
            "/app/storage/assembly-procedure-assets",
            MAC_OVERRIDE,
        )

    def test_ansible_creates_the_derivative_cache_bind_source(self):
        self.assertIn("name: pi5_storage", SERVER_ROLE)
        self.assertIn("pi5_phase3_storage_contract", STORAGE_ROLE)
        self.assertIn("{{ pi5_storage_root }}/{{ item.suffix }}", STORAGE_ROLE)
        self.assertIn("pi5_phase3_storage_contract", RUNTIME_PERMISSIONS)

    def test_phase3_server_and_ansible_share_the_complete_storage_contract(self):
        expected_keys = {entry["logical_key"] for entry in STORAGE_CONTRACT}
        phase3_external = {
            key
            for key, value in PHASE3_MODEL["volumes"].items()
            if value.get("external") is True
        }
        self.assertEqual(phase3_external, expected_keys)
        self.assertEqual(
            {entry["logical_key"] for entry in STORAGE_CONTRACT},
            {key for key in SERVER_MODEL["volumes"] if key in expected_keys},
        )
        self.assertEqual(len(STORAGE_CONTRACT), 14)
        for entry in STORAGE_CONTRACT:
            key = entry["logical_key"]
            server_volume = SERVER_MODEL["volumes"][key]
            self.assertEqual(server_volume["driver"], "local")
            self.assertEqual(server_volume["driver_opts"]["type"], "none")
            self.assertEqual(server_volume["driver_opts"]["o"], "bind")
            self.assertTrue(
                server_volume["driver_opts"]["device"].endswith(
                    f"/storage/{entry['suffix']}"
                )
            )
            self.assertIn(
                f"{key}:/app/storage/{entry['suffix']}",
                PHASE3_COMPOSE,
            )

    def test_storage_preparation_is_shared_with_torque_and_normal_routes(self):
        self.assertIn("name: pi5_storage", RELEASE_STORAGE_PREPARE)
        self.assertIn("pi5_storage_manage_existing: false", RELEASE_STORAGE_PREPARE)
        self.assertIn("Materialize and validate all phase3 external durable volumes", RELEASE_STORAGE_PREPARE)
        self.assertIn("release_pi5_storage_prepared_run_id: \"{{ release_run_id }}\"", RELEASE_STORAGE_PREPARE)
        self.assertIn("include_tasks: prepare-storage.yml", RELEASE_PREFETCH)
        self.assertIn("include_tasks: prepare-storage.yml", RELEASE_PREPARE)
        self.assertIn("(release_pi5_storage_prepared_run_id | default('')) != release_run_id", RELEASE_PREPARE)
        self.assertNotIn("name: pi5_storage", RELEASE_PREFETCH)
        self.assertNotIn("release_pi5_volume_materialization", RELEASE_PREFETCH)
        self.assertNotIn("name: pi5_storage", RELEASE_PREPARE)
        self.assertNotIn("release_pi5_volume_materialization", RELEASE_PREPARE)
        self.assertIn("Validate the full set before creating any missing volume", VOLUME_MATERIALIZER)

    def test_overlay_storage_is_in_backup_and_integrity_boundaries(self):
        for source in (
            "/app/storage/assembly-procedure-images",
            "/app/storage/assembly-procedure-assets",
            "/app/storage/.integrity",
        ):
            self.assertIn(source, BACKUP_SCRIPT)

    def test_work_instruction_originals_are_durable_and_recoverable(self):
        suffix = "work-instruction-assets"
        runtime_path = f"/app/storage/{suffix}"
        for compose in (SERVER_COMPOSE, PHASE3_COMPOSE):
            self.assertIn(f"{suffix}-storage:{runtime_path}", compose)
        self.assertIn(f"../../.docker/local/storage/{suffix}:{runtime_path}", MAC_OVERRIDE)
        self.assertIn(runtime_path, BACKUP_SCRIPT)
        for relative_path in (
            "infrastructure/docker/Dockerfile.api",
            "scripts/ci/rehearse-release-runtime.sh",
            "apps/api/src/services/backup/backup-recommended-targets.catalog.ts",
            "apps/api/src/services/backup/backup-target-templates.ts",
        ):
            self.assertIn(runtime_path, (ROOT / relative_path).read_text())
        for relative_path in (
            "scripts/server/backup-encrypted.sh",
            "scripts/google_drive_dr/source_policy.py",
            "apps/api/src/services/file-storage/file-storage-config.ts",
            "infrastructure/ansible/roles/server/tasks/main.yml",
        ):
            self.assertIn(suffix, (ROOT / relative_path).read_text())

    def test_ansible_environment_uses_one_canonical_root_and_consistent_aliases(self):
        for value in (
            "FILE_STORAGE_ROOT={{ api_file_storage_root | default('/app/storage') }}",
            "PHOTO_STORAGE_DIR={{ api_photo_storage_dir | default('/app/storage') }}",
            "PDF_STORAGE_DIR={{ api_pdf_storage_dir | default('/app/storage') }}",
            "CSV_DASHBOARD_STORAGE_DIR={{ api_csv_dashboard_storage_dir | default('/app/storage') }}",
            "SIGNAGE_RENDER_DIR={{ api_signage_render_dir | default('/app/storage/signage-rendered') }}",
        ):
            self.assertIn(value, API_ENV)


if __name__ == "__main__":
    unittest.main()
