from haizen_agent.classifier import DistributionToken, ManufacturingOrderToken, classify_scan_line


def test_classify_distribution_short_legacy() -> None:
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
    from haizen_agent.distribution_gate import DistributionGate

    g = DistributionGate()
    g.set_next_distribution(2)
    assert g.take_for_manufacturing_order_scan() == 2
    assert g.take_for_manufacturing_order_scan() is None


def test_classify_rejects_zero_legacy() -> None:
    t = classify_scan_line("0")
    assert isinstance(t, ManufacturingOrderToken)


def test_classify_rejects_leading_zero_three_digits_legacy() -> None:
    """012 は製造order側（パターン外）"""
    t = classify_scan_line("012")
    assert isinstance(t, ManufacturingOrderToken)


def test_prefixed_dist_accepts_dist_prefix() -> None:
    t = classify_scan_line("DIST:3", distribution_mode="prefixed_dist")
    assert isinstance(t, DistributionToken)
    assert t.value == 3


def test_prefixed_dist_case_insensitive() -> None:
    t = classify_scan_line("dist:12", distribution_mode="prefixed_dist")
    assert isinstance(t, DistributionToken)
    assert t.value == 12


def test_prefixed_dist_allows_whitespace_after_colon() -> None:
    t = classify_scan_line("DIST: 12", distribution_mode="prefixed_dist")
    assert isinstance(t, DistributionToken)
    assert t.value == 12


def test_prefixed_dist_rejects_bare_short_number() -> None:
    t = classify_scan_line("3", distribution_mode="prefixed_dist")
    assert isinstance(t, ManufacturingOrderToken)
    assert t.raw == "3"
