"""Pure pinned-host-key contract for StoneBase Local control SSH.

The aggregate preflight executes this exact candidate source on Pi5 and the
locked Local backend imports the same accepted source after the Pi5 checkout
switch.  Keep it standard-library-only so neither boundary can silently fall
back to ambient SSH configuration.
"""
from __future__ import annotations

import base64
import binascii
import re
from pathlib import PurePosixPath


MAX_KNOWN_HOSTS_BYTES = 1024
_KEY_TYPE = "ssh-ed25519"
_LINE_RE = re.compile(r"^\* ssh-ed25519 ([A-Za-z0-9+/]+={0,2})$")


class LocalTransportContractError(ValueError):
    """The Local SSH host-key contract is missing or malformed."""


def validate_known_hosts_payload(value: str | bytes) -> str:
    """Return one normalized wildcard-scoped Ed25519 known-hosts record."""

    if isinstance(value, str):
        try:
            raw = value.encode("ascii")
        except UnicodeEncodeError as error:
            raise LocalTransportContractError(
                "Local known-hosts payload is not ASCII"
            ) from error
    elif isinstance(value, bytes):
        raw = value
    else:
        raise LocalTransportContractError("Local known-hosts payload is malformed")
    if not raw or len(raw) > MAX_KNOWN_HOSTS_BYTES or b"\x00" in raw:
        raise LocalTransportContractError("Local known-hosts payload is malformed")
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError as error:
        raise LocalTransportContractError(
            "Local known-hosts payload is not ASCII"
        ) from error
    lines = text.splitlines()
    if len(lines) != 1 or text not in {lines[0], f"{lines[0]}\n"}:
        raise LocalTransportContractError(
            "Local known-hosts payload must contain exactly one record"
        )
    match = _LINE_RE.fullmatch(lines[0])
    if match is None:
        raise LocalTransportContractError(
            "Local known-hosts record must pin one Ed25519 key"
        )
    try:
        decoded = base64.b64decode(match.group(1), validate=True)
    except (binascii.Error, ValueError) as error:
        raise LocalTransportContractError(
            "Local known-hosts Ed25519 key is malformed"
        ) from error
    expected_prefix = b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20"
    if len(decoded) != len(expected_prefix) + 32 or not decoded.startswith(
        expected_prefix
    ):
        raise LocalTransportContractError(
            "Local known-hosts Ed25519 key is malformed"
        )
    return f"* {_KEY_TYPE} {match.group(1)}\n"


def ssh_security_options(known_hosts_path: str) -> tuple[str, ...]:
    """Return the complete non-ambient host-authentication option set."""

    if not isinstance(known_hosts_path, str) or "\x00" in known_hosts_path:
        raise LocalTransportContractError("Local known-hosts path is malformed")
    path = PurePosixPath(known_hosts_path)
    if (
        not path.is_absolute()
        or ".." in path.parts
        or str(path) != known_hosts_path
    ):
        raise LocalTransportContractError("Local known-hosts path is malformed")
    return (
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        f"UserKnownHostsFile={known_hosts_path}",
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        "-o",
        "UpdateHostKeys=no",
        "-o",
        "HostKeyAlgorithms=ssh-ed25519",
    )
