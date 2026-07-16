import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.terminal_profile_registry import (
    DEFAULT_REGISTRY_PATH,
    RegistryError,
    load_registry,
)
from scripts.deploy.rolling_release.backends import ansible as legacy_ansible


class TerminalProfileRegistryTest(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads(DEFAULT_REGISTRY_PATH.read_text(encoding="utf-8"))

    def load_payload(self, payload=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        playbook = root / "infrastructure/ansible/playbooks/deploy-staged.yml"
        playbook.parent.mkdir(parents=True)
        playbook.write_text("---\n", encoding="utf-8")
        registry_path = root / "registry.json"
        registry_path.write_text(
            json.dumps(self.payload if payload is None else payload),
            encoding="utf-8",
        )
        return load_registry(registry_path, repository_root=root)

    def test_production_registry_contains_only_kiosk_and_signage(self):
        registry = load_registry()

        self.assertEqual(registry.schema_version, 1)
        self.assertEqual(registry.profile_ids, ("kiosk", "signage"))
        self.assertEqual(registry.pi5_control_plane.inventory_group, "server")
        self.assertEqual(registry.pi5_control_plane.required_host_count, 1)
        kiosk = registry.profile("kiosk")
        signage = registry.profile("signage")
        self.assertEqual(kiosk.adapter_id, "generic-systemd")
        self.assertEqual(kiosk.notice_seconds, 60)
        self.assertEqual(kiosk.approval_policy, "human")
        self.assertEqual(signage.adapter_id, "signage-systemd")
        self.assertEqual(signage.notice_seconds, 0)
        self.assertEqual(signage.approval_policy, "health-only")
        self.assertEqual(
            registry.profiles_for_components({"status-agent"}),
            ["kiosk", "signage"],
        )

    def test_profile_order_is_deterministic(self):
        self.payload["terminalProfiles"].reverse()
        registry = self.load_payload()

        self.assertEqual(registry.profile_ids, ("kiosk", "signage"))

    def test_production_runtime_options_match_the_existing_sealed_contract(self):
        registry = load_registry()

        kiosk = registry.profile("kiosk").adapter_options
        self.assertEqual(
            kiosk.systemd_units,
            legacy_ansible._COMMON_RUNTIME_UNITS
            + legacy_ansible._KIOSK_RUNTIME_UNITS,
        )
        self.assertEqual(
            kiosk.rollback_paths,
            legacy_ansible._COMMON_TERMINAL_PATHS
            + legacy_ansible._KIOSK_TERMINAL_PATHS,
        )
        signage = registry.profile("signage").adapter_options
        self.assertEqual(
            signage.systemd_units,
            legacy_ansible._COMMON_RUNTIME_UNITS
            + legacy_ansible._SIGNAGE_RUNTIME_UNITS,
        )
        self.assertEqual(
            signage.rollback_paths,
            legacy_ansible._COMMON_TERMINAL_PATHS
            + legacy_ansible._SIGNAGE_TERMINAL_PATHS,
        )

    def test_synthetic_profile_and_unique_adapter_need_only_registry_data(self):
        synthetic = copy.deepcopy(self.payload["terminalProfiles"][0])
        synthetic.update(
            {
                "id": "synthetic-fourth",
                "inventoryGroup": "synthetic_fourth",
                "rolloutOrder": 30,
                "impactComponent": "synthetic-runtime",
                "adapterId": "unique-terminal",
                "canaryGroup": "synthetic_fourth_canary",
                "approvalPolicy": "health-only",
            }
        )
        self.payload["terminalProfiles"].append(synthetic)
        self.payload["pathMappings"].append(
            {
                "match": "prefix",
                "path": "clients/synthetic-fourth/",
                "component": "synthetic-runtime",
            }
        )
        self.payload["componentProfiles"]["synthetic-runtime"] = [
            "synthetic-fourth"
        ]
        self.payload["componentProfiles"]["global"].append("synthetic-fourth")

        registry = self.load_payload()

        self.assertEqual(
            registry.profile_ids, ("kiosk", "signage", "synthetic-fourth")
        )
        self.assertEqual(
            registry.component_for("clients/synthetic-fourth/main.py"),
            "synthetic-runtime",
        )
        self.assertEqual(
            registry.profiles_for_components({"synthetic-runtime"}),
            ["synthetic-fourth"],
        )
        self.assertEqual(
            registry.profile("synthetic-fourth").adapter_id, "unique-terminal"
        )

    def test_duplicate_json_key_is_rejected(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        registry_path = root / "registry.json"
        registry_path.write_text(
            '{"schemaVersion": 1, "schemaVersion": 1}', encoding="utf-8"
        )

        with self.assertRaisesRegex(RegistryError, "duplicate key: schemaVersion"):
            load_registry(registry_path, repository_root=root)

    def test_unknown_top_level_profile_and_adapter_option_fields_are_rejected(self):
        cases = []
        top = copy.deepcopy(self.payload)
        top["command"] = "true"
        cases.append((top, "unknown command"))
        profile = copy.deepcopy(self.payload)
        profile["terminalProfiles"][0]["importPath"] = "package.module"
        cases.append((profile, "unknown importPath"))
        options = copy.deepcopy(self.payload)
        options["terminalProfiles"][0]["adapterOptions"]["shell"] = "true"
        cases.append((options, "unknown shell"))

        for payload, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(RegistryError, message):
                    self.load_payload(payload)

    def test_unsafe_identifiers_are_rejected(self):
        cases = (
            ("id", "kiosk; reboot", "safe lowercase identifier"),
            ("id", "server", "reserved"),
            ("inventoryGroup", "server", "reserved"),
            ("adapterId", "package.module", "safe lowercase identifier"),
        )
        for field, value, message in cases:
            with self.subTest(field=field, value=value):
                payload = copy.deepcopy(self.payload)
                payload["terminalProfiles"][0][field] = value
                with self.assertRaisesRegex(RegistryError, message):
                    self.load_payload(payload)

    def test_pi5_control_plane_is_fixed(self):
        for field, value in (
            ("id", "pi4"),
            ("inventoryGroup", "servers"),
            ("adapterId", "generic-systemd"),
            ("requiredHostCount", 2),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(self.payload)
                payload["pi5ControlPlane"][field] = value
                with self.assertRaises(RegistryError):
                    self.load_payload(payload)

    def test_playbook_must_be_existing_yaml_below_ansible_root(self):
        for value in (
            "../../outside.yml",
            "/tmp/deploy.yml",
            "playbooks/missing.yml",
            "playbooks/deploy-staged.sh",
            "playbooks/deploy-staged.yml; reboot",
        ):
            with self.subTest(value=value):
                payload = copy.deepcopy(self.payload)
                payload["terminalProfiles"][0]["playbook"] = value
                with self.assertRaises(RegistryError):
                    self.load_payload(payload)

    def test_systemd_units_and_rollback_paths_are_strict(self):
        cases = (
            (
                "systemdUnits",
                ["../../evil.service"],
                "safe explicit systemd unit",
            ),
            ("systemdUnits", ["kiosk-browser"], "safe explicit systemd unit"),
            ("rollbackPaths", ["/etc/passwd;reboot"], "allowlisted absolute path"),
            (
                "rollbackPaths",
                ["/root/.ssh/authorized_keys"],
                "allowlisted absolute path",
            ),
            ("rollbackPaths", ["/etc/passwd"], "allowlisted absolute path"),
            ("rollbackPaths", ["/usr/bin/bash"], "allowlisted absolute path"),
            ("rollbackPaths", ["/etc/../root/secret"], "allowlisted absolute path"),
        )
        for field, value, message in cases:
            with self.subTest(field=field, value=value):
                payload = copy.deepcopy(self.payload)
                payload["terminalProfiles"][0]["adapterOptions"][field] = value
                with self.assertRaisesRegex(RegistryError, message):
                    self.load_payload(payload)

    def test_profile_identity_and_order_fields_are_unique(self):
        fields = ("id", "inventoryGroup", "canaryGroup", "rolloutOrder")
        for field in fields:
            with self.subTest(field=field):
                payload = copy.deepcopy(self.payload)
                payload["terminalProfiles"][1][field] = payload[
                    "terminalProfiles"
                ][0][field]
                with self.assertRaisesRegex(RegistryError, "must be unique"):
                    self.load_payload(payload)

    def test_profile_policy_and_bounded_integer_fields_are_strict(self):
        cases = (
            ("approvalPolicy", "automatic"),
            ("approvalPolicy", ["human"]),
            ("noticeSeconds", True),
            ("noticeSeconds", 3601),
            ("rolloutOrder", 0),
        )
        for field, value in cases:
            with self.subTest(field=field, value=value):
                payload = copy.deepcopy(self.payload)
                payload["terminalProfiles"][0][field] = value
                with self.assertRaises(RegistryError):
                    self.load_payload(payload)

    def test_path_mappings_are_normalized_unique_and_non_executable(self):
        cases = (
            {"match": "glob", "path": "clients/*", "component": "kiosk-role"},
            {"match": ["prefix"], "path": "clients/new/", "component": "kiosk-role"},
            {"match": "prefix", "path": "../outside/", "component": "kiosk-role"},
            {"match": "exact", "path": "/etc/passwd", "component": "kiosk-role"},
            {"match": "prefix", "path": "clients/[abc]/", "component": "kiosk-role"},
            {"match": "prefix", "path": "clients/new/", "component": "unknown"},
        )
        for mapping in cases:
            with self.subTest(mapping=mapping):
                payload = copy.deepcopy(self.payload)
                payload["pathMappings"].append(mapping)
                with self.assertRaises(RegistryError):
                    self.load_payload(payload)

        duplicate = copy.deepcopy(self.payload)
        duplicate["pathMappings"].append(copy.deepcopy(duplicate["pathMappings"][0]))
        with self.assertRaisesRegex(RegistryError, "duplicate match/path"):
            self.load_payload(duplicate)

        shadowed = copy.deepcopy(self.payload)
        migration_index = next(
            index
            for index, mapping in enumerate(shadowed["pathMappings"])
            if mapping["component"] == "migration"
        )
        api_index = next(
            index
            for index, mapping in enumerate(shadowed["pathMappings"])
            if mapping["path"] == "apps/api/"
        )
        migration_mapping = shadowed["pathMappings"][migration_index]
        shadowed["pathMappings"][migration_index] = shadowed["pathMappings"][api_index]
        shadowed["pathMappings"][api_index] = migration_mapping
        with self.assertRaisesRegex(RegistryError, "shadowed by an earlier prefix"):
            self.load_payload(shadowed)

    def test_component_profile_references_and_safety_components_are_strict(self):
        unknown = copy.deepcopy(self.payload)
        unknown["componentProfiles"]["status-agent"].append("not-registered")
        with self.assertRaisesRegex(RegistryError, "unknown profiles"):
            self.load_payload(unknown)

        global_incomplete = copy.deepcopy(self.payload)
        global_incomplete["componentProfiles"]["global"] = ["kiosk"]
        with self.assertRaisesRegex(RegistryError, "global must target every"):
            self.load_payload(global_incomplete)

        control_targets_runtime = copy.deepcopy(self.payload)
        control_targets_runtime["componentProfiles"]["deploy-control"] = ["kiosk"]
        with self.assertRaisesRegex(RegistryError, "must not target terminals"):
            self.load_payload(control_targets_runtime)

        missing_self = copy.deepcopy(self.payload)
        missing_self["componentProfiles"]["kiosk-role"] = []
        with self.assertRaisesRegex(RegistryError, "does not target itself"):
            self.load_payload(missing_self)

    def test_unsupported_schema_and_duplicate_profile_options_are_rejected(self):
        schema = copy.deepcopy(self.payload)
        schema["schemaVersion"] = 2
        with self.assertRaisesRegex(RegistryError, "schemaVersion"):
            self.load_payload(schema)

        duplicate_unit = copy.deepcopy(self.payload)
        duplicate_unit["terminalProfiles"][0]["adapterOptions"]["systemdUnits"] = [
            "status-agent.service",
            "status-agent.service",
        ]
        with self.assertRaisesRegex(RegistryError, "duplicate entries"):
            self.load_payload(duplicate_unit)


if __name__ == "__main__":
    unittest.main()
