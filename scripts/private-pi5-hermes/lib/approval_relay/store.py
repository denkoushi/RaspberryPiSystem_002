#!/usr/bin/env python3
"""File-based approval IPC store (Phase D5.1)."""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

try:
    from .models import ApprovalChoice, ApprovalRequest, ApprovalResponse
except ImportError:
    from models import ApprovalChoice, ApprovalRequest, ApprovalResponse


class FileApprovalStore:
    """One task directory under store_dir with atomic JSON files."""

    REQUEST_FILE = "request.json"
    RESPONSE_FILE = "response.json"
    USER_INDEX_DIR = "by-user"

    def __init__(self, store_dir: Path, task_id: str) -> None:
        self.store_dir = Path(store_dir)
        self.task_id = task_id
        self.task_dir = self.store_dir / task_id

    @classmethod
    def user_index_path(cls, store_dir: Path, discord_user_id: str) -> Path:
        return Path(store_dir) / cls.USER_INDEX_DIR / f"{discord_user_id}.json"

    @classmethod
    def bind_active_task(
        cls, store_dir: Path, discord_user_id: str, task_id: str
    ) -> None:
        index_path = cls.user_index_path(store_dir, discord_user_id)
        index_path.parent.mkdir(parents=True, exist_ok=True)
        cls._atomic_write(
            index_path,
            {"task_id": task_id, "bound_at": time.time()},
        )

    @classmethod
    def clear_active_task(cls, store_dir: Path, discord_user_id: str) -> None:
        index_path = cls.user_index_path(store_dir, discord_user_id)
        if index_path.is_file():
            index_path.unlink()

    @classmethod
    def active_task_id(cls, store_dir: Path, discord_user_id: str) -> str | None:
        index_path = cls.user_index_path(store_dir, discord_user_id)
        if not index_path.is_file():
            return None
        try:
            data = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        task_id = str(data.get("task_id") or "").strip()
        return task_id or None

    def ensure_task_dir(self) -> None:
        self.task_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(self.task_dir, 0o700)

    @staticmethod
    def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, indent=2))
            tmp_path = Path(handle.name)
        os.replace(tmp_path, path)

    def write_request(self, approval_data: dict[str, Any]) -> ApprovalRequest:
        self.ensure_task_dir()
        request = ApprovalRequest.from_mapping(
            self.task_id,
            {
                **approval_data,
                "created_at": time.time(),
            },
        )
        self._atomic_write(self.task_dir / self.REQUEST_FILE, request.to_mapping())
        return request

    def read_request(self) -> ApprovalRequest | None:
        path = self.task_dir / self.REQUEST_FILE
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        return ApprovalRequest.from_mapping(self.task_id, data)

    def write_response(
        self,
        choice: ApprovalChoice,
        *,
        discord_user_id: str = "",
    ) -> ApprovalResponse:
        self.ensure_task_dir()
        response = ApprovalResponse(
            choice=choice,
            discord_user_id=discord_user_id,
            decided_at=time.time(),
        )
        self._atomic_write(self.task_dir / self.RESPONSE_FILE, response.to_mapping())
        return response

    def read_response(self) -> ApprovalResponse | None:
        path = self.task_dir / self.RESPONSE_FILE
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        return ApprovalResponse.from_mapping(data)

    def wait_for_response(
        self,
        timeout_seconds: float,
        poll_interval_seconds: float = 0.5,
    ) -> ApprovalResponse | None:
        deadline = time.monotonic() + max(timeout_seconds, 0.0)
        interval = max(poll_interval_seconds, 0.05)
        while time.monotonic() < deadline:
            response = self.read_response()
            if response is not None:
                return response
            time.sleep(interval)
        return None

    def cleanup(self) -> None:
        if self.task_dir.is_dir():
            for child in self.task_dir.iterdir():
                if child.is_file():
                    child.unlink(missing_ok=True)
            self.task_dir.rmdir()

    @classmethod
    def purge_stale_tasks(
        cls,
        store_dir: Path,
        *,
        max_age_seconds: float,
    ) -> int:
        root = Path(store_dir)
        if not root.is_dir():
            return 0
        now = time.time()
        removed = 0
        for entry in root.iterdir():
            if not entry.is_dir() or entry.name == cls.USER_INDEX_DIR:
                continue
            request_path = entry / cls.REQUEST_FILE
            mtime = request_path.stat().st_mtime if request_path.is_file() else entry.stat().st_mtime
            if now - mtime <= max_age_seconds:
                continue
            for child in entry.iterdir():
                if child.is_file():
                    child.unlink(missing_ok=True)
            entry.rmdir()
            removed += 1
        return removed
