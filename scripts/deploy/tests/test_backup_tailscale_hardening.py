import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from jinja2 import Environment
import yaml


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"


class BackupTailscaleHardeningTests(unittest.TestCase):
    def test_backup_archive_is_private_and_cleanup_is_always(self):
        play = yaml.safe_load((ANSIBLE / "playbooks/backup-client-directory.yml").read_text())[0]
        block = play["tasks"][1]
        create, archive, archive_failure, fetch, fetch_failure = block["block"]
        cleanup, = block["always"]
        self.assertEqual(archive_failure["when"], "archive_result.failed | default(true)")
        self.assertEqual(fetch_failure["when"], "fetch_result.failed | default(true)")
        archive_source = fetch["ansible.builtin.fetch"]["src"]
        self.assertTrue(create["become"])
        self.assertEqual(create["ansible.builtin.file"], {
            "path": archive_source, "state": "touch", "mode": "0600", "owner": "root",
        })
        self.assertEqual(cleanup["ansible.builtin.file"], {
            "path": archive_source, "state": "absent",
        })
        self.assertEqual(fetch["ansible.builtin.fetch"]["dest"], (
            "{{ backup_destination }}/{{ inventory_hostname }}_{{ client_dir_path | basename }}.tar.gz"
        ))
        self.assertNotIn("ansible.builtin.shell", archive)
        self.assertTrue(archive["become"])
        argv = archive["ansible.builtin.command"]["argv"]
        self.assertEqual(argv, [
            "tar", "--create", "--gzip", "--file", archive_source,
            "--directory", "{{ client_dir_path | dirname }}", "{{ client_dir_path | basename }}",
        ])
        environment = Environment()
        environment.filters.update(basename=lambda p: Path(p).name,
                                   dirname=lambda p: str(Path(p).parent))
        with tempfile.TemporaryDirectory() as directory:
            temporary_path = Path(directory)
            source = temporary_path / "directory with spaces"
            source.mkdir()
            (source / "data").write_text("fixture")
            args = [environment.from_string(argument).render(
                inventory_hostname="fixture", client_dir_path=str(source)
            ) for argument in argv]
            archive_path = temporary_path / "archive.tar.gz"
            args[args.index("--file") + 1] = str(archive_path)
            # Model the file task's creation mode without requiring root locally.
            descriptor = os.open(archive_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
            self.assertEqual(archive_path.stat().st_mode & 0o777, 0o600)
            subprocess.run(args, check=True)
            self.assertGreater(archive_path.stat().st_size, 0)
            self.assertEqual(archive_path.stat().st_mode & 0o777, 0o600)

    def test_tailscale_auth_file_tasks_keep_existing_conditions(self):
        tasks = yaml.safe_load((ANSIBLE / "roles/common/tasks/tailscale.yml").read_text())
        block = next(task for task in tasks if "always" in task)
        self.assertEqual(block["when"], [
            "(tailscale_connected | default(false)) | bool == false",
            "tailscale_effective_auth_key | default('') | length > 0",
        ])
        environment = Environment()
        environment.filters["bool"] = bool
        for connected, key, expected in (
            (False, None, False), (False, "", False), (True, "fixture", False),
            (False, "fixture", True),
        ):
            with self.subTest(connected=connected, key=key):
                variables = {"tailscale_connected": connected}
                if key is not None:
                    variables["tailscale_effective_auth_key"] = key
                self.assertEqual(all(environment.compile_expression(condition)(**variables)
                                     for condition in block["when"]), expected)
        self.assertTrue(block["become"])
        self.assertTrue(block["no_log"])
        create, write, authenticate = block["block"]
        self.assertEqual(create["ansible.builtin.tempfile"]["state"], "file")
        self.assertEqual(write["ansible.builtin.copy"], {
            "content": "{{ tailscale_effective_auth_key }}",
            "dest": "{{ tailscale_auth_key_file.path }}",
            "owner": "root", "group": "root", "mode": "0600",
        })
        self.assertEqual(authenticate["ansible.builtin.command"], (
            "tailscale up {{ tailscale_extra_args }} "
            "--auth-key=file:{{ tailscale_auth_key_file.path }}"
        ))
        cleanup, = block["always"]
        self.assertEqual(cleanup["ansible.builtin.file"], {
            "path": "{{ tailscale_auth_key_file.path }}", "state": "absent",
        })
        self.assertEqual(cleanup["when"], "tailscale_auth_key_file.path is defined")


if __name__ == "__main__":
    unittest.main()
