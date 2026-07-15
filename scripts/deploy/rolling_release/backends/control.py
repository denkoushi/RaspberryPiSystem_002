"""Remote per-run observation and cooperative-control adapter."""
from __future__ import annotations

import base64
import json
from pathlib import Path, PurePosixPath
from typing import Any

from .. import remote_control
from ..models import validate_lookup_run_id
from .command import SshTransport


REMOTE_PYTHON = "/usr/bin/python3"
REMOTE_CONTROL_LOADER = (
    "import base64,sys;source,payload=sys.argv[1:];"
    "sys.argv=['rolling-release-control',base64.b64decode(payload).decode('utf-8')];"
    "exec(compile(base64.b64decode(source),'<rolling-release-control>','exec'),"
    "{'__name__':'__main__'})"
)


def _source() -> str:
    path = Path(remote_control.__file__ or "")
    if not path.is_file():
        raise RuntimeError("standalone remote-control source is unavailable")
    return path.read_text(encoding="utf-8")


def _encode(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


class RemoteRunControl:
    def __init__(
        self,
        transport: SshTransport,
        *,
        remote_project: PurePosixPath = PurePosixPath("/opt/RaspberryPiSystem_002"),
        source: str | None = None,
    ) -> None:
        if not remote_project.is_absolute() or ".." in remote_project.parts:
            raise ValueError("remote project must be an absolute normalized path")
        self.transport = transport
        self.remote_project = remote_project
        self.source = _source() if source is None else source
        if not self.source.strip():
            raise ValueError("remote-control source must not be empty")

    def _request(self, payload: dict[str, Any]) -> dict[str, Any]:
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        result = self.transport.run(
            [
                REMOTE_PYTHON,
                "-c",
                REMOTE_CONTROL_LOADER,
                _encode(self.source),
                _encode(serialized),
            ]
        )
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "remote control failed").strip())
        try:
            value = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError("remote control returned malformed JSON") from error
        if not isinstance(value, dict):
            raise RuntimeError("remote control returned a non-object")
        return value

    def snapshot(self, run_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        validate_lookup_run_id(run_id)
        value = self._request(
            {"action": "snapshot", "project": str(self.remote_project), "runId": run_id}
        )
        state = value.get("state")
        control = value.get("control")
        if state is not None and not isinstance(state, dict):
            raise RuntimeError("remote state is malformed")
        if control is not None and not isinstance(control, dict):
            raise RuntimeError("remote control record is malformed")
        return state, control

    def request_cancel(self, run_id: str, reason: str) -> dict[str, Any]:
        validate_lookup_run_id(run_id)
        return self._request(
            {
                "action": "cancel",
                "project": str(self.remote_project),
                "runId": run_id,
                "reason": reason,
            }
        )

    def approve(self, run_id: str, operator_client: str) -> dict[str, Any]:
        validate_lookup_run_id(run_id)
        return self._request(
            {
                "action": "approve",
                "project": str(self.remote_project),
                "runId": run_id,
                "client": operator_client,
            }
        )
