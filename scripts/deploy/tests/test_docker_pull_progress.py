from __future__ import annotations

import base64
import json
from pathlib import Path
import socketserver
import tempfile
import threading
from types import SimpleNamespace
import unittest

from scripts.deploy.docker_pull_progress import (
    DockerEngineImagePuller,
    PullExecution,
    PullProgressAccumulator,
    PullStreamUnavailable,
    PullTimedOut,
    _open_engine_session,
)


def event(
    status: str,
    *,
    layer_id: str = "1" * 12,
    current: int | None = None,
    total: int | None = None,
) -> dict[str, object]:
    document: dict[str, object] = {"status": status, "id": layer_id}
    if current is not None or total is not None:
        document["progressDetail"] = {
            "current": current or 0,
            "total": total or 0,
        }
    else:
        document["progressDetail"] = {}
    return document


class FakeClock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


class FakeSession:
    def __init__(
        self,
        clock: FakeClock,
        items: list[object],
    ) -> None:
        self.clock = clock
        self.items = list(items)
        self.closed = False

    def poll(self, timeout_seconds: float) -> object | None:
        if not self.items:
            self.clock.advance(timeout_seconds)
            return None
        item = self.items.pop(0)
        if item is None:
            self.clock.advance(timeout_seconds)
            return None
        return item

    def close(self) -> None:
        self.closed = True


class DockerPullProgressTests(unittest.TestCase):
    def test_accumulates_parallel_download_extract_and_completion(self) -> None:
        accumulator = PullProgressAccumulator(started_at=0.0)
        accumulator.apply(
            event("Downloading", current=25, total=100),
            observed_at=1.0,
        )
        accumulator.apply(
            event(
                "Downloading",
                layer_id="2" * 12,
                current=50,
                total=200,
            ),
            observed_at=2.0,
        )
        first = accumulator.snapshot(
            observed_at=30.0,
            consume_heartbeat_delta=True,
        )
        self.assertEqual(first.phase, "downloading")
        self.assertEqual(first.downloaded_bytes, 75)
        self.assertEqual(first.download_total_bytes, 300)
        self.assertEqual(first.bytes_advanced_since_last_heartbeat, 75)
        self.assertEqual(first.known_layers, 2)
        self.assertEqual(first.active_layer_ids, ("1" * 12, "2" * 12))

        accumulator.apply(event("Download complete"), observed_at=31.0)
        accumulator.apply(
            event("Extracting", current=40, total=100),
            observed_at=32.0,
        )
        accumulator.apply(
            event("Pull complete"),
            observed_at=33.0,
        )
        second = accumulator.snapshot(
            observed_at=60.0,
            consume_heartbeat_delta=True,
        )
        self.assertEqual(second.phase, "downloading")
        self.assertEqual(second.downloaded_bytes, 150)
        self.assertEqual(second.extracted_bytes, 100)
        self.assertEqual(second.completed_layers, 1)
        self.assertEqual(second.active_layer_ids, ("2" * 12,))

    def test_rejects_malformed_progress_and_redacts_engine_error(self) -> None:
        accumulator = PullProgressAccumulator(started_at=0.0)
        with self.assertRaisesRegex(
            PullStreamUnavailable,
            "^engine-protocol-invalid$",
        ):
            accumulator.apply(
                event("Downloading", current=101, total=100),
                observed_at=1.0,
            )
        with self.assertRaisesRegex(
            PullStreamUnavailable,
            "^engine-protocol-invalid$",
        ):
            accumulator.apply(
                event("Downloading", current=1 << 51, total=1 << 51),
                observed_at=1.5,
            )
        secret = "never-serialize-this-token"
        with self.assertRaises(PullStreamUnavailable) as raised:
            accumulator.apply(
                {
                    "error": f"registry rejected token={secret}",
                    "errorDetail": {"message": secret},
                },
                observed_at=2.0,
            )
        self.assertEqual(str(raised.exception), "engine-pull-error")
        self.assertNotIn(secret, str(raised.exception))

    def test_cached_and_active_layer_reporting_is_bounded(self) -> None:
        accumulator = PullProgressAccumulator(started_at=0.0)
        accumulator.apply(
            event("Already exists", layer_id=f"{0:012x}"),
            observed_at=1.0,
        )
        for layer_number in range(1, 10):
            accumulator.apply(
                event(
                    "Downloading",
                    layer_id=f"{layer_number:012x}",
                    current=1,
                    total=2,
                ),
                observed_at=float(layer_number + 1),
            )
        snapshot = accumulator.snapshot(
            observed_at=30.0,
            consume_heartbeat_delta=True,
        )
        self.assertEqual(snapshot.known_layers, 10)
        self.assertEqual(snapshot.completed_layers, 1)
        self.assertEqual(len(snapshot.active_layer_ids), 8)
        self.assertNotIn(f"{0:012x}", snapshot.active_layer_ids)

    def test_puller_emits_heartbeat_and_returns_bounded_summary(self) -> None:
        clock = FakeClock()
        session = FakeSession(
            clock,
            [
                SimpleNamespace(
                    kind="event",
                    payload=json.dumps(
                        event("Downloading", current=50, total=100)
                    ).encode(),
                ),
                None,
                SimpleNamespace(
                    kind="event",
                    payload=json.dumps(event("Download complete")).encode(),
                ),
                SimpleNamespace(
                    kind="event",
                    payload=json.dumps(event("Pull complete")).encode(),
                ),
                SimpleNamespace(
                    kind="event",
                    payload=json.dumps(
                        {"status": "Status: Downloaded newer image"}
                    ).encode(),
                ),
                SimpleNamespace(kind="complete", payload=None),
            ],
        )
        snapshots = []
        puller = DockerEngineImagePuller(
            session_factory=lambda *_args: session,
            clock=clock,
        )
        result = puller.pull(
            "ghcr.io/denkoushi/raspisys-api@sha256:" + "a" * 64,
            username="denkoushi",
            token="token-not-for-output",
            execution=PullExecution(
                stage="api-image-pull",
                timeout_seconds=60,
                heartbeat_seconds=30,
            ),
            event_sink=snapshots.append,
        )
        self.assertTrue(session.closed)
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0].downloaded_bytes, 50)
        self.assertEqual(result.observability_mode, "engine-api")
        self.assertEqual(result.final_snapshot.phase, "complete")
        self.assertNotIn("token-not-for-output", json.dumps(result.as_document()))

    def test_timeout_uses_injected_clock_and_closes_session(self) -> None:
        clock = FakeClock()
        session = FakeSession(clock, [])
        snapshots = []
        puller = DockerEngineImagePuller(
            session_factory=lambda *_args: session,
            clock=clock,
        )
        with self.assertRaises(PullTimedOut) as raised:
            puller.pull(
                "ghcr.io/denkoushi/raspisys-api@sha256:" + "a" * 64,
                username="denkoushi",
                token="",
                execution=PullExecution(
                    stage="api-image-pull",
                    timeout_seconds=60,
                    heartbeat_seconds=30,
                ),
                event_sink=snapshots.append,
            )
        self.assertTrue(session.closed)
        self.assertEqual(raised.exception.elapsed_seconds, 60)
        self.assertEqual(raised.exception.timeout_seconds, 60)
        self.assertEqual([snapshot.elapsed_seconds for snapshot in snapshots], [30, 60])

    def test_event_sink_interruption_closes_started_session(self) -> None:
        clock = FakeClock()
        session = FakeSession(clock, [])
        puller = DockerEngineImagePuller(
            session_factory=lambda *_args: session,
            clock=clock,
        )

        def interrupt(_snapshot: object) -> None:
            raise KeyboardInterrupt

        with self.assertRaises(KeyboardInterrupt):
            puller.pull(
                "ghcr.io/denkoushi/raspisys-api@sha256:" + "a" * 64,
                username="denkoushi",
                token="",
                execution=PullExecution(
                    stage="api-image-pull",
                    timeout_seconds=60,
                    heartbeat_seconds=30,
                ),
                event_sink=interrupt,
            )
        self.assertTrue(session.closed)

    def test_real_unix_http_transport_streams_progress_without_serializing_auth(
        self,
    ) -> None:
        secret = "private-registry-password"
        captured_headers: dict[str, str] = {}

        class Handler(socketserver.StreamRequestHandler):
            def _request(self) -> tuple[str, dict[str, str]]:
                request_line = self.rfile.readline().decode("ascii").strip()
                headers: dict[str, str] = {}
                while True:
                    line = self.rfile.readline()
                    if line in {b"\r\n", b"\n", b""}:
                        break
                    key, value = line.decode("ascii").split(":", 1)
                    headers[key.lower()] = value.strip()
                return request_line, headers

            def handle(self) -> None:
                ping, _ = self._request()
                if not ping.startswith("GET /_ping "):
                    return
                self.wfile.write(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n"
                    b"Connection: keep-alive\r\n\r\nOK"
                )
                self.wfile.flush()
                pull, headers = self._request()
                if not pull.startswith("POST /images/create?"):
                    return
                captured_headers.update(headers)
                records = [
                    event("Pulling fs layer"),
                    event("Downloading", current=100, total=100),
                    event("Verifying Checksum"),
                    event("Download complete"),
                    event("Extracting", current=100, total=100),
                    event("Pull complete"),
                    {"status": "Status: Downloaded newer image"},
                ]
                payload = b"".join(
                    json.dumps(record, separators=(",", ":")).encode() + b"\r\n"
                    for record in records
                )
                self.wfile.write(
                    (
                        "HTTP/1.1 200 OK\r\n"
                        f"Content-Length: {len(payload)}\r\n"
                        "Connection: close\r\n\r\n"
                    ).encode("ascii")
                    + payload
                )
                self.wfile.flush()

        with tempfile.TemporaryDirectory() as directory:
            socket_path = Path(directory) / "docker.sock"
            server = socketserver.UnixStreamServer(str(socket_path), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                puller = DockerEngineImagePuller(
                    session_factory=lambda reference, username, token: (
                        _open_engine_session(
                            reference,
                            username,
                            token,
                            socket_path=socket_path,
                        )
                    )
                )
                result = puller.pull(
                    "127.0.0.1:54321/fixture@sha256:" + "b" * 64,
                    username="fixture-user",
                    token=secret,
                    execution=PullExecution(
                        stage="api-image-pull",
                        timeout_seconds=5,
                        heartbeat_seconds=1,
                    ),
                    event_sink=lambda _snapshot: None,
                )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

        auth = json.loads(
            base64.urlsafe_b64decode(
                captured_headers["x-registry-auth"].encode("ascii")
            )
        )
        self.assertEqual(auth["password"], secret)
        self.assertEqual(result.final_snapshot.downloaded_bytes, 100)
        self.assertEqual(result.final_snapshot.extracted_bytes, 100)
        self.assertNotIn(secret, json.dumps(result.as_document()))


if __name__ == "__main__":
    unittest.main()
