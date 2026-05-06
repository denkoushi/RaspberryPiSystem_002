"""区分: 分配番号 vs 製造 order（モード別に契約を固定）。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal


DistributionClassificationMode = Literal["legacy_short_numeric", "prefixed_dist"]

_DIST_LEGACY = re.compile(r"^([1-9]\d{0,2})$")
_DIST_PREFIXED = re.compile(r"^DIST:\s*([1-9]\d{0,2})$", re.IGNORECASE)


@dataclass(frozen=True)
class DistributionToken:
    value: int


@dataclass(frozen=True)
class ManufacturingOrderToken:
    raw: str


ScanToken = DistributionToken | ManufacturingOrderToken


def classify_scan_line(
    line: str,
    *,
    distribution_mode: DistributionClassificationMode = "legacy_short_numeric",
) -> ScanToken:
    s = line.strip()
    if not s:
        raise ValueError("empty scan")

    if distribution_mode == "prefixed_dist":
        m = _DIST_PREFIXED.match(s)
        if m:
            v = int(m.group(1))
            if 1 <= v <= 999:
                return DistributionToken(value=v)
        return ManufacturingOrderToken(raw=s)

    m = _DIST_LEGACY.match(s)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 999:
            return DistributionToken(value=v)
    return ManufacturingOrderToken(raw=s)
