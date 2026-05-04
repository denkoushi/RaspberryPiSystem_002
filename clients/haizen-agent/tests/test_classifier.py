import pytest

from haizen_agent.classifier import DistributionToken, ManufacturingOrderToken, classify_scan_line
from haizen_agent.distribution_gate import DistributionGate


def test_classify_distribution_short() -> None:
    assert classify_scan_line("3") == DistributionToken(value=3)
    assert classify_scan_line(" 12 ") == DistributionToken(value=12)


def test_classify_order_numeric_long() -> None:
    t = classify_scan_line("1234567890")
    assert isinstance(t, ManufacturingOrderToken)
    assert t.raw == "1234567890"


def test_classify_order_with_hyphen() -> None:
    t = classify_scan_line("ABC-123")
    assert isinstance(t, ManufacturingOrderToken)


def test_distribution_gate_single_use() -> None:
    g = DistributionGate()
    g.set_next_distribution(2)
    assert g.take_for_manufacturing_order_scan() == 2
    assert g.take_for_manufacturing_order_scan() is None


def test_classify_rejects_zero() -> None:
    t = classify_scan_line("0")
    assert isinstance(t, ManufacturingOrderToken)


def test_classify_rejects_leading_zero_three_digits() -> None:
    """012 は製造order側（パターン外）"""
    t = classify_scan_line("012")
    assert isinstance(t, ManufacturingOrderToken)
