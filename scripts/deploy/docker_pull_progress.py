#!/usr/bin/env python3
"""Bounded, secret-free progress for local Docker Engine image pulls."""

from __future__ import annotations

import base64
import http.client
import json
import queue
import re
import socket
import threading
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol


DOCKER_SOCKET = Path("/var/run/docker.sock")
MAX_EVENT_BYTES = 64 * 1024
MAX_LAYERS = 512
MAX_ACTIVE_LAYER_IDS = 8
MAX_PROGRESS_BYTES = 1 << 50
LAYER_ID_RE = re.compile(r"^[0-9a-f]{12}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
REFERENCE_COMPONENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$")
TAG_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")
ENGINE_CONNECT_TIMEOUT_SECONDS = 10
SESSION_CLOSE_GRACE_SECONDS = 5


class PullCapabilityUnavailable(RuntimeError):
    """The Engine progress API was unavailable before the pull started."""


class PullStreamUnavailable(RuntimeError):
    """A started Engine pull ended without a trustworthy success."""

    def __init__(
        self,
        reason_code: str,
        snapshot: PullProgressSnapshot | None = None,
    ) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code
        self.snapshot = snapshot


class PullTimedOut(RuntimeError):
    def __init__(
        self,
        *,
        elapsed_seconds: float,
        timeout_seconds: float,
        snapshot: PullProgressSnapshot,
    ) -> None:
        super().__init__(f"image pull timed out after {timeout_seconds}s")
        self.elapsed_seconds = elapsed_seconds
        self.timeout_seconds = timeout_seconds
        self.snapshot = snapshot


@dataclass(frozen=True)
class PullExecution:
    stage: str
    timeout_seconds: float
    heartbeat_seconds: float

    def __post_init__(self) -> None:
        if (
            re.fullmatch(r"[a-z][a-z0-9-]{0,63}", self.stage) is None
            or isinstance(self.timeout_seconds, bool)
            or not isinstance(self.timeout_seconds, (int, float))
            or self.timeout_seconds <= 0
            or isinstance(self.heartbeat_seconds, bool)
            or not isinstance(self.heartbeat_seconds, (int, float))
            or self.heartbeat_seconds <= 0
        ):
            raise ValueError("pull execution is malformed")


@dataclass(frozen=True)
class PullProgressSnapshot:
    phase: str
    elapsed_seconds: float
    downloaded_bytes: int
    download_total_bytes: int
    extracted_bytes: int
    extract_total_bytes: int
    bytes_advanced_since_last_heartbeat: int
    seconds_since_byte_progress: float
    known_layers: int
    completed_layers: int
    active_layer_ids: tuple[str, ...]
    unknown_statuses: int

    def as_document(self) -> dict[str, object]:
        return {
            "phase": self.phase,
            "elapsedSeconds": round(max(0.0, self.elapsed_seconds), 3),
            "downloadedBytes": self.downloaded_bytes,
            "downloadTotalBytes": self.download_total_bytes,
            "extractedBytes": self.extracted_bytes,
            "extractTotalBytes": self.extract_total_bytes,
            "bytesAdvancedSinceLastHeartbeat": (
                self.bytes_advanced_since_last_heartbeat
            ),
            "secondsSinceByteProgress": round(
                max(0.0, self.seconds_since_byte_progress), 3
            ),
            "knownLayers": self.known_layers,
            "completedLayers": self.completed_layers,
            "activeLayerIds": list(self.active_layer_ids),
            "unknownStatuses": self.unknown_statuses,
        }


@dataclass(frozen=True)
class PullResult:
    elapsed_seconds: float
    final_snapshot: PullProgressSnapshot
    observability_mode: str

    def as_document(self) -> dict[str, object]:
        return {
            "elapsedSeconds": round(max(0.0, self.elapsed_seconds), 3),
            "observabilityMode": self.observability_mode,
            "progress": self.final_snapshot.as_document(),
        }


class DockerImagePuller(Protocol):
    def pull(
        self,
        reference: str,
        *,
        username: str,
        token: str,
        execution: PullExecution,
        event_sink: Callable[[PullProgressSnapshot], None],
    ) -> PullResult: ...


@dataclass
class _LayerProgress:
    phase: str = "waiting"
    download_current: int = 0
    download_total: int = 0
    extract_current: int = 0
    extract_total: int = 0
    completed: bool = False


class PullProgressAccumulator:
    """Pure aggregation of validated Docker Engine pull events."""

    _KNOWN_STATUSES = {
        "Pulling fs layer",
        "Waiting",
        "Downloading",
        "Verifying Checksum",
        "Download complete",
        "Extracting",
        "Pull complete",
        "Already exists",
    }

    def __init__(self, *, started_at: float) -> None:
        self.started_at = started_at
        self.last_byte_progress_at = started_at
        self.layers: dict[str, _LayerProgress] = {}
        self.unknown_statuses = 0
        self.stream_complete = False
        self._last_reported_work_bytes = 0

    @staticmethod
    def _strict_object(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise PullStreamUnavailable("engine-protocol-invalid")
            result[key] = value
        return result

    @staticmethod
    def parse_event(raw: bytes) -> Mapping[str, Any]:
        if not raw or len(raw) > MAX_EVENT_BYTES:
            raise PullStreamUnavailable("engine-protocol-invalid")
        try:
            document = json.loads(
                raw.decode("utf-8"),
                object_pairs_hook=PullProgressAccumulator._strict_object,
            )
        except (UnicodeError, json.JSONDecodeError) as error:
            raise PullStreamUnavailable("engine-protocol-invalid") from error
        if not isinstance(document, dict):
            raise PullStreamUnavailable("engine-protocol-invalid")
        return document

    @staticmethod
    def _progress_detail(value: object) -> tuple[int, int]:
        if value is None:
            return (0, 0)
        if not isinstance(value, dict):
            raise PullStreamUnavailable("engine-protocol-invalid")
        current = value.get("current", 0)
        total = value.get("total", 0)
        if (
            type(current) is not int
            or type(total) is not int
            or current < 0
            or total < 0
            or current > MAX_PROGRESS_BYTES
            or total > MAX_PROGRESS_BYTES
            or (total > 0 and current > total)
        ):
            raise PullStreamUnavailable("engine-protocol-invalid")
        return (current, total)

    def apply(self, document: Mapping[str, Any], *, observed_at: float) -> None:
        if "error" in document or "errorDetail" in document:
            raise PullStreamUnavailable("engine-pull-error")
        status = document.get("status")
        if not isinstance(status, str) or len(status) > 256:
            raise PullStreamUnavailable("engine-protocol-invalid")
        if status.startswith("Status:"):
            self.stream_complete = True
            return
        if status.startswith("Digest:") or status.startswith("Pulling from"):
            return

        layer_id = document.get("id")
        if not isinstance(layer_id, str) or LAYER_ID_RE.fullmatch(layer_id) is None:
            self.unknown_statuses = min(self.unknown_statuses + 1, MAX_LAYERS)
            return
        if layer_id not in self.layers:
            if len(self.layers) >= MAX_LAYERS:
                raise PullStreamUnavailable("engine-layer-limit-exceeded")
            self.layers[layer_id] = _LayerProgress()
        layer = self.layers[layer_id]

        if status not in self._KNOWN_STATUSES:
            self.unknown_statuses = min(self.unknown_statuses + 1, MAX_LAYERS)
            return
        current, total = self._progress_detail(document.get("progressDetail"))
        before = (
            layer.download_current
            + layer.extract_current
        )
        if status == "Downloading":
            layer.phase = "downloading"
            layer.download_current = max(layer.download_current, current)
            layer.download_total = max(layer.download_total, total)
        elif status == "Verifying Checksum":
            layer.phase = "verifying"
        elif status == "Download complete":
            layer.phase = "verifying"
            if layer.download_total:
                layer.download_current = layer.download_total
        elif status == "Extracting":
            layer.phase = "extracting"
            layer.extract_current = max(layer.extract_current, current)
            layer.extract_total = max(layer.extract_total, total)
        elif status in {"Pull complete", "Already exists"}:
            layer.phase = "complete"
            layer.completed = True
            if layer.download_total:
                layer.download_current = layer.download_total
            if layer.extract_total:
                layer.extract_current = layer.extract_total
        else:
            layer.phase = "downloading"
        after = layer.download_current + layer.extract_current
        if after > before:
            self.last_byte_progress_at = observed_at

    def snapshot(
        self,
        *,
        observed_at: float,
        consume_heartbeat_delta: bool,
    ) -> PullProgressSnapshot:
        downloaded = sum(layer.download_current for layer in self.layers.values())
        download_total = sum(layer.download_total for layer in self.layers.values())
        extracted = sum(layer.extract_current for layer in self.layers.values())
        extract_total = sum(layer.extract_total for layer in self.layers.values())
        work_bytes = downloaded + extracted
        advanced = max(0, work_bytes - self._last_reported_work_bytes)
        if consume_heartbeat_delta:
            self._last_reported_work_bytes = work_bytes

        active_phases = {
            layer.phase for layer in self.layers.values() if not layer.completed
        }
        if "extracting" in active_phases:
            phase = "extracting"
        elif "verifying" in active_phases:
            phase = "verifying"
        elif active_phases:
            phase = "downloading"
        elif self.stream_complete:
            phase = "complete"
        else:
            phase = "waiting"
        active_ids = tuple(
            sorted(
                layer_id
                for layer_id, layer in self.layers.items()
                if not layer.completed and layer.phase != "waiting"
            )[:MAX_ACTIVE_LAYER_IDS]
        )
        return PullProgressSnapshot(
            phase=phase,
            elapsed_seconds=max(0.0, observed_at - self.started_at),
            downloaded_bytes=downloaded,
            download_total_bytes=download_total,
            extracted_bytes=extracted,
            extract_total_bytes=extract_total,
            bytes_advanced_since_last_heartbeat=advanced,
            seconds_since_byte_progress=max(
                0.0, observed_at - self.last_byte_progress_at
            ),
            known_layers=len(self.layers),
            completed_layers=sum(
                1 for layer in self.layers.values() if layer.completed
            ),
            active_layer_ids=active_ids,
            unknown_statuses=self.unknown_statuses,
        )


@dataclass(frozen=True)
class _StreamItem:
    kind: str
    payload: bytes | None = None


class PullEventSession(Protocol):
    def poll(self, timeout_seconds: float) -> _StreamItem | None: ...

    def close(self) -> None: ...


class _UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: Path, *, timeout: float) -> None:
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self) -> None:
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.settimeout(self.timeout)
        connection.connect(str(self.socket_path))
        self.sock = connection


class _EnginePullSession:
    def __init__(
        self,
        connection: _UnixHTTPConnection,
        response: http.client.HTTPResponse,
    ) -> None:
        self.connection = connection
        self.response = response
        self.items: queue.Queue[_StreamItem] = queue.Queue(maxsize=512)
        self.closed = threading.Event()
        if self.connection.sock is not None:
            self.connection.sock.settimeout(None)
        self.worker = threading.Thread(
            target=self._pump,
            name="docker-pull-progress",
            daemon=True,
        )
        self.worker.start()

    def _publish(self, item: _StreamItem) -> None:
        while not self.closed.is_set():
            try:
                self.items.put(item, timeout=0.1)
                return
            except queue.Full:
                continue

    def _pump(self) -> None:
        try:
            while not self.closed.is_set():
                raw = self.response.readline(MAX_EVENT_BYTES + 1)
                if not raw:
                    self._publish(_StreamItem("complete"))
                    return
                if len(raw) > MAX_EVENT_BYTES:
                    self._publish(_StreamItem("protocol-error"))
                    return
                self._publish(_StreamItem("event", raw.rstrip(b"\r\n")))
        except (OSError, http.client.HTTPException):
            self._publish(_StreamItem("read-error"))

    def poll(self, timeout_seconds: float) -> _StreamItem | None:
        try:
            return self.items.get(timeout=timeout_seconds)
        except queue.Empty:
            return None

    def close(self) -> None:
        if self.closed.is_set():
            return
        self.closed.set()
        current_socket = self.connection.sock
        if current_socket is not None:
            try:
                current_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.connection.close()
        self.worker.join(timeout=SESSION_CLOSE_GRACE_SECONDS)


SessionFactory = Callable[
    [str, str, str],
    PullEventSession,
]


def _parse_reference(reference: str) -> tuple[str, str, str]:
    if (
        not isinstance(reference, str)
        or "\x00" in reference
        or "\r" in reference
        or "\n" in reference
        or len(reference) > 512
    ):
        raise PullStreamUnavailable("image-reference-invalid")
    if "@" in reference:
        repository, delimiter, digest = reference.rpartition("@")
        if (
            delimiter != "@"
            or REFERENCE_COMPONENT_RE.fullmatch(repository) is None
            or DIGEST_RE.fullmatch(digest) is None
        ):
            raise PullStreamUnavailable("image-reference-invalid")
        tag = digest
    else:
        slash = reference.rfind("/")
        colon = reference.rfind(":")
        if (
            colon <= slash
            or REFERENCE_COMPONENT_RE.fullmatch(reference[:colon]) is None
            or TAG_RE.fullmatch(reference[colon + 1 :]) is None
        ):
            raise PullStreamUnavailable("image-reference-invalid")
        repository = reference[:colon]
        tag = reference[colon + 1 :]
    server_address = repository.split("/", 1)[0]
    return repository, tag, server_address


def _registry_auth(username: str, token: str, server_address: str) -> str:
    if any(
        not isinstance(value, str)
        or "\x00" in value
        or "\r" in value
        or "\n" in value
        or len(value.encode("utf-8")) > 4096
        for value in (username, token, server_address)
    ):
        raise PullStreamUnavailable("registry-auth-invalid")
    document: dict[str, str] = {}
    if token:
        document = {
            "username": username,
            "password": token,
            "serveraddress": server_address,
        }
    raw = json.dumps(document, separators=(",", ":"), ensure_ascii=True).encode(
        "utf-8"
    )
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _open_engine_session(
    reference: str,
    username: str,
    token: str,
    *,
    socket_path: Path = DOCKER_SOCKET,
) -> PullEventSession:
    repository, tag, server_address = _parse_reference(reference)
    authorization = _registry_auth(username, token, server_address)
    if not socket_path.exists():
        raise PullCapabilityUnavailable("docker-engine-socket-unavailable")
    connection = _UnixHTTPConnection(
        socket_path,
        timeout=ENGINE_CONNECT_TIMEOUT_SECONDS,
    )
    try:
        connection.request("GET", "/_ping")
        ping = connection.getresponse()
        ping_body = ping.read(32)
        if ping.status != 200 or ping_body.strip() != b"OK":
            raise PullCapabilityUnavailable("docker-engine-api-unavailable")
    except PullCapabilityUnavailable:
        connection.close()
        raise
    except (OSError, http.client.HTTPException) as error:
        connection.close()
        raise PullCapabilityUnavailable("docker-engine-api-unavailable") from error

    query = urllib.parse.urlencode(
        {
            "fromImage": repository,
            "tag": tag,
            "platform": "linux/arm64",
        }
    )
    headers = {
        "Content-Length": "0",
        "X-Registry-Auth": authorization,
    }
    try:
        connection.request("POST", f"/images/create?{query}", headers=headers)
        response = connection.getresponse()
    except (OSError, http.client.HTTPException) as error:
        connection.close()
        raise PullStreamUnavailable("engine-request-failed") from error
    if response.status != 200:
        try:
            response.read(MAX_EVENT_BYTES)
        finally:
            connection.close()
        raise PullStreamUnavailable("engine-response-rejected")
    return _EnginePullSession(connection, response)


class DockerEngineImagePuller:
    def __init__(
        self,
        *,
        session_factory: SessionFactory = _open_engine_session,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.session_factory = session_factory
        self.clock = clock

    def pull(
        self,
        reference: str,
        *,
        username: str,
        token: str,
        execution: PullExecution,
        event_sink: Callable[[PullProgressSnapshot], None],
    ) -> PullResult:
        started_at = self.clock()
        accumulator = PullProgressAccumulator(started_at=started_at)
        session = self.session_factory(reference, username, token)
        next_heartbeat = started_at + execution.heartbeat_seconds
        try:
            while True:
                now = self.clock()
                remaining = execution.timeout_seconds - (now - started_at)
                if remaining <= 0:
                    snapshot = accumulator.snapshot(
                        observed_at=now,
                        consume_heartbeat_delta=True,
                    )
                    event_sink(snapshot)
                    raise PullTimedOut(
                        elapsed_seconds=round(now - started_at, 3),
                        timeout_seconds=execution.timeout_seconds,
                        snapshot=snapshot,
                    )
                if now >= next_heartbeat:
                    snapshot = accumulator.snapshot(
                        observed_at=now,
                        consume_heartbeat_delta=True,
                    )
                    event_sink(snapshot)
                    next_heartbeat = now + execution.heartbeat_seconds
                    continue
                wait_seconds = min(remaining, max(0.0, next_heartbeat - now))
                item = session.poll(wait_seconds)
                now = self.clock()
                if item is None:
                    if now - started_at >= execution.timeout_seconds:
                        snapshot = accumulator.snapshot(
                            observed_at=now,
                            consume_heartbeat_delta=True,
                        )
                        event_sink(snapshot)
                        raise PullTimedOut(
                            elapsed_seconds=round(now - started_at, 3),
                            timeout_seconds=execution.timeout_seconds,
                            snapshot=snapshot,
                        )
                    snapshot = accumulator.snapshot(
                        observed_at=now,
                        consume_heartbeat_delta=True,
                    )
                    event_sink(snapshot)
                    next_heartbeat = now + execution.heartbeat_seconds
                    continue
                if item.kind == "event" and item.payload is not None:
                    try:
                        accumulator.apply(
                            accumulator.parse_event(item.payload),
                            observed_at=now,
                        )
                    except PullStreamUnavailable as error:
                        snapshot = accumulator.snapshot(
                            observed_at=now,
                            consume_heartbeat_delta=False,
                        )
                        raise PullStreamUnavailable(
                            error.reason_code,
                            snapshot,
                        ) from error
                    continue
                if item.kind == "complete":
                    snapshot = accumulator.snapshot(
                        observed_at=now,
                        consume_heartbeat_delta=True,
                    )
                    if not accumulator.stream_complete:
                        raise PullStreamUnavailable(
                            "engine-stream-incomplete",
                            snapshot,
                        )
                    return PullResult(
                        elapsed_seconds=max(0.0, now - started_at),
                        final_snapshot=snapshot,
                        observability_mode="engine-api",
                    )
                snapshot = accumulator.snapshot(
                    observed_at=now,
                    consume_heartbeat_delta=False,
                )
                reason_code = (
                    "engine-protocol-invalid"
                    if item.kind == "protocol-error"
                    else "engine-stream-read-failed"
                )
                raise PullStreamUnavailable(reason_code, snapshot)
        finally:
            session.close()


def safe_progress_event(
    stage: str,
    snapshot: PullProgressSnapshot,
    *,
    timeout_seconds: float,
    state: str = "progress",
) -> dict[str, object]:
    if re.fullmatch(r"[a-z][a-z0-9-]{0,63}", stage) is None:
        raise ValueError("pull stage is malformed")
    return {
        "stage": stage,
        "state": state,
        **snapshot.as_document(),
        "timeoutSeconds": timeout_seconds,
    }


__all__ = [
    "DockerEngineImagePuller",
    "DockerImagePuller",
    "PullCapabilityUnavailable",
    "PullExecution",
    "PullProgressAccumulator",
    "PullProgressSnapshot",
    "PullResult",
    "PullStreamUnavailable",
    "PullTimedOut",
    "safe_progress_event",
]
