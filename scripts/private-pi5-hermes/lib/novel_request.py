#!/usr/bin/env python3
"""Parse Discord /novel quick_command payloads."""

from __future__ import annotations

import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class NovelRequest:
    """User creative prompt after /novel prefix (or argv)."""

    prompt: str

    @classmethod
    def from_argv(cls, argv: list[str] | None = None) -> NovelRequest:
        args = list(argv if argv is not None else sys.argv[1:])
        prompt = " ".join(part for part in args if part).strip()
        return cls(prompt=prompt)

    @classmethod
    def from_text(cls, text: str) -> NovelRequest:
        raw = (text or "").strip()
        if raw.lower().startswith("/novel"):
            raw = raw[6:].strip()
        return cls(prompt=raw)
