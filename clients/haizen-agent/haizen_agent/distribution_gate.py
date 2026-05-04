"""次の製造 order 1件だけ有効な分配番号の一時状態。"""

from __future__ import annotations


class DistributionGate:
    """直前にスキャンした分配番号を保持し、製造 order 処理時に1回だけ取り出す。"""

    __slots__ = ("_pending",)

    def __init__(self) -> None:
        self._pending: int | None = None

    def set_next_distribution(self, n: int) -> None:
        self._pending = n

    def take_for_manufacturing_order_scan(self) -> int | None:
        v = self._pending
        self._pending = None
        return v
