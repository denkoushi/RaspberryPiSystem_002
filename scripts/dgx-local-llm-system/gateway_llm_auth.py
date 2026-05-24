#!/usr/bin/env python3
"""
LLM shared-token authentication for DGX system-prod gateway.

Accepts StackChan-style X-LLM-Token or OpenAI-style Authorization: Bearer.
Supports multiple valid tokens via LLM_SHARED_ADDITIONAL_TOKENS (comma-separated).
"""

from __future__ import annotations

import os
from typing import Mapping


def parse_additional_tokens(raw: str) -> frozenset[str]:
    tokens: set[str] = set()
    for part in raw.split(","):
        token = part.strip()
        if token:
            tokens.add(token)
    return frozenset(tokens)


def load_llm_shared_tokens_from_env(
    environ: Mapping[str, str] | None = None,
) -> frozenset[str]:
    """Load primary + additional LLM shared tokens from environment."""
    env = environ if environ is not None else os.environ
    tokens: set[str] = set()
    primary = (env.get("LLM_SHARED_TOKEN") or "").strip()
    if primary:
        tokens.add(primary)
    additional = (env.get("LLM_SHARED_ADDITIONAL_TOKENS") or "").strip()
    if additional:
        tokens.update(parse_additional_tokens(additional))
    return frozenset(tokens)


def llm_shared_token_ok(headers: Mapping[str, str], expected_tokens: frozenset[str]) -> bool:
    """Return True when headers carry a token in expected_tokens."""
    if not expected_tokens:
        return False
    header_token = headers.get("X-LLM-Token", "")
    if header_token in expected_tokens:
        return True
    auth = headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        bearer = auth[len("Bearer ") :].strip()
        return bearer in expected_tokens
    return False
