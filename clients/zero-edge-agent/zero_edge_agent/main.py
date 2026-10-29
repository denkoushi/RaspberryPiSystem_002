"""Collect scans on the main thread while a worker drains SQLite."""

import logging
import signal
import threading

from .classifier import Distribution, classify
from .clock import is_synchronized
from .config import load_config
from .distribution_gate import DistributionGate
from .keyboard import iter_scans
from .queue import ScanQueue
from .sender import run_sender

LOG = logging.getLogger(__name__)


class ScanProcessor:
    def __init__(self, queue, clock_check=is_synchronized):
        self.queue = queue
        self.clock_check = clock_check
        self.gate = DistributionGate()

    def process(self, scan):
        token = classify(scan.line)
        if token is None:
            return
        if not self.clock_check():
            self.gate.clear()
            LOG.warning("Clock not NTP synchronized; dropping scan")
            return
        if isinstance(token, Distribution):
            self.gate.set(token.branch_no, scan.monotonic_at)
            return
        branch = self.gate.take(scan.monotonic_at)
        record_id = self.queue.enqueue(token.order_number, branch, scan.scanned_at)
        LOG.info("Queued scan %s branch=%d", record_id, branch)


def install_stop_handlers(stop):
    # Event.set() takes a non-reentrant lock; calling it from the handler deadlocks when the
    # signal lands while the main thread holds that lock inside stop.wait().
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: threading.Thread(target=stop.set, daemon=True).start())


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    stop = threading.Event()
    install_stop_handlers(stop)
    queue = None
    worker = None
    failed = False
    try:
        config = load_config()
        queue = ScanQueue(config.queue_path)
        processor = ScanProcessor(queue)
        worker = threading.Thread(target=run_sender, args=(config, stop), name="sender")
        worker.start()
        for scan in iter_scans(config.hid_device, stop):
            processor.process(scan)
    except Exception as error:
        LOG.error("Agent stopped (%s)", type(error).__name__)
        failed = True
    finally:
        stop.set()
        if worker is not None:
            worker.join()
        if queue is not None:
            queue.close()
        LOG.info("Agent shutdown complete")
    return 1 if failed else 0
