"""Only DIST:1 through DIST:5 select a distribution branch."""

import logging
import re
from dataclasses import dataclass
from typing import Optional, Union

LOG = logging.getLogger(__name__)
DIST = re.compile(r"DIST:\s*([+-]?[0-9]+)", re.IGNORECASE)


@dataclass(frozen=True)
class Distribution:
    branch_no: int


@dataclass(frozen=True)
class Slip:
    order_number: str


def classify(line: str) -> Optional[Union[Distribution, Slip]]:
    line = line.strip()
    if not line:
        return None
    match = DIST.fullmatch(line)
    if match:
        # Avoid int conversion limits for an accidentally very long barcode.
        digits = match[1].lstrip("+").lstrip("0")
        if digits in ("1", "2", "3", "4", "5"):
            return Distribution(int(digits))
        LOG.warning("Ignoring distribution outside 1..5")
        return None
    return Slip(line)
