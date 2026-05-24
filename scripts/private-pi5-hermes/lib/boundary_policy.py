#!/usr/bin/env python3
"""
URL and filesystem boundary policy for Hermes tools profile (Phase D0).

Pure validation logic — Hermes Agent does not call this yet; Ansible smoke and
future tool allowlists use the same definitions.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True)
class BoundaryPolicy:
    """Allow/deny rules for outbound URLs and local file paths."""

    allowed_url_prefixes: tuple[str, ...] = ()
    denied_url_prefixes: tuple[str, ...] = ()
    denied_host_patterns: tuple[str, ...] = ()
    allowed_fs_prefixes: tuple[str, ...] = ()
    denied_fs_prefixes: tuple[str, ...] = ()

    @classmethod
    def from_mapping(cls, data: dict[str, Any]) -> BoundaryPolicy:
        def _tuple(key: str) -> tuple[str, ...]:
            raw = data.get(key) or []
            if not isinstance(raw, list):
                raise ValueError(f"{key} must be a list")
            return tuple(str(item).strip() for item in raw if str(item).strip())

        return cls(
            allowed_url_prefixes=_tuple("allowed_url_prefixes"),
            denied_url_prefixes=_tuple("denied_url_prefixes"),
            denied_host_patterns=_tuple("denied_host_patterns"),
            allowed_fs_prefixes=_tuple("allowed_fs_prefixes"),
            denied_fs_prefixes=_tuple("denied_fs_prefixes"),
        )


@dataclass
class BoundaryValidationResult:
    ok: bool
    reason: str = ""


def _normalize_path(path: str) -> str:
    return str(Path(path).expanduser().resolve())


def _path_is_within(path: str, prefix: str) -> bool:
    try:
        return Path(path) == Path(prefix) or Path(path).is_relative_to(Path(prefix))
    except AttributeError:  # pragma: no cover
        normalized_path = f"{path.rstrip('/')}/"
        normalized_prefix = f"{prefix.rstrip('/')}/"
        return path == prefix or normalized_path.startswith(normalized_prefix)


def validate_url(url: str, policy: BoundaryPolicy) -> BoundaryValidationResult:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"}:
        return BoundaryValidationResult(False, f"unsupported scheme: {parsed.scheme!r}")

    full = url.strip()
    for prefix in policy.denied_url_prefixes:
        if full.startswith(prefix):
            return BoundaryValidationResult(False, f"denied url prefix: {prefix}")

    host = (parsed.hostname or "").lower()
    for pattern in policy.denied_host_patterns:
        if _host_matches_pattern(host, pattern):
            return BoundaryValidationResult(False, f"denied host pattern: {pattern}")

    if policy.allowed_url_prefixes:
        if not any(full.startswith(prefix) for prefix in policy.allowed_url_prefixes):
            return BoundaryValidationResult(False, "url not in allowed_url_prefixes")

    return BoundaryValidationResult(True, "ok")


def _host_matches_pattern(host: str, pattern: str) -> bool:
    pattern = pattern.strip().lower()
    if not pattern:
        return False
    if pattern.startswith("regex:"):
        return re.search(pattern[6:], host) is not None
    if "/" in pattern:
        try:
            network = ipaddress.ip_network(pattern, strict=False)
            addr = ipaddress.ip_address(host)
            return addr in network
        except ValueError:
            return False
    return host == pattern or host.endswith(f".{pattern}")


def validate_fs_path(path: str, policy: BoundaryPolicy) -> BoundaryValidationResult:
    try:
        normalized = _normalize_path(path)
    except OSError as exc:
        return BoundaryValidationResult(False, f"path resolution failed: {exc}")

    for prefix in policy.denied_fs_prefixes:
        denied = _normalize_path(prefix) if prefix.startswith("/") else prefix
        if _path_is_within(normalized, denied):
            return BoundaryValidationResult(False, f"denied fs prefix: {prefix}")

    if policy.allowed_fs_prefixes:
        allowed = False
        for prefix in policy.allowed_fs_prefixes:
            allowed_prefix = _normalize_path(prefix)
            if _path_is_within(normalized, allowed_prefix):
                allowed = True
                break
        if not allowed:
            return BoundaryValidationResult(False, "path not in allowed_fs_prefixes")

    return BoundaryValidationResult(True, "ok")


def validate_policy_document(data: dict[str, Any]) -> list[str]:
    """Return human-readable errors; empty list means valid."""
    errors: list[str] = []
    try:
        policy = BoundaryPolicy.from_mapping(data)
    except ValueError as exc:
        return [str(exc)]

    if not policy.allowed_url_prefixes and not policy.denied_url_prefixes:
        errors.append("define at least one of allowed_url_prefixes or denied_url_prefixes")

    for url in data.get("smoke_urls") or []:
        result = validate_url(str(url), policy)
        if not result.ok:
            errors.append(f"smoke_urls: {url!r}: {result.reason}")

    for path in data.get("smoke_paths") or []:
        result = validate_fs_path(str(path), policy)
        if not result.ok:
            errors.append(f"smoke_paths: {path!r}: {result.reason}")

    return errors
