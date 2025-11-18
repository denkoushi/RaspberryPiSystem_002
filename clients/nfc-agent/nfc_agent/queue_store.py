from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import List, Tuple, Dict, Any


class QueueStore:
    def __init__(self, path: Path):
        self.path = path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS queued_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def enqueue(self, payload: Dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO queued_events (payload) VALUES (?)",
                (json.dumps(payload, ensure_ascii=False),),
            )

    def list_events(self, limit: int = 100) -> List[Tuple[int, Dict[str, Any]]]:
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT id, payload FROM queued_events ORDER BY id ASC LIMIT ?",
                (limit,),
            )
            rows = cur.fetchall()
        return [(row["id"], json.loads(row["payload"])) for row in rows]

    def delete(self, event_ids: List[int]) -> None:
        if not event_ids:
            return
        with self._connect() as conn:
            conn.executemany("DELETE FROM queued_events WHERE id = ?", ((event_id,) for event_id in event_ids))

    def count(self) -> int:
        with self._connect() as conn:
            cur = conn.execute("SELECT COUNT(*) FROM queued_events")
            (count,) = cur.fetchone()
        return int(count)

    def clear(self) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM queued_events")
