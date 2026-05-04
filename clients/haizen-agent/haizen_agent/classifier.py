"""区分: 分配番号（短い数値） vs 製造 order（その他のバーコード文字列）。"""

from __future__ import annotations

import re
from dataclasses import dataclass


_DIST_PATTERN = re.compile(r"^([1-9]\d{0,2})$")


@dataclass(frozen=True)
class DistributionToken:
    value: int


@dataclass(frozen=True)
class ManufacturingOrderToken:
    raw: str


ScanToken = DistributionToken | ManufacturingOrderToken


def classify_scan_line(line: str) -> ScanToken:
    s = line.strip()
    if not s:
        raise ValueError("empty scan")
    m = _DIST_PATTERN.match(s)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 999:
            return DistributionToken(value=v)
    return ManufacturingOrderToken(raw=s)
