from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


class QueueStore:
    LOCAL_AUDIT_LIMIT = 10_000

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS torque_outbox (
                    event_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS torque_local_audit (
                    event_id TEXT PRIMARY KEY,
                    reason TEXT NOT NULL,
                    device_path TEXT NOT NULL,
                    parser_profile TEXT NOT NULL,
                    raw_text TEXT NOT NULL,
                    error TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS torque_local_audit_created_idx "
                "ON torque_local_audit (created_at, event_id)"
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def enqueue(self, event_id: str, payload: dict[str, Any]) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO torque_outbox (event_id, payload) VALUES (?, ?)",
                (event_id, json.dumps(payload, ensure_ascii=False)),
            )

    def pending(self, limit: int = 100) -> list[tuple[str, dict[str, Any]]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT event_id, payload FROM torque_outbox ORDER BY created_at, event_id LIMIT ?", (limit,)
            ).fetchall()
        return [(row["event_id"], json.loads(row["payload"])) for row in rows]

    def mark_attempt(self, event_id: str, error: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE torque_outbox SET attempt_count = attempt_count + 1, last_error = ? WHERE event_id = ?",
                (error[:1000], event_id),
            )

    def acknowledge(self, event_id: str) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM torque_outbox WHERE event_id = ?", (event_id,))

    def count(self) -> int:
        with self._connect() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM torque_outbox").fetchone()[0])

    def record_local_error(
        self,
        event_id: str,
        *,
        reason: str,
        device_path: str,
        parser_profile: str,
        raw_text: str,
        error: str | None = None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO torque_local_audit
                    (event_id, reason, device_path, parser_profile, raw_text, error)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (event_id, reason, device_path, parser_profile, raw_text[:10_000], error[:1000] if error else None),
            )
            connection.execute(
                """
                DELETE FROM torque_local_audit
                WHERE event_id IN (
                    SELECT event_id FROM torque_local_audit
                    ORDER BY created_at DESC, event_id DESC
                    LIMIT -1 OFFSET ?
                )
                """,
                (self.LOCAL_AUDIT_LIMIT,),
            )

    def local_error_count(self) -> int:
        with self._connect() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM torque_local_audit").fetchone()[0])

    def local_errors(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT event_id, reason, device_path, parser_profile, raw_text, error, created_at
                FROM torque_local_audit
                ORDER BY created_at DESC, event_id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]
