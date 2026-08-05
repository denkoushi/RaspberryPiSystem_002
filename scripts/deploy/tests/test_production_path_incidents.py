from __future__ import annotations

import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "scripts/deploy/production_path_incidents.py"
SPEC = importlib.util.spec_from_file_location("production_path_incidents", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
INCIDENTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INCIDENTS)

FILES = (
    "scripts/deploy/rolling_release/backends/ansible.py",
    "infrastructure/ansible/roles/server/tasks/main.yml",
    "infrastructure/docker/Dockerfile.web",
    "scripts/deploy/rolling_release/terminal_preflight.py",
    "infrastructure/ansible/roles/signage/tasks/release-preparation.yml",
    "scripts/deploy/terminal-source-bundle.py",
    "infrastructure/docker/docker-compose.phase3.yml",
    "infrastructure/docker/docker-compose.phase3.migration.yml",
    "scripts/deploy/lib/pi5-blue-green/images-evidence.sh",
    "scripts/deploy/lib/pi5-blue-green/runtime.sh",
    "scripts/deploy/terminal-runtime-manifest.py",
    "apps/web/src/layouts/KioskLayout.tsx",
)

MUTATIONS = {
    "encrypted-vault-planning": (
        "scripts/deploy/rolling_release/backends/ansible.py",
        "_read_only_inventory_context(path, runtime=runtime)",
        "_unsafe_inventory_context(path, runtime=runtime)",
    ),
    "pi5-runtime-permissions": (
        "infrastructure/ansible/roles/server/tasks/main.yml",
        "Verify existing Pi5 writable trees are ready",
        "Skip existing Pi5 writable tree verification",
    ),
    "caddy-allowlist-expansion": (
        "infrastructure/docker/Dockerfile.web",
        'elif [ -n \\"$USE_LOCAL_CERTS\\" ]; then caddy run --config /srv/Caddyfile.local.template',
        'elif [ -n \\"$USE_LOCAL_CERTS\\" ]; then envsubst < /srv/Caddyfile.local.template > /tmp/Caddyfile.local && caddy run --config /tmp/Caddyfile.local',
    ),
    "pi3-ssh-compression": (
        "scripts/deploy/rolling_release/backends/ansible.py",
        'compression = "-o Compression=yes"',
        'compression = "-o Compression=no"',
    ),
    "pi3-external-source-authority": (
        "scripts/deploy/terminal-source-bundle.py",
        '"protocol.allow=never"',
        '"protocol.allow=always"',
    ),
    "backup-ssh-bind-authority": (
        "infrastructure/docker/docker-compose.phase3.yml",
        "/run/secrets/backup-ssh/id_ed25519",
        "/run/secrets/backup-ssh/missing-id",
    ),
    "database-role-wiring": (
        "infrastructure/docker/docker-compose.phase3.yml",
        "DATABASE_URL: ${APP_DATABASE_URL:?APP_DATABASE_URL is required}",
        "DATABASE_URL: postgresql://postgres:known-default@db:5432/borrow_return",
    ),
    "derivative-storage-mount": (
        "infrastructure/docker/docker-compose.phase3.yml",
        "part-measurement-drawings-derivatives-storage:/app/storage/part-measurement-drawings-derivatives",
        "part-measurement-drawings-derivatives-storage:/app/storage/missing-derivative-mount",
    ),
    "migration-gateway-image": (
        "scripts/deploy/lib/pi5-blue-green/runtime.sh",
        "gateway_image() {",
        "missing_gateway_image() {",
    ),
    "slot-web-runtime-config": (
        "scripts/deploy/lib/pi5-blue-green/runtime.sh",
        'caddy validate --config "$config_path"',
        "caddy validate --config /srv/Caddyfile.slot",
    ),
    "kiosk-initial-deploy-status-gate": (
        "apps/web/src/layouts/KioskLayout.tsx",
        "deployStatus === undefined || deployStatus.isMaintenance",
        "deployStatus?.isMaintenance",
    ),
    "terminal-runtime-recreate-metadata": (
        "scripts/deploy/terminal-runtime-manifest.py",
        'if not key.startswith("com.docker.compose.")',
        'if key != "com.docker.compose.version"',
    ),
}


class ProductionPathIncidentMutationTest(unittest.TestCase):
    def copy_fixture(self, target: Path) -> None:
        for relative in FILES:
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)

    def test_unmodified_repository_passes_all_incident_probes(self) -> None:
        statuses = INCIDENTS.validate(ROOT)
        self.assertEqual(set(statuses), set(INCIDENTS.INCIDENT_IDS))
        self.assertTrue(all(statuses.values()))

    def test_each_historical_fault_is_detected_in_an_isolated_copy(self) -> None:
        for incident, (relative, before, after) in MUTATIONS.items():
            with self.subTest(incident=incident), tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                self.copy_fixture(root)
                path = root / relative
                original = path.read_text(encoding="utf-8")
                self.assertIn(before, original)
                path.write_text(original.replace(before, after, 1), encoding="utf-8")
                statuses = INCIDENTS.incident_status(root)
                self.assertFalse(statuses[incident], statuses)
                with self.assertRaisesRegex(ValueError, incident):
                    INCIDENTS.validate(root)


if __name__ == "__main__":
    unittest.main()
