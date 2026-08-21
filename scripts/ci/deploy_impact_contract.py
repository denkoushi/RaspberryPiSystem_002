"""Pure PR Deploy impact table contract.

The contract is deliberately independent from GitHub, Git, and subprocesses.
It consumes the current ``classify_event_changes.py`` JSON and uses the static
terminal profile registry only to infer target machines, then verifies that a
PR declaration is complete and no less conservative than the automatically
inferred impact.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Mapping

try:
    from scripts.deploy.deploy_impact import classify_change_records
except ModuleNotFoundError:  # pragma: no cover - direct module invocation fallback
    from deploy_impact import classify_change_records  # type: ignore[no-redef]


SCHEMA_VERSION = 1
START_MARKER = "<!-- deploy-impact:start -->"
END_MARKER = "<!-- deploy-impact:end -->"
REQUIRED_FIELDS = (
    "Risk",
    "Target machines",
    "Changed surfaces",
    "Required files/artifacts",
    "Database",
    "Secrets/config delivery",
    "Success evidence",
    "Rollback/cleanup",
    "Production verification",
)
RISK_ORDER = (
    "docs",
    "ui-logic",
    "api-agent-config",
    "db-auth-systemd-deploy",
    "unknown",
)
RISK_RANK = {risk: index for index, risk in enumerate(RISK_ORDER)}
TARGETS = frozenset({"pi3", "pi4", "pi5"})
SURFACES = frozenset(
    {"web", "api", "agent", "systemd", "config", "db", "auth", "deploy", "docs", "ci", "unknown"}
)
_ROW_RE = re.compile(r"^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$")
_PLACEHOLDER_RE = re.compile(
    r"(?:\b(?:TODO|TBD)\b|<[^>\n]*>|\b(?:replace|choose|select)\s+(?:one|this|here|value)\b|記入|選択|ここに|\.\.\.)",
    re.IGNORECASE,
)
_AUTH_RE = re.compile(r"(?:^|/)(?:auth|security|oauth|token)(?:/|\.|$)", re.IGNORECASE)
_SYSTEMD_SUFFIXES = (".service", ".timer", ".socket", ".path", ".target", ".mount")


class ImpactContractError(ValueError):
    """Raised when a PR declaration is malformed or under-declared."""


@dataclass(frozen=True)
class ImpactAssessment:
    declared: Mapping[str, str]
    inferred_risk: str
    inferred_targets: frozenset[str]
    inferred_surfaces: frozenset[str]
    deploy_components: tuple[str, ...]


def _normalize_value(value: str) -> str:
    normalized = value.strip()
    if len(normalized) >= 2 and normalized[0] == "`" and normalized[-1] == "`":
        normalized = normalized[1:-1].strip()
    if not normalized:
        raise ImpactContractError("Deploy impact table contains an empty value")
    if _PLACEHOLDER_RE.search(normalized):
        raise ImpactContractError(f"Deploy impact table contains a placeholder: {normalized!r}")
    return normalized


def parse_table(body: str) -> dict[str, str]:
    """Parse exactly one marker-bounded two-column Markdown table."""

    if not isinstance(body, str):
        raise ImpactContractError("pull request body must be text")
    if body.count(START_MARKER) != 1 or body.count(END_MARKER) != 1:
        raise ImpactContractError("PR body must contain exactly one Deploy impact table")
    start = body.index(START_MARKER) + len(START_MARKER)
    end = body.index(END_MARKER)
    if end <= start:
        raise ImpactContractError("Deploy impact table markers are out of order")

    values: dict[str, str] = {}
    saw_header = False
    for line in body[start:end].splitlines():
        match = _ROW_RE.match(line.strip())
        if not match:
            continue
        key, value = match.groups()
        key = key.strip()
        if key in {"Item", "Declaration"} or set(key) == {"-"}:
            saw_header = True
            continue
        if key not in REQUIRED_FIELDS:
            raise ImpactContractError(f"unknown Deploy impact table row: {key!r}")
        if key in values:
            raise ImpactContractError(f"duplicate Deploy impact table row: {key!r}")
        values[key] = _normalize_value(value)

    missing = sorted(set(REQUIRED_FIELDS) - set(values))
    if missing or not saw_header:
        details = ", ".join(missing) if missing else "table header"
        raise ImpactContractError(f"Deploy impact table is incomplete: {details}")
    return values


def _tokens(value: str, *, allowed: frozenset[str], field: str) -> frozenset[str]:
    tokens = frozenset(
        token.strip().strip("`").lower()
        for token in value.split(",")
        if token.strip()
    )
    if not tokens or not tokens <= allowed:
        invalid = sorted(tokens - allowed)
        raise ImpactContractError(f"{field} contains unsupported values: {invalid}")
    return tokens


def _target_tokens(value: str) -> frozenset[str]:
    """Parse device tokens while allowing a rationale after ``none``."""

    normalized: list[str] = []
    for raw_token in value.split(","):
        token = raw_token.strip().strip("`")
        if re.fullmatch(r"none(?:\s*(?::|—|-)\s*.+)?", token, re.IGNORECASE):
            normalized.append("none")
        else:
            normalized.append(token)
    return _tokens(",".join(normalized), allowed=TARGETS | {"none"}, field="Target machines")


def _require_reason(value: str, *, field: str) -> None:
    lowered = value.strip().lower()
    if lowered in {"n/a", "na", "none", "no"}:
        raise ImpactContractError(f"{field} must explain N/A/none/no")
    if lowered.startswith(("n/a", "na", "none", "no")):
        remainder = re.sub(r"^(?:n/a|na|none|no)\s*(?::|—|-)?\s*", "", value, flags=re.IGNORECASE)
        if not remainder.strip():
            raise ImpactContractError(f"{field} must explain N/A/none/no")


def _yes_no(value: str, *, field: str) -> bool:
    match = re.match(r"^(yes|no)\b", value.strip(), re.IGNORECASE)
    if not match:
        raise ImpactContractError(f"{field} must start with yes or no")
    remainder = value.strip()[match.end() :].strip(" :—-")
    if not remainder:
        raise ImpactContractError(f"{field} must include a reason or delivery method")
    return match.group(1).lower() == "yes"


def _path_surfaces(path: str) -> set[str]:
    normalized = PurePosixPath(path).as_posix().removeprefix("./")
    surfaces: set[str] = set()
    lower = normalized.lower()
    if _is_explicit_docs_path(normalized):
        surfaces.add("docs")
    if lower.startswith(".github/workflows/") or lower.startswith(".github/actions/"):
        surfaces.add("ci")
    if lower.startswith("scripts/ci/"):
        surfaces.add("ci")
    if lower.startswith("scripts/git_lifecycle/"):
        surfaces.add("ci")
    if lower.startswith("scripts/google_drive_dr/"):
        surfaces.add("deploy")
    if lower.startswith("apps/api/"):
        surfaces.add("api")
    if lower.startswith("apps/web/"):
        surfaces.add("web")
    if lower.startswith("packages/"):
        surfaces.update({"api", "web"})
    if lower.startswith("clients/") or lower.startswith("scripts/client/"):
        surfaces.add("agent")
    if lower.startswith("apps/api/prisma/"):
        surfaces.add("db")
    if _AUTH_RE.search(lower):
        surfaces.add("auth")
    if lower.startswith("infrastructure/ansible/"):
        surfaces.update({"config", "deploy"})
    if lower.startswith("infrastructure/docker/"):
        surfaces.update({"config", "deploy"})
    if lower.startswith("scripts/deploy/") or lower == "scripts/update-all-clients.sh":
        surfaces.add("deploy")
    if lower.endswith(_SYSTEMD_SUFFIXES) or any(
        lower.endswith(suffix + ".j2") for suffix in _SYSTEMD_SUFFIXES
    ):
        surfaces.add("systemd")
    return surfaces


def _is_explicit_docs_path(path: str) -> bool:
    """Return whether a path is explicitly documentation-owned."""

    normalized = PurePosixPath(path).as_posix().removeprefix("./").lower()
    if normalized.startswith(("docs/", ".cursor/", ".agent/")):
        return True
    if normalized.startswith(".github/") and normalized.endswith(
        (".md", ".mdc", ".markdown", ".mdx")
    ):
        return True
    if "/" not in normalized and (
        normalized == "readme"
        or normalized.startswith("readme.")
        or normalized.endswith((".md", ".markdown", ".mdx"))
    ):
        return True
    return False


def infer_surfaces(
    ci_classification: Mapping[str, Any],
    deploy_classification: Mapping[str, Any],
) -> frozenset[str]:
    surfaces: set[str] = set()
    changes = ci_classification.get("changes")
    if not isinstance(changes, list):
        return frozenset({"unknown"})
    if not changes and (
        ci_classification.get("fullSuite")
        or ci_classification.get("failClosedReasons")
    ):
        return frozenset({"unknown"})
    for change in changes:
        if not isinstance(change, Mapping):
            surfaces.add("unknown")
            continue
        status = change.get("status")
        if not isinstance(status, str) or status[:1] not in {"A", "M"}:
            surfaces.add("unknown")
        fail_closed_reason = change.get("failClosedReason")
        if isinstance(fail_closed_reason, str) and (
            fail_closed_reason.startswith("unknown path")
            or fail_closed_reason.startswith("unsupported git status")
        ):
            surfaces.add("unknown")
        path = change.get("path")
        if not isinstance(path, str):
            surfaces.add("unknown")
            continue
        surfaces.update(_path_surfaces(path))
        previous = change.get("previousPath")
        if isinstance(previous, str):
            surfaces.update(_path_surfaces(previous))
    explicit_docs_only = bool(changes) and all(
        isinstance(change, Mapping)
        and isinstance(change.get("path"), str)
        and _is_explicit_docs_path(change["path"])
        and (
            not isinstance(change.get("previousPath"), str)
            or _is_explicit_docs_path(change["previousPath"])
        )
        for change in changes
    )
    if ci_classification.get("fullSuite") and not explicit_docs_only:
        surfaces.add("unknown")
    components = deploy_classification.get("components", [])
    if not isinstance(components, list) or any(not isinstance(item, str) for item in components):
        surfaces.add("unknown")
    if "unknown" in components:
        surfaces.add("unknown")
    if not surfaces:
        surfaces.add("unknown")
    return frozenset(surfaces)


def infer_risk(
    ci_classification: Mapping[str, Any],
    surfaces: frozenset[str],
) -> str:
    if "unknown" in surfaces:
        return "unknown"
    changes = ci_classification.get("changes", [])
    if not isinstance(changes, list):
        return "unknown"
    for change in changes:
        if not isinstance(change, Mapping):
            return "unknown"
        status = change.get("status")
        if not isinstance(status, str) or status[:1] not in {"A", "M"}:
            return "unknown"
        fail_closed_reason = change.get("failClosedReason", "")
        if isinstance(fail_closed_reason, str) and fail_closed_reason.startswith(
            "unknown path"
        ):
            return "unknown"
    if surfaces & {"db", "auth", "systemd", "deploy", "config", "ci"}:
        return "db-auth-systemd-deploy"
    if surfaces & {"api", "agent"}:
        return "api-agent-config"
    if surfaces & {"web"}:
        return "ui-logic"
    return "docs"


def infer_targets(deploy_classification: Mapping[str, Any]) -> frozenset[str]:
    targets: set[str] = set()
    if deploy_classification.get("server"):
        targets.add("pi5")
    if deploy_classification.get("kiosk"):
        targets.add("pi4")
    if deploy_classification.get("signage"):
        targets.add("pi3")
    return frozenset(targets)


def assess(
    declaration: Mapping[str, str],
    classification: Mapping[str, Any],
) -> ImpactAssessment:
    if not isinstance(classification, Mapping):
        raise ImpactContractError("classification JSON must be an object")
    if classification.get("schemaVersion") != 6:
        raise ImpactContractError(
            "classification JSON must use classify_event_changes schemaVersion 6"
        )
    classified_changes = (
        classification.get("changes", [])
        if isinstance(classification.get("changes"), list)
        else []
    )
    # The enforced CI classifier is the authority for repository-policy-only
    # paths.  Do not turn a newly added development tool into a fleet target
    # merely because the deploy registry has no runtime component for it.
    deploy_changes = [
        change
        for change in classified_changes
        if not (
            isinstance(change, Mapping)
            and isinstance(change.get("categories"), list)
            and set(change["categories"]) == {"repo_policy"}
        )
    ]
    deploy_classification = classify_change_records(deploy_changes)
    if set(declaration) != set(REQUIRED_FIELDS):
        missing = sorted(set(REQUIRED_FIELDS) - set(declaration))
        extra = sorted(set(declaration) - set(REQUIRED_FIELDS))
        raise ImpactContractError(f"invalid declaration fields; missing={missing}, extra={extra}")
    risk = declaration["Risk"].strip().strip("`").lower()
    if risk not in RISK_RANK:
        raise ImpactContractError(f"unsupported Risk value: {risk!r}")
    targets = _target_tokens(declaration["Target machines"])
    if "none" in targets and len(targets) != 1:
        raise ImpactContractError("Target machines cannot combine none with a device")
    surfaces = _tokens(declaration["Changed surfaces"], allowed=SURFACES, field="Changed surfaces")
    _require_reason(declaration["Required files/artifacts"], field="Required files/artifacts")
    database_changed = _yes_no(declaration["Database"], field="Database")
    _yes_no(declaration["Secrets/config delivery"], field="Secrets/config delivery")
    _require_reason(declaration["Success evidence"], field="Success evidence")
    _require_reason(declaration["Rollback/cleanup"], field="Rollback/cleanup")
    _require_reason(declaration["Production verification"], field="Production verification")

    inferred_surfaces = infer_surfaces(classification, deploy_classification)
    inferred_risk = infer_risk(classification, inferred_surfaces)
    inferred_targets = infer_targets(deploy_classification)
    if RISK_RANK[risk] < RISK_RANK[inferred_risk]:
        raise ImpactContractError(
            f"Risk under-declared: declared={risk}, inferred={inferred_risk}"
        )
    declared_targets = set() if targets == {"none"} else set(targets)
    if not inferred_targets <= declared_targets:
        raise ImpactContractError(
            f"Target machines under-declared: declared={sorted(declared_targets)}, inferred={sorted(inferred_targets)}"
        )
    if not inferred_surfaces <= surfaces:
        raise ImpactContractError(
            f"Changed surfaces under-declared: declared={sorted(surfaces)}, inferred={sorted(inferred_surfaces)}"
        )
    if "db" in inferred_surfaces and not database_changed:
        raise ImpactContractError("Database must be yes when a database surface is inferred")
    return ImpactAssessment(
        declared=declaration,
        inferred_risk=inferred_risk,
        inferred_targets=inferred_targets,
        inferred_surfaces=inferred_surfaces,
        deploy_components=tuple(deploy_classification.get("components", [])),
    )


def render_summary(assessment: ImpactAssessment) -> str:
    targets = ", ".join(sorted(assessment.inferred_targets)) or "none"
    surfaces = ", ".join(sorted(assessment.inferred_surfaces))
    components = ", ".join(assessment.deploy_components) or "none"
    return "\n".join(
        [
            "## Deploy impact contract",
            "",
            f"- Declared risk: `{assessment.declared['Risk']}`",
            f"- Inferred minimum risk: `{assessment.inferred_risk}`",
            f"- Inferred target machines: `{targets}`",
            f"- Inferred surfaces: `{surfaces}`",
            f"- Registry components: `{components}`",
            "- Declaration is complete and does not reduce automatic CI selection.",
            "",
        ]
    )
