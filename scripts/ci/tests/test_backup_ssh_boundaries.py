from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
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
BACKUP_INVENTORY_TEMPLATE = (
    ROOT / "infrastructure/ansible/templates/backup-client-inventory.yml.j2"
).read_text()
GITIGNORE = (ROOT / ".gitignore").read_text()
PLAYBOOKS_DIR = ROOT / "infrastructure/ansible/playbooks"
RESTRICTION_CHECK = (PLAYBOOKS_DIR / "check-backup-key-restriction.yml").read_text()


class BackupSshBoundaryTest(unittest.TestCase):
    def test_api_never_mounts_an_operator_ssh_directory(self):
        for compose in (SERVER_COMPOSE, PHASE3_COMPOSE, MAC_OVERRIDE):
            self.assertNotIn("/root/.ssh", compose)
            self.assertNotIn("PI5_SSH_DIR", compose)
            self.assertIn("/run/secrets/backup-ssh/id_ed25519", compose)
            self.assertIn("/run/secrets/backup-ssh/known_hosts", compose)
            self.assertIn("create_host_path: false", compose)
            self.assertNotIn("/app/host/infrastructure/ansible", compose)
            self.assertIn("/app/backup-ansible", compose)

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

    def test_dedicated_inventory_cannot_receive_application_credentials(self):
        for forbidden in ("vault_", "password", "secret", "api_key", "client_key"):
            self.assertNotIn(forbidden, BACKUP_INVENTORY_TEMPLATE.lower())
        for required in ("ansible_host", "ansible_user", "ansible_python_interpreter"):
            self.assertIn(required, BACKUP_INVENTORY_TEMPLATE)

    def test_host_backup_authority_is_never_tracked(self):
        self.assertIn("/secrets/backup-ssh/", GITIGNORE.splitlines())


class BackupKeyRestrictionCheckTest(unittest.TestCase):
    ALLOWED_MODULES = {
        "ansible.builtin.slurp",
        "ansible.builtin.stat",
        "ansible.builtin.assert",
        "ansible.builtin.set_fact",
        "ansible.builtin.debug",
        "ansible.builtin.fail",
    }

    def test_never_escalates_privileges(self):
        self.assertIsNone(re.search(r"become:\s*(true|yes)", RESTRICTION_CHECK, re.I))
        self.assertIn("become: false", RESTRICTION_CHECK)

    def test_uses_only_read_only_modules(self):
        modules = set(re.findall(r"^\s+(ansible\.builtin\.\w+):", RESTRICTION_CHECK, re.M))
        self.assertTrue(modules)
        self.assertLessEqual(modules, self.ALLOWED_MODULES)

    def test_no_public_key_literal_in_playbooks(self):
        pattern = re.compile(r"(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) AAAA")
        for path in PLAYBOOKS_DIR.rglob("*.yml"):
            self.assertIsNone(pattern.search(path.read_text()), str(path))

    def test_authorized_keys_tasks_hide_content(self):
        tasks = re.split(r"\n    - name: ", RESTRICTION_CHECK)
        read_tasks = [t for t in tasks if "slurp:" in t]
        self.assertEqual(len(read_tasks), 1)
        self.assertIn("no_log: true", read_tasks[0])
        for task in tasks:
            if "backup_key_file" in task and "set_fact:" in task:
                self.assertIn("no_log: true", task)


@unittest.skipUnless(shutil.which("ansible-playbook"), "ansible-playbook is not installed")
class BackupKeyRestrictionCheckRunTest(unittest.TestCase):
    KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyBodyForCheckOnly0123456789"

    def run_check(self, line, allowed_from=""):
        with tempfile.TemporaryDirectory() as home:
            os.makedirs(os.path.join(home, ".ssh"))
            if line is not None:
                with open(os.path.join(home, ".ssh", "authorized_keys"), "w") as f:
                    f.write(line + "\n")
            cmd = [
                "ansible-playbook", "-i", "localhost,", "-c", "local",
                "-e", "client_host=localhost",
                "-e", "backup_ssh_public_key='" + self.KEY + "'",
                "-e", "backup_key_home=" + home,
                str(PLAYBOOKS_DIR / "check-backup-key-restriction.yml"),
            ]
            if allowed_from:
                cmd[-1:-1] = ["-e", "backup_ssh_allowed_from=" + allowed_from]
            out = subprocess.run(cmd, capture_output=True, text=True).stdout
        found = re.findall(r'"msg": "localhost: ([^"]*)"', out)
        return found[-1] if found else out

    def test_restricted_line_is_ok(self):
        line = 'restrict,from="192.168.1.100,192.168.1.1" ' + self.KEY + " backup"
        self.assertEqual(self.run_check(line, "192.168.1.1"), "OK")

    def test_partial_address_does_not_match(self):
        line = 'restrict,from="192.168.1.100" ' + self.KEY + " backup"
        self.assertEqual(self.run_check(line, "192.168.1.1"), "from= does not match")

    def test_options_in_comment_are_ignored(self):
        line = self.KEY + ' restrict, from="192.168.1.1"'
        self.assertEqual(self.run_check(line), "restrict is missing, from= is missing")

    def test_missing_file(self):
        self.assertEqual(self.run_check(None), "authorized_keys is missing")


if __name__ == "__main__":
    unittest.main()
