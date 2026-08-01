"""Read-only identity verification for a freshly installed Pi4 OS."""

from __future__ import annotations

import base64
import binascii
import hashlib
import ipaddress
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


HOSTNAME_RE = re.compile(
    r'^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
)
FINGERPRINT_RE = re.compile(r'^SHA256:[A-Za-z0-9+/]{43}$')


class BootstrapIdentityError(RuntimeError):
    """The reported bootstrap endpoint could not prove its expected identity."""


class BootstrapCommandRunner(Protocol):
    def run(
        self,
        command: list[str],
        *,
        capture: bool = True,
        cwd: Path | None = None,
    ) -> str:
        """Run one controller command."""


@dataclass(frozen=True)
class BootstrapIdentity:
    hostname: str
    user: str
    ssh_host_key_fingerprint: str
    known_hosts_entry: str

    def public_dict(self) -> dict[str, str]:
        return {
            'hostname': self.hostname,
            'user': self.user,
            'sshHostKeyFingerprint': self.ssh_host_key_fingerprint,
        }


class BootstrapIdentityVerifier(Protocol):
    def verify(
        self,
        host: str,
        expected_user: str,
        expected_hostname: str,
        expected_fingerprint: str | None = None,
    ) -> BootstrapIdentity:
        """Prove a reported endpoint without changing it."""


def canonical_hostname(value: str) -> str:
    hostname = value.strip()
    if not HOSTNAME_RE.fullmatch(hostname):
        raise BootstrapIdentityError(
            'bootstrap hostname must be a short hostname containing only letters, digits, and hyphens'
        )
    return hostname.lower()


def _fingerprint(key_blob: str) -> str:
    try:
        decoded = base64.b64decode(key_blob, validate=True)
    except (ValueError, binascii.Error) as error:
        raise BootstrapIdentityError(
            'bootstrap SSH host key has an invalid encoding'
        ) from error
    digest = base64.b64encode(hashlib.sha256(decoded).digest()).decode('ascii')
    return f"SHA256:{digest.rstrip('=')}"


class SshBootstrapIdentityVerifier:
    """Pin one ED25519 host key, then verify the remote user and short hostname."""

    def __init__(self, runner: BootstrapCommandRunner) -> None:
        self.runner = runner

    def verify(
        self,
        host: str,
        expected_user: str,
        expected_hostname: str,
        expected_fingerprint: str | None = None,
    ) -> BootstrapIdentity:
        try:
            address = ipaddress.ip_address(host)
        except ValueError as error:
            raise BootstrapIdentityError(
                'bootstrap identity verification requires a literal IPv4 address'
            ) from error
        if not isinstance(address, ipaddress.IPv4Address):
            raise BootstrapIdentityError(
                'bootstrap identity verification requires a literal IPv4 address'
            )
        endpoint = str(address)
        hostname = canonical_hostname(expected_hostname)
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', expected_user):
            raise BootstrapIdentityError('inventory SSH user is not safe for recovery')
        if expected_fingerprint is not None and not FINGERPRINT_RE.fullmatch(
            expected_fingerprint
        ):
            raise BootstrapIdentityError(
                'bootstrap SSH host-key fingerprint must use the SHA256 format returned by plan'
            )

        try:
            scanned = self.runner.run(
                ['ssh-keyscan', '-T', '5', '-t', 'ed25519', endpoint]
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise BootstrapIdentityError(
                'bootstrap SSH host key could not be read'
            ) from error

        keys: set[str] = set()
        for raw_line in scanned.splitlines():
            line = raw_line.strip()
            if not line or line.startswith('#'):
                continue
            fields = line.split()
            if len(fields) != 3 or fields[1] != 'ssh-ed25519':
                raise BootstrapIdentityError(
                    'bootstrap SSH key scan returned an unexpected record'
                )
            keys.add(fields[2])
        if len(keys) != 1:
            raise BootstrapIdentityError(
                'bootstrap endpoint must expose exactly one ED25519 SSH host key'
            )
        key_blob = next(iter(keys))
        fingerprint = _fingerprint(key_blob)
        if expected_fingerprint is not None and fingerprint != expected_fingerprint:
            raise BootstrapIdentityError(
                'bootstrap SSH host key changed after plan; recovery did not start'
            )
        known_hosts_entry = f'{endpoint} ssh-ed25519 {key_blob}'

        try:
            with tempfile.TemporaryDirectory(
                prefix='pi4-recovery-known-hosts-'
            ) as directory:
                known_hosts_path = Path(directory) / 'known_hosts'
                known_hosts_path.write_text(
                    known_hosts_entry + '\n', encoding='utf-8'
                )
                os.chmod(known_hosts_path, 0o600)
                output = self.runner.run(
                    [
                        'ssh',
                        '-o',
                        'BatchMode=yes',
                        '-o',
                        'ConnectTimeout=15',
                        '-o',
                        f'UserKnownHostsFile={known_hosts_path}',
                        '-o',
                        'StrictHostKeyChecking=yes',
                        f'{expected_user}@{endpoint}',
                        'id -un && hostname -s',
                    ]
                )
        except (OSError, subprocess.SubprocessError) as error:
            raise BootstrapIdentityError(
                'bootstrap SSH identity could not be verified with its pinned host key'
            ) from error

        identity_lines = [line.strip() for line in output.splitlines() if line.strip()]
        if len(identity_lines) != 2 or identity_lines[0] != expected_user:
            raise BootstrapIdentityError(
                'bootstrap endpoint authenticated as an unexpected user'
            )
        if canonical_hostname(identity_lines[1]) != hostname:
            raise BootstrapIdentityError(
                'bootstrap endpoint reported a different hostname'
            )
        return BootstrapIdentity(
            hostname=hostname,
            user=expected_user,
            ssh_host_key_fingerprint=fingerprint,
            known_hosts_entry=known_hosts_entry,
        )
