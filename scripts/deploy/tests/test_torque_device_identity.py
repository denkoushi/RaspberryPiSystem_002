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
            "idVendor",
            "idProduct",
            '"${rfkill_device}" == "${controller_path}"',
            "btmgmt --index",
            "bluetoothctl show",
        ):
            self.assertIn(fragment, helper)
        self.assertNotIn("rfkill unblock bluetooth", helper)
        self.assertNotIn("/sys/class/bluetooth/hci1", helper)

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
            "90-torque-bluetooth-adapter.rules",
            "99-torque-wrench-hid.rules",
            "torque-bluetooth-adapter@.service",
            "udevadm control --reload-rules",
            "udevadm trigger --subsystem-match=bluetooth --property-match=DEVTYPE=host --action=add",
            "udevadm trigger --subsystem-match=input --property-match=ID_BUS=bluetooth --action=add",
        ):
            self.assertIn(fragment, tasks)

    def test_device_identity_files_are_in_the_sealed_rollback_contract(self) -> None:
        backend = (ROOT / "scripts/deploy/rolling_release/backends/ansible.py").read_text()
        registry = (ROOT / "scripts/deploy/terminal-profile-registry.json").read_text()
        safety = (ROOT / "scripts/deploy/tests/test-deploy-safety-contracts.sh").read_text()

        for destination in (
            "/usr/local/libexec/torque-bluetooth-adapter",
            "/etc/systemd/system/torque-bluetooth-adapter@.service",
            "/etc/udev/rules.d/90-torque-bluetooth-adapter.rules",
            "/etc/udev/rules.d/99-torque-wrench-hid.rules",
        ):
            self.assertIn(destination, backend)
            self.assertIn(destination, registry)
            self.assertIn(destination, safety)


if __name__ == "__main__":
    unittest.main()
