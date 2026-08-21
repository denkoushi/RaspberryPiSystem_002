from pathlib import Path
import unittest


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
            "device: /opt/RaspberryPiSystem_002/storage/csv-dashboards",
            SERVER_COMPOSE,
        )
        self.assertIn(
            "device: /opt/RaspberryPiSystem_002/storage/.integrity",
            SERVER_COMPOSE,
        )
        self.assertIn(
            "device: /opt/RaspberryPiSystem_002/storage/"
            "part-measurement-drawings-derivatives",
            SERVER_COMPOSE,
        )
        self.assertIn(
            "device: /opt/RaspberryPiSystem_002/storage/assembly-procedure-assets",
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
        self.assertIn(
            '"{{ repo_path }}/storage/part-measurement-drawings-derivatives"',
            SERVER_ROLE,
        )
        self.assertIn(
            '"{{ repo_path }}/storage/assembly-procedure-assets"',
            SERVER_ROLE,
        )
        self.assertIn(
            '"{{ repo_path }}/storage/assembly-procedure-assets"',
            RUNTIME_PERMISSIONS,
        )

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
