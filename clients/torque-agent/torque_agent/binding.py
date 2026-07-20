from __future__ import annotations

import time
from dataclasses import dataclass

from .models import WorkBinding


@dataclass
class BindingStore:
    ttl_seconds: float
    _binding: WorkBinding | None = None
    _expires_at: float = 0

    def update(self, binding: WorkBinding) -> None:
        self._binding = binding
        self._expires_at = time.monotonic() + self.ttl_seconds

    def clear(self) -> None:
        self._binding = None
        self._expires_at = 0

    def current(self) -> WorkBinding | None:
        if not self._binding or time.monotonic() >= self._expires_at:
            return None
        return self._binding
