"""Capture and send on a single monotonic loop with bounded failure backoff."""

import logging
import signal
import threading
import time

from .capture import capture
from .config import load_config
from .notify import sd_notify, watchdog_interval
from .sender import HttpClient

LOG = logging.getLogger(__name__)


def install_stop_handlers(stop):
    # Event.set() takes a non-reentrant lock, also held inside stop.wait().
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: threading.Thread(target=stop.set, daemon=True).start())


def run_loop(config, stop, take=capture, post=None, monotonic=time.monotonic,
             notify=sd_notify, heartbeat=None):
    post = post if post is not None else HttpClient(config).post
    heartbeat = watchdog_interval() if heartbeat is None else heartbeat
    interval = config.interval_sec
    delay = interval
    deadline = monotonic()
    previous = None
    notify("READY=1")
    while not stop.is_set():
        remaining = deadline - monotonic()
        if remaining > 0:
            stop.wait(min(remaining, heartbeat))
            notify("WATCHDOG=1")
            continue
        started = monotonic()
        try:
            frame = take(config.video_device)
            if stop.is_set():
                break
            try:
                status = post(frame)
            finally:
                del frame
            state = "success" if status == 202 else "auth" if status in (401, 403) else "failed"
        except Exception:
            # Never log exceptions or HTTP bodies that could contain credentials.
            state = "failed"
        if state != previous:
            if state == "success":
                if previous is not None:
                    LOG.info("Camera sending recovered")
            elif state == "auth":
                LOG.error("Camera authentication failed; check device key")
            else:
                LOG.warning("Camera capture or send failed; dropping frame")
        previous = state
        delay = interval if state == "success" else min(60, max(interval, delay * 2))
        # Slow operations never cause a catch-up busy loop.
        deadline = started + delay
        if deadline <= monotonic():
            deadline = monotonic() + min(interval, delay)
        notify("WATCHDOG=1")


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    stop = threading.Event()
    install_stop_handlers(stop)
    try:
        config = load_config()
        client = HttpClient(config)
        LOG.info("Watch camera agent started")
        run_loop(config, stop, post=client.post)
    except Exception as error:
        LOG.error("Agent stopped (%s)", type(error).__name__)
        return 1
    return 0
