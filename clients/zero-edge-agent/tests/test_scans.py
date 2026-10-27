from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from zero_edge_agent import clock
from zero_edge_agent.classifier import Distribution, Slip, classify
from zero_edge_agent.distribution_gate import DistributionGate
from zero_edge_agent.keyboard import Scan
from zero_edge_agent.main import ScanProcessor
from zero_edge_agent.queue import ScanQueue


@pytest.fixture(autouse=True)
def reset_clock_cache(monkeypatch):
    monkeypatch.setattr(clock, "_cache_until", 0.0)
    monkeypatch.setattr(clock, "_cached_result", False)


@pytest.mark.parametrize("line, expected", [
    ("DIST:1", Distribution(1)), (" dist: 5 ", Distribution(5)),
    ("DiSt:3", Distribution(3)), ("DIST:02", Distribution(2)),
    ("DIST:0", None), ("DIST:6", None), ("DIST:-1", None), ("DIST:999", None),
    ("DIST:" + "9" * 5000, None), ("", None), ("  ", None),
    ("  abc-001  ", Slip("abc-001")), ("1", Slip("1")),
    ("DIST:abc", Slip("DIST:abc")), ("DIST:1x", Slip("DIST:1x")),
])
def test_classifier(line, expected):
    assert classify(line) == expected


def test_invalid_distribution_is_logged(caplog):
    assert classify("DIST:7") is None
    assert "outside 1..5" in caplog.text


def test_distribution_next_slip_only_and_replacement():
    now = [100.0]
    gate = DistributionGate(lambda: now[0])
    assert gate.take() == 0
    gate.set(1)
    now[0] = 150
    gate.set(4)
    now[0] = 209.999
    assert gate.take() == 4
    assert gate.take() == 0


@pytest.mark.parametrize("elapsed, expected", [(59.999, 2), (60, 0), (61, 0)])
def test_distribution_expiry(elapsed, expected):
    gate = DistributionGate()
    gate.set(2, 100)
    assert gate.take(100 + elapsed) == expected
    assert gate.take(100 + elapsed) == 0


def test_clock_gate_drops_and_clears_pending_distribution(tmp_path, caplog):
    queue = ScanQueue(tmp_path / "queue.db")
    synced = [False]
    processor = ScanProcessor(queue, clock_check=lambda: synced[0])
    at = datetime.fromisoformat("2026-10-27T14:03:00.123+09:00")
    processor.process(Scan("DIST:2", at, 0))
    processor.process(Scan("lost", at, 1))
    assert queue.oldest() is None
    assert "not NTP synchronized" in caplog.text
    synced[0] = True
    processor.process(Scan("DIST:3", at, 2))
    synced[0] = False
    processor.process(Scan("lost-again", at, 3))
    synced[0] = True
    processor.process(Scan("  kept  ", at, 4))
    assert queue.oldest()["orderNumber"] == "kept"
    assert queue.oldest()["branchNo"] == 0
    assert queue.oldest()["scannedAt"] == "2026-10-27T14:03:00.123+09:00"
    queue.close()


def test_processor_consumes_dist_once_and_invalid_dist_is_ignored(tmp_path):
    queue = ScanQueue(tmp_path / "queue.db")
    processor = ScanProcessor(queue, clock_check=lambda: True)
    at = datetime.now().astimezone()
    for line in ("DIST:2", "DIST:9", "first", "second"):
        processor.process(Scan(line, at, 10))
    first = queue.oldest()
    assert (first["orderNumber"], first["branchNo"]) == ("first", 2)
    queue.delete(first["clientRecordId"])
    assert queue.oldest()["branchNo"] == 0
    queue.close()


def test_clock_marker_avoids_subprocess(monkeypatch):
    monkeypatch.setattr(clock.Path, "exists", lambda _: True)
    monkeypatch.setattr(clock.subprocess, "run", lambda *a, **k: pytest.fail("not needed"))
    assert clock.is_synchronized()


@pytest.mark.parametrize("returncode, stdout, expected", [(0, "yes\n", True), (0, "no", False), (1, "yes", False)])
def test_clock_timedatectl(monkeypatch, returncode, stdout, expected):
    monkeypatch.setattr(clock.Path, "exists", lambda _: False)
    def run(args, **kwargs):
        assert args == ["timedatectl", "show", "-p", "NTPSynchronized", "--value"]
        assert kwargs["timeout"] == 2
        return SimpleNamespace(returncode=returncode, stdout=stdout)
    monkeypatch.setattr(clock.subprocess, "run", run)
    assert clock.is_synchronized() is expected


@pytest.mark.parametrize("error", [OSError(), clock.subprocess.TimeoutExpired("timedatectl", 2)])
def test_clock_command_failure_is_unsynchronized(monkeypatch, error):
    monkeypatch.setattr(clock.Path, "exists", lambda _: False)
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(clock.subprocess, "run", fail)
    assert not clock.is_synchronized()


@pytest.mark.parametrize("synchronized, ttl", [(True, 60), (False, 5)])
def test_clock_cache_expires_and_refreshes(monkeypatch, synchronized, ttl):
    now = [100.0]
    monkeypatch.setattr(clock.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(clock.Path, "exists", lambda _: False)
    run = Mock(side_effect=[
        SimpleNamespace(returncode=0, stdout="yes" if synchronized else "no"),
        SimpleNamespace(returncode=0, stdout="no" if synchronized else "yes"),
    ])
    monkeypatch.setattr(clock.subprocess, "run", run)
    assert clock.is_synchronized() is synchronized
    now[0] += ttl - 0.001
    assert clock.is_synchronized() is synchronized
    assert run.call_count == 1
    now[0] = 100.0 + ttl
    assert clock.is_synchronized() is not synchronized
    assert run.call_count == 2


def test_clock_failure_is_cached_and_marker_overrides_negative_cache(monkeypatch):
    now = [100.0]
    marker = [False]
    monkeypatch.setattr(clock.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(clock.Path, "exists", lambda _: marker[0])
    run = Mock(side_effect=OSError())
    monkeypatch.setattr(clock.subprocess, "run", run)
    assert not clock.is_synchronized()
    now[0] = 104.999
    assert not clock.is_synchronized()
    assert run.call_count == 1
    marker[0] = True
    assert clock.is_synchronized()
    assert run.call_count == 1
    marker[0] = False
    now[0] = 105.0
    assert not clock.is_synchronized()
    assert run.call_count == 2
