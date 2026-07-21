"""Best-effort, secret-free timing events for orchestrated rolling releases."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

from ansible.plugins.callback import CallbackBase


DOCUMENTATION = r"""
name: rolling_release_timing
type: notification
short_description: Records task durations for an orchestrated rolling release.
description:
  - Records only timing and task identity fields for an orchestrated release.
  - Never records task arguments, result payloads, stdout, stderr, or variables.
"""


class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = "notification"
    CALLBACK_NAME = "rolling_release_timing"

    def __init__(self):
        super().__init__()
        self._starts = {}
        self._path = os.environ.get("ROLLING_RELEASE_TIMING_PATH")
        self._run_id = os.environ.get("RUN_ID")
        self._scope = os.environ.get("ROLLING_RELEASE_TIMING_SCOPE")
        self._enabled = bool(self._path and self._run_id and self._scope)

    @staticmethod
    def _utc_now():
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @staticmethod
    def _task_key(host, task):
        return (host.get_name(), getattr(task, "_uuid", ""))

    def v2_runner_on_start(self, host, task):
        if self._enabled:
            self._starts[self._task_key(host, task)] = (time.monotonic(), self._utc_now())

    def _record(self, result, outcome):
        if not self._enabled:
            return
        try:
            host = result._host
            task = result._task
            timing = self._starts.pop(self._task_key(host, task), None)
            if timing is None:
                return
            started, started_at = timing
            # Task names are repository-authored labels; never write result data,
            # command arguments, stdout, stderr, or Ansible variables.
            event = {
                "schemaVersion": 1,
                "runId": self._run_id,
                "scope": self._scope,
                "host": host.get_name(),
                "play": getattr(getattr(task, "_parent", None), "_play", None).get_name()
                if getattr(getattr(task, "_parent", None), "_play", None) else "",
                "task": task.get_name(),
                "outcome": outcome,
                "startedAt": started_at,
                "endedAt": self._utc_now(),
                "durationMs": round((time.monotonic() - started) * 1000),
            }
            encoded = (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            directory = os.path.dirname(self._path)
            os.makedirs(directory, mode=0o700, exist_ok=True)
            flags = os.O_APPEND | os.O_CREAT | os.O_WRONLY
            flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(self._path, flags, 0o600)
            try:
                os.fchmod(descriptor, 0o600)
                os.write(descriptor, encoded)
            finally:
                os.close(descriptor)
        except Exception:
            # Observability must not alter Ansible's result or release safety.
            return

    def v2_runner_on_ok(self, result):
        self._record(result, "changed" if result._result.get("changed") else "ok")

    def v2_runner_on_skipped(self, result):
        self._record(result, "skipped")

    def v2_runner_on_failed(self, result, ignore_errors=False):
        self._record(result, "failed")

    def v2_runner_on_unreachable(self, result):
        self._record(result, "unreachable")
