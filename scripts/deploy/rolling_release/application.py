"""Pi3 artifact-preflight transport and remote identity helpers."""
from __future__ import annotations

import re
import shlex
from pathlib import PurePosixPath
from typing import Any

from .backends.command import SshTransport, SubprocessRunner
from .backends.systemd import DEFAULT_REMOTE_USER
from .policy import server_identity


_REMOTE_CLIENT_ID_PROBE = r'''import os,re,stat,sys
p="/etc/raspi-status-agent.conf"
flags=os.O_RDONLY|getattr(os,"O_CLOEXEC",0)|getattr(os,"O_NOFOLLOW",0)
try:
 fd=os.open(p,flags)
 try:
  if not stat.S_ISREG(os.fstat(fd).st_mode): raise OSError("not regular")
  data=os.read(fd,65537)
 finally: os.close(fd)
 if len(data)>65536: raise OSError("too large")
 text=data.decode("utf-8")
 values=[]
 pattern=re.compile(r'^[ \t]*CLIENT_ID[ \t]*=[ \t]*(?:"([A-Za-z0-9][A-Za-z0-9._:-]{0,127})"|\'([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\'|([A-Za-z0-9][A-Za-z0-9._:-]{0,127}))[ \t]*(?:#.*)?$')
 for line in text.splitlines():
  match=pattern.fullmatch(line)
  if match: values.append(next(value for value in match.groups() if value is not None))
 if len(values)!=1: raise OSError("CLIENT_ID unavailable")
 print(values[0])
except Exception:
 sys.exit(78)
'''


def _remote_user_and_host(raw_host: str) -> tuple[str, str]:
    if "@" in raw_host:
        user, host = raw_host.split("@", 1)
        if not user or not host:
            raise RuntimeError("RASPI_SERVER_HOST is malformed")
        return user, raw_host
    return DEFAULT_REMOTE_USER, f"{DEFAULT_REMOTE_USER}@{raw_host}"


def build_server_transport(
    runtime: Any,
    *,
    runner: Any | None = None,
) -> tuple[str, SshTransport]:
    """Build the SSH transport used by the Pi3 artifact preflight."""

    raw_host = runtime.os.environ.get("RASPI_SERVER_HOST")
    if not raw_host:
        raise RuntimeError("RASPI_SERVER_HOST is required")
    remote_user, ssh_host = _remote_user_and_host(raw_host)
    options = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"]
    configured = runtime.os.environ.get("RASPI_SERVER_SSH_OPTS")
    if configured:
        options.extend(shlex.split(configured))
    transport = SshTransport(
        ssh_host,
        runner if runner is not None else SubprocessRunner(),
        ssh_options=options,
    )
    return remote_user, transport


def read_remote_server_client_id(*, runtime: Any) -> str:
    """Read only the public CLIENT_ID field; never return the config or key."""

    _remote_user, transport = build_server_transport(runtime)
    result = transport.run(["/usr/bin/python3", "-c", _REMOTE_CLIENT_ID_PROBE])
    value = result.stdout.strip()
    if (
        result.returncode != 0
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value)
    ):
        raise RuntimeError("remote Pi5 CLIENT_ID could not be verified")
    return value


def validate_remote_server_identity(
    inventory_data: dict[str, Any], *, runtime: Any
) -> dict[str, str]:
    identity = server_identity(inventory_data)
    if read_remote_server_client_id(runtime=runtime) != identity["clientId"]:
        raise RuntimeError(
            "RASPI_SERVER_HOST does not match the selected inventory server identity"
        )
    return identity
