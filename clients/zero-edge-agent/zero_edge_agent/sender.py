"""One request at a time; retry the same immutable payload on failure."""

import http.client
import json
import logging
import ssl
import urllib.error
import urllib.request

from .clock import is_synchronized
from .queue import ScanQueue

LOG = logging.getLogger(__name__)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HttpClient:
    def __init__(self, config):
        self.config = config
        context = ssl.create_default_context()
        if config.tls_skip_verify:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=context), NoRedirect(),
        )

    def post(self, record):
        request = urllib.request.Request(
            self.config.api_base_url + "/api/mobile-placement/edge-scans",
            data=json.dumps(record).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", "x-client-key": self.config.x_client_key},
        )
        try:
            with self.opener.open(request, timeout=10) as response:
                return response.status
        except urllib.error.HTTPError as error:
            error.close()
            return error.code


class Sender:
    def __init__(self, queue, post, clock_check=is_synchronized):
        self.queue = queue
        self.post = post
        self.clock_check = clock_check
        self.backoff = 1.0

    def step(self):
        # A wrong boot clock must not purge valid records from an earlier boot.
        if not self.clock_check():
            return 1.0
        removed = self.queue.purge()
        if removed:
            LOG.warning("Expired %d scans older than seven days", removed)
        record = self.queue.oldest()
        if record is None:
            return 1.0
        try:
            status = self.post(record)
        except (OSError, urllib.error.URLError, http.client.HTTPException):
            # Never log exceptions/response bodies that could contain credentials.
            LOG.warning("Network failure; keeping scan %s", record["clientRecordId"])
            status = None
        if status in (200, 400, 422):
            self.queue.delete(record["clientRecordId"])
            log = LOG.info if status == 200 else LOG.error
            log("HTTP %s; removed scan %s", status, record["clientRecordId"])
            self.backoff = 1.0
            return 0.0
        if status in (401, 403):
            LOG.error("AUTHENTICATION FAILED HTTP %s; keeping scan %s; check device key and restart",
                      status, record["clientRecordId"])
        elif status is not None:
            LOG.warning("HTTP %s; keeping scan %s", status, record["clientRecordId"])
        delay = self.backoff
        self.backoff = min(300.0, self.backoff * 2)
        return delay


def run_sender(config, stop):
    queue = None
    try:
        queue = ScanQueue(config.queue_path)
        sender = Sender(queue, HttpClient(config).post)
        while not stop.is_set():
            stop.wait(sender.step())
    except Exception as error:
        LOG.error("Sender stopped (%s)", type(error).__name__)
        stop.set()
    finally:
        if queue is not None:
            queue.close()
