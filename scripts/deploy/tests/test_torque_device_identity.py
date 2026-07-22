from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CLIENT_ROLE = ROOT / "infrastructure/ansible/roles/client"


class TorqueDeviceIdentityContractTests(unittest.TestCase):
    def test_controller_rule_and_helper_target_only_the_configured_usb_adapter(self) -> None:
        rule = (CLIENT_ROLE / "templates/90-torque-bluetooth-adapter.rules.j2").read_text()
        helper = (CLIENT_ROLE / "templates/torque-bluetooth-adapter.sh.j2").read_text()

        for fragment in (
            'SUBSYSTEM=="bluetooth"',
            'ENV{DEVTYPE}=="host"',
            'ATTRS{idVendor}=="{{ torque_agent_bluetooth_adapter.usb_vendor_id }}"',
            'ATTRS{idProduct}=="{{ torque_agent_bluetooth_adapter.usb_product_id }}"',
            'torque-bluetooth-adapter@%k.service',
        ):
            self.assertIn(fragment, rule)
        for fragment in (
            "^hci[0-9]+$",
            "--discover",
            "--self-test",
            "--probe",
            "expected exactly one configured external Bluetooth controller",
            "idVendor",
            "idProduct",
            '"${rfkill_device}" == "${controller_path}"',
            "run_btmgmt()",
            "torque-bluetooth operation=%s result=%s status=%s",
            "--kill-after=1",
            "cut -c1-240",
            "management info did not respond",
            "for _ in {1..3}",
            "run_btmgmt power-on",
            "for _ in {1..15}",
        ):
            self.assertIn(fragment, helper)
        self.assertNotIn("bluetoothctl", helper)
        self.assertNotIn("rfkill unblock bluetooth", helper)
        self.assertNotIn("/sys/class/bluetooth/hci1", helper)
        self.assertNotIn("2>/dev/null || true", helper)
        self.assertIn('[[ "${controller_name}" =~ ^hci[0-9]+$ ]] || continue', helper)
        discover_branch = helper.index('if [[ "${hci_name}" == \'--discover\' ]]')
        discover_exit = helper.index("exit 0", discover_branch)
        probe_branch = helper.index('if [[ "${hci_name}" == \'--probe\' ]]')
        probe_exit = helper.index("exit 0", probe_branch)
        rfkill_write = helper.index("printf '0\\n'", discover_exit)
        self.assertLess(discover_branch, discover_exit)
        self.assertLess(discover_exit, rfkill_write)
        self.assertLess(probe_branch, probe_exit)
        self.assertLess(probe_exit, rfkill_write)
        self.assertLess(rfkill_write, helper.index("run_btmgmt power-on"))

        unit = (CLIENT_ROLE / "templates/torque-bluetooth-adapter@.service.j2").read_text()
        self.assertIn("TimeoutStartSec=90", unit)
        self.assertIn("TimeoutStopSec=10", unit)

    def test_hid_rule_requires_full_wrench_identity_before_creating_by_id_link(self) -> None:
        rule = (CLIENT_ROLE / "templates/99-torque-wrench-hid.rules.j2").read_text()

        for fragment in (
            'SUBSYSTEM=="input"',
            'KERNEL=="event*"',
            'ATTRS{id/bustype}=="0005"',
            'ATTRS{id/vendor}=="{{ wrench.vendor_id }}"',
            'ATTRS{id/product}=="{{ wrench.product_id }}"',
            'ATTRS{name}=="{{ wrench.name }}"',
            'ATTRS{uniq}=="{{ wrench.uniq }}"',
            'SYMLINK+="input/by-id/{{ wrench.link_name }}"',
        ):
            self.assertIn(fragment, rule)

    def test_stonebase_inventory_uses_stable_identities_and_verified_parser(self) -> None:
        inventory = (ROOT / "infrastructure/ansible/inventory.yml").read_text()
        start = inventory.index("            raspi4-kensaku-stonebase01:")
        end = inventory.index("            raspi4-sessaku-01:", start)
        host = inventory[start:end]

        for fragment in (
            "torque_agent_enabled: true",
            'torque_agent_tls_verify_mode: "insecure"',
            'usb_vendor_id: "2357"',
            'usb_product_id: "0604"',
            'path: "/dev/input/by-id/bluetooth-TOHNICHI_702902S-event-kbd"',
            'parserProfile: "cem3-btla-hogp-v1"',
        ):
            self.assertIn(fragment, host)
        self.assertIsNone(re.search(r"/dev/input/event[0-9]+", host))
        self.assertIsNone(re.search(r"\bhci[0-9]+\b", host))

    def test_configuration_task_validates_and_installs_both_identity_adapters(self) -> None:
        tasks = (CLIENT_ROLE / "tasks/torque-agent.yml").read_text()
        for fragment in (
            "torque_agent_bluetooth_adapter.usb_vendor_id",
            "torque_agent_hid_links",
            "cem3-btla-hogp-v1",
            "torque_agent_tls_verify_mode",
            "90-torque-bluetooth-adapter.rules",
            "99-torque-wrench-hid.rules",
            "torque-bluetooth-adapter@.service",
            "udevadm control --reload-rules",
            "udevadm trigger --subsystem-match=input --property-match=ID_BUS=bluetooth --action=add",
            "Discover the exact configured torque Bluetooth controller",
            "/usr/local/libexec/torque-bluetooth-adapter --discover",
            "Prepare and synchronously verify the exact torque Bluetooth controller",
            "torque-bluetooth-adapter@{{ torque_bluetooth_controller_discovery.stdout | trim }}.service",
            "Require successful exact torque Bluetooth controller preparation",
            "ExecMainCode=1",
            "ExecMainStatus=0",
            "state: started",
            "Start exact torque Bluetooth controller preparation without interruption",
            "Read bounded exact torque Bluetooth controller journal diagnostics",
            "--lines=80 --no-pager --output=short-iso",
        ):
            self.assertIn(fragment, tasks)
        self.assertNotIn(
            "udevadm trigger --subsystem-match=bluetooth --property-match=DEVTYPE=host --action=add",
            tasks,
        )
        self.assertNotRegex(
            tasks,
            r"torque-bluetooth-adapter@\{\{[^\n]+\n\s+state: restarted",
        )
        self.assertNotIn("ExecMainCode=exited", tasks)

    def test_device_identity_files_are_in_the_sealed_rollback_contract(self) -> None:
        backend = (ROOT / "scripts/deploy/rolling_release/backends/ansible.py").read_text()
        registry = (ROOT / "scripts/deploy/terminal-profile-registry.json").read_text()
        safety = (ROOT / "scripts/deploy/tests/test-deploy-safety-contracts.sh").read_text()

        for destination in (
            "/usr/local/libexec/torque-bluetooth-adapter",
            "/usr/local/libexec/torque-bluetooth-guard",
            "/etc/systemd/system/torque-bluetooth-adapter@.service",
            "/etc/systemd/system/torque-bluetooth-guard.service",
            "/etc/udev/rules.d/90-torque-bluetooth-adapter.rules",
            "/etc/udev/rules.d/99-torque-wrench-hid.rules",
        ):
            self.assertIn(destination, backend)
            self.assertIn(destination, registry)
            self.assertIn(destination, safety)


if __name__ == "__main__":
    unittest.main()
