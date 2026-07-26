"""Pure, data-driven release-readiness selection and admission policy.

The JSON registry may select only the closed facts, scopes and capabilities in
this module.  It cannot name commands, imports or Python callables.  After the
registry is loaded, every function in this module is deterministic and has no
remote or mutable-system side effects.
"""
from __future__ import annotations

import ast
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


EX_SOFTWARE = 70
EX_CONFIG = 78
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ID_RE = re.compile(r"^[a-z][a-z0-9.-]{2,127}$")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
MAX_CONDITION_DEPTH = 6
ACTION_LEVELS = {
    "verification": 1,
    "verification-only": 1,
    "activation": 2,
    "mutation": 3,
}
KNOWN_ACTIONS = frozenset(ACTION_LEVELS)
KNOWN_CAPABILITIES = frozenset(
    {
        "local.source-and-scope",
        "migration.production-ledger",
        "route.pi5-authority-and-resources",
        "route.external-server-build",
        "terminal.selected-prerequisites",
        "architecture.activation-executor",
        "architecture.verification-executor",
        "route.interrupted-run-recovery",
    }
)
KNOWN_FLAGS = frozenset(
    {
        "typedTargetPlanningEnabled",
        "activationExecutionEnabled",
        "verificationOnlyExecutionEnabled",
        "fullFleet",
        "reverifySelected",
    }
)
LEGACY_ENFORCED_GATE_IDS = frozenset(
    {
        "local.source-and-scope",
        "migration.production-ledger",
        "route.pi5-authority-and-resources",
        "route.external-server-build",
        "terminal.selected-prerequisites",
        "architecture.activation-executor",
        "architecture.verification-executor",
    }
)
REGISTRY_PATH = Path(__file__).resolve().parents[1] / "readiness-gates.json"
TERMINAL_REGISTRY_PATH = (
    Path(__file__).resolve().parents[1] / "terminal-profile-registry.json"
)


class ReadinessPolicyError(ValueError):
    """The registry, plan, evidence or admission contract is not auditable."""


@dataclass(frozen=True)
class WorkFact:
    host: str
    profile: str
    mutation: bool
    activation: bool
    verification: bool
    claims: tuple[str, ...]

    @property
    def actions(self) -> tuple[str, ...]:
        values: list[str] = []
        if self.mutation:
            values.append("mutation")
        if self.activation:
            values.append("activation")
        if self.verification:
            values.append("verification")
        if self.verification and not self.mutation and not self.activation:
            values.append("verification-only")
        return tuple(values)

    @property
    def action_level(self) -> int:
        return max((ACTION_LEVELS[value] for value in self.actions), default=0)


@dataclass(frozen=True)
class ReadinessFacts:
    sha: str
    components: tuple[str, ...]
    pi5_required: bool
    flags: tuple[tuple[str, bool], ...]
    terminal_work: tuple[WorkFact, ...]

    def flag(self, name: str) -> bool:
        values = dict(self.flags)
        if name not in values:
            raise ReadinessPolicyError(f"readiness fact flag is unavailable: {name}")
        return values[name]


@dataclass(frozen=True)
class GateDefinition:
    id: str
    owner: str
    classification: str
    mode: str
    protects: str
    failure_impact: str
    observation: str
    when: Mapping[str, Any]
    scope: Mapping[str, Any]
    capability: str
    issue_prefixes: tuple[str, ...]
    timeout_seconds: int
    recovery: str
    regression_test: str
    enforcement_basis: Mapping[str, Any]


@dataclass(frozen=True)
class ReadinessRegistry:
    schema_version: int
    policy_digest: str
    gates: tuple[GateDefinition, ...]
    component_coverage: Mapping[str, Mapping[str, Any]]
    profiles: frozenset[str]


@dataclass(frozen=True)
class GateSelection:
    gate: GateDefinition
    applies: bool
    hosts: tuple[str, ...]


@dataclass(frozen=True)
class ProbeRequest:
    capability: str
    gate_ids: tuple[str, ...]
    hosts: tuple[str, ...]
    timeout_seconds: int


@dataclass(frozen=True)
class ReadinessSelection:
    policy_digest: str
    facts: ReadinessFacts
    gates: tuple[GateSelection, ...]
    probes: tuple[ProbeRequest, ...]


@dataclass(frozen=True)
class ProbeEvidence:
    capability: str
    status: str
    issues: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    hosts: tuple[str, ...] = ()


@dataclass(frozen=True)
class GateDecision:
    id: str
    classification: str
    mode: str
    status: str
    capability: str
    hosts: tuple[str, ...]
    issues: tuple[str, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class ReadinessDecision:
    status: str
    exit_code: int
    policy_digest: str
    gates: tuple[GateDecision, ...]
    unowned_issues: tuple[str, ...] = ()


@dataclass(frozen=True)
class ReadinessAdmission:
    version: int
    sha: str
    policy_digest: str
    components: tuple[str, ...]
    pi5_required: bool
    terminal_work: tuple[WorkFact, ...]
    gate_ids: tuple[str, ...]
    capabilities: tuple[str, ...]
    scope_digest: str

    def as_payload(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "sha": self.sha,
            "policyDigest": self.policy_digest,
            "components": list(self.components),
            "pi5Required": self.pi5_required,
            "terminalWork": [
                {
                    "host": work.host,
                    "profile": work.profile,
                    "mutationRequired": work.mutation,
                    "activationRequired": work.activation,
                    "verificationRequired": work.verification,
                    "claims": list(work.claims),
                }
                for work in self.terminal_work
            ],
            "gateIds": list(self.gate_ids),
            "capabilities": list(self.capabilities),
            "scopeDigest": self.scope_digest,
        }


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def _require_text(value: Any, *, name: str, maximum: int = 4000) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or "\x00" in value
        or len(value) > maximum
    ):
        raise ReadinessPolicyError(f"{name} is missing or malformed")
    return value


def _load_json_object(path: Path, *, name: str) -> dict[str, Any]:
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=lambda constant: (_ for _ in ()).throw(
                ValueError(f"invalid JSON constant: {constant}")
            ),
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
        raise ReadinessPolicyError(f"{name} is not valid strict JSON") from error
    if not isinstance(value, dict):
        raise ReadinessPolicyError(f"{name} must be a JSON object")
    return value


def _reject_duplicate_keys(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _known_components_and_profiles(
    terminal_registry_path: Path,
) -> tuple[frozenset[str], frozenset[str]]:
    payload = _load_json_object(
        terminal_registry_path, name="terminal profile registry"
    )
    components = payload.get("componentProfiles")
    profiles = payload.get("terminalProfiles")
    if not isinstance(components, dict) or not isinstance(profiles, list):
        raise ReadinessPolicyError("terminal profile registry shape is malformed")
    profile_ids = {
        profile.get("id")
        for profile in profiles
        if isinstance(profile, dict) and isinstance(profile.get("id"), str)
    }
    if len(profile_ids) != len(profiles):
        raise ReadinessPolicyError("terminal profile registry profiles are malformed")
    return frozenset({*components, "unknown"}), frozenset(profile_ids)


def _validate_string_list(
    value: Any,
    *,
    name: str,
    allowed: frozenset[str] | None = None,
    allow_empty: bool = False,
) -> tuple[str, ...]:
    if (
        not isinstance(value, list)
        or (not allow_empty and not value)
        or any(not isinstance(item, str) or not item for item in value)
        or len(value) != len(set(value))
    ):
        raise ReadinessPolicyError(f"{name} must be a unique string list")
    if allowed is not None and not set(value) <= allowed:
        raise ReadinessPolicyError(f"{name} contains an unknown value")
    return tuple(value)


def _validate_condition(
    condition: Any,
    *,
    components: frozenset[str],
    profiles: frozenset[str],
    depth: int = 0,
) -> None:
    if depth > MAX_CONDITION_DEPTH or not isinstance(condition, dict):
        raise ReadinessPolicyError("readiness condition is malformed or too deep")
    if len(condition) != 1:
        raise ReadinessPolicyError("readiness condition must contain one operator")
    operator, value = next(iter(condition.items()))
    if operator == "always":
        if value is not True:
            raise ReadinessPolicyError("always condition must be true")
        return
    if operator in {"all", "any"}:
        if not isinstance(value, list) or not value:
            raise ReadinessPolicyError(f"{operator} condition must be non-empty")
        for nested in value:
            _validate_condition(
                nested,
                components=components,
                profiles=profiles,
                depth=depth + 1,
            )
        return
    if operator == "not":
        _validate_condition(
            value,
            components=components,
            profiles=profiles,
            depth=depth + 1,
        )
        return
    if operator == "componentAny":
        _validate_string_list(value, name=operator, allowed=components)
        return
    if operator == "serverWork":
        if type(value) is not bool:
            raise ReadinessPolicyError("serverWork condition must be boolean")
        return
    if operator == "flagEquals":
        if (
            not isinstance(value, dict)
            or set(value) != {"name", "value"}
            or value.get("name") not in KNOWN_FLAGS
            or type(value.get("value")) is not bool
        ):
            raise ReadinessPolicyError("flagEquals condition is malformed")
        return
    if operator == "terminalWorkAny":
        if not isinstance(value, dict) or set(value) != {"actions", "profiles"}:
            raise ReadinessPolicyError("terminalWorkAny condition is malformed")
        _validate_string_list(
            value["actions"], name="terminalWorkAny.actions", allowed=KNOWN_ACTIONS
        )
        _validate_string_list(
            value["profiles"],
            name="terminalWorkAny.profiles",
            allowed=profiles,
            allow_empty=True,
        )
        return
    raise ReadinessPolicyError(f"unknown readiness condition operator: {operator}")


def _validate_scope(
    scope: Any, *, profiles: frozenset[str]
) -> None:
    if not isinstance(scope, dict) or not isinstance(scope.get("kind"), str):
        raise ReadinessPolicyError("readiness scope is malformed")
    kind = scope["kind"]
    if kind in {"none", "pi5"}:
        if set(scope) != {"kind"}:
            raise ReadinessPolicyError(f"{kind} scope has unknown fields")
        return
    if kind == "terminalWork":
        if set(scope) != {"kind", "actions", "profiles"}:
            raise ReadinessPolicyError("terminalWork scope is malformed")
        _validate_string_list(
            scope["actions"], name="scope.actions", allowed=KNOWN_ACTIONS
        )
        _validate_string_list(
            scope["profiles"],
            name="scope.profiles",
            allowed=profiles,
            allow_empty=True,
        )
        return
    if kind == "inventory":
        raise ReadinessPolicyError(
            "inventory-wide readiness scope requires a separate reviewed safety design"
        )
    raise ReadinessPolicyError(f"unknown readiness scope: {kind}")


def _test_method_exists(project: Path, reference: str) -> bool:
    if "::" not in reference:
        return False
    relative, method = reference.split("::", 1)
    if not method.startswith("test_"):
        return False
    path = project / relative
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, SyntaxError):
        return False
    return any(
        isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == method
        for node in ast.walk(tree)
    )


def load_registry(
    path: Path = REGISTRY_PATH,
    *,
    terminal_registry_path: Path = TERMINAL_REGISTRY_PATH,
    project: Path | None = None,
) -> ReadinessRegistry:
    payload = _load_json_object(path, name="readiness registry")
    if set(payload) != {"schemaVersion", "gates", "componentCoverage"}:
        raise ReadinessPolicyError("readiness registry top-level fields are invalid")
    if type(payload["schemaVersion"]) is not int or payload["schemaVersion"] != 1:
        raise ReadinessPolicyError("unsupported readiness registry version")
    raw_gates = payload["gates"]
    coverage = payload["componentCoverage"]
    if not isinstance(raw_gates, list) or not raw_gates:
        raise ReadinessPolicyError("readiness gate registry must not be empty")
    if not isinstance(coverage, dict):
        raise ReadinessPolicyError("component coverage must be an object")
    components, profiles = _known_components_and_profiles(terminal_registry_path)
    expected_gate_fields = {
        "id",
        "owner",
        "classification",
        "mode",
        "protects",
        "failureImpact",
        "observation",
        "when",
        "scope",
        "capability",
        "issuePrefixes",
        "timeoutSeconds",
        "recovery",
        "regressionTest",
        "enforcementBasis",
    }
    definitions: list[GateDefinition] = []
    ids: set[str] = set()
    for raw in raw_gates:
        if not isinstance(raw, dict) or set(raw) != expected_gate_fields:
            raise ReadinessPolicyError("readiness gate fields are invalid")
        gate_id = _require_text(raw["id"], name="gate id", maximum=128)
        if ID_RE.fullmatch(gate_id) is None or gate_id in ids:
            raise ReadinessPolicyError("readiness gate ID is invalid or duplicated")
        ids.add(gate_id)
        owner = raw["owner"]
        classification = raw["classification"]
        mode = raw["mode"]
        if owner not in {"local", "pi5", "terminal", "architecture"}:
            raise ReadinessPolicyError(f"readiness gate owner is invalid: {gate_id}")
        if classification not in {"safety", "correctness", "warning"}:
            raise ReadinessPolicyError(
                f"readiness gate classification is invalid: {gate_id}"
            )
        if mode not in {"enforce", "observe"}:
            raise ReadinessPolicyError(f"readiness gate mode is invalid: {gate_id}")
        capability = raw["capability"]
        if capability not in KNOWN_CAPABILITIES:
            raise ReadinessPolicyError(f"readiness capability is invalid: {gate_id}")
        _validate_condition(
            raw["when"], components=components, profiles=profiles
        )
        _validate_scope(raw["scope"], profiles=profiles)
        issue_prefixes = _validate_string_list(
            raw["issuePrefixes"], name=f"{gate_id}.issuePrefixes"
        )
        if any(len(prefix) > 160 or "\x00" in prefix for prefix in issue_prefixes):
            raise ReadinessPolicyError(f"issue prefix is malformed: {gate_id}")
        timeout = raw["timeoutSeconds"]
        if type(timeout) is not int or not 1 <= timeout <= 300:
            raise ReadinessPolicyError(f"readiness timeout is invalid: {gate_id}")
        basis = raw["enforcementBasis"]
        if not isinstance(basis, dict) or not isinstance(basis.get("kind"), str):
            raise ReadinessPolicyError(f"enforcement basis is malformed: {gate_id}")
        kind = basis["kind"]
        if mode == "observe":
            if (
                set(basis) != {
                    "kind",
                    "requiredProductionRuns",
                    "productionRunIds",
                }
                or kind != "observe"
                or type(basis["requiredProductionRuns"]) is not int
                or basis["requiredProductionRuns"] < 3
                or any(
                    not isinstance(run_id, str)
                    or RUN_ID_RE.fullmatch(run_id) is None
                    for run_id in basis["productionRunIds"]
                )
            ):
                raise ReadinessPolicyError(
                    f"observe rollout evidence is malformed: {gate_id}"
                )
        elif kind == "existing-contract":
            if (
                gate_id not in LEGACY_ENFORCED_GATE_IDS
                or set(basis) != {"kind", "reason"}
            ):
                raise ReadinessPolicyError(
                    f"existing enforcement basis is malformed: {gate_id}"
                )
            _require_text(basis["reason"], name=f"{gate_id} enforcement reason")
        elif kind == "observed-promotion":
            if (
                set(basis) != {"kind", "productionRunIds", "reason"}
                or len(set(basis["productionRunIds"])) < 3
                or any(
                    not isinstance(run_id, str)
                    or RUN_ID_RE.fullmatch(run_id) is None
                    for run_id in basis["productionRunIds"]
                )
            ):
                raise ReadinessPolicyError(
                    f"observed promotion evidence is insufficient: {gate_id}"
                )
            _require_text(basis["reason"], name=f"{gate_id} promotion reason")
        elif kind == "immediate-safety":
            if classification != "safety" or set(basis) != {"kind", "reason"}:
                raise ReadinessPolicyError(
                    f"immediate enforcement is not justified: {gate_id}"
                )
            _require_text(basis["reason"], name=f"{gate_id} safety reason")
        else:
            raise ReadinessPolicyError(
                f"enforcement basis kind is unsupported: {gate_id}"
            )
        regression_test = _require_text(
            raw["regressionTest"], name=f"{gate_id} regression test"
        )
        root = project or Path(__file__).resolve().parents[3]
        if not _test_method_exists(root, regression_test):
            raise ReadinessPolicyError(
                f"readiness regression test does not exist: {gate_id}"
            )
        definitions.append(
            GateDefinition(
                id=gate_id,
                owner=owner,
                classification=classification,
                mode=mode,
                protects=_require_text(raw["protects"], name=f"{gate_id} protects"),
                failure_impact=_require_text(
                    raw["failureImpact"], name=f"{gate_id} failure impact"
                ),
                observation=_require_text(
                    raw["observation"], name=f"{gate_id} observation"
                ),
                when=raw["when"],
                scope=raw["scope"],
                capability=capability,
                issue_prefixes=issue_prefixes,
                timeout_seconds=timeout,
                recovery=_require_text(
                    raw["recovery"], name=f"{gate_id} recovery"
                ),
                regression_test=regression_test,
                enforcement_basis=basis,
            )
        )
    prefix_owners: dict[tuple[str, str], str] = {}
    for gate in definitions:
        for prefix in gate.issue_prefixes:
            key = (gate.capability, prefix)
            if key in prefix_owners:
                raise ReadinessPolicyError(
                    "readiness issue prefix has multiple owners: "
                    f"{prefix_owners[key]}, {gate.id}"
                )
            prefix_owners[key] = gate.id
    if set(coverage) != set(components):
        missing = sorted(set(components) - set(coverage))
        unknown = sorted(set(coverage) - set(components))
        raise ReadinessPolicyError(
            f"component coverage mismatch; missing={missing}, unknown={unknown}"
        )
    for component, decision in coverage.items():
        if not isinstance(decision, dict):
            raise ReadinessPolicyError(
                f"component coverage is malformed: {component}"
            )
        if set(decision) == {"gateIds"}:
            gate_ids = _validate_string_list(
                decision["gateIds"], name=f"{component}.gateIds"
            )
            if not set(gate_ids) <= ids:
                raise ReadinessPolicyError(
                    f"component coverage names an unknown gate: {component}"
                )
        elif set(decision) == {"noAdditionalGateReason"}:
            _require_text(
                decision["noAdditionalGateReason"],
                name=f"{component} no-additional-gate reason",
            )
        else:
            raise ReadinessPolicyError(
                f"component coverage must choose gates or a reason: {component}"
            )
    digest = hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()
    return ReadinessRegistry(
        schema_version=1,
        policy_digest=f"sha256:{digest}",
        gates=tuple(definitions),
        component_coverage=coverage,
        profiles=profiles,
    )


def _required_bool(payload: Mapping[str, Any], key: str) -> bool:
    value = payload.get(key)
    if type(value) is not bool:
        raise ReadinessPolicyError(f"plan boolean is unavailable: {key}")
    return value


def facts_from_plan(plan: Mapping[str, Any]) -> ReadinessFacts:
    if not isinstance(plan, Mapping):
        raise ReadinessPolicyError("readiness plan is unavailable")
    sha = plan.get("sha") or plan.get("desiredSha")
    if not isinstance(sha, str) or FULL_SHA_RE.fullmatch(sha) is None:
        raise ReadinessPolicyError("readiness plan SHA is unavailable")
    raw_components = plan.get("classificationComponents")
    # The current planner uses null for a genuine no-impact/no-op
    # classification.  Normalize that valid state to the registered neutral
    # component; an absent key remains an incomplete contract.
    if "classificationComponents" in plan and raw_components is None:
        raw_components = ["neutral"]
    components = _validate_string_list(
        raw_components, name="classificationComponents"
    )
    pi5_required = _required_bool(plan, "pi5Required")
    flags = tuple(
        (
            name,
            _required_bool(plan, name),
        )
        for name in sorted(KNOWN_FLAGS)
    )
    raw_work = plan.get("terminalWork")
    if not isinstance(raw_work, list):
        raise ReadinessPolicyError("terminalWork is unavailable")
    work_items: list[WorkFact] = []
    hosts: set[str] = set()
    for raw in raw_work:
        if not isinstance(raw, Mapping):
            raise ReadinessPolicyError("terminalWork entry is malformed")
        host = raw.get("host")
        profile = raw.get("role")
        if (
            not isinstance(host, str)
            or not host
            or host in hosts
            or not isinstance(profile, str)
            or not profile
        ):
            raise ReadinessPolicyError("terminalWork identity is malformed")
        hosts.add(host)
        requirements = raw.get("claimRequirements")
        if not isinstance(requirements, list):
            raise ReadinessPolicyError("terminalWork claim requirements are unavailable")
        claims: list[str] = []
        for requirement in requirements:
            kind = requirement.get("kind") if isinstance(requirement, Mapping) else None
            if not isinstance(kind, str) or not kind or kind in claims:
                raise ReadinessPolicyError(
                    "terminalWork claim requirement is malformed"
                )
            claims.append(kind)
        work_items.append(
            WorkFact(
                host=host,
                profile=profile,
                mutation=_required_bool(raw, "mutationRequired"),
                activation=_required_bool(raw, "activationRequired"),
                verification=_required_bool(raw, "verificationRequired"),
                claims=tuple(sorted(claims)),
            )
        )
    return ReadinessFacts(
        sha=sha,
        components=tuple(sorted(components)),
        pi5_required=pi5_required,
        flags=flags,
        terminal_work=tuple(work_items),
    )


def _work_matches(
    work: WorkFact, *, actions: Iterable[str], profiles: Iterable[str]
) -> bool:
    action_set = set(actions)
    profile_set = set(profiles)
    return (
        (not profile_set or work.profile in profile_set)
        and bool(action_set & set(work.actions))
    )


def _issue_matches(pattern: str, issue: str) -> bool:
    return (
        issue == pattern[1:]
        if pattern.startswith("=")
        else issue.startswith(pattern)
    )


def _issue_match_length(pattern: str) -> int:
    return len(pattern) - int(pattern.startswith("="))


def _condition_matches(condition: Mapping[str, Any], facts: ReadinessFacts) -> bool:
    operator, value = next(iter(condition.items()))
    if operator == "always":
        return True
    if operator == "all":
        return all(_condition_matches(item, facts) for item in value)
    if operator == "any":
        return any(_condition_matches(item, facts) for item in value)
    if operator == "not":
        return not _condition_matches(value, facts)
    if operator == "componentAny":
        return bool(set(value) & set(facts.components))
    if operator == "serverWork":
        return facts.pi5_required is value
    if operator == "flagEquals":
        return facts.flag(value["name"]) is value["value"]
    if operator == "terminalWorkAny":
        return any(
            _work_matches(
                work, actions=value["actions"], profiles=value["profiles"]
            )
            for work in facts.terminal_work
        )
    raise ReadinessPolicyError(f"unvalidated condition operator: {operator}")


def _scope_hosts(scope: Mapping[str, Any], facts: ReadinessFacts) -> tuple[str, ...]:
    kind = scope["kind"]
    if kind == "none":
        return ()
    if kind == "pi5":
        return ("pi5",)
    if kind == "terminalWork":
        return tuple(
            work.host
            for work in facts.terminal_work
            if _work_matches(
                work, actions=scope["actions"], profiles=scope["profiles"]
            )
        )
    raise ReadinessPolicyError(f"unvalidated scope: {kind}")


def select_readiness(
    registry: ReadinessRegistry, facts: ReadinessFacts
) -> ReadinessSelection:
    unknown_components = set(facts.components) - set(registry.component_coverage)
    if unknown_components:
        raise ReadinessPolicyError(
            f"readiness plan contains uncovered components: {sorted(unknown_components)}"
        )
    unknown_profiles = {
        work.profile for work in facts.terminal_work
    } - set(registry.profiles)
    if unknown_profiles:
        raise ReadinessPolicyError(
            f"readiness plan contains unknown profiles: {sorted(unknown_profiles)}"
        )
    selections = tuple(
        GateSelection(
            gate=gate,
            applies=(applies := _condition_matches(gate.when, facts)),
            hosts=_scope_hosts(gate.scope, facts) if applies else (),
        )
        for gate in registry.gates
    )
    grouped: dict[str, dict[str, Any]] = {}
    for selection in selections:
        if not selection.applies:
            continue
        record = grouped.setdefault(
            selection.gate.capability,
            {"gate_ids": [], "hosts": [], "timeout": 0},
        )
        record["gate_ids"].append(selection.gate.id)
        record["hosts"].extend(selection.hosts)
        record["timeout"] = max(
            record["timeout"], selection.gate.timeout_seconds
        )
    probes = tuple(
        ProbeRequest(
            capability=capability,
            gate_ids=tuple(sorted(record["gate_ids"])),
            hosts=tuple(dict.fromkeys(record["hosts"])),
            timeout_seconds=record["timeout"],
        )
        for capability, record in sorted(grouped.items())
    )
    return ReadinessSelection(
        policy_digest=registry.policy_digest,
        facts=facts,
        gates=selections,
        probes=probes,
    )


def readiness_plan_payload(selection: ReadinessSelection) -> dict[str, Any]:
    return {
        "version": 1,
        "policyDigest": selection.policy_digest,
        "components": list(selection.facts.components),
        "applicableGates": [
            gate.gate.id for gate in selection.gates if gate.applies
        ],
        "probes": [
            {
                "capability": probe.capability,
                "gateIds": list(probe.gate_ids),
                "hosts": list(probe.hosts),
                "timeoutSeconds": probe.timeout_seconds,
            }
            for probe in selection.probes
        ],
    }


def evaluate_readiness(
    registry: ReadinessRegistry,
    selection: ReadinessSelection,
    evidence: Sequence[ProbeEvidence],
) -> ReadinessDecision:
    evidence_by_capability: dict[str, ProbeEvidence] = {}
    for item in evidence:
        if item.capability in evidence_by_capability:
            raise ReadinessPolicyError(
                f"duplicate readiness evidence: {item.capability}"
            )
        if item.status not in {"passed", "blocked", "incomplete"}:
            raise ReadinessPolicyError(
                f"readiness evidence status is invalid: {item.capability}"
            )
        evidence_by_capability[item.capability] = item
    requested = {probe.capability for probe in selection.probes}
    unexpected = set(evidence_by_capability) - requested
    if unexpected:
        raise ReadinessPolicyError(
            f"readiness evidence capability was not requested: {sorted(unexpected)}"
        )
    unowned: list[str] = []
    decisions: list[GateDecision] = []
    applicable = [item for item in selection.gates if item.applies]
    for item in applicable:
        current = evidence_by_capability.get(item.gate.capability)
        if current is None:
            continue
        for issue in (*current.issues, *current.warnings):
            owners = [
                candidate.gate
                for candidate in applicable
                if candidate.gate.capability == current.capability
                and any(
                    _issue_matches(prefix, issue)
                    for prefix in candidate.gate.issue_prefixes
                )
            ]
            if not owners:
                unowned.append(issue)
                continue
            longest = max(
                _issue_match_length(prefix)
                for owner in owners
                for prefix in owner.issue_prefixes
                if _issue_matches(prefix, issue)
            )
            precise = [
                owner
                for owner in owners
                if any(
                    _issue_matches(prefix, issue)
                    and _issue_match_length(prefix) == longest
                    for prefix in owner.issue_prefixes
                )
            ]
            if len({owner.id for owner in precise}) != 1:
                unowned.append(issue)
    for item in selection.gates:
        gate = item.gate
        if not item.applies:
            status = "not-applicable"
            issues: tuple[str, ...] = ()
            warnings: tuple[str, ...] = ()
        else:
            current = evidence_by_capability.get(gate.capability)
            if current is None:
                status = "incomplete"
                issues = (f"{gate.capability}.missing-evidence",)
                warnings = ()
            else:
                owned_issues = tuple(
                    issue
                    for issue in current.issues
                    if any(
                        _issue_matches(prefix, issue)
                        for prefix in gate.issue_prefixes
                    )
                )
                owned_warnings = tuple(
                    warning
                    for warning in current.warnings
                    if any(
                        _issue_matches(prefix, warning)
                        for prefix in gate.issue_prefixes
                    )
                )
                issues = owned_issues
                warnings = owned_warnings
                if current.status == "incomplete":
                    status = "incomplete"
                elif owned_issues or owned_warnings:
                    status = "blocked" if gate.mode == "enforce" else "warned"
                elif current.status == "blocked":
                    status = "incomplete"
                else:
                    status = "passed"
        decisions.append(
            GateDecision(
                id=gate.id,
                classification=gate.classification,
                mode=gate.mode,
                status=status,
                capability=gate.capability,
                hosts=item.hosts,
                issues=issues,
                warnings=warnings,
            )
        )
    if unowned or any(item.status == "incomplete" for item in decisions):
        status, exit_code = "incomplete", EX_SOFTWARE
    elif any(item.status == "blocked" for item in decisions):
        status, exit_code = "blocked", EX_CONFIG
    elif any(item.status == "warned" for item in decisions):
        status, exit_code = "warned", 0
    else:
        status, exit_code = "passed", 0
    return ReadinessDecision(
        status=status,
        exit_code=exit_code,
        policy_digest=selection.policy_digest,
        gates=tuple(decisions),
        unowned_issues=tuple(sorted(set(unowned))),
    )


def readiness_review_payload(
    registry: ReadinessRegistry,
    decision: ReadinessDecision,
) -> dict[str, Any]:
    definitions = {gate.id: gate for gate in registry.gates}
    return {
        "version": 2,
        "status": decision.status,
        "policyDigest": decision.policy_digest,
        "gateCount": len(decision.gates),
        "classifications": {
            classification: sum(
                item.classification == classification for item in decision.gates
            )
            for classification in ("safety", "correctness", "warning")
        },
        "applicableGateCount": sum(
            item.status != "not-applicable" for item in decision.gates
        ),
        "indeterminateGateCount": sum(
            item.status == "incomplete" for item in decision.gates
        ),
        "unownedIssues": list(decision.unowned_issues),
        "gates": [
            {
                "id": item.id,
                "owner": definitions[item.id].owner,
                "classification": item.classification,
                "mode": item.mode,
                "protects": definitions[item.id].protects,
                "failureImpact": definitions[item.id].failure_impact,
                "failure_impact": definitions[item.id].failure_impact,
                "observation": definitions[item.id].observation,
                "appliesNow": item.status != "not-applicable",
                "applies_now": item.status != "not-applicable",
                "status": item.status,
                "capability": item.capability,
                "hosts": list(item.hosts),
                "issues": list(item.issues),
                "warnings": list(item.warnings),
                "timeoutSeconds": definitions[item.id].timeout_seconds,
                "recovery": definitions[item.id].recovery,
                "regressionTest": definitions[item.id].regression_test,
            }
            for item in decision.gates
        ],
    }


def unavailable_readiness_review(
    registry: ReadinessRegistry, issue_code: str
) -> dict[str, Any]:
    """Render a version 2 review when facts cannot be constructed."""

    _require_text(issue_code, name="readiness unavailable issue", maximum=256)
    decision = ReadinessDecision(
        status="incomplete",
        exit_code=EX_SOFTWARE,
        policy_digest=registry.policy_digest,
        gates=tuple(
            GateDecision(
                id=gate.id,
                classification=gate.classification,
                mode=gate.mode,
                status="incomplete",
                capability=gate.capability,
                hosts=(),
                issues=(issue_code,) if gate.id == "local.source-and-scope" else (),
                warnings=(),
            )
            for gate in registry.gates
        ),
        unowned_issues=(),
    )
    return readiness_review_payload(registry, decision)


def make_admission(
    selection: ReadinessSelection, decision: ReadinessDecision
) -> ReadinessAdmission:
    if decision.exit_code != 0:
        raise ReadinessPolicyError("readiness admission requires a passing review")
    body = {
        "sha": selection.facts.sha,
        "policyDigest": selection.policy_digest,
        "components": list(selection.facts.components),
        "pi5Required": selection.facts.pi5_required,
        "terminalWork": [asdict(work) for work in selection.facts.terminal_work],
        "gateIds": [
            item.id for item in decision.gates if item.status != "not-applicable"
        ],
        "capabilities": [probe.capability for probe in selection.probes],
    }
    digest = hashlib.sha256(_canonical_json(body).encode("utf-8")).hexdigest()
    return ReadinessAdmission(
        version=1,
        sha=selection.facts.sha,
        policy_digest=selection.policy_digest,
        components=selection.facts.components,
        pi5_required=selection.facts.pi5_required,
        terminal_work=selection.facts.terminal_work,
        gate_ids=tuple(body["gateIds"]),
        capabilities=tuple(body["capabilities"]),
        scope_digest=f"sha256:{digest}",
    )


def parse_admission(payload: Mapping[str, Any]) -> ReadinessAdmission:
    if not isinstance(payload, Mapping) or set(payload) != {
        "version",
        "sha",
        "policyDigest",
        "components",
        "pi5Required",
        "terminalWork",
        "gateIds",
        "capabilities",
        "scopeDigest",
    }:
        raise ReadinessPolicyError("readiness admission fields are malformed")
    if payload.get("version") != 1 or type(payload.get("version")) is not int:
        raise ReadinessPolicyError("readiness admission version is unsupported")
    sha = payload.get("sha")
    policy_digest = payload.get("policyDigest")
    scope_digest = payload.get("scopeDigest")
    if not isinstance(sha, str) or FULL_SHA_RE.fullmatch(sha) is None:
        raise ReadinessPolicyError("readiness admission SHA is malformed")
    for name, value in (
        ("policy digest", policy_digest),
        ("scope digest", scope_digest),
    ):
        if not isinstance(value, str) or re.fullmatch(r"sha256:[0-9a-f]{64}", value) is None:
            raise ReadinessPolicyError(f"readiness admission {name} is malformed")
    components = _validate_string_list(
        payload.get("components"), name="admission components"
    )
    if type(payload.get("pi5Required")) is not bool:
        raise ReadinessPolicyError("readiness admission Pi5 scope is malformed")
    gate_ids = _validate_string_list(payload.get("gateIds"), name="admission gates")
    capabilities = _validate_string_list(
        payload.get("capabilities"),
        name="admission capabilities",
        allowed=KNOWN_CAPABILITIES,
    )
    works: list[WorkFact] = []
    raw_works = payload.get("terminalWork")
    if not isinstance(raw_works, list):
        raise ReadinessPolicyError("readiness admission work is malformed")
    seen: set[str] = set()
    for raw in raw_works:
        if not isinstance(raw, Mapping) or set(raw) != {
            "host",
            "profile",
            "mutationRequired",
            "activationRequired",
            "verificationRequired",
            "claims",
        }:
            raise ReadinessPolicyError("readiness admission work entry is malformed")
        host = raw["host"]
        profile = raw["profile"]
        if (
            not isinstance(host, str)
            or not host
            or host in seen
            or not isinstance(profile, str)
            or not profile
        ):
            raise ReadinessPolicyError("readiness admission work identity is malformed")
        seen.add(host)
        works.append(
            WorkFact(
                host=host,
                profile=profile,
                mutation=_required_bool(raw, "mutationRequired"),
                activation=_required_bool(raw, "activationRequired"),
                verification=_required_bool(raw, "verificationRequired"),
                claims=_validate_string_list(
                    raw["claims"], name=f"{host} admission claims", allow_empty=True
                ),
            )
        )
    admission = ReadinessAdmission(
        version=1,
        sha=sha,
        policy_digest=policy_digest,
        components=tuple(components),
        pi5_required=payload["pi5Required"],
        terminal_work=tuple(works),
        gate_ids=tuple(gate_ids),
        capabilities=tuple(capabilities),
        scope_digest=scope_digest,
    )
    # Recompute from the semantic fields to reject a payload whose digest was
    # copied from another admitted scope.
    body = {
        "sha": admission.sha,
        "policyDigest": admission.policy_digest,
        "components": list(admission.components),
        "pi5Required": admission.pi5_required,
        "terminalWork": [asdict(work) for work in admission.terminal_work],
        "gateIds": list(admission.gate_ids),
        "capabilities": list(admission.capabilities),
    }
    expected = "sha256:" + hashlib.sha256(
        _canonical_json(body).encode("utf-8")
    ).hexdigest()
    if expected != admission.scope_digest:
        raise ReadinessPolicyError("readiness admission scope digest does not match")
    return admission


def compare_admission(
    admission: ReadinessAdmission,
    current: ReadinessSelection,
) -> tuple[str, ...]:
    issues: list[str] = []
    if admission.sha != current.facts.sha:
        issues.append("readiness-admission.sha-changed")
    if admission.policy_digest != current.policy_digest:
        issues.append("readiness-admission.policy-changed")
    if not set(current.facts.components) <= set(admission.components):
        issues.append("readiness-admission.component-expanded")
    if current.facts.pi5_required and not admission.pi5_required:
        issues.append("readiness-admission.pi5-work-expanded")
    admitted_work = {work.host: work for work in admission.terminal_work}
    for work in current.facts.terminal_work:
        prior = admitted_work.get(work.host)
        if prior is None:
            issues.append(f"readiness-admission.host-added:{work.host}")
            continue
        if work.profile != prior.profile:
            issues.append(f"readiness-admission.profile-changed:{work.host}")
        if work.action_level > prior.action_level:
            issues.append(f"readiness-admission.action-expanded:{work.host}")
        if not set(work.claims) <= set(prior.claims):
            issues.append(f"readiness-admission.claim-expanded:{work.host}")
    current_gate_ids = {
        item.gate.id for item in current.gates if item.applies
    }
    if not current_gate_ids <= set(admission.gate_ids):
        issues.append("readiness-admission.gate-expanded")
    current_capabilities = {probe.capability for probe in current.probes}
    if not current_capabilities <= set(admission.capabilities):
        issues.append("readiness-admission.capability-expanded")
    return tuple(issues)
