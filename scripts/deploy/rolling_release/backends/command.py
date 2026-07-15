"""Injectable subprocess and SSH command boundaries."""
from __future__ import annotations

import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol, Sequence


@dataclass(frozen=True)
class CommandResult:
    argv: tuple[str, ...]
    returncode: int
    stdout: str = ''
    stderr: str = ''


class CommandRunner(Protocol):
    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path | None = None,
        env: Mapping[str, str] | None = None,
        input_text: str | None = None,
    ) -> CommandResult:
        """Execute argv without a shell and return all observable results."""


class SubprocessRunner:
    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path | None = None,
        env: Mapping[str, str] | None = None,
        input_text: str | None = None,
    ) -> CommandResult:
        command = tuple(str(value) for value in argv)
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=dict(env) if env is not None else os.environ.copy(),
            input=input_text,
            text=True,
            capture_output=True,
            check=False,
        )
        return CommandResult(command, completed.returncode, completed.stdout, completed.stderr)


class SshTransport:
    """Turn a remote argv into one safely quoted OpenSSH command argument."""

    def __init__(
        self,
        host: str,
        runner: CommandRunner,
        *,
        ssh_binary: str = 'ssh',
        ssh_options: Sequence[str] = (),
    ) -> None:
        if not isinstance(host, str) or not host or '\x00' in host:
            raise ValueError('SSH host is missing or malformed')
        self.host = host
        self.runner = runner
        self.ssh_binary = ssh_binary
        self.ssh_options = tuple(ssh_options)

    def run(self, remote_argv: Sequence[str], *, input_text: str | None = None) -> CommandResult:
        remote = tuple(str(value) for value in remote_argv)
        if not remote or any('\x00' in value for value in remote):
            raise ValueError('remote command is empty or malformed')
        remote_command = shlex.join(remote)
        return self.runner.run(
            [self.ssh_binary, *self.ssh_options, '--', self.host, remote_command],
            input_text=input_text,
        )
