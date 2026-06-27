#!/usr/bin/env python3
"""Research request parsing for Discord /ask."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ResearchRequest:
    prompt: str

    @classmethod
    def from_text(cls, text: str) -> "ResearchRequest":
        raw = (text or "").strip()
        lowered = raw.lower()
        if lowered.startswith("/ask"):
            raw = raw[4:].strip()
        return cls(prompt=raw)
