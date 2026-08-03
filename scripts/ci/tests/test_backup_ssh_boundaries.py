from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
SERVER_COMPOSE = (ROOT / "infrastructure/docker/docker-compose.server.yml").read_text()
PHASE3_COMPOSE = (ROOT / "infrastructure/docker/docker-compose.phase3.yml").read_text()
MAC_OVERRIDE = (
    ROOT / "infrastructure/docker/docker-compose.mac-local.override.yml"
).read_text()
SSH_POLICY = (
    ROOT / "apps/api/src/services/backup/backup-ssh-policy.ts"
).read_text()
CATALOG = (
    ROOT / "apps/api/src/services/backup/backup-recommended-targets.catalog.ts"
).read_text()


class BackupSshBoundaryTest(unittest.TestCase):
    def test_api_never_mounts_an_operator_ssh_directory(self):
        for compose in (SERVER_COMPOSE, PHASE3_COMPOSE, MAC_OVERRIDE):
            self.assertNotIn("/root/.ssh", compose)
            self.assertNotIn("PI5_SSH_DIR", compose)
            self.assertIn("/run/secrets/backup-ssh/id_ed25519", compose)
            self.assertIn("/run/secrets/backup-ssh/known_hosts", compose)
            self.assertIn("create_host_path: false", compose)

    def test_backup_transport_pins_hosts_and_one_identity(self):
        for required in (
            "StrictHostKeyChecking=yes",
            "IdentitiesOnly=yes",
            "UserKnownHostsFile=",
            "--private-key",
        ):
            self.assertIn(required, SSH_POLICY)
        self.assertNotIn("StrictHostKeyChecking=no", SSH_POLICY)

    def test_private_ssh_directories_are_not_recommended_backup_targets(self):
        self.assertNotIn("sshHomeUser", CATALOG)
        self.assertNotIn("/.ssh", CATALOG)


if __name__ == "__main__":
    unittest.main()
