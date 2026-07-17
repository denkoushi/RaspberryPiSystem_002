from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


class QueueStore:
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
