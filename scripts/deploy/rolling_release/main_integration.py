"""Pure repository-completion audit for rolling-release presentation."""
from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from typing import Any


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
AncestryPredicate = Callable[[str, str], bool]


def _valid_sha(value: Any) -> str | None:
    return value if isinstance(value, str) and FULL_SHA_RE.fullmatch(value) else None


def _relation(
    candidate: str | None,
    origin_main_sha: str | None,
    *,
    issue_prefix: str,
    is_ancestor: AncestryPredicate,
    issues: list[str],
) -> bool | None:
    if candidate is None or origin_main_sha is None:
        return None
    try:
        result = is_ancestor(candidate, origin_main_sha)
    except Exception:
        issues.append(f"{issue_prefix}.ancestry-unavailable")
        return None
    if type(result) is not bool:
        issues.append(f"{issue_prefix}.ancestry-malformed")
        return None
    return result


def build_main_integration_audit(
    *,
    source_sha: Any,
    origin_main_sha: Any,
    production_shas: Iterable[Any],
    is_ancestor: AncestryPredicate,
    origin_main_authoritative: bool = True,
) -> dict[str, Any]:
    """Return fail-closed main-integration evidence without running Git.

    Operational release success remains independent of this audit.  Unknown
    or malformed repository evidence blocks only the higher-level task
    completion claim.
    """

    issues: list[str] = []
    source = _valid_sha(source_sha)
    if source is None:
        issues.append("source.sha-unavailable")

    main = _valid_sha(origin_main_sha)
    if main is None or origin_main_authoritative is not True:
        main = None
        issues.append("origin-main.sha-unavailable")

    normalized_production: set[str] = set()
    production_evidence_complete = True
    for value in production_shas:
        sha = _valid_sha(value)
        if sha is None:
            production_evidence_complete = False
            continue
        normalized_production.add(sha)
    if not production_evidence_complete or not normalized_production:
        issues.append("production.sha-unavailable")
    ordered_production = sorted(normalized_production)

    source_in_main = _relation(
        source,
        main,
        issue_prefix="source",
        is_ancestor=is_ancestor,
        issues=issues,
    )
    production_relations = [
        _relation(
            sha,
            main,
            issue_prefix="production",
            is_ancestor=is_ancestor,
            issues=issues,
        )
        for sha in ordered_production
    ]
    if production_relations and any(value is False for value in production_relations):
        production_in_main: bool | None = False
    elif (
        production_evidence_complete
        and production_relations
        and all(value is True for value in production_relations)
    ):
        production_in_main = True
    else:
        production_in_main = None

    explicit_pending = source_in_main is False or production_in_main is False
    unavailable = source_in_main is None or production_in_main is None
    if explicit_pending:
        status = "pending"
    elif unavailable:
        status = "unavailable"
    else:
        status = "integrated"
    completion_eligible = status == "integrated"

    return {
        "version": 1,
        "status": status,
        "sourceSha": source,
        "originMainSha": main,
        "sourceShaIsInMain": source_in_main,
        "productionSha": (
            ordered_production[0] if len(ordered_production) == 1 else None
        ),
        "productionShas": ordered_production,
        "productionShaIsInMain": production_in_main,
        "integrationPending": not completion_eligible,
        "completionEligible": completion_eligible,
        "issues": sorted(set(issues)),
    }
