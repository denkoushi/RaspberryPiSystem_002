"""One fail-closed matrix for all terminal client-agent integration boundaries."""
from __future__ import annotations

import importlib.util
import re
import sys
import unittest
from pathlib import Path
from types import ModuleType

from scripts.deploy.terminal_profile_registry import load_registry
from scripts.deploy.rolling_release import terminal_adapters
from scripts.deploy.rolling_release.backends import ansible


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
        compare_set("terminal adapter probes", set(terminal_adapters._AGENT_PROBES))
        compare_set("Ansible kiosk-agent order", set(ansible._KIOSK_AGENT_ORDER))

        adapter_supported = terminal_adapters.GenericSystemdAdapter.supported_health_probe_ids
        for agent_id in sorted(agent_ids - set(adapter_supported)):
            issues.append(f"{agent_id}: missing from generic-systemd supported health probes")

        marker_agents = {
            agent_id
            for agent_id in agent_ids
            if ansible._TERMINAL_AGENT_MARKER_RE.fullmatch(
                f"TERMINAL_AGENT_HEALTH_OK:{agent_id}:7071"
            )
        }
        compare_set("Ansible terminal health marker", marker_agents)

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
            for profile_id in affected_profiles:
                rollback_paths = self.registry.profile(profile_id).adapter_options.rollback_paths
                if agent.runtime_env_path not in rollback_paths:
                    issues.append(
                        f"{agent_id}: {profile_id} rollback paths omit runtimeEnvPath"
                    )

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
