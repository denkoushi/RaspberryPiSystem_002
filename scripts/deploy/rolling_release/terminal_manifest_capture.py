"""Seal file and runtime rollback manifests through one SSH transport.

The zip application starts as the terminal SSH user, proves that live account
identity, then re-executes itself once through passwordless sudo. The elevated
process calls the existing idempotent manifest implementations and returns
their two independent results in one non-secret envelope.
"""
from __future__ import annotations

import argparse
import base64
import importlib
import json
import os
import pwd
import re
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any


USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
HOME_RE = re.compile(r"^/home/[a-z_][a-z0-9_-]{0,31}$")
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SUCCESS_MARKER_PREFIX = "TERMINAL_MANIFEST_CAPTURE_RESULT:"
ERROR_MARKER_PREFIX = "TERMINAL_MANIFEST_CAPTURE_ERROR:"
REMOTE_USER_TOKEN = "@REMOTE_USER@"
REMOTE_HOME_TOKEN = "@REMOTE_HOME@"


class CaptureEnvelopeError(RuntimeError):
    def __init__(self, stage: str, code: str, message: str) -> None:
        super().__init__(message)
        self.stage = stage
        self.code = code


def _encoded_marker(prefix: str, value: dict[str, Any]) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return prefix + base64.urlsafe_b64encode(encoded).decode("ascii")


def _safe_message(value: str) -> str:
    message = " ".join(value.split())[:512]
    return message or "terminal manifest capture failed"


def _invoking_identity() -> tuple[str, str]:
    if os.geteuid() == 0:
        raise CaptureEnvelopeError(
            "identity", "identity.root", "capture transport did not start as the SSH user"
        )
    record = pwd.getpwuid(os.geteuid())
    user = record.pw_name
    home = record.pw_dir
    if (
        USER_RE.fullmatch(user) is None
        or HOME_RE.fullmatch(home) is None
        or home != f"/home/{user}"
    ):
        raise CaptureEnvelopeError(
            "identity", "identity.account", "terminal SSH account identity is malformed"
        )
    return user, home


def _concrete_paths(templates: list[str], user: str, home: str) -> list[str]:
    concrete: list[str] = []
    for template in templates:
        if not isinstance(template, str) or "\x00" in template or len(template) > 4096:
            raise CaptureEnvelopeError(
                "identity", "identity.path-template", "manifest path template is malformed"
            )
        path = template.replace(REMOTE_USER_TOKEN, user).replace(REMOTE_HOME_TOKEN, home)
        if REMOTE_USER_TOKEN in path or REMOTE_HOME_TOKEN in path:
            raise CaptureEnvelopeError(
                "identity", "identity.path-template", "manifest path template is unresolved"
            )
        if not path.startswith("/") or os.path.normpath(path) != path:
            raise CaptureEnvelopeError(
                "identity", "identity.path", "manifest destination is not normalized"
            )
        concrete.append(path)
    if not concrete or len(concrete) != len(set(concrete)):
        raise CaptureEnvelopeError(
            "identity", "identity.paths", "manifest destination set is malformed"
        )
    return concrete


def capture_all(
    args: argparse.Namespace,
    *,
    rollback_module: Any | None = None,
    runtime_module: Any | None = None,
) -> dict[str, Any]:
    if os.geteuid() != 0:
        raise CaptureEnvelopeError(
            "identity", "identity.privilege", "manifest capture is not elevated"
        )
    if (
        USER_RE.fullmatch(args.remote_user or "") is None
        or HOME_RE.fullmatch(args.remote_home or "") is None
        or args.remote_home != f"/home/{args.remote_user}"
    ):
        raise CaptureEnvelopeError(
            "identity", "identity.forwarded", "forwarded terminal identity is malformed"
        )
    try:
        account = pwd.getpwnam(args.remote_user)
    except KeyError as error:
        raise CaptureEnvelopeError(
            "identity", "identity.missing", "terminal SSH account disappeared"
        ) from error
    if account.pw_dir != args.remote_home:
        raise CaptureEnvelopeError(
            "identity", "identity.changed", "terminal SSH account home changed"
        )
    if FULL_SHA_RE.fullmatch(args.expected_head or "") is None:
        raise CaptureEnvelopeError(
            "file", "file.expected-head", "terminal expected HEAD is malformed"
        )

    rollback = rollback_module or importlib.import_module("rollback_manifest")
    runtime = runtime_module or importlib.import_module("terminal_runtime_manifest")
    try:
        file_result = rollback.capture_set(
            root=args.file_root,
            run_id=args.run_id,
            host=args.host,
            paths=args.path,
            repository=args.repository,
            expected_head=args.expected_head,
        )
    except Exception as error:
        raise CaptureEnvelopeError(
            "file", "file.capture", "file manifest capture failed"
        ) from error
    try:
        runtime_result = runtime.capture(
            root=args.runtime_root,
            run_id=args.run_id,
            host=args.host,
            units=args.unit,
            docker_services=args.docker_service,
            restart_on_restore_units=args.restart_on_restore_unit,
            compose_project=args.compose_project,
            compose_working_directory=args.compose_working_directory,
            compose_config_files=args.compose_config_file,
        )
    except Exception as error:
        code = getattr(error, "code", "runtime.capture")
        if not isinstance(code, str) or not re.fullmatch(r"[a-z0-9.-]{1,100}", code):
            code = "runtime.capture"
        raise CaptureEnvelopeError(
            "runtime", code, "runtime manifest capture failed"
        ) from error
    return {
        "version": 1,
        "remoteUser": args.remote_user,
        "remoteHome": args.remote_home,
        "fileManifest": file_result,
        "runtimeManifest": runtime_result,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--elevated", action="store_true")
    parser.add_argument("--remote-user")
    parser.add_argument("--remote-home")
    parser.add_argument("--file-root", type=Path, required=True)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--path-template", action="append", default=[])
    parser.add_argument("--path", action="append", default=[])
    parser.add_argument("--unit", action="append", default=[])
    parser.add_argument("--restart-on-restore-unit", action="append", default=[])
    parser.add_argument("--docker-service", action="append", default=[])
    parser.add_argument("--compose-project")
    parser.add_argument("--compose-working-directory", type=Path)
    parser.add_argument("--compose-config-file", action="append", type=Path, default=[])
    parser.add_argument("--ansible-marker", action="store_true")
    return parser


def _elevated_arguments(args: argparse.Namespace, user: str, home: str) -> list[str]:
    concrete_paths = _concrete_paths(args.path_template, user, home)
    arguments = [
        "--elevated",
        "--remote-user",
        user,
        "--remote-home",
        home,
        "--file-root",
        str(args.file_root),
        "--runtime-root",
        str(args.runtime_root),
        "--run-id",
        args.run_id,
        "--host",
        args.host,
        "--repository",
        str(args.repository),
        "--expected-head",
        args.expected_head,
    ]
    for path in concrete_paths:
        arguments.extend(("--path", path))
    for unit in args.unit:
        arguments.extend(("--unit", unit))
    for unit in args.restart_on_restore_unit:
        arguments.extend(("--restart-on-restore-unit", unit))
    for service in args.docker_service:
        arguments.extend(("--docker-service", service))
    if args.compose_project is not None:
        arguments.extend(("--compose-project", args.compose_project))
    if args.compose_working_directory is not None:
        arguments.extend(
            ("--compose-working-directory", str(args.compose_working_directory))
        )
    for path in args.compose_config_file:
        arguments.extend(("--compose-config-file", str(path)))
    if args.ansible_marker:
        arguments.append("--ansible-marker")
    return arguments


def _run_elevated(args: argparse.Namespace) -> int:
    user, home = _invoking_identity()
    archive = Path(sys.argv[0]).resolve()
    try:
        metadata = archive.stat()
    except OSError as error:
        raise CaptureEnvelopeError(
            "identity", "identity.archive", "capture archive is unavailable"
        ) from error
    if not stat.S_ISREG(metadata.st_mode):
        raise CaptureEnvelopeError(
            "identity", "identity.archive", "capture archive is not a regular file"
        )
    command = [
        "/usr/bin/sudo",
        "-n",
        "/usr/bin/python3",
        str(archive),
        *_elevated_arguments(args, user, home),
    ]
    completed = subprocess.run(
        command,
        text=True,
        capture_output=True,
        check=False,
        env={"PATH": os.environ.get("PATH", "")},
    )
    sys.stdout.write(completed.stdout)
    sys.stderr.write(completed.stderr)
    return completed.returncode


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if not args.elevated:
            return _run_elevated(args)
        if args.path_template:
            raise CaptureEnvelopeError(
                "identity", "identity.template-elevated", "elevated capture received templates"
            )
        result = capture_all(args)
    except CaptureEnvelopeError as error:
        payload = {
            "version": 1,
            "stage": error.stage,
            "code": error.code,
            "message": _safe_message(str(error)),
        }
        if args.ansible_marker:
            print(_encoded_marker(ERROR_MARKER_PREFIX, payload))
        else:
            print("terminal manifest capture failed", file=sys.stderr)
        return 1
    except Exception:
        # Never transport an unexpected exception string: helper failures can
        # include subprocess or endpoint context adjacent to secrets.
        payload = {
            "version": 1,
            "stage": "identity",
            "code": "capture.internal",
            "message": "terminal manifest capture failed",
        }
        if args.ansible_marker:
            print(_encoded_marker(ERROR_MARKER_PREFIX, payload))
        else:
            print("terminal manifest capture failed", file=sys.stderr)
        return 1
    if args.ansible_marker:
        print(_encoded_marker(SUCCESS_MARKER_PREFIX, result))
    else:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
