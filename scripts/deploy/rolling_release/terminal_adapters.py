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
    staged_source_required: ClassVar[bool] = False

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
        dynamic = (
            f"/etc/sudoers.d/{user}",
            f"/etc/sudoers.d/{user}-client-services",
        )
        return tuple(
            dict.fromkeys(
                (
                    *self.profile.adapter_options.rollback_paths,
                    *dynamic,
                    *self.run_scoped_rollback_paths(run_id),
                )
            )
        )

    def run_scoped_rollback_paths(self, run_id: str) -> tuple[str, ...]:
        del run_id
        return ()

    def prepare_repository(self, inventory: str, host: str) -> dict[str, Any]:
        return self.runtime.prepare_terminal_repository(inventory, host)

    def stage_candidate_source(
        self,
        inventory: str,
        host: str,
        revision: str,
        previous_sha: str,
        run_id: str,
        *,
        release_authority: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        del inventory, host, revision, previous_sha, run_id
        if release_authority is not None:
            raise RuntimeError("release authority is unsupported for this profile")
        return None

    def validate_staged_release_authority(
        self,
        release_authority: dict[str, Any],
        staged_source: dict[str, Any],
    ) -> None:
        del release_authority, staged_source
        raise RuntimeError("staged release authority is unsupported for this profile")

    def cleanup_candidate_source(
        self,
        inventory: str,
        host: str,
        staged_source: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        del inventory, host, staged_source
        return None

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

    def capture_historical_manifest(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
        previous_sha: str,
    ) -> dict[str, Any]:
        """Recapture an interrupted run with its original manifest contract."""

        return self.capture_manifest(
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
        staged_source: dict[str, Any] | None = None,
        target: dict[str, Any] | None = None,
    ) -> None:
        del target
        apply_profile = getattr(self.runtime, "apply_terminal_profile", None)
        if callable(apply_profile):
            apply_profile(
                inventory,
                host,
                revision,
                run_id,
                self.profile,
                staged_source=staged_source,
            )
            return
        # Test and old injected runtimes retain the legacy executor shape.
        if staged_source is not None:
            raise RuntimeError("staged terminal source requires the profile executor")
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

    def owns_profile_release_identity(self) -> bool:
        return False

    def expected_claim_identity(
        self, runtime: Any, desired_sha: str, kind: ClaimKind
    ) -> str:
        del runtime, kind
        return desired_sha

    def direct_claim_authority(self, kind: ClaimKind) -> ClaimAuthority:
        return self.release_claim_authority(kind)

    def direct_claim_kind(self) -> ClaimKind:
        return ClaimKind.TERMINAL_REPOSITORY

    def observed_claim_identity(
        self,
        kind: ClaimKind,
        observation: dict[str, Any],
        target: dict[str, Any],
        *,
        release_key: str,
    ) -> str | None:
        if kind is self.ready_claim_kind():
            return target.get(release_key)
        if kind is ClaimKind.TERMINAL_REPOSITORY:
            return observation.get("currentSha")
        raise RuntimeError(f"terminal ready path cannot observe {kind.value}")

    def normalize_interrupted_record(
        self, record: dict[str, Any]
    ) -> dict[str, Any]:
        return record

    def baseline_claim_spec(
        self,
        target: dict[str, Any],
        observation: dict[str, Any],
        *,
        verification_id: str | None,
    ) -> dict[str, Any]:
        del target, observation, verification_id
        raise RuntimeError("profile does not own a baseline release identity")

    def validate_staged_claim_identity(
        self,
        requirements: list[dict[str, str]],
        staged_source: dict[str, Any],
    ) -> None:
        del requirements, staged_source

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
        target: dict[str, Any],
        *,
        rollback: bool,
    ) -> None:
        del inventory, target_spec, run_id, release_sha, verification_id, target, rollback

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

    def observe_rollback(
        self,
        inventory: str,
        host: str,
        client_id: str,
        target: dict[str, Any],
        *,
        runtime_health: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        del target
        return self.observe(
            inventory, host, client_id, runtime_health=runtime_health
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
        maintenance = target.get("maintenance")
        if (
            not isinstance(maintenance, dict)
            or maintenance.get("state") not in {"acknowledged", "unconfirmed"}
            or not isinstance(target.get("maintenanceStartedAt"), str)
        ):
            raise RuntimeError(
                "Kiosk Web activation requires a durable maintenance request"
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
            not in (
                {
                    "currentSha",
                    "services",
                    "oneshotServices",
                    "authenticatedEndpoint",
                    "statusClientId",
                    "agentContainers",
                    "authenticatedAgentEndpoints",
                    "pcscdRequired",
                },
                {
                    "currentSha",
                    "services",
                    "oneshotServices",
                    "authenticatedEndpoint",
                    "statusClientId",
                    "agentContainers",
                    "authenticatedAgentEndpoints",
                    "pcscdRequired",
                    "maintenanceAgents",
                },
            )
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
        maintained = (
            agents.get("maintenanceAgents", []) if isinstance(agents, dict) else None
        )
        maintained_names = (
            [entry.get("agent") for entry in maintained]
            if isinstance(maintained, list)
            else []
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
            or not isinstance(maintained, list)
            or any(
                not isinstance(entry, dict)
                or set(entry) != {"agent", "reasonCode", "expiresAt"}
                or entry.get("agent") not in configured
                or not isinstance(entry.get("reasonCode"), str)
                or not isinstance(entry.get("expiresAt"), str)
                for entry in maintained
            )
            or len(maintained_names) != len(set(maintained_names))
            or not set(maintained_names) <= set(containers)
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
    staged_source_required = True
    supported_health_probe_ids = frozenset(
        {"display-manager", "status-agent", "signage-endpoint", "ready-sha"}
    )

    def ready_claim_kind(self) -> ClaimKind | None:
        return ClaimKind.SIGNAGE_RELEASE_ARTIFACT

    def owns_profile_release_identity(self) -> bool:
        return True

    def expected_claim_identity(
        self, runtime: Any, desired_sha: str, kind: ClaimKind
    ) -> str:
        if kind is not ClaimKind.SIGNAGE_RELEASE_ARTIFACT:
            return super().expected_claim_identity(runtime, desired_sha, kind)
        return runtime.signage_release_artifact_identity(desired_sha)

    def direct_claim_authority(self, kind: ClaimKind) -> ClaimAuthority:
        if kind is ClaimKind.SIGNAGE_RELEASE_ARTIFACT:
            return ClaimAuthority.SIGNAGE_ARTIFACT_PROBE
        return super().direct_claim_authority(kind)

    def direct_claim_kind(self) -> ClaimKind:
        return ClaimKind.SIGNAGE_RELEASE_ARTIFACT

    def observed_claim_identity(
        self,
        kind: ClaimKind,
        observation: dict[str, Any],
        target: dict[str, Any],
        *,
        release_key: str,
    ) -> str | None:
        if kind is ClaimKind.SIGNAGE_RELEASE_ARTIFACT:
            return observation.get("releaseArtifactIdentity")
        return super().observed_claim_identity(
            kind, observation, target, release_key=release_key
        )

    def normalize_interrupted_record(
        self, record: dict[str, Any]
    ) -> dict[str, Any]:
        if "repositoryBaseline" in record:
            return record
        requirements = record.get("claimRequirements")
        kinds = {
            value.get("kind")
            for value in requirements or []
            if isinstance(value, dict)
        }
        previous_sha = record.get("previousSha")
        if (
            (requirements is None or kinds == {ClaimKind.TERMINAL_REPOSITORY.value})
            and isinstance(previous_sha, str)
            and FULL_SHA_RE.fullmatch(previous_sha) is not None
        ):
            return {
                **record,
                "repositoryBaseline": {
                    "head": previous_sha,
                    "artifactState": "absent",
                    "artifactIdentity": None,
                    "artifactSha256": None,
                    "legacyRepositorySha": previous_sha,
                },
            }
        return record

    def baseline_claim_spec(
        self,
        target: dict[str, Any],
        observation: dict[str, Any],
        *,
        verification_id: str | None,
    ) -> dict[str, Any]:
        baseline = target.get("repositoryBaseline")
        previous_sha = target.get("previousSha")
        if (
            not isinstance(baseline, dict)
            or not isinstance(previous_sha, str)
            or FULL_SHA_RE.fullmatch(previous_sha) is None
        ):
            raise RuntimeError("profile artifact rollback baseline is unavailable")
        if baseline.get("artifactState") == "absent":
            if (
                baseline.get("artifactIdentity") is not None
                or baseline.get("artifactSha256") is not None
                or baseline.get("legacyRepositorySha") != previous_sha
            ):
                raise RuntimeError("legacy profile rollback baseline is malformed")
            return {
                "kind": ClaimKind.TERMINAL_REPOSITORY,
                "expected": previous_sha,
                "observed": observation.get("currentSha"),
                "authority": ClaimAuthority.TERMINAL_REPOSITORY_PROBE,
                "verificationId": None,
            }
        if baseline.get("artifactState") != "installed":
            raise RuntimeError("profile artifact rollback baseline is malformed")
        identity = baseline.get("artifactIdentity")
        if (
            not isinstance(identity, str)
            or not identity.startswith(f"git:{previous_sha}@sha256:")
        ):
            raise RuntimeError("profile artifact rollback identity is malformed")
        return {
            "kind": ClaimKind.SIGNAGE_RELEASE_ARTIFACT,
            "expected": identity,
            "observed": observation.get("releaseArtifactIdentity"),
            "authority": (
                ClaimAuthority.SIGNAGE_READY
                if verification_id is not None
                else ClaimAuthority.SIGNAGE_ARTIFACT_PROBE
            ),
            "verificationId": verification_id,
        }

    def validate_staged_claim_identity(
        self,
        requirements: list[dict[str, str]],
        staged_source: dict[str, Any],
    ) -> None:
        requirement = next(
            (
                value
                for value in requirements
                if value["kind"] == ClaimKind.SIGNAGE_RELEASE_ARTIFACT.value
            ),
            None,
        )
        if requirement is None:
            return
        actual = (
            f"git:{staged_source.get('sourceSha')}@sha256:"
            f"{staged_source.get('artifactSha256')}"
        )
        if actual != requirement["expectedIdentity"]:
            raise RuntimeError(
                "staged profile artifact disagrees with the planned claim"
            )

    def release_claim_authority(self, kind: ClaimKind) -> ClaimAuthority:
        if kind is ClaimKind.SIGNAGE_RELEASE_ARTIFACT:
            return ClaimAuthority.SIGNAGE_READY
        return super().release_claim_authority(kind)

    def prepare_repository(self, inventory: str, host: str) -> dict[str, Any]:
        return self.runtime.prepare_signage_release_identity(inventory, host)

    @staticmethod
    def _uses_stage3_manifest(target: dict[str, Any]) -> bool:
        manifest = target.get("rollbackManifest")
        return (
            isinstance(manifest, dict)
            and manifest.get("schemaVersion") == 1
            and manifest.get("kind") == "signage-artifact-baseline"
        )

    def capture_manifest(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
        previous_sha: str,
    ) -> dict[str, Any]:
        """Seal only the Signage pointer/runtime baseline for new runs."""

        return self.runtime.capture_signage_artifact_baseline(
            inventory, target_spec, run_id, previous_sha
        )

    def capture_historical_manifest(
        self,
        inventory: str,
        target_spec: dict[str, str],
        run_id: str,
        previous_sha: str,
    ) -> dict[str, Any]:
        """Keep abandoned pre-Stage-3 runs on the historical reader."""

        return super().capture_manifest(
            inventory, target_spec, run_id, previous_sha
        )

    def observe_direct(
        self,
        inventory: str,
        host: str,
        client_id: str,
        *,
        runtime_health: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._observe_signage_direct(
            inventory,
            host,
            client_id,
            runtime_health=runtime_health,
            artifact_required=True,
        )

    def _observe_signage_direct(
        self,
        inventory: str,
        host: str,
        client_id: str,
        *,
        runtime_health: dict[str, Any] | None,
        artifact_required: bool,
    ) -> dict[str, Any]:
        services = list(self._active_units())
        if runtime_health is not None:
            restored_units, restored_agents = self._validated_runtime_health(runtime_health)
            if restored_agents:
                raise RuntimeError("signage runtime cannot contain kiosk agents")
            services = list(restored_units)
        result = self.runtime.probe_terminal_release_evidence(
            inventory,
            host,
            client_id,
            services,
            expected_agents=(),
            check_status_agent_result=(
                "status-agent" in self.profile.adapter_options.health_probe_ids
            ),
            signage_artifact=artifact_required,
        )
        expected_keys = {
            "currentSha", "services", "oneshotServices", "authenticatedEndpoint",
            "statusClientId", "agentContainers", "authenticatedAgentEndpoints",
            "pcscdRequired",
        }
        if artifact_required:
            expected_keys.update({"artifactSha256", "releaseArtifactIdentity"})
        if (
            not isinstance(result, dict)
            or set(result) != expected_keys
            or result.get("services") != services
            or result.get("authenticatedEndpoint") is not True
            or result.get("statusClientId") != client_id
            or FULL_SHA_RE.fullmatch(str(result.get("currentSha") or "")) is None
            or result.get("agentContainers") != []
            or result.get("authenticatedAgentEndpoints") != []
            or result.get("pcscdRequired") is not False
        ):
            raise RuntimeError(f"signage release evidence is malformed: {host}")
        if artifact_required and (
            SHA256_RE.fullmatch(str(result.get("artifactSha256") or "")) is None
            or result.get("releaseArtifactIdentity")
            != f"git:{result.get('currentSha')}@sha256:{result.get('artifactSha256')}"
        ):
            raise RuntimeError(f"signage artifact evidence is malformed: {host}")
        self.extend_health_evidence(inventory, host, result)
        return result

    def observe_rollback(
        self,
        inventory: str,
        host: str,
        client_id: str,
        target: dict[str, Any],
        *,
        runtime_health: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        baseline = target.get("repositoryBaseline")
        if not isinstance(baseline, dict):
            raise RuntimeError("signage rollback baseline is unavailable")
        artifact_state = baseline.get("artifactState")
        if artifact_state == "installed":
            artifact_required = True
        elif artifact_state == "absent":
            artifact_required = False
        else:
            raise RuntimeError("signage rollback baseline is malformed")
        return self._observe_signage_direct(
            inventory,
            host,
            client_id,
            runtime_health=runtime_health,
            artifact_required=artifact_required,
        )

    def stage_candidate_source(
        self,
        inventory: str,
        host: str,
        revision: str,
        previous_sha: str,
        run_id: str,
        *,
        release_authority: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        arguments = (inventory, host, revision, previous_sha, run_id)
        if release_authority is None:
            return self.runtime.stage_signage_artifact_candidate(*arguments)
        return self.runtime.stage_signage_artifact_candidate(
            *arguments, release_authority=release_authority
        )

    def validate_staged_release_authority(
        self,
        release_authority: dict[str, Any],
        staged_source: dict[str, Any],
    ) -> None:
        fields = {
            "sourceSha": "sourceSha",
            "ociDigest": "ociDigest",
            "artifactSha256": "artifactSha256",
            "manifestSha256": "manifestSha256",
            "payloadDigest": "payloadDigest",
        }
        if (
            release_authority.get("releaseScope") != "pi3-signage-artifact"
            or any(
                release_authority.get(expected) != staged_source.get(actual)
                for expected, actual in fields.items()
            )
        ):
            raise RuntimeError(
                "staged Signage artifact disagrees with scoped release authority"
            )

    def cleanup_candidate_source(
        self,
        inventory: str,
        host: str,
        staged_source: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if staged_source is None:
            return None
        return self.runtime.cleanup_signage_artifact_candidate(
            inventory,
            host,
            staged_source,
        )

    def apply(
        self,
        inventory: str,
        host: str,
        revision: str,
        run_id: str,
        *,
        staged_source: dict[str, Any] | None = None,
        target: dict[str, Any] | None = None,
    ) -> None:
        if staged_source is None:
            raise RuntimeError("Signage artifact candidate is unavailable")
        if target is None or not self._uses_stage3_manifest(target):
            raise RuntimeError("Signage artifact rollback baseline is unavailable")
        self.runtime.apply_signage_artifact_candidate(
            inventory,
            host,
            revision,
            run_id,
            staged_source,
            target["rollbackManifest"],
        )

    def rollback(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> bool:
        if not self._uses_stage3_manifest(target):
            return super().rollback(inventory, target_spec, target, run_id)
        return self.runtime.rollback_signage_artifact(
            inventory, target_spec, target, run_id
        )

    def preflight_rollback(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
    ) -> dict[str, Any]:
        if not self._uses_stage3_manifest(target):
            return super().preflight_rollback(
                inventory, target_spec, target, run_id
            )
        return self.runtime.preflight_signage_artifact_rollback(
            inventory, target_spec, target, run_id
        )

    def cleanup(
        self,
        inventory: str,
        target_spec: dict[str, str],
        target: dict[str, Any],
        run_id: str,
        outcome: str,
    ) -> dict[str, Any]:
        if not self._uses_stage3_manifest(target):
            return super().cleanup(
                inventory, target_spec, target, run_id, outcome
            )
        return self.runtime.cleanup_signage_artifact_release(
            inventory, target_spec, target, run_id, outcome
        )

    def run_scoped_rollback_paths(self, run_id: str) -> tuple[str, ...]:
        return (
            f"/run/signage/release-{run_id}-maintenance.svg",
            f"/run/signage/release-{run_id}-maintenance.jpg",
            f"/run/signage/release-{run_id}-maintenance.sha256",
            f"/var/tmp/raspi-pi3-signage-{run_id}.pyz.tmp",
            f"/var/tmp/raspi-pi3-signage-{run_id}.pyz",
        )

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
        target: dict[str, Any],
        *,
        rollback: bool,
    ) -> None:
        artifact_sha256: str | None = None
        if rollback:
            baseline = target.get("repositoryBaseline")
            if not isinstance(baseline, dict) or set(baseline) != {
                "head",
                "artifactState",
                "artifactIdentity",
                "artifactSha256",
                "legacyRepositorySha",
            }:
                raise RuntimeError("signage rollback ready baseline is malformed")
            if baseline.get("artifactState") == "absent":
                if (
                    baseline.get("head") != release_sha
                    or baseline.get("legacyRepositorySha") != release_sha
                    or baseline.get("artifactIdentity") is not None
                    or baseline.get("artifactSha256") is not None
                ):
                    raise RuntimeError(
                        "legacy signage rollback ready identity is malformed"
                    )
                identity_mode = "legacy-repository"
            elif baseline.get("artifactState") == "installed":
                artifact_sha256 = baseline.get("artifactSha256")
                if (
                    baseline.get("head") != release_sha
                    or baseline.get("legacyRepositorySha") is not None
                    or not isinstance(artifact_sha256, str)
                    or SHA256_RE.fullmatch(artifact_sha256) is None
                    or baseline.get("artifactIdentity")
                    != f"git:{release_sha}@sha256:{artifact_sha256}"
                ):
                    raise RuntimeError(
                        "installed signage rollback ready identity is malformed"
                    )
                identity_mode = "artifact"
            else:
                raise RuntimeError("signage rollback ready state is unknown")
        else:
            requirements = target.get("claimRequirements")
            matches = [
                value
                for value in requirements or []
                if isinstance(value, dict)
                and value.get("kind")
                == ClaimKind.SIGNAGE_RELEASE_ARTIFACT.value
            ]
            if len(matches) != 1:
                raise RuntimeError("signage forward ready identity is unavailable")
            expected = matches[0].get("expectedIdentity")
            prefix = f"git:{release_sha}@sha256:"
            if not isinstance(expected, str) or not expected.startswith(prefix):
                raise RuntimeError("signage forward ready identity is malformed")
            artifact_sha256 = expected[len(prefix) :]
            if SHA256_RE.fullmatch(artifact_sha256) is None:
                raise RuntimeError("signage forward ready digest is malformed")
            identity_mode = "artifact"
        self.runtime.prove_signage_ready(
            inventory,
            target_spec["host"],
            run_id,
            target_spec["clientId"],
            release_sha,
            verification_id,
            identity_mode=identity_mode,
            artifact_sha256=artifact_sha256,
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
