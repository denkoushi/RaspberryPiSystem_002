"""Subprocess boundary used by snapshot and restic adapters.

Keeping process creation here makes the higher-level modules deterministic in
unit tests and gives the runner one place to terminate an in-flight restic or
Docker child when systemd sends SIGTERM.
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol


@dataclass(frozen=True)
class CommandResult:
    """The safe subset of a subprocess result exposed to callers."""

    returncode: int
    stdout: bytes = b""
    stderr: bytes = b""


class CommandError(RuntimeError):
    """Raised for a non-zero command without echoing command output."""

    def __init__(self, argv: Sequence[str], returncode: int):
        self.argv = tuple(str(item) for item in argv)
        self.returncode = int(returncode)
        super().__init__(f"command failed with exit code {self.returncode}")


class CommandPort(Protocol):
    """Minimal command boundary required by the snapshot and restic layers."""

    def run(
        self,
        argv: Sequence[str],
        *,
        check: bool = True,
        stdout: BinaryIO | int | None = None,
        input: bytes | None = None,
        input_file: BinaryIO | str | os.PathLike[str] | None = None,
        env: Mapping[str, str] | None = None,
        cwd: str | None = None,
    ) -> CommandResult:
        ...

    def terminate_active(self) -> None:
        ...


class SubprocessCommandPort:
    """Run one child at a time and terminate its complete process group."""

    def __init__(self) -> None:
        self._active: subprocess.Popen[bytes] | None = None
        self._lock = threading.Lock()

    def run(
        self,
        argv: Sequence[str],
        *,
        check: bool = True,
        stdout: BinaryIO | int | None = None,
        input: bytes | None = None,
        input_file: BinaryIO | str | os.PathLike[str] | None = None,
        env: Mapping[str, str] | None = None,
        cwd: str | None = None,
    ) -> CommandResult:
        if input is not None and input_file is not None:
            raise ValueError("input and input_file are mutually exclusive")
        owned_input: BinaryIO | None = None
        if input_file is not None:
            if hasattr(input_file, "read"):
                stdin = input_file
            else:
                # The stream must stay open until ``communicate`` drains it;
                # the finally block below is its explicit context boundary.
                owned_input = Path(input_file).open("rb")  # noqa: SIM115
                stdin = owned_input
        else:
            stdin = subprocess.PIPE if input is not None else subprocess.DEVNULL
        process = subprocess.Popen(
            [str(item) for item in argv],
            stdin=stdin,
            stdout=stdout if stdout is not None else subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=dict(env) if env is not None else None,
            cwd=cwd,
            start_new_session=True,
        )
        with self._lock:
            self._active = process
        try:
            output, error = process.communicate(input=input)
        finally:
            if owned_input is not None:
                owned_input.close()
            with self._lock:
                if self._active is process:
                    self._active = None
        result = CommandResult(
            returncode=int(process.returncode or 0),
            stdout=output or b"",
            stderr=error or b"",
        )
        if check and result.returncode != 0:
            raise CommandError(argv, result.returncode)
        return result

    def terminate_active(self) -> None:
        """Ask the active child and descendants to stop, without deleting data."""

        with self._lock:
            process = self._active
        if process is None or process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
