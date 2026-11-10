from collections import Counter
from configparser import ConfigParser
from pathlib import Path
import shlex
import unittest
from unittest.mock import patch

from jinja2 import Environment, StrictUndefined
import yaml

from scripts.deploy.rolling_release import signage_artifact_stage as stage


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"


class DeploymentSshBoundaryTest(unittest.TestCase):
    def test_ansible_configurations_check_host_keys(self):
        for name in ("ansible.cfg", "ansible-readonly.cfg"):
            config = ConfigParser()
            config.read(ANSIBLE / name)
            self.assertTrue(config.getboolean("defaults", "host_key_checking"))

    def test_deployment_connections_never_disable_host_key_checks(self):
        for path in (
            ANSIBLE / "inventory.yml",
            ANSIBLE / "ansible.cfg",
            ROOT / "scripts/deploy/rolling_release/signage_artifact_stage.py",
        ):
            source = path.read_text()
            self.assertNotIn("StrictHostKeyChecking=no", source)
            self.assertNotIn("UserKnownHostsFile=/dev/null", source)

    def test_inventory_hosts_have_exactly_one_pinned_key_and_no_extra_keys(self):
        inventory = yaml.safe_load((ANSIBLE / "inventory.yml").read_text())
        hosts = set()

        def visit(group):
            hosts.update(group.get("hosts", {}))
            for child in group.get("children", {}).values():
                visit(child)

        visit(inventory["all"])
        entries = []
        for line in (ANSIBLE / "known_hosts").read_text().splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            fields = line.split()
            self.assertGreaterEqual(len(fields), 3)
            self.assertEqual(fields[1], "ssh-ed25519")
            entries.append(fields[0])
        self.assertTrue(hosts)
        self.assertEqual(Counter(entries), Counter({host: 1 for host in hosts}))

    def test_all_hosts_inherit_the_repository_ssh_policy(self):
        inventory = yaml.safe_load((ANSIBLE / "inventory.yml").read_text())
        common_args = inventory["all"]["vars"]["ansible_ssh_common_args"]
        environment = Environment(undefined=StrictUndefined)
        environment.filters["quote"] = shlex.quote

        def visit(group):
            for host, variables in group.get("hosts", {}).items():
                self.assertNotIn("ansible_ssh_common_args", variables or {})
                rendered = environment.from_string(common_args).render(
                    inventory_dir=str(ANSIBLE), inventory_hostname=host
                )
                self.assertEqual(shlex.split(rendered), [
                    "-o", f"UserKnownHostsFile={ANSIBLE / 'known_hosts'}",
                    "-o", "GlobalKnownHostsFile=/dev/null",
                    "-o", f"HostKeyAlias={host}",
                    "-o", "StrictHostKeyChecking=yes",
                ])
            for child in group.get("children", {}).values():
                self.assertNotIn("ansible_ssh_common_args", child.get("vars", {}))
                visit(child)

        visit(inventory["all"])

    def test_signage_ssh_and_scp_use_inventory_alias_and_repository_keys(self):
        target = {
            "host": "raspberrypi3", "profile": "signage",
            "address": "100.64.0.3", "user": "pi", "port": 2222,
        }
        transport = stage.SshTargetTransport(target, stage_source="", verifier_source="")
        with patch.object(stage.subprocess, "run") as run, patch.object(transport, "_helper"):
            run.return_value.returncode = 0
            transport.copy(Path("/tmp/signage-release.tar"), stage.ARTIFACT_NAME, {
                "stagingRoot": str(stage.DEFAULT_STAGING_ROOT), "runId": "test-run",
            })
        for command in (transport._ssh_prefix(), run.call_args.args[0]):
            for option in (
                f"UserKnownHostsFile={ANSIBLE / 'known_hosts'}",
                "GlobalKnownHostsFile=/dev/null",
                "HostKeyAlias=raspberrypi3", "StrictHostKeyChecking=yes",
            ):
                self.assertIn(option, command)
                self.assertEqual(command[command.index(option) - 1], "-o")
            self.assertNotIn("HostKeyAlias=100.64.0.3", command)

    def test_tailscale_install_uses_a_signed_apt_repository_only_when_missing(self):
        source = (ANSIBLE / "roles/common/tasks/tailscale.yml").read_text()
        self.assertNotIn("| sh", source)
        tasks = yaml.safe_load(source)
        install = next(task for task in tasks if "block" in task)
        self.assertEqual(install["when"], "tailscaled_version.rc != 0")
        block = install["block"]
        self.assertFalse(any("ansible.builtin.shell" in task for task in block))
        key = next(task["ansible.builtin.get_url"] for task in block if "ansible.builtin.get_url" in task)
        repo = next(task["ansible.builtin.apt_repository"]["repo"] for task in block if "ansible.builtin.apt_repository" in task)
        self.assertTrue(key["url"].startswith("https://pkgs.tailscale.com/stable/"))
        self.assertIn("{{ ansible_distribution_release }}", key["url"])
        self.assertIn("tailscale_keyring_sha256", key["checksum"])
        self.assertIn(f"signed-by={key['dest']}", repo)
        self.assertIn("{{ ansible_distribution_release }}", repo)
        self.assertTrue(any(task.get("ansible.builtin.apt", {}).get("name") == "tailscale" for task in block))
