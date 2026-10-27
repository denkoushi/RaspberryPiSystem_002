"""A branch applies once, for at most 60 monotonic seconds."""

import time


class DistributionGate:
    def __init__(self, monotonic=time.monotonic):
        self.monotonic = monotonic
        self.clear()

    def clear(self):
        self.pending = 0
        self.expires_at = 0.0

    def set(self, branch_no, scanned_monotonic=None):
        self.pending = branch_no
        now = self.monotonic() if scanned_monotonic is None else scanned_monotonic
        self.expires_at = now + 60.0

    def take(self, scanned_monotonic=None):
        now = self.monotonic() if scanned_monotonic is None else scanned_monotonic
        branch = self.pending if now < self.expires_at else 0
        self.clear()
        return branch
