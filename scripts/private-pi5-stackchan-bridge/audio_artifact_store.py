#!/usr/bin/env python3
"""In-memory WAV artifacts served by bridge GET /api/stackchan/audio/<id>."""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class AudioArtifact:
    audio_id: str
    wav_bytes: bytes
    content_type: str
    created_at: float


class AudioArtifactStore:
    def __init__(self, ttl_sec: float = 600.0, max_items: int = 32) -> None:
        self._ttl_sec = ttl_sec
        self._max_items = max_items
        self._lock = threading.Lock()
        self._items: dict[str, AudioArtifact] = {}

    def put(self, wav_bytes: bytes, content_type: str = "audio/wav") -> str:
        audio_id = uuid.uuid4().hex
        now = time.monotonic()
        with self._lock:
            self._purge_locked(now)
            self._items[audio_id] = AudioArtifact(
                audio_id=audio_id,
                wav_bytes=wav_bytes,
                content_type=content_type,
                created_at=now,
            )
            if len(self._items) > self._max_items:
                oldest = min(self._items.values(), key=lambda a: a.created_at)
                self._items.pop(oldest.audio_id, None)
        return audio_id

    def get(self, audio_id: str) -> AudioArtifact | None:
        now = time.monotonic()
        with self._lock:
            self._purge_locked(now)
            return self._items.get(audio_id)

    def _purge_locked(self, now: float) -> None:
        expired = [aid for aid, art in self._items.items() if now - art.created_at > self._ttl_sec]
        for aid in expired:
            self._items.pop(aid, None)
