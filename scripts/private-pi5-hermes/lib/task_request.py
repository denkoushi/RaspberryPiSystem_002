#!/usr/bin/env python3
"""Parse Discord /task quick_command payloads."""

from __future__ import annotations

import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class TaskRequest:
    """User task text after /task prefix (or argv)."""

    prompt: str

    @classmethod
    def from_argv(cls, argv: list[str] | None = None) -> TaskRequest:
        args = list(argv if argv is not None else sys.argv[1:])
        prompt = " ".join(part for part in args if part).strip()
        return cls(prompt=prompt)

    @classmethod
    def from_text(cls, text: str) -> TaskRequest:
        raw = (text or "").strip()
        if raw.lower().startswith("/task"):
            raw = raw[5:].strip()
        return cls(prompt=raw)
