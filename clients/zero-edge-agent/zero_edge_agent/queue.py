"""Durable FIFO. Each thread owns its own SQLite connection."""

import sqlite3
import time
import uuid
from pathlib import Path

MAX_AGE_SECONDS = 7 * 24 * 60 * 60


class ScanQueue:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        with self.db:
            self.db.execute("""
                CREATE TABLE IF NOT EXISTS scans (
                    sequence INTEGER PRIMARY KEY,
                    client_record_id TEXT NOT NULL UNIQUE,
                    scanned_at TEXT NOT NULL,
                    scanned_epoch REAL NOT NULL,
                    order_number TEXT NOT NULL,
                    branch_no INTEGER NOT NULL CHECK(branch_no BETWEEN 0 AND 5)
                )
            """)
            self.db.execute("CREATE INDEX IF NOT EXISTS scans_age ON scans(scanned_epoch, sequence)")

    def enqueue(self, order_number, branch_no, scanned_at):
        if scanned_at.utcoffset() is None:
            raise ValueError("scanned_at must have a timezone offset")
        record_id = str(uuid.uuid4())
        with self.db:
            self.db.execute(
                "INSERT INTO scans (client_record_id, scanned_at, scanned_epoch, order_number, branch_no) "
                "VALUES (?, ?, ?, ?, ?)",
                (record_id, scanned_at.isoformat(timespec="milliseconds"), scanned_at.timestamp(),
                 order_number, branch_no),
            )
        return record_id

    def oldest(self):
        row = self.db.execute("SELECT * FROM scans ORDER BY scanned_epoch, sequence LIMIT 1").fetchone()
        if row is None:
            return None
        return {"clientRecordId": row["client_record_id"], "scannedAt": row["scanned_at"],
                "orderNumber": row["order_number"], "branchNo": row["branch_no"]}

    def delete(self, record_id):
        with self.db:
            self.db.execute("DELETE FROM scans WHERE client_record_id = ?", (record_id,))

    def purge(self, now=None):
        cutoff = (time.time() if now is None else now) - MAX_AGE_SECONDS
        with self.db:
            return self.db.execute("DELETE FROM scans WHERE scanned_epoch < ?", (cutoff,)).rowcount

    def close(self):
        self.db.close()
