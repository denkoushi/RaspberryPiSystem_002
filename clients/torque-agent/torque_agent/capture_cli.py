from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Sequence

from .capture_fixtures import replay_summary, sanitize_capture, validate_fixtures
from .capture_models import (
    FRAME_TERMINATORS_BY_NAME,
    CaptureConfiguration,
    CaptureDeviceError,
    CaptureIncompleteError,
    CaptureSafetyError,
)
from .capture_recorder import capture_events


EXIT_SUCCESS = 0
EXIT_USAGE_OR_SAFETY = 2
EXIT_INCOMPLETE = 3
EXIT_DEVICE_OR_OS = 4


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return parsed


def _positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="torque-capture",
        description="Read-only CEM3-BTLA capture, replay, sanitization, and fixture validation tools.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    capture = subparsers.add_parser("capture", help="capture private raw EV_KEY events on Linux")
    capture.add_argument("--device", type=Path, required=True)
    capture.add_argument("--output", type=Path, required=True)
    capture.add_argument("--scenario", choices=sorted({
        "normal", "below_limit", "above_limit", "repeated_memory", "rapid_consecutive"
    }), required=True)
    capture.add_argument("--expected-frames", type=_positive_int, required=True)
    capture.add_argument("--firmware", required=True)
    capture.add_argument("--output-config", required=True)
    capture.add_argument(
        "--terminator",
        choices=sorted(FRAME_TERMINATORS_BY_NAME),
        default="enter",
        help="key that completes one transmitted measurement; TAB remains a field delimiter in enter mode",
    )
    capture.add_argument("--timeout", type=_positive_float, default=120.0)

    replay = subparsers.add_parser("replay", help="replay captured EV_KEY events without printing payloads")
    replay.add_argument("--input", type=Path, required=True)
    replay.add_argument(
        "--synthetic",
        action="store_true",
        help="allow an explicit repository-hosted synthetic event file",
    )

    sanitize = subparsers.add_parser("sanitize", help="replace exact private literals and emit a fixture")
    sanitize.add_argument("--input", type=Path, required=True)
    sanitize.add_argument("--redactions", type=Path, required=True)
    sanitize.add_argument("--output", type=Path, required=True)

    validate = subparsers.add_parser("validate", help="validate fixture schema, provenance, and coverage")
    validate.add_argument("--fixtures", type=Path, required=True)
    validate.add_argument("--available-device-count", type=_positive_int, default=1)
    validate.add_argument("--redactions", type=Path)
    return parser


def _print_summary(value: dict[str, object]) -> None:
    print(json.dumps(value, ensure_ascii=False, sort_keys=True))


def _capture(args: argparse.Namespace) -> dict[str, object]:
    # The Linux-only adapter is deliberately imported only for the capture subcommand.
    from .linux_event_source import LinuxEvdevEventSource

    config = CaptureConfiguration(
        device=args.device,
        output=args.output,
        scenario=args.scenario,
        expected_frames=args.expected_frames,
        firmware=args.firmware,
        output_config=args.output_config,
        timeout_seconds=args.timeout,
        frame_terminators=FRAME_TERMINATORS_BY_NAME[args.terminator],
    )
    frames = asyncio.run(capture_events(LinuxEvdevEventSource(config.device), config))
    return {"status": "complete", "frames": frames}


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "capture":
            result = _capture(args)
        elif args.command == "replay":
            result = replay_summary(args.input, allow_repository_input=args.synthetic)
        elif args.command == "sanitize":
            result = sanitize_capture(args.input, args.redactions, args.output)
        elif args.command == "validate":
            result = validate_fixtures(
                args.fixtures,
                available_device_count=args.available_device_count,
                redactions_path=args.redactions,
            )
        else:  # pragma: no cover - argparse makes this unreachable
            raise CaptureSafetyError("unknown command")
    except CaptureSafetyError as error:
        print(f"safety error: {error}", file=sys.stderr)
        return EXIT_USAGE_OR_SAFETY
    except CaptureIncompleteError as error:
        print(f"incomplete: {error}", file=sys.stderr)
        return EXIT_INCOMPLETE
    except (CaptureDeviceError, OSError) as error:
        print(f"device error: {error}", file=sys.stderr)
        return EXIT_DEVICE_OR_OS
    except KeyboardInterrupt:
        print("incomplete: capture interrupted; acquired events were retained", file=sys.stderr)
        return EXIT_INCOMPLETE
    _print_summary(result)
    return EXIT_SUCCESS


if __name__ == "__main__":
    raise SystemExit(main())
