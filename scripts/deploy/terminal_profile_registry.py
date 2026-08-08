"""Strict reader for terminal deployment impact and client-agent metadata.

The registry contains static identifiers and repository mappings only. Runtime
execution policy, claims, adapters, rollout plans, and rollback state are not
represented here.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any


SCHEMA_VERSION = 5
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY_PATH = Path(__file__).with_name("terminal-profile-registry.json")
_SAFE_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
_SAFE_COMPONENT_RE = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
_PATH_MATCHES = frozenset({"exact", "prefix"})
_PATH_MAPPING_KEYS = frozenset({"match", "path", "component"})
_COMPONENT_HOST_SELECTOR_KEYS = frozenset({"hostVar", "match"})
_COMPONENT_HOST_SELECTOR_MATCHES = frozenset({"true", "non-empty-string"})
_SAFE_HOST_VAR_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
_SAFE_ENVIRONMENT_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,126}$")
_SAFE_HEALTH_ENDPOINT_RE = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,255}$")
_PORT_POLICIES = frozenset({"fixed", "configurable"})
_CLIENT_AGENT_KEYS = frozenset(
    {
        "composeService",
        "runtimeEnvPath",
        "envTemplate",
        "portPolicy",
        "defaultPort",
        "portEnvironment",
        "healthEndpoint",
        "responseValidator",
        "component",
        "hostSelector",
    }
)
_TOP_LEVEL_KEYS = frozenset(
    {
        "schemaVersion",
        "terminalProfiles",
        "pathMappings",
        "componentProfiles",
        "componentHostSelectors",
        "clientAgents",
    }
)


class RegistryError(ValueError):
    """Raised when registry data violates the static data contract."""


@dataclass(frozen=True)
class TerminalProfile:
    id: str


@dataclass(frozen=True)
class PathMapping:
    match: str
    path: str
    component: str

    def matches(self, repository_path: str) -> bool:
        if self.match == "exact":
            return repository_path == self.path
        return repository_path.startswith(self.path)


@dataclass(frozen=True)
class ComponentHostSelector:
    component: str
    host_var: str
    match: str

    def matches(self, host_vars: dict[str, Any]) -> bool:
        value = host_vars.get(self.host_var)
        if self.match == "true":
            return value is True
        return isinstance(value, str) and bool(value.strip())


@dataclass(frozen=True)
class ClientAgentContract:
    """Data-only cross-boundary contract for one containerized terminal agent."""

    id: str
    compose_service: str
    runtime_env_path: str
    env_template: str
    port_policy: str
    default_port: int
    port_environment: str
    health_endpoint: str
    response_validator: str
    component: str
    host_selector: ComponentHostSelector


@dataclass(frozen=True)
class TerminalProfileRegistry:
    schema_version: int
    profiles: tuple[TerminalProfile, ...]
    path_mappings: tuple[PathMapping, ...]
    component_profiles: tuple[tuple[str, tuple[str, ...]], ...]
    component_host_selectors: tuple[ComponentHostSelector, ...]
    client_agents: tuple[ClientAgentContract, ...]

    @property
    def profile_ids(self) -> tuple[str, ...]:
        return tuple(profile.id for profile in self.profiles)

    @property
    def client_agent_ids(self) -> tuple[str, ...]:
        return tuple(agent.id for agent in self.client_agents)

    def client_agent(self, agent_id: str) -> ClientAgentContract:
        for agent in self.client_agents:
            if agent.id == agent_id:
                return agent
        raise KeyError(agent_id)

    def component_for(self, repository_path: str) -> str:
        if not isinstance(repository_path, str) or not repository_path:
            return "unknown"
        for mapping in self.path_mappings:
            if mapping.matches(repository_path):
                return mapping.component
        return "unknown"

    def profiles_for_components(self, components: set[str]) -> list[str]:
        if "unknown" in components:
            return list(self.profile_ids)
        component_profiles = dict(self.component_profiles)
        affected: set[str] = set()
        for component in components:
            affected.update(component_profiles.get(component, ()))
        return [profile.id for profile in self.profiles if profile.id in affected]

    def components_apply_to_host(self, components: set[str], host_vars: Any) -> bool:
        if not components:
            return False
        selectors = {
            selector.component: selector
            for selector in self.component_host_selectors
        }
        if any(component not in selectors for component in components):
            return True
        if not isinstance(host_vars, dict):
            return True
        return any(selectors[component].matches(host_vars) for component in components)


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise RegistryError(f"terminal profile registry contains duplicate key: {key}")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise RegistryError(f"terminal profile registry contains invalid JSON constant: {value}")


def _strict_object(value: Any, *, name: str, keys: frozenset[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RegistryError(f"{name} must be an object")
    actual = set(value)
    if actual != set(keys):
        missing = sorted(set(keys) - actual)
        unknown = sorted(actual - set(keys))
        details = []
        if missing:
            details.append("missing " + ", ".join(missing))
        if unknown:
            details.append("unknown " + ", ".join(unknown))
        raise RegistryError(f"{name} has invalid fields: {'; '.join(details)}")
    return value


def _safe_identifier(value: Any, *, name: str) -> str:
    if not isinstance(value, str) or _SAFE_ID_RE.fullmatch(value) is None:
        raise RegistryError(f"{name} must be a safe lowercase identifier")
    return value


def _safe_component(value: Any, *, name: str) -> str:
    if not isinstance(value, str) or _SAFE_COMPONENT_RE.fullmatch(value) is None:
        raise RegistryError(f"{name} must be a safe component identifier")
    if value == "unknown":
        raise RegistryError(f"{name} cannot redefine the implicit unknown component")
    return value


def _bounded_int(value: Any, *, name: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise RegistryError(f"{name} must be an integer from {minimum} to {maximum}")
    return value


def _unique_string_list(
    value: Any,
    *,
    name: str,
    maximum: int,
    validator,
) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) > maximum:
        raise RegistryError(f"{name} must be a list with at most {maximum} entries")
    result = tuple(validator(item, name=f"{name} entry") for item in value)
    if len(result) != len(set(result)):
        raise RegistryError(f"{name} contains duplicate entries")
    return result


def _safe_repository_path(value: Any, *, name: str, exact: bool) -> str:
    if not isinstance(value, str) or not value or len(value) > 512:
        raise RegistryError(f"{name} must be a bounded repository path")
    if value.startswith("/") or "\\" in value or "//" in value:
        raise RegistryError(f"{name} must be a normalized relative repository path")
    if any(character in value for character in "*?[]"):
        raise RegistryError(f"{name} cannot contain glob syntax")
    normalized_value = value[:-1] if value.endswith("/") else value
    parsed = PurePosixPath(normalized_value)
    if (
        not normalized_value
        or parsed.as_posix() != normalized_value
        or any(part in {".", ".."} for part in parsed.parts)
        or (exact and value.endswith("/"))
    ):
        raise RegistryError(f"{name} must be a normalized relative repository path")
    return value


def _parse_profile(value: Any, *, index: int) -> TerminalProfile:
    item = _strict_object(value, name=f"terminalProfiles[{index}]", keys=frozenset({"id"}))
    return TerminalProfile(
        id=_safe_identifier(item["id"], name=f"terminalProfiles[{index}].id")
    )


def _parse_path_mapping(value: Any, *, index: int) -> PathMapping:
    item = _strict_object(value, name=f"pathMappings[{index}]", keys=_PATH_MAPPING_KEYS)
    match = item["match"]
    if not isinstance(match, str) or match not in _PATH_MATCHES:
        raise RegistryError(f"pathMappings[{index}].match must be exact or prefix")
    return PathMapping(
        match=match,
        path=_safe_repository_path(
            item["path"], name=f"pathMappings[{index}].path", exact=match == "exact"
        ),
        component=_safe_component(
            item["component"], name=f"pathMappings[{index}].component"
        ),
    )


def _parse_component_profiles(
    value: Any, *, profile_ids: set[str]
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    if not isinstance(value, dict) or not value or len(value) > 256:
        raise RegistryError("componentProfiles must be a non-empty bounded object")
    result: list[tuple[str, tuple[str, ...]]] = []
    for raw_component, raw_profiles in value.items():
        component = _safe_component(raw_component, name="componentProfiles key")
        profiles = _unique_string_list(
            raw_profiles,
            name=f"componentProfiles.{component}",
            maximum=64,
            validator=_safe_identifier,
        )
        unknown_profiles = sorted(set(profiles) - profile_ids)
        if unknown_profiles:
            raise RegistryError(
                f"componentProfiles.{component} references unknown profiles: "
                + ", ".join(unknown_profiles)
            )
        result.append((component, profiles))
    return tuple(sorted(result))


def _parse_component_host_selectors(
    value: Any,
    *,
    component_profiles: dict[str, tuple[str, ...]],
) -> tuple[ComponentHostSelector, ...]:
    if not isinstance(value, dict) or len(value) > 256:
        raise RegistryError("componentHostSelectors must be a bounded object")
    selectors: list[ComponentHostSelector] = []
    for raw_component, raw_selector in value.items():
        component = _safe_component(
            raw_component, name="componentHostSelectors key"
        )
        if not component_profiles.get(component):
            raise RegistryError(
                f"componentHostSelectors.{component} must reference a terminal component"
            )
        selector = _strict_object(
            raw_selector,
            name=f"componentHostSelectors.{component}",
            keys=_COMPONENT_HOST_SELECTOR_KEYS,
        )
        host_var = selector["hostVar"]
        match = selector["match"]
        if not isinstance(host_var, str) or _SAFE_HOST_VAR_RE.fullmatch(host_var) is None:
            raise RegistryError(
                f"componentHostSelectors.{component}.hostVar is invalid"
            )
        if not isinstance(match, str) or match not in _COMPONENT_HOST_SELECTOR_MATCHES:
            raise RegistryError(
                f"componentHostSelectors.{component}.match is invalid"
            )
        selectors.append(
            ComponentHostSelector(component=component, host_var=host_var, match=match)
        )
    return tuple(sorted(selectors, key=lambda item: item.component))


def _parse_client_agents(value: Any) -> tuple[ClientAgentContract, ...]:
    if not isinstance(value, dict) or not value or len(value) > 64:
        raise RegistryError("clientAgents must be a non-empty bounded object")
    agents: list[ClientAgentContract] = []
    for raw_id, raw_contract in value.items():
        agent_id = _safe_identifier(raw_id, name="clientAgents key")
        item = _strict_object(
            raw_contract, name=f"clientAgents.{agent_id}", keys=_CLIENT_AGENT_KEYS
        )
        compose_service = _safe_identifier(
            item["composeService"], name=f"clientAgents.{agent_id}.composeService"
        )
        runtime_env_path = item["runtimeEnvPath"]
        parsed_runtime_path = PurePosixPath(runtime_env_path) if isinstance(runtime_env_path, str) else None
        if (
            not isinstance(runtime_env_path, str)
            or len(runtime_env_path) > 512
            or not runtime_env_path.startswith("/")
            or runtime_env_path.endswith("/")
            or parsed_runtime_path is None
            or parsed_runtime_path.as_posix() != runtime_env_path
            or ".." in parsed_runtime_path.parts
            or not runtime_env_path.endswith("/.env")
        ):
            raise RegistryError(
                f"clientAgents.{agent_id}.runtimeEnvPath must name a normalized absolute .env file"
            )
        env_template = _safe_repository_path(
            item["envTemplate"],
            name=f"clientAgents.{agent_id}.envTemplate",
            exact=True,
        )
        if not env_template.startswith("infrastructure/ansible/templates/") or not env_template.endswith(".j2"):
            raise RegistryError(
                f"clientAgents.{agent_id}.envTemplate must be an Ansible env template"
            )
        port_policy = item["portPolicy"]
        if not isinstance(port_policy, str) or port_policy not in _PORT_POLICIES:
            raise RegistryError(
                f"clientAgents.{agent_id}.portPolicy must be fixed or configurable"
            )
        port_environment = item["portEnvironment"]
        if (
            not isinstance(port_environment, str)
            or _SAFE_ENVIRONMENT_NAME_RE.fullmatch(port_environment) is None
        ):
            raise RegistryError(
                f"clientAgents.{agent_id}.portEnvironment must be a safe environment name"
            )
        health_endpoint = item["healthEndpoint"]
        if (
            not isinstance(health_endpoint, str)
            or _SAFE_HEALTH_ENDPOINT_RE.fullmatch(health_endpoint) is None
            or "//" in health_endpoint
            or ".." in PurePosixPath(health_endpoint).parts
        ):
            raise RegistryError(
                f"clientAgents.{agent_id}.healthEndpoint must be a normalized path"
            )
        component = _safe_component(
            item["component"], name=f"clientAgents.{agent_id}.component"
        )
        host_selector_raw = _strict_object(
            item["hostSelector"],
            name=f"clientAgents.{agent_id}.hostSelector",
            keys=_COMPONENT_HOST_SELECTOR_KEYS,
        )
        host_var = host_selector_raw["hostVar"]
        host_match = host_selector_raw["match"]
        if not isinstance(host_var, str) or _SAFE_HOST_VAR_RE.fullmatch(host_var) is None:
            raise RegistryError(
                f"clientAgents.{agent_id}.hostSelector.hostVar is invalid"
            )
        if not isinstance(host_match, str) or host_match not in _COMPONENT_HOST_SELECTOR_MATCHES:
            raise RegistryError(
                f"clientAgents.{agent_id}.hostSelector.match is invalid"
            )
        agents.append(
            ClientAgentContract(
                id=agent_id,
                compose_service=compose_service,
                runtime_env_path=runtime_env_path,
                env_template=env_template,
                port_policy=port_policy,
                default_port=_bounded_int(
                    item["defaultPort"],
                    name=f"clientAgents.{agent_id}.defaultPort",
                    minimum=1,
                    maximum=65_535,
                ),
                port_environment=port_environment,
                health_endpoint=health_endpoint,
                response_validator=_safe_identifier(
                    item["responseValidator"],
                    name=f"clientAgents.{agent_id}.responseValidator",
                ),
                component=component,
                host_selector=ComponentHostSelector(
                    component=component, host_var=host_var, match=host_match
                ),
            )
        )
    return tuple(sorted(agents, key=lambda agent: agent.id))


def load_registry(
    registry_path: Path | str = DEFAULT_REGISTRY_PATH,
    *,
    repository_root: Path | str = PROJECT_ROOT,
) -> TerminalProfileRegistry:
    """Load and validate the static registry without executing repository content."""
    del repository_root
    path = Path(registry_path)
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise RegistryError(f"terminal profile registry cannot be read: {path}") from exc
    if len(raw) > 1024 * 1024:
        raise RegistryError("terminal profile registry exceeds the 1 MiB size limit")
    try:
        payload = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_json_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RegistryError("terminal profile registry is not valid UTF-8 JSON") from exc
    top = _strict_object(payload, name="terminal profile registry", keys=_TOP_LEVEL_KEYS)
    schema_version = _bounded_int(
        top["schemaVersion"], name="schemaVersion", minimum=SCHEMA_VERSION, maximum=SCHEMA_VERSION
    )
    raw_profiles = top["terminalProfiles"]
    if not isinstance(raw_profiles, list) or not raw_profiles or len(raw_profiles) > 64:
        raise RegistryError("terminalProfiles must contain from 1 to 64 profiles")
    profiles = tuple(_parse_profile(item, index=index) for index, item in enumerate(raw_profiles))
    profile_ids = {profile.id for profile in profiles}
    if len(profile_ids) != len(profiles):
        raise RegistryError("terminal profile ids must be unique")

    raw_path_mappings = top["pathMappings"]
    if not isinstance(raw_path_mappings, list) or not raw_path_mappings or len(raw_path_mappings) > 512:
        raise RegistryError("pathMappings must contain from 1 to 512 mappings")
    path_mappings = tuple(
        _parse_path_mapping(item, index=index)
        for index, item in enumerate(raw_path_mappings)
    )
    mapping_keys = [(mapping.match, mapping.path) for mapping in path_mappings]
    if len(mapping_keys) != len(set(mapping_keys)):
        raise RegistryError("pathMappings contains duplicate match/path entries")
    for index, mapping in enumerate(path_mappings):
        for earlier in path_mappings[:index]:
            if earlier.match == "prefix" and mapping.path.startswith(earlier.path):
                raise RegistryError(
                    f"pathMappings[{index}] is shadowed by an earlier prefix mapping"
                )

    component_profiles = _parse_component_profiles(
        top["componentProfiles"], profile_ids=profile_ids
    )
    component_map = dict(component_profiles)
    component_host_selectors = _parse_component_host_selectors(
        top["componentHostSelectors"], component_profiles=component_map
    )
    client_agents = _parse_client_agents(top["clientAgents"])
    mapped_components = {mapping.component for mapping in path_mappings}
    missing_components = sorted(mapped_components - set(component_map))
    if missing_components:
        raise RegistryError(
            "pathMappings reference components absent from componentProfiles: "
            + ", ".join(missing_components)
        )
    for non_runtime_component in ("neutral", "deploy-control"):
        if component_map.get(non_runtime_component) != ():
            raise RegistryError(
                f"componentProfiles.{non_runtime_component} must not target terminals"
            )
    if set(component_map.get("global", ())) != profile_ids:
        raise RegistryError("componentProfiles.global must target every terminal profile")
    selectors_by_component = {
        selector.component: selector for selector in component_host_selectors
    }
    for agent in client_agents:
        if not component_map.get(agent.component):
            raise RegistryError(
                f"clientAgents.{agent.id}.component must target a terminal profile"
            )
        if selectors_by_component.get(agent.component) != agent.host_selector:
            raise RegistryError(
                f"clientAgents.{agent.id}.hostSelector must match componentHostSelectors"
            )

    return TerminalProfileRegistry(
        schema_version=schema_version,
        profiles=profiles,
        path_mappings=path_mappings,
        component_profiles=component_profiles,
        component_host_selectors=component_host_selectors,
        client_agents=client_agents,
    )
