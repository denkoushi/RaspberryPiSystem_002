#!/usr/bin/env python3
"""Map boundary-policy.tools.yaml to Hermes security.website_blocklist settings."""

from __future__ import annotations

from urllib.parse import urlparse

from .boundary_policy import BoundaryPolicy

# Hermes website_blocklist domain rules derived from boundary deny rules (D3).
_STATIC_BLOCKLIST_DOMAINS: tuple[str, ...] = (
    "localhost",
    "127.0.0.1",
    "*.local",
    "*.internal",
)


def expected_llm_base_url_from_policy(policy: BoundaryPolicy) -> str:
    """Return the allowed DGX base URL (no trailing path) for config contract checks."""
    if not policy.allowed_url_prefixes:
        raise ValueError("allowed_url_prefixes must define at least one entry for D3")
    prefix = policy.allowed_url_prefixes[0].rstrip("/")
    parsed = urlparse(prefix)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"invalid allowed_url_prefixes entry: {prefix!r}")
    return f"{parsed.scheme}://{parsed.netloc}"


def website_blocklist_domains_from_policy(policy: BoundaryPolicy) -> tuple[str, ...]:
    """
    Derive Hermes security.website_blocklist.domains from boundary deny rules.

    Hermes uses a deny-list model; allowed_url_prefixes are enforced via
    model/custom_providers base_url alignment in config_contract (not blocklist).
    """
    domains: list[str] = list(_STATIC_BLOCKLIST_DOMAINS)
    seen: set[str] = set(domains)

    for prefix in policy.denied_url_prefixes:
        parsed = urlparse(prefix)
        host = (parsed.hostname or "").strip().lower()
        if host and host not in seen:
            domains.append(host)
            seen.add(host)

    for pattern in policy.denied_host_patterns:
        domain = _host_pattern_to_blocklist_domain(pattern)
        if domain and domain not in seen:
            domains.append(domain)
            seen.add(domain)

    return tuple(domains)


def _host_pattern_to_blocklist_domain(pattern: str) -> str | None:
    """Best-effort conversion of boundary host patterns to Hermes domain rules."""
    raw = pattern.strip()
    if not raw:
        return None
    if raw.startswith("regex:"):
        return None
    if "/" in raw:
        return None
    return raw.lower()


def hermes_security_blocklist_document(policy: BoundaryPolicy) -> dict[str, object]:
    """Hermes config fragment: security.website_blocklist."""
    return {
        "enabled": True,
        "domains": list(website_blocklist_domains_from_policy(policy)),
        "shared_files": [],
    }


def hermes_security_emission(policy: BoundaryPolicy) -> dict[str, object]:
    """JSON payload for validate_boundary_policy.py --emit-hermes-security."""
    return {
        "expected_llm_base_url": expected_llm_base_url_from_policy(policy),
        "website_blocklist": hermes_security_blocklist_document(policy),
    }
