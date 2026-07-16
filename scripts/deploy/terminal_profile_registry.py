"""Strict, data-only terminal deployment profile registry.

The registry selects identifiers and repository-owned assets.  It is not an
extension language: commands, shell fragments, Python import paths, and
arbitrary adapter options are deliberately absent from the schema.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any


SCHEMA_VERSION = 1
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY_PATH = Path(__file__).with_name("terminal-profile-registry.json")
_SAFE_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
_SAFE_GROUP_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
_SAFE_COMPONENT_RE = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
_SYSTEMD_UNIT_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}"
    r"\.(?:service|timer|socket|path|target|mount)$"
)
_ROLLBACK_PATH_RE = re.compile(r"^/[A-Za-z0-9._/@:+,=%-]+$")
_ALLOWED_ROLLBACK_PATHS = frozenset(
    {
        "/etc/NetworkManager/NetworkManager.conf",
        "/etc/raspi-haizen-agent.conf",
        "/etc/raspi-status-agent.conf",
        "/usr/bin/chromium-browser",
    }
)
_ALLOWED_ROLLBACK_PREFIXES = (
    "/etc/polkit-1/rules.d/",
    "/etc/systemd/system/",
    "/etc/tmpfiles.d/",
    "/opt/RaspberryPiSystem_002/",
    "/run/signage/",
    "/run/systemd/system/",
    "/usr/local/",
    "/var/spool/cron/",
)
_APPROVAL_POLICIES = frozenset({"human", "health-only"})
_PATH_MATCHES = frozenset({"exact", "prefix"})
_RESERVED_PROFILE_IDS = frozenset({"server", "pi5", "unknown"})
_RESERVED_INVENTORY_GROUPS = frozenset({"all", "clients", "server", "ungrouped"})
_TOP_LEVEL_KEYS = frozenset(
    {
        "schemaVersion",
        "pi5ControlPlane",
        "terminalProfiles",
        "pathMappings",
        "componentProfiles",
    }
)
_CONTROL_PLANE_KEYS = frozenset(
    {"id", "inventoryGroup", "adapterId", "requiredHostCount"}
)
_PROFILE_KEYS = frozenset(
    {
        "id",
        "inventoryGroup",
        "rolloutOrder",
        "impactComponent",
        "adapterId",
        "playbook",
        "noticeSeconds",
        "canaryGroup",
        "approvalPolicy",
        "adapterOptions",
    }
)
_ADAPTER_OPTION_KEYS = frozenset(
    {"systemdUnits", "rollbackPaths", "healthProbeIds", "readyAuthority"}
)
_READY_AUTHORITIES = frozenset({"control-plane", "terminal"})
_PATH_MAPPING_KEYS = frozenset({"match", "path", "component"})


class RegistryError(ValueError):
    """Raised when registry data violates the executable safety contract."""


@dataclass(frozen=True)
class Pi5ControlPlane:
    id: str
    inventory_group: str
    adapter_id: str
    required_host_count: int


@dataclass(frozen=True)
class AdapterOptions:
    systemd_units: tuple[str, ...]
    rollback_paths: tuple[str, ...]
    health_probe_ids: tuple[str, ...]
    ready_authority: str


@dataclass(frozen=True)
class TerminalProfile:
    id: str
    inventory_group: str
    rollout_order: int
    impact_component: str
    adapter_id: str
    playbook: str
    notice_seconds: int
    canary_group: str
    approval_policy: str
    adapter_options: AdapterOptions


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
class TerminalProfileRegistry:
    schema_version: int
    pi5_control_plane: Pi5ControlPlane
    profiles: tuple[TerminalProfile, ...]
    path_mappings: tuple[PathMapping, ...]
    component_profiles: tuple[tuple[str, tuple[str, ...]], ...]

    @property
    def profile_ids(self) -> tuple[str, ...]:
        return tuple(profile.id for profile in self.profiles)

    def profile(self, profile_id: str) -> TerminalProfile:
        for profile in self.profiles:
            if profile.id == profile_id:
                return profile
        raise KeyError(profile_id)

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


def _safe_group(value: Any, *, name: str) -> str:
    if not isinstance(value, str) or _SAFE_GROUP_RE.fullmatch(value) is None:
        raise RegistryError(f"{name} must be a safe inventory group")
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


def _safe_unit(value: Any, *, name: str) -> str:
    if (
        not isinstance(value, str)
        or ".." in value
        or _SYSTEMD_UNIT_RE.fullmatch(value) is None
    ):
        raise RegistryError(f"{name} must be a safe explicit systemd unit")
    return value


def _safe_rollback_path(value: Any, *, name: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) > 512
        or value.endswith("/")
        or _ROLLBACK_PATH_RE.fullmatch(value) is None
        or PurePosixPath(value).as_posix() != value
        or ".." in PurePosixPath(value).parts
        or (
            value not in _ALLOWED_ROLLBACK_PATHS
            and not value.startswith(_ALLOWED_ROLLBACK_PREFIXES)
        )
    ):
        raise RegistryError(f"{name} must be a normalized allowlisted absolute path")
    return value


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


def _validated_playbook(value: Any, *, repository_root: Path, name: str) -> str:
    path = _safe_repository_path(value, name=name, exact=True)
    parsed = PurePosixPath(path)
    if parsed.suffix not in {".yml", ".yaml"}:
        raise RegistryError(f"{name} must be an Ansible YAML playbook")
    ansible_root = (repository_root / "infrastructure/ansible").resolve()
    candidate = (ansible_root / Path(*parsed.parts)).resolve()
    if not candidate.is_relative_to(ansible_root) or not candidate.is_file():
        raise RegistryError(f"{name} must exist below the Ansible root")
    return path


def _parse_control_plane(value: Any) -> Pi5ControlPlane:
    item = _strict_object(
        value, name="pi5ControlPlane", keys=_CONTROL_PLANE_KEYS
    )
    control_plane = Pi5ControlPlane(
        id=_safe_identifier(item["id"], name="pi5ControlPlane.id"),
        inventory_group=_safe_group(
            item["inventoryGroup"], name="pi5ControlPlane.inventoryGroup"
        ),
        adapter_id=_safe_identifier(
            item["adapterId"], name="pi5ControlPlane.adapterId"
        ),
        required_host_count=_bounded_int(
            item["requiredHostCount"],
            name="pi5ControlPlane.requiredHostCount",
            minimum=1,
            maximum=1,
        ),
    )
    if (
        control_plane.id != "pi5"
        or control_plane.inventory_group != "server"
        or control_plane.adapter_id != "pi5-blue-green"
    ):
        raise RegistryError(
            "pi5ControlPlane must use id pi5, server group, and pi5-blue-green adapter"
        )
    return control_plane


def _parse_adapter_options(value: Any, *, profile_id: str) -> AdapterOptions:
    item = _strict_object(
        value,
        name=f"terminal profile {profile_id} adapterOptions",
        keys=_ADAPTER_OPTION_KEYS,
    )
    ready_authority = item["readyAuthority"]
    if (
        not isinstance(ready_authority, str)
        or ready_authority not in _READY_AUTHORITIES
    ):
        raise RegistryError(
            f"terminal profile {profile_id} readyAuthority must be "
            "control-plane or terminal"
        )
    return AdapterOptions(
        systemd_units=_unique_string_list(
            item["systemdUnits"],
            name=f"terminal profile {profile_id} systemdUnits",
            maximum=64,
            validator=_safe_unit,
        ),
        rollback_paths=_unique_string_list(
            item["rollbackPaths"],
            name=f"terminal profile {profile_id} rollbackPaths",
            maximum=256,
            validator=_safe_rollback_path,
        ),
        health_probe_ids=_unique_string_list(
            item["healthProbeIds"],
            name=f"terminal profile {profile_id} healthProbeIds",
            maximum=32,
            validator=_safe_identifier,
        ),
        ready_authority=ready_authority,
    )


def _parse_profile(
    value: Any, *, index: int, repository_root: Path
) -> TerminalProfile:
    item = _strict_object(
        value, name=f"terminalProfiles[{index}]", keys=_PROFILE_KEYS
    )
    profile_id = _safe_identifier(
        item["id"], name=f"terminalProfiles[{index}].id"
    )
    if profile_id in _RESERVED_PROFILE_IDS:
        raise RegistryError(f"terminal profile id is reserved: {profile_id}")
    inventory_group = _safe_group(
        item["inventoryGroup"],
        name=f"terminal profile {profile_id} inventoryGroup",
    )
    if inventory_group in _RESERVED_INVENTORY_GROUPS:
        raise RegistryError(
            f"terminal profile inventory group is reserved: {inventory_group}"
        )
    canary_group = _safe_group(
        item["canaryGroup"], name=f"terminal profile {profile_id} canaryGroup"
    )
    if canary_group in _RESERVED_INVENTORY_GROUPS or canary_group == inventory_group:
        raise RegistryError(
            f"terminal profile {profile_id} canaryGroup must be a distinct non-reserved group"
    )
    approval_policy = item["approvalPolicy"]
    if (
        not isinstance(approval_policy, str)
        or approval_policy not in _APPROVAL_POLICIES
    ):
        raise RegistryError(
            f"terminal profile {profile_id} approvalPolicy must be human or health-only"
        )
    return TerminalProfile(
        id=profile_id,
        inventory_group=inventory_group,
        rollout_order=_bounded_int(
            item["rolloutOrder"],
            name=f"terminal profile {profile_id} rolloutOrder",
            minimum=1,
            maximum=10_000,
        ),
        impact_component=_safe_component(
            item["impactComponent"],
            name=f"terminal profile {profile_id} impactComponent",
        ),
        adapter_id=_safe_identifier(
            item["adapterId"], name=f"terminal profile {profile_id} adapterId"
        ),
        playbook=_validated_playbook(
            item["playbook"],
            repository_root=repository_root,
            name=f"terminal profile {profile_id} playbook",
        ),
        notice_seconds=_bounded_int(
            item["noticeSeconds"],
            name=f"terminal profile {profile_id} noticeSeconds",
            minimum=0,
            maximum=3_600,
        ),
        canary_group=canary_group,
        approval_policy=approval_policy,
        adapter_options=_parse_adapter_options(
            item["adapterOptions"], profile_id=profile_id
        ),
    )


def _parse_path_mapping(value: Any, *, index: int) -> PathMapping:
    item = _strict_object(
        value, name=f"pathMappings[{index}]", keys=_PATH_MAPPING_KEYS
    )
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


def load_registry(
    registry_path: Path | str = DEFAULT_REGISTRY_PATH,
    *,
    repository_root: Path | str = PROJECT_ROOT,
) -> TerminalProfileRegistry:
    """Load and validate one registry without executing repository content."""
    path = Path(registry_path)
    root = Path(repository_root).resolve()
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
    top = _strict_object(
        payload, name="terminal profile registry", keys=_TOP_LEVEL_KEYS
    )
    schema_version = _bounded_int(
        top["schemaVersion"],
        name="schemaVersion",
        minimum=SCHEMA_VERSION,
        maximum=SCHEMA_VERSION,
    )
    control_plane = _parse_control_plane(top["pi5ControlPlane"])

    raw_profiles = top["terminalProfiles"]
    if (
        not isinstance(raw_profiles, list)
        or not raw_profiles
        or len(raw_profiles) > 64
    ):
        raise RegistryError("terminalProfiles must contain from 1 to 64 profiles")
    profiles = tuple(
        sorted(
            (
                _parse_profile(item, index=index, repository_root=root)
                for index, item in enumerate(raw_profiles)
            ),
            key=lambda profile: (profile.rollout_order, profile.id),
        )
    )
    for name, values in (
        ("profile ids", [profile.id for profile in profiles]),
        ("inventory groups", [profile.inventory_group for profile in profiles]),
        ("canary groups", [profile.canary_group for profile in profiles]),
        ("rollout orders", [profile.rollout_order for profile in profiles]),
    ):
        if len(values) != len(set(values)):
            raise RegistryError(f"terminal profile {name} must be unique")

    raw_path_mappings = top["pathMappings"]
    if (
        not isinstance(raw_path_mappings, list)
        or not raw_path_mappings
        or len(raw_path_mappings) > 512
    ):
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

    profile_ids = {profile.id for profile in profiles}
    component_profiles = _parse_component_profiles(
        top["componentProfiles"], profile_ids=profile_ids
    )
    component_map = dict(component_profiles)
    mapped_components = {mapping.component for mapping in path_mappings}
    missing_components = sorted(mapped_components - set(component_map))
    if missing_components:
        raise RegistryError(
            "pathMappings reference components absent from componentProfiles: "
            + ", ".join(missing_components)
        )
    for profile in profiles:
        if profile.impact_component not in mapped_components:
            raise RegistryError(
                f"terminal profile {profile.id} impactComponent has no path mapping"
            )
        if profile.id not in component_map.get(profile.impact_component, ()):
            raise RegistryError(
                f"terminal profile {profile.id} impactComponent does not target itself"
            )
    for non_runtime_component in ("neutral", "deploy-control"):
        if component_map.get(non_runtime_component) != ():
            raise RegistryError(
                f"componentProfiles.{non_runtime_component} must not target terminals"
            )
    if set(component_map.get("global", ())) != profile_ids:
        raise RegistryError("componentProfiles.global must target every terminal profile")

    return TerminalProfileRegistry(
        schema_version=schema_version,
        pi5_control_plane=control_plane,
        profiles=profiles,
        path_mappings=path_mappings,
        component_profiles=component_profiles,
    )
