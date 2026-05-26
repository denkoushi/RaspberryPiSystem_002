#!/usr/bin/env python3
"""In-process Hermes chat runner with file approval relay (Phase D5.1)."""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from pathlib import Path

try:
    from .store import FileApprovalStore
    from .subprocess_notify import install_file_approval_relay
    from .tool_write_gate import install_tool_write_approval_relay
except ImportError:
    from store import FileApprovalStore
    from subprocess_notify import install_file_approval_relay
    from tool_write_gate import install_tool_write_approval_relay


def _poll_responses_until_stop(
    *,
    store_dir: Path,
    task_id: str,
    session_key: str,
    poll_interval_seconds: float,
    stop_event: threading.Event,
) -> None:
    store = FileApprovalStore(store_dir, task_id)
    try:
        import tools.approval as approval  # type: ignore[import-untyped]
    except ImportError:
        return

    while not stop_event.is_set():
        response = store.read_response()
        if response is not None:
            choice = response.choice.value
            approval.resolve_gateway_approval(session_key, choice)
            try:
                (store.task_dir / FileApprovalStore.RESPONSE_FILE).unlink(missing_ok=True)
            except OSError:
                pass
        time.sleep(max(poll_interval_seconds, 0.05))


def run_inprocess_hermes_chat(
    *,
    task_id: str,
    store_dir: Path,
    session_key: str,
    tools_home: Path,
    tools_env_path: Path,
    hermes_bin: Path,
    prompt: str,
    toolsets: str,
    request_timeout_seconds: float,
    poll_interval_seconds: float,
) -> int:
    """Register approval relay and invoke Hermes CLI main in this process."""
    os.environ["HOME"] = str(tools_home)
    os.environ["HERMES_EXEC_ASK"] = "1"
    os.environ["HERMES_GATEWAY_SESSION"] = session_key
    os.environ["HERMES_TASK_APPROVAL_RELAY"] = "1"
    os.environ["HERMES_TASK_APPROVAL_GUARD_WRITES"] = "1"
    path_prefix = str(hermes_bin.parent)
    os.environ["PATH"] = f"{path_prefix}:/usr/local/bin:/usr/bin:/bin"
    os.chdir(tools_home)

    if tools_env_path.is_file():
        for line in tools_env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            key = key.strip()
            if key:
                os.environ[key] = value.strip().strip('"').strip("'")

    install_file_approval_relay(
        store_dir=store_dir,
        task_id=task_id,
        session_key=session_key,
        request_timeout_seconds=request_timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )

    stop_event = threading.Event()
    poll_thread = threading.Thread(
        target=_poll_responses_until_stop,
        kwargs={
            "store_dir": store_dir,
            "task_id": task_id,
            "session_key": session_key,
            "poll_interval_seconds": poll_interval_seconds,
            "stop_event": stop_event,
        },
        name=f"approval-relay-poll-{task_id[:8]}",
        daemon=True,
    )
    poll_thread.start()

    argv = ["hermes", "chat", "-q", prompt, "--toolsets", toolsets]
    try:
        from hermes_cli.main import main as hermes_main  # type: ignore[import-untyped]
    except ImportError as exc:
        stop_event.set()
        poll_thread.join(timeout=2.0)
        print(f"hermes_cli.main unavailable: {exc}", file=sys.stderr)
        return 127

    install_tool_write_approval_relay(
        store_dir=store_dir,
        task_id=task_id,
        request_timeout_seconds=request_timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )

    old_argv = sys.argv
    sys.argv = argv
    try:
        hermes_main()
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else 1
    else:
        code = 0
    finally:
        sys.argv = old_argv
        stop_event.set()
        poll_thread.join(timeout=2.0)

    return int(code) if isinstance(code, int) else 1


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Hermes tools chat with approval relay")
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--store-dir", required=True)
    parser.add_argument("--session-key", required=True)
    parser.add_argument("--tools-home", required=True)
    parser.add_argument("--tools-env", required=True)
    parser.add_argument("--hermes-bin", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--toolsets", required=True)
    parser.add_argument("--request-timeout", type=float, default=300.0)
    parser.add_argument("--poll-interval", type=float, default=0.5)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    return run_inprocess_hermes_chat(
        task_id=args.task_id,
        store_dir=Path(args.store_dir),
        session_key=args.session_key,
        tools_home=Path(args.tools_home),
        tools_env_path=Path(args.tools_env),
        hermes_bin=Path(args.hermes_bin),
        prompt=args.prompt,
        toolsets=args.toolsets,
        request_timeout_seconds=args.request_timeout,
        poll_interval_seconds=args.poll_interval,
    )


if __name__ == "__main__":
    raise SystemExit(main())
