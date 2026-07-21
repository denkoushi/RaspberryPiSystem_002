"""Executable terminal-profile adapters.

The coordinator owns ordering and durable state transitions.  An adapter owns
the terminal-specific operations inside each transition: rollback authority,
notice and maintenance preparation, profile playbook application, health and
ready evidence, exact restoration, and final display cleanup.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, ClassVar

from .activation import (
    ActivationUncertainError,
    KIOSK_WEB_ACTIVATION_STRATEGY,
    KIOSK_WEB_MIGRATION_MODE,
)
from .release_claims import ClaimAuthority, ClaimKind

try:
    from terminal_profile_registry import TerminalProfile
except ImportError:  # Repository-root package imports used by contract tests.
    from scripts.deploy.terminal_profile_registry import TerminalProfile


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_COMMON_RUNTIME_UNITS = frozenset(
    {
        "lightdm.service",
        "status-agent.service",
        "status-agent.timer",
        "haizen-agent.service",
    }
)
_AGENT_PROBES = ("nfc-agent", "barcode-agent", "torque-agent")
_TERMINAL_REPOSITORY = "/opt/RaspberryPiSystem_002"
_CLIENT_COMPOSE_PROJECT = "docker"
_CLIENT_COMPOSE_DIRECTORY = f"{_TERMINAL_REPOSITORY}/infrastructure/docker"
_CLIENT_COMPOSE_FILES = (
    f"{_CLIENT_COMPOSE_DIRECTORY}/docker-compose.client.yml",
)


@dataclass(frozen=True)
class TerminalRuntimeManifestContract:
    """Secret-free, adapter-owned runtime capture/probe configuration."""

    systemd_units: tuple[str, ...]
    docker_services: tuple[str, ...]
    restart_on_restore_units: tuple[str, ...]
    compose_project: str | None
    compose_working_directory: str | None
    compose_config_files: tuple[str, ...]

    def as_preflight_payload(self) -> dict[str, Any]:
        compose = None
        if self.docker_services:
            compose = {
                "project": self.compose_project,
                "workingDirectory": self.compose_working_directory,
                "configFiles": list(self.compose_config_files),
            }
        return {
            "systemdUnits": list(self.systemd_units),
            "dockerServices": list(self.docker_services),
            "restartOnRestoreUnits": list(self.restart_on_restore_units),
            "compose": compose,
        }


def _verified_control_plane_sha(records: Any, *, qualifier: str) -> str:
    servers = [
        record
        for record in records
        if isinstance(record, dict) and record.get("role") == "server"
    ]
    if len(servers) != 1:
        raise RuntimeError(f"{qualifier} has no unique Pi5 release authority")
    expected = servers[0].get("currentSha")
    if (
        servers[0].get("evidence") != "verified"
        or not isinstance(expected, str)
        or FULL_SHA_RE.fullmatch(expected) is None
    ):
        raise RuntimeError(f"{qualifier} has no verified Pi5 Web release")
    return expected


@dataclass(frozen=True)
class TerminalAdapter:
    """Base contract shared by repository-owned Linux/Pi adapters."""

    profile: TerminalProfile
    runtime: Any

    adapter_id: ClassVar[str]
    supported_health_probe_ids: ClassVar[frozenset[str]]

    def validate(self) -> None:
        probes = set(self.profile.adapter_options.health_probe_ids)
        unknown = sorted(probes - self.supported_health_probe_ids)
        if unknown:
            raise ValueError(
                f"terminal profile {self.profile.id} uses unsupported "
                f"{self.adapter_id} health probes: {', '.join(unknown)}"
            )

    @property
    def runtime_units(self) -> tuple[str, ...]:
        return self.profile.adapter_options.systemd_units

    @property
    def docker_services(self) -> tuple[str, ...]:
        probes = set(self.profile.adapter_options.health_probe_ids)
        return tuple(probe for probe in _AGENT_PROBES if probe in probes)

    @property
    def restart_on_restore_units(self) -> tuple[str, ...]:
        units = self.profile.adapter_options.systemd_units
        result = []
        if "haizen-agent.service" in units:
            result.append("haizen-agent.service")
        result.extend(
            unit
            for unit in units
            if unit not in _COMMON_RUNTIME_UNITS and unit.endswith(".service")
        )
        return tuple(dict.fromkeys(result))

    @property
    def runtime_manifest_contract(self) -> TerminalRuntimeManifestContract:
        """Return the sole capture contract used by preflight and release."""

        docker_services = self.docker_services
        return TerminalRuntimeManifestContract(
            systemd_units=self.runtime_units,
            docker_services=docker_services,
            restart_on_restore_units=self.restart_on_restore_units,
            compose_project=_CLIENT_COMPOSE_PROJECT if docker_services else None,
            compose_working_directory=(
                _CLIENT_COMPOSE_DIRECTORY if docker_services else None
            ),
            compose_config_files=_CLIENT_COMPOSE_FILES if docker_services else (),
        )

    def rollback_paths(self, user: str, home: str, run_id: str) -> tuple[str, ...]:
        del run_id
        dynamic = (
            f"/etc/sudoers.d/{user}",
            f"/etc/sudoers.d/{user}-client-services",
        )
        return tuple(
            dict.fromkeys((*self.profile.adapter_options.rollback_paths, *dynamic))
        )

    def prepare_repository(self, inventory: str, host: str) -> dict[str, Any]:
        return self.runtime.prepare_terminal_repository(inventory, host)

    def capture_manifest(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
        previous_sha: str,
    ) -> dict[str, Any]:
        return self.runtime.capture_terminal_manifest(
            inventory, target_spec, run_id, previous_sha
        )

    def should_issue_notice(self, *, emergency_override: bool) -> bool:
        return self.runtime.should_issue_terminal_notice(
            terminal_type=self.profile.id,
            notice_seconds=self.profile.notice_seconds,
            emergency_override=emergency_override,
        )

    def notice_skip_reason(self, *, emergency_override: bool) -> str:
        return self.runtime.terminal_notice_skip_reason(
            terminal_type=self.profile.id,
            notice_seconds=self.profile.notice_seconds,
            emergency_override=emergency_override,
        )

    def deliver_notice(
        self,
        state: Any,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> None:
        self.runtime.deliver_terminal_notice(
            state,
            target_spec,
            target,
            run_id,
            duration_seconds=self.profile.notice_seconds,
        )

    def enter_maintenance(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
    ) -> None:
        self.runtime.state_command(
            "put",
            "--run-id",
            run_id,
            "--clients",
            target_spec["clientId"],
            "--terminal-type",
            self.profile.id,
        )

    def prestage_maintenance(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
    ) -> None:
        del inventory, target_spec, run_id

    def apply(
        self,
        inventory: str,
        host: str,
        revision: str,
        run_id: str,
        *,
        runtime_artifact_vars: str | None = None,
    ) -> None:
        apply_profile = getattr(self.runtime, "apply_terminal_profile", None)
        if callable(apply_profile):
            if runtime_artifact_vars is None:
                apply_profile(inventory, host, revision, run_id, self.profile)
            else:
                apply_profile(
                    inventory,
                    host,
                    revision,
                    run_id,
                    self.profile,
                    runtime_artifact_vars=runtime_artifact_vars,
                )
            return
        if runtime_artifact_vars is not None:
            raise RuntimeError("legacy terminal runtime cannot consume artifact vars")
        # Test and old injected runtimes retain the legacy executor shape.
        self.runtime.playbook(inventory, host, revision, run_id)

    def activate(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> dict[str, Any]:
        raise RuntimeError(
            f"terminal profile {self.profile.id} does not support artifact activation"
        )

    def reconcile_activation(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> dict[str, Any] | None:
        del inventory, target_spec, target, run_id
        return None

    def cleanup_activation(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> dict[str, Any] | None:
        del inventory, target_spec, target, run_id
        return None

    def ready_claim_kind(self) -> ClaimKind | None:
        return None

    def release_claim_authority(self, kind: ClaimKind) -> ClaimAuthority:
        if kind is ClaimKind.TERMINAL_REPOSITORY:
            return ClaimAuthority.TERMINAL_REPOSITORY_PROBE
        raise RuntimeError(
            f"terminal profile {self.profile.id} cannot prove {kind.value}"
        )

    def expected_ready_sha(self, state: Any, target: dict[str, Any]) -> str:
        if self.profile.adapter_options.ready_authority == "terminal":
            expected = target.get("desiredSha")
        else:
            expected = _verified_control_plane_sha(
                state.payload.get("hosts") or [], qualifier="terminal ready release"
            )
        if not isinstance(expected, str) or FULL_SHA_RE.fullmatch(expected) is None:
            raise RuntimeError("terminal ready release SHA is unavailable")
        return expected

    def expected_rollback_ready_sha(
        self, state: Any, target: dict[str, Any]
    ) -> str:
        if self.profile.adapter_options.ready_authority == "terminal":
            expected = target.get("previousSha")
            if not isinstance(expected, str) or FULL_SHA_RE.fullmatch(expected) is None:
                raise RuntimeError("terminal rollback release SHA is unavailable")
            return expected
        return self.expected_ready_sha(state, target)

    def interrupted_rollback_ready_sha(
        self, fleet_state: dict[str, Any], previous_sha: str
    ) -> str:
        if self.profile.adapter_options.ready_authority == "terminal":
            return previous_sha
        return _verified_control_plane_sha(
            (fleet_state.get("fleet") or {}).values(),
            qualifier="Kiosk rollback",
        )

    def prove_ready(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
        release_sha: str,
        verification_id: str,
    ) -> None:
        del inventory, target_spec, run_id, release_sha, verification_id

    def observe(
        self,
        inventory: str,
        host: str,
        client_id: str,
        *,
        runtime_health: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if runtime_health is None:
            return self.runtime.observe_terminal_evidence(
                inventory, host, self.profile.id, client_id
            )
        return self.runtime.observe_terminal_evidence(
            inventory,
            host,
            self.profile.id,
            client_id,
            runtime_health=runtime_health,
        )

    def _active_units(self) -> tuple[str, ...]:
        probes = set(self.profile.adapter_options.health_probe_ids)
        units = []
        if "display-manager" in probes:
            units.append("lightdm.service")
        units.extend(
            unit
            for unit in self.profile.adapter_options.systemd_units
            if unit not in _COMMON_RUNTIME_UNITS
        )
        if "status-agent" in probes:
            units.append("status-agent.timer")
        return tuple(dict.fromkeys(units))

    def _validated_runtime_health(
        self, value: dict[str, Any]
    ) -> tuple[tuple[str, ...], tuple[str, ...]]:
        if not isinstance(value, dict) or set(value) != {
            "activeSystemdUnits",
            "runningDockerServices",
        }:
            raise RuntimeError("sealed terminal runtime health contract is malformed")
        units = value.get("activeSystemdUnits")
        agents = value.get("runningDockerServices")
        if (
            not isinstance(units, list)
            or any(
                not isinstance(unit, str) or unit not in self.runtime_units
                for unit in units
            )
            or len(units) != len(set(units))
            or not isinstance(agents, list)
            or any(
                not isinstance(agent, str) or agent not in self.docker_services
                for agent in agents
            )
            or len(agents) != len(set(agents))
        ):
            raise RuntimeError("sealed terminal runtime health contract is malformed")
        return tuple(units), tuple(agents)

    def observe_direct(
        self,
        inventory: str,
        host: str,
        client_id: str,
        *,
        runtime_health: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Collect adapter-owned live evidence for the real facade runtime."""

        sha = self.runtime.remote_previous_sha(inventory, host)
        if not isinstance(sha, str) or FULL_SHA_RE.fullmatch(sha) is None:
            raise RuntimeError(f"terminal HEAD is not immutable: {host}")
        restored_agents: tuple[str, ...] | None = None
        if runtime_health is None:
            services = list(self._active_units())
        else:
            restored_units, restored_agents = self._validated_runtime_health(
                runtime_health
            )
            services = list(restored_units)
        for service in services:
            self.runtime.run(
                [
                    "ansible",
                    "-i",
                    inventory,
                    host,
                    "-b",
                    "-m",
                    "command",
                    "-a",
                    f"systemctl is-active --quiet {service}",
                ],
                cwd=self.runtime.ANSIBLE_DIRECTORY,
                capture=True,
            )
        oneshot_services = []
        if "status-agent" in self.profile.adapter_options.health_probe_ids:
            self.runtime.run(
                [
                    "ansible",
                    "-i",
                    inventory,
                    host,
                    "-b",
                    "-m",
                    "shell",
                    "-a",
                    'test "$(systemctl show --property=Result --value '
                    'status-agent.service)" = success',
                ],
                cwd=self.runtime.ANSIBLE_DIRECTORY,
                capture=True,
            )
            oneshot_services.append("status-agent.service")
        identity = self.runtime.probe_terminal_identity(inventory, host, client_id)
        if identity != {"authenticated": True, "statusClientId": client_id}:
            raise RuntimeError(f"terminal identity is not authenticated: {host}")
        result: dict[str, Any] = {
            "currentSha": sha,
            "services": services,
            "oneshotServices": oneshot_services,
            "authenticatedEndpoint": True,
            "statusClientId": client_id,
        }
        self.extend_health_evidence(
            inventory, host, result, expected_agents=restored_agents
        )
        return result

    def extend_health_evidence(
        self,
        inventory: str,
        host: str,
        result: dict[str, Any],
        *,
        expected_agents: tuple[str, ...] | None = None,
    ) -> None:
        del inventory, host, result, expected_agents

    def rollback(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> bool:
        return self.runtime.rollback_terminal(
            inventory, target_spec, target, run_id
        )

    def preflight_rollback(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> dict[str, Any]:
        return self.runtime.preflight_terminal_rollback(
            inventory, target_spec, target, run_id
        )

    def clear_maintenance(self, target_spec: dict[str, str], run_id: str) -> None:
        self.runtime.state_command(
            "remove-client",
            "--run-id",
            run_id,
            "--client",
            target_spec["clientId"],
        )

    def finalize_after_maintenance(
        self,
        state: Any,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
        observation: dict[str, Any],
    ) -> None:
        del state, inventory, target_spec, target, run_id, observation

    def cleanup(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
        outcome: str,
    ) -> dict[str, Any]:
        return self.runtime.cleanup_terminal_rollback(
            inventory, target_spec, target, run_id, outcome
        )


class GenericSystemdAdapter(TerminalAdapter):
    """Git/status-agent/systemd/manifest adapter for ordinary Linux terminals."""

    adapter_id = "generic-systemd"
    supported_health_probe_ids = frozenset(
        {"display-manager", "status-agent", "nfc-agent", "barcode-agent", "torque-agent", "ready-sha"}
    )

    def ready_claim_kind(self) -> ClaimKind | None:
        if self.profile.adapter_options.ready_authority == "control-plane":
            return ClaimKind.CONTROL_PLANE_WEB
        return super().ready_claim_kind()

    def release_claim_authority(self, kind: ClaimKind) -> ClaimAuthority:
        if kind is ClaimKind.CONTROL_PLANE_WEB and (
            self.profile.adapter_options.ready_authority == "control-plane"
        ):
            return ClaimAuthority.KIOSK_COMPILED_WEB_READY
        return super().release_claim_authority(kind)

    def _requires_kiosk_web_activation(
        self, target: dict[str, Any]
    ) -> bool:
        return (
            target.get("activationRequired") is True
            and target.get("activationStrategyId")
            == KIOSK_WEB_ACTIVATION_STRATEGY
            and target.get("activationMode") == KIOSK_WEB_MIGRATION_MODE
        )

    def activate(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> dict[str, Any]:
        if not self._requires_kiosk_web_activation(target):
            raise RuntimeError("Kiosk Web activation strategy is not authorized")
        if not isinstance(target.get("acknowledgedAt"), str):
            raise RuntimeError(
                "Kiosk Web activation requires acknowledged maintenance"
            )
        result = self.runtime.activate_kiosk_web(
            inventory, target_spec, target, run_id
        )
        if result.get("state") != "succeeded":
            raise ActivationUncertainError(
                "Kiosk Web activation result is not proven quiescent and successful"
            )
        return result

    def reconcile_activation(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> dict[str, Any] | None:
        if not self._requires_kiosk_web_activation(target):
            return None
        return self.runtime.reconcile_kiosk_web_activation(
            inventory, target_spec, target, run_id
        )

    def cleanup_activation(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> dict[str, Any] | None:
        if not self._requires_kiosk_web_activation(target):
            return None
        return self.runtime.cleanup_kiosk_web_activation(
            inventory, target_spec, target, run_id
        )

    def preflight_rollback(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> dict[str, Any]:
        result = super().preflight_rollback(
            inventory, target_spec, target, run_id
        )
        if not self._requires_kiosk_web_activation(target):
            return result
        try:
            activation = self.reconcile_activation(
                inventory, target_spec, target, run_id
            )
            if not isinstance(activation, dict) or activation.get("state") not in {
                "absent",
                "succeeded",
                "failed",
            }:
                result["issues"].append(
                    "Kiosk Web activation is not proven quiescent"
                )
            else:
                result["activationReconciliation"] = activation
        except Exception as error:
            result["issues"].append(f"Kiosk Web activation: {error}")
        result["ready"] = not result["issues"]
        return result

    def cleanup(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
        outcome: str,
    ) -> dict[str, Any]:
        if "activationCleanup" not in target:
            activation_cleanup = self.cleanup_activation(
                inventory, target_spec, target, run_id
            )
            if activation_cleanup is not None:
                target["activationCleanup"] = activation_cleanup
        return super().cleanup(
            inventory, target_spec, target, run_id, outcome
        )

    def rollback_paths(self, user: str, home: str, run_id: str) -> tuple[str, ...]:
        base = super().rollback_paths(user, home, run_id)
        legacy_browser_paths = (
            f"{home}/.config/autostart/ibus.desktop",
            f"{home}/.config/autostart/ibus-owner.desktop",
            f"{home}/.config/autostart/ibus-engine.desktop",
            f"{home}/.config/autostart/im-launch.desktop",
            f"{home}/.mozilla/firefox/kiosk-system/chrome/userChrome.css",
            f"{home}/.mozilla/firefox/kiosk-system/user.js",
            f"{home}/.config/labwc/rc.xml",
        )
        return tuple(dict.fromkeys((*base, *legacy_browser_paths)))

    def observe_direct(
        self,
        inventory: str,
        host: str,
        client_id: str,
        *,
        runtime_health: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Collect the unchanged Generic proofs through one SSH transport."""

        restored_agents: tuple[str, ...] | None = None
        if runtime_health is None:
            services = list(self._active_units())
        else:
            restored_units, restored_agents = self._validated_runtime_health(
                runtime_health
            )
            services = list(restored_units)
        result = self.runtime.probe_terminal_release_evidence(
            inventory,
            host,
            client_id,
            services,
            expected_agents=restored_agents,
            check_status_agent_result=(
                "status-agent" in self.profile.adapter_options.health_probe_ids
            ),
        )
        expected_oneshot = (
            ["status-agent.service"]
            if "status-agent" in self.profile.adapter_options.health_probe_ids
            else []
        )
        if (
            not isinstance(result, dict)
            or set(result)
            != {
                "currentSha",
                "services",
                "oneshotServices",
                "authenticatedEndpoint",
                "statusClientId",
                "agentContainers",
                "authenticatedAgentEndpoints",
                "pcscdRequired",
            }
            or result.get("services") != services
            or result.get("oneshotServices") != expected_oneshot
            or result.get("authenticatedEndpoint") is not True
            or result.get("statusClientId") != client_id
            or not isinstance(result.get("currentSha"), str)
            or FULL_SHA_RE.fullmatch(result["currentSha"]) is None
        ):
            raise RuntimeError(f"terminal release evidence is malformed: {host}")
        self._validate_agent_evidence(result, host=host)
        return result

    def _validate_agent_evidence(
        self, agents: dict[str, Any], *, host: str
    ) -> None:
        configured = set(self.docker_services)
        containers = agents.get("agentContainers") if isinstance(agents, dict) else None
        endpoints = (
            agents.get("authenticatedAgentEndpoints")
            if isinstance(agents, dict)
            else None
        )
        if (
            not isinstance(containers, list)
            or any(agent not in configured for agent in containers)
            or len(containers) != len(set(containers))
            or not isinstance(endpoints, list)
            or len(endpoints) != len(containers)
            or any(
                not isinstance(endpoint, dict)
                or set(endpoint) != {"agent", "port"}
                or endpoint.get("agent") != containers[index]
                or isinstance(endpoint.get("port"), bool)
                or not isinstance(endpoint.get("port"), int)
                or not 1 <= endpoint["port"] <= 65535
                for index, endpoint in enumerate(endpoints)
            )
            or type(agents.get("pcscdRequired")) is not bool
        ):
            raise RuntimeError(
                f"{self.profile.id} agent health evidence is malformed: {host}"
            )

    def extend_health_evidence(
        self,
        inventory: str,
        host: str,
        result: dict[str, Any],
        *,
        expected_agents: tuple[str, ...] | None = None,
    ) -> None:
        configured = set(self.docker_services)
        if not configured:
            return
        if expected_agents is None:
            agents = self.runtime.probe_kiosk_agents(inventory, host)
        else:
            agents = self.runtime.probe_kiosk_agents(
                inventory, host, expected_agents=list(expected_agents)
            )
        self._validate_agent_evidence(agents, host=host)
        result.update(agents)


class SignageSystemdAdapter(TerminalAdapter):
    """Signage compatibility adapter with controller-owned visual proof."""

    adapter_id = "signage-systemd"
    supported_health_probe_ids = frozenset(
        {"display-manager", "status-agent", "signage-endpoint", "ready-sha"}
    )

    def ready_claim_kind(self) -> ClaimKind | None:
        return ClaimKind.TERMINAL_REPOSITORY

    def release_claim_authority(self, kind: ClaimKind) -> ClaimAuthority:
        if kind is ClaimKind.TERMINAL_REPOSITORY:
            return ClaimAuthority.SIGNAGE_READY
        return super().release_claim_authority(kind)

    def rollback_paths(self, user: str, home: str, run_id: str) -> tuple[str, ...]:
        base = super().rollback_paths(user, home, run_id)
        prestage_paths = (
            f"/run/signage/release-{run_id}-maintenance.svg",
            f"/run/signage/release-{run_id}-maintenance.jpg",
            f"/run/signage/release-{run_id}-maintenance.sha256",
        )
        return tuple(dict.fromkeys((*base, *prestage_paths)))

    @property
    def restart_on_restore_units(self) -> tuple[str, ...]:
        return tuple(
            unit
            for unit in ("haizen-agent.service", "signage-lite.service")
            if unit in self.profile.adapter_options.systemd_units
        )

    def _active_units(self) -> tuple[str, ...]:
        allowed = (
            "lightdm.service",
            "signage-lite.service",
            "signage-lite-update.timer",
            "signage-lite-watchdog.timer",
            "signage-daily-reboot.timer",
            "status-agent.timer",
        )
        units = set(self.profile.adapter_options.systemd_units)
        return tuple(unit for unit in allowed if unit in units)

    def extend_health_evidence(
        self,
        inventory: str,
        host: str,
        result: dict[str, Any],
        *,
        expected_agents: tuple[str, ...] | None = None,
    ) -> None:
        del expected_agents
        signage = self.runtime.probe_signage_endpoints(inventory, host)
        if (
            not isinstance(signage, dict)
            or signage.get("signageEndpointAuthenticated") is not True
            or SHA256_RE.fullmatch(str(signage.get("signageImageSha256") or ""))
            is None
        ):
            raise RuntimeError(f"signage endpoint is not authenticated: {host}")
        result.update(signage)

    def prestage_maintenance(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
    ) -> None:
        self.runtime.prestage_signage_maintenance(
            inventory, target_spec["host"], run_id, target_spec["clientId"]
        )

    def prove_ready(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
        release_sha: str,
        verification_id: str,
    ) -> None:
        self.runtime.prove_signage_ready(
            inventory,
            target_spec["host"],
            run_id,
            target_spec["clientId"],
            release_sha,
            verification_id,
        )

    def finalize_after_maintenance(
        self,
        state: Any,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
        observation: dict[str, Any],
    ) -> None:
        proof = self.runtime.refresh_signage_after_maintenance(
            inventory, target_spec["host"], run_id
        )
        if (
            not isinstance(proof, dict)
            or proof.get("signageEndpointAuthenticated") is not True
            or proof.get("maintenanceArtifactReplaced") is not True
            or SHA256_RE.fullmatch(str(proof.get("signageImageSha256") or ""))
            is None
        ):
            raise RuntimeError(
                f"signage display proof is malformed: {target_spec['host']}"
            )
        target["signageDisplayProof"] = {
            **proof,
            "verifiedAt": self.runtime.utc_now(),
        }
        observation.update(proof)
        state.save()


__all__ = [
    "GenericSystemdAdapter",
    "SignageSystemdAdapter",
    "TerminalAdapter",
]
