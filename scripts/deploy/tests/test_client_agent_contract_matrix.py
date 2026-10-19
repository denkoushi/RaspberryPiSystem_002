"""One fail-closed matrix for all terminal client-agent integration boundaries."""
from __future__ import annotations

import importlib.util
import itertools
import json
import re
import sys
import unittest
from pathlib import Path
from types import ModuleType

import yaml
from jinja2 import Environment, StrictUndefined

from scripts.deploy.terminal_profile_registry import load_registry


ROOT = Path(__file__).resolve().parents[3]
TERMINAL_REPOSITORY = "/opt/RaspberryPiSystem_002"


def _load_script_module(name: str, path: Path) -> ModuleType:
    specification = importlib.util.spec_from_file_location(name, path)
    assert specification is not None and specification.loader is not None
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


def _compose_service_block(compose: str, service: str) -> str | None:
    match = re.search(
        rf"^  {re.escape(service)}:\n(.*?)(?=^  [a-z][a-z0-9-]*:\n|^volumes:|\Z)",
        compose,
        flags=re.MULTILINE | re.DOTALL,
    )
    return None if match is None else match.group(0)


class ClientAgentContractMatrixTest(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = load_registry()
        cls.manifest = _load_script_module(
            "client_agent_contract_runtime_manifest",
            ROOT / "scripts/deploy/terminal-runtime-manifest.py",
        )
        cls.health = _load_script_module(
            "client_agent_contract_health_probe",
            ROOT / "scripts/deploy/terminal-agent-health-probe.py",
        )
        cls.compose = (
            ROOT / "infrastructure/docker/docker-compose.client.yml"
        ).read_text(encoding="utf-8")
        cls.common_tasks = (
            ROOT / "infrastructure/ansible/roles/common/tasks/main.yml"
        ).read_text(encoding="utf-8")
        cls.client_main = (
            ROOT / "infrastructure/ansible/roles/client/tasks/main.yml"
        ).read_text(encoding="utf-8")

    def test_client_agent_hardening_defaults_to_false_in_both_roles(self) -> None:
        for role in ("client", "release_kiosk"):
            with self.subTest(role=role):
                defaults = yaml.safe_load((
                    ROOT / f"infrastructure/ansible/roles/{role}/defaults/main.yml"
                ).read_text())
                self.assertIs(defaults["client_agents_hardened"], False)

    def test_client_compose_legacy_and_least_privilege_contracts(self) -> None:
        static = yaml.safe_load(self.compose)
        environment = Environment(undefined=StrictUndefined)
        environment.filters["to_json"] = json.dumps
        environment.filters["bool"] = lambda value: str(value).lower() in {"1", "true", "yes", "on"}
        template = environment.from_string((
            ROOT / "infrastructure/ansible/roles/release_kiosk/templates/client-compose.yml.j2"
        ).read_text(encoding="utf-8"))
        legacy_mounts = {
            "nfc-agent": ["nfc-agent-data:/data", "/run/pcscd:/run/pcscd:ro"],
            "barcode-agent": None,
            "torque-agent": ["torque-agent-data:/data", "/dev/input:/dev/input",
                             "/run/torque-bluetooth-guard:/run/torque-bluetooth-guard"],
        }
        hardened_contract = {
            "nfc-agent": (["46", "104"], ["c 189:* rw", "c 13:* rw"],
                          ["nfc-agent-data:/data", "nfc-agent-data:/app/nfc-agent/data",
                           "/run/pcscd:/run/pcscd:ro",
                           "/dev/bus/usb:/dev/bus/usb:ro", "/dev/input:/dev/input:ro"]),
            "barcode-agent": (["20"], ["c 166:* rw", "c 188:* rw"], ["/dev:/dev:ro"]),
            "torque-agent": (["104"], ["c 13:* rw"],
                             ["torque-agent-data:/data", "/dev/input:/dev/input:ro",
                              "/run/torque-bluetooth-guard:/run/torque-bluetooth-guard"]),
        }
        # Every service selection in both modes, including a missing inventory
        # variable and string booleans as Ansible accepts them.
        for size in range(1, 4):
            for selected in itertools.combinations(hardened_contract, size):
                for value in (None, False, True, "false", "true"):
                    variables = {} if value is None else {"client_agents_hardened": value}
                    hardened = value is True or value == "true"
                    rendered = yaml.safe_load(template.render(
                        release_kiosk_services=selected,
                        release_kiosk_project_dir=TERMINAL_REPOSITORY,
                        release_kiosk_compose_images={name: f"fixture/{name}:test" for name in selected},
                        **variables,
                    ))
                    self.assertEqual(set(rendered["services"]), set(selected))
                    expected_volumes = {
                        name: None for name in ("nfc-agent-data", "torque-agent-data")
                        if name.removesuffix("-data") in selected
                    }
                    self.assertEqual(rendered["volumes"], expected_volumes or None)
                    for name in selected:
                        with self.subTest(service=name, selected=selected, mode=value):
                            service = rendered["services"][name]
                            reference = dict(static["services"][name])
                            reference.pop("build")
                            reference.pop("profiles", None)
                            reference["image"] = f"fixture/{name}:test"
                            reference["env_file"] = [f"{TERMINAL_REPOSITORY}/clients/{name}/.env"]
                            for key in ("image", "env_file", "network_mode", "restart", "healthcheck"):
                                self.assertEqual(service.get(key), reference.get(key))
                            self.assertNotIn("cap_add", service)
                            if hardened:
                                groups, rules, mounts = hardened_contract[name]
                                self.assertNotIn("privileged", service)
                                self.assertNotIn("devices", service)
                                self.assertEqual(service["user"], "10001:10001")
                                self.assertEqual(service["security_opt"], ["no-new-privileges:true"])
                                self.assertEqual(service["cap_drop"], ["ALL"])
                                self.assertEqual(service["group_add"], groups)
                                self.assertEqual(service["device_cgroup_rules"], rules)
                                self.assertEqual(service["volumes"], mounts)
                            else:
                                self.assertEqual(service, reference)
                                self.assertIs(service["privileged"], True)
                                self.assertEqual(service["user"], "0:0")
                                self.assertEqual(service.get("volumes"), legacy_mounts[name])
                                if name == "nfc-agent":
                                    self.assertEqual(service["devices"], ["/dev/bus/usb:/dev/bus/usb"])
                                else:
                                    self.assertNotIn("devices", service)
                                for key in ("cap_drop", "security_opt", "group_add", "device_cgroup_rules"):
                                    self.assertNotIn(key, service)

    def test_default_mode_matches_the_pre_hardening_stanzas_plus_root_user(self) -> None:
        """The static compose default must equal the previous device contract
        except for the explicit ``user: "0:0"`` that the USER 10001 images need."""
        static = yaml.safe_load(self.compose)
        previous = {
            "nfc-agent": {
                "network_mode": "host", "privileged": True,
                "devices": ["/dev/bus/usb:/dev/bus/usb"],
                "env_file": ["../../clients/nfc-agent/.env"],
                "volumes": ["nfc-agent-data:/data", "/run/pcscd:/run/pcscd:ro"],
                "restart": "unless-stopped",
            },
            "barcode-agent": {
                "network_mode": "host", "privileged": True,
                "env_file": ["../../clients/barcode-agent/.env"],
                "restart": "unless-stopped",
            },
            "torque-agent": {
                "network_mode": "host", "privileged": True,
                "env_file": ["../../clients/torque-agent/.env"],
                "volumes": ["torque-agent-data:/data", "/dev/input:/dev/input",
                            "/run/torque-bluetooth-guard:/run/torque-bluetooth-guard"],
                "restart": "unless-stopped",
            },
        }
        for name, expected in previous.items():
            with self.subTest(service=name):
                service = dict(static["services"][name])
                service.pop("build")
                service.pop("profiles", None)
                service.pop("healthcheck", None)
                self.assertEqual(service.pop("user"), "0:0")
                self.assertEqual(service, expected)

    def test_client_agent_images_run_as_dedicated_users_with_writable_data(self) -> None:
        for name in ("nfc-agent", "barcode-agent", "torque-agent"):
            with self.subTest(service=name):
                dockerfile = (ROOT / f"infrastructure/docker/Dockerfile.{name}").read_text()
                runtime = dockerfile.split("AS runtime\n", 1)[1]
                self.assertIn("groupadd --gid 10001 agent", runtime)
                self.assertIn("useradd --uid 10001 --gid 10001", runtime)
                self.assertIn("chown 10001:10001 /data", runtime)
                self.assertIn("chmod 0750 /data", runtime)
                self.assertIn("USER 10001:10001\n", runtime)
        nfc = (ROOT / "infrastructure/docker/Dockerfile.nfc-agent").read_text()
        self.assertIn("chown 10001:10001 /app/nfc-agent/data", nfc)

    def test_client_agent_contract_matrix(self) -> None:
        """Report every missing/extra integration in one actionable failure."""

        issues: list[str] = []
        agents = {agent.id: agent for agent in self.registry.client_agents}
        agent_ids = set(agents)
        if not agent_ids:
            issues.append("registry: clientAgents is empty")

        def compare_set(boundary: str, actual: set[str]) -> None:
            missing = sorted(agent_ids - actual)
            extra = sorted(actual - agent_ids)
            for agent_id in missing:
                issues.append(f"{agent_id}: missing from {boundary}")
            for agent_id in extra:
                issues.append(f"{agent_id}: extra definition in {boundary}")

        compare_set("terminal-runtime-manifest allowlist", set(self.manifest.ALLOWED_DOCKER_SERVICES))
        compare_set("terminal-agent-health-probe ports", set(self.health._AGENTS))
        compare_set("terminal-agent-health-probe port environment", set(self.health._PORT_ENVIRONMENT))
        compare_set("terminal-agent-health-probe endpoint", set(self.health._ENDPOINTS))
        compare_set("terminal-agent-health-probe response validator", set(self.health._RESPONSE_VALIDATORS))

        fixed_port_agents = {
            agent.id for agent in agents.values() if agent.port_policy == "fixed"
        }
        if set(self.health._FIXED_PORT_AGENTS) != fixed_port_agents:
            issues.append(
                "port policy: fixed agents differ between registry and health probe "
                f"(registry={sorted(fixed_port_agents)}, "
                f"probe={sorted(self.health._FIXED_PORT_AGENTS)})"
            )

        compose_services: set[str] = set()
        for agent_id, agent in sorted(agents.items()):
            compose_services.add(agent.compose_service)
            relative_env = agent.runtime_env_path.removeprefix(
                f"{TERMINAL_REPOSITORY}/"
            )
            config = (
                ROOT
                / "infrastructure/ansible/roles/client/tasks"
                / f"{agent_id}.yml"
            )
            lifecycle = config.with_name(f"{agent_id}-lifecycle.yml")
            template = ROOT / agent.env_template
            for boundary, path in (
                ("configuration task", config),
                ("lifecycle task", lifecycle),
                ("environment template", template),
            ):
                if not path.is_file():
                    issues.append(f"{agent_id}: missing {boundary}: {path.relative_to(ROOT)}")

            if self.health._AGENTS.get(agent_id) != agent.default_port:
                issues.append(
                    f"{agent_id}: default port differs between registry and health probe"
                )
            if self.health._PORT_ENVIRONMENT.get(agent_id) != agent.port_environment:
                issues.append(
                    f"{agent_id}: port environment differs between registry and health probe"
                )
            if self.health._ENDPOINTS.get(agent_id) != agent.health_endpoint:
                issues.append(
                    f"{agent_id}: health endpoint differs between registry and health probe"
                )
            if self.health._RESPONSE_VALIDATORS.get(agent_id) != agent.response_validator:
                issues.append(
                    f"{agent_id}: response validator differs between registry and health probe"
                )

            block = _compose_service_block(self.compose, agent.compose_service)
            if block is None:
                issues.append(f"{agent_id}: missing Compose service {agent.compose_service}")
            elif f"../../{relative_env}" not in block:
                issues.append(
                    f"{agent_id}: Compose service does not use {relative_env}"
                )

            if config.is_file():
                configuration = config.read_text(encoding="utf-8")
                if Path(agent.env_template).name not in configuration:
                    issues.append(
                        f"{agent_id}: configuration task does not distribute {agent.env_template}"
                    )
                if f'{{{{ repo_path }}}}/{relative_env}' not in configuration:
                    issues.append(
                        f"{agent_id}: configuration task destination differs from runtimeEnvPath"
                    )
                if "docker compose" in configuration:
                    issues.append(
                        f"{agent_id}: configuration task owns container lifecycle"
                    )

            if lifecycle.is_file():
                lifecycle_text = lifecycle.read_text(encoding="utf-8")
                if agent.compose_service not in lifecycle_text:
                    issues.append(
                        f"{agent_id}: lifecycle task does not select Compose service"
                    )
                if agent.health_endpoint not in lifecycle_text:
                    issues.append(
                        f"{agent_id}: lifecycle health check differs from registry endpoint"
                    )
                if (
                    f"default({agent.default_port})" not in lifecycle_text
                    and f":{agent.default_port}{agent.health_endpoint}" not in lifecycle_text
                ):
                    issues.append(
                        f"{agent_id}: lifecycle default port differs from registry"
                    )

            template_text = template.read_text(encoding="utf-8") if template.is_file() else ""
            if f"{agent.port_environment}=" not in template_text:
                issues.append(
                    f"{agent_id}: environment template does not define {agent.port_environment}"
                )
            if f"default({agent.default_port})" not in template_text:
                issues.append(
                    f"{agent_id}: environment template default port differs from registry"
                )

            runtime_fact = f"{agent_id.replace('-', '_')}_runtime_recreate_needed"
            classification_pattern = "^" + agent.env_template.replace(".", r"\.") + "$"
            if classification_pattern not in self.common_tasks:
                issues.append(
                    f"{agent_id}: runtime recreate classification omits {agent.env_template}"
                )
            if runtime_fact not in self.common_tasks:
                issues.append(f"{agent_id}: missing runtime recreate fact")
            if f"include_tasks: {agent_id}.yml" not in self.client_main:
                issues.append(f"{agent_id}: client role omits configuration task")
            if f"include_tasks: {agent_id}-lifecycle.yml" not in self.client_main:
                issues.append(f"{agent_id}: client role omits lifecycle task")

            for path in (
                f"clients/{agent_id}/source.py",
                agent.env_template,
                f"infrastructure/ansible/roles/client/tasks/{agent_id}.yml",
                f"infrastructure/ansible/roles/client/tasks/{agent_id}-lifecycle.yml",
                f"infrastructure/docker/Dockerfile.{agent_id}",
            ):
                if self.registry.component_for(path) != agent.component:
                    issues.append(
                        f"{agent_id}: impact mapping for {path} is not {agent.component}"
                    )

            affected_profiles = self.registry.profiles_for_components({agent.component})
            if not affected_profiles:
                issues.append(f"{agent_id}: component does not select a terminal profile")

        services_section = self.compose.split("\nvolumes:", maxsplit=1)[0]
        service_blocks = set(
            re.findall(r"^  ([a-z][a-z0-9-]*):\n", services_section, flags=re.MULTILINE)
        )
        compare_set("Compose services", service_blocks)
        if len(compose_services) != len(agent_ids):
            issues.append("registry: clientAgents reuses a Compose service name")

        if issues:
            self.fail("client-agent contract matrix drift:\n- " + "\n- ".join(sorted(issues)))


if __name__ == "__main__":
    unittest.main()
