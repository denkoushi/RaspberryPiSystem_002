"""Command-line contract for the rolling release entry point."""
from __future__ import annotations

import argparse
import re


DEFAULT_CANARY_HOLD_TIMEOUT = 1800
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
OCI_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
PI3_SIGNAGE_ARTIFACT_SCOPE = "pi3-signage-artifact"


class UsageError(RuntimeError):
    """A user-facing command contract error that must exit with status 2."""


RETIRED_OPTIONS: tuple[tuple[str, str], ...] = (
    ("follow", "--follow is retired; use --status RUN_ID"),
    ("foreground", "--foreground is retired; omit it because normal execution waits"),
    ("profile", "--profile is retired; use GitHub Actions or systemd timing"),
    ("job", "--job is retired; use --detach"),
    ("attach", "--attach is retired; use --status RUN_ID"),
    (
        "client_only_compatible",
        "--client-only-compatible is retired; use --limit PATTERN and keep Pi5-required changes in scope",
    ),
)


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(
        prog="update-all-clients.sh",
        description="Run or inspect one fail-closed rolling release.",
    )
    value.add_argument("branch_positional", nargs="?")
    value.add_argument("inventory_positional", nargs="?")
    value.add_argument("--branch", dest="branch")
    value.add_argument("--inventory", dest="inventory")
    value.add_argument("--limit", default="")
    value.add_argument("--status")
    value.add_argument("--approve")
    value.add_argument("--cancel")
    value.add_argument("--print-plan", "--dry-run", action="store_true")
    value.add_argument("--preflight-only", action="store_true")
    value.add_argument("--detach", action="store_true")
    value.add_argument("--full-fleet", action="store_true")
    value.add_argument("--reverify-selected", action="store_true")
    value.add_argument(
        "--release-scope",
        choices=(PI3_SIGNAGE_ARTIFACT_SCOPE,),
    )
    value.add_argument("--signage-oci-digest")
    value.add_argument("--signage-source-sha")
    value.add_argument("--signage-artifact-sha256")
    value.add_argument("--signage-manifest-sha256")
    value.add_argument("--signage-payload-digest")
    value.add_argument("--follow", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--foreground", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--profile", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--job", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--attach", help=argparse.SUPPRESS)
    value.add_argument(
        "--client-only-compatible",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    value.add_argument("--emergency-override", action="store_true")
    value.add_argument("--reason")
    value.add_argument("--remote-run", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--sha", help=argparse.SUPPRESS)
    value.add_argument("--run-id", help=argparse.SUPPRESS)
    value.add_argument("--expected-server-client-id", help=argparse.SUPPRESS)
    value.add_argument("--readiness-admission-json", help=argparse.SUPPRESS)
    value.add_argument("--skip-canary-hold", action="store_true")
    value.add_argument(
        "--canary-hold-timeout",
        type=int,
        default=None,
        help=argparse.SUPPRESS,
    )
    return value


def validate_run_id(value: str) -> str:
    if not RUN_ID_RE.fullmatch(value):
        raise UsageError("run ID must contain only 3-80 letters, digits, '_' or '-', and start with a letter or digit")
    return value


def _validate_text(name: str, value: str | None, *, maximum: int = 500) -> None:
    if value is None:
        return
    if not value.strip():
        raise UsageError(f"{name} must not be empty")
    if len(value) > maximum or any(ord(character) < 32 for character in value):
        raise UsageError(f"{name} contains unsupported control characters or is too long")


def _validate_branch(value: str) -> None:
    _validate_text("branch", value, maximum=255)
    forbidden = ("..", "@{", "\\", " ", "~", "^", ":", "?", "*", "[")
    if value.startswith(("-", ".", "/")) or value.endswith((".", "/")) or "//" in value:
        raise UsageError("branch is not a safe Git branch name")
    if any(token in value for token in forbidden):
        raise UsageError("branch is not a safe Git branch name")


def normalize_arguments(args: argparse.Namespace) -> argparse.Namespace:
    """Normalize positional input and reject invalid combinations locally."""
    for option, positional in (("branch", "branch_positional"), ("inventory", "inventory_positional")):
        explicit = getattr(args, option)
        positional_value = getattr(args, positional)
        if explicit and positional_value and explicit != positional_value:
            raise UsageError(f"conflicting {option} values")
        setattr(args, option, explicit or positional_value)

    for attribute, message in RETIRED_OPTIONS:
        if getattr(args, attribute, None):
            raise UsageError(message)

    control_actions = [
        ("--status", args.status),
        ("--approve", args.approve),
        ("--cancel", args.cancel),
    ]
    selected_actions = [(name, value) for name, value in control_actions if value]
    if len(selected_actions) > 1:
        raise UsageError("--status, --approve and --cancel are mutually exclusive")

    if selected_actions:
        name, run_id = selected_actions[0]
        validate_run_id(run_id)
        release_only_options = [
            option
            for option, selected in (
                ("branch", args.branch is not None),
                ("inventory", args.inventory is not None),
                ("--limit", bool(args.limit)),
                ("--detach", args.detach),
                ("--print-plan", args.print_plan),
                ("--preflight-only", args.preflight_only),
                ("--remote-run", args.remote_run),
                ("--sha", args.sha is not None),
                ("--run-id", args.run_id is not None),
                ("--expected-server-client-id", args.expected_server_client_id is not None),
                ("--readiness-admission-json", args.readiness_admission_json is not None),
                ("--emergency-override", args.emergency_override),
                ("--skip-canary-hold", args.skip_canary_hold),
                ("--full-fleet", args.full_fleet),
                ("--reverify-selected", args.reverify_selected),
                ("--release-scope", args.release_scope is not None),
                ("--signage-oci-digest", args.signage_oci_digest is not None),
                ("--signage-source-sha", args.signage_source_sha is not None),
                (
                    "--signage-artifact-sha256",
                    args.signage_artifact_sha256 is not None,
                ),
                (
                    "--signage-manifest-sha256",
                    args.signage_manifest_sha256 is not None,
                ),
                (
                    "--signage-payload-digest",
                    args.signage_payload_digest is not None,
                ),
                (
                    "--canary-hold-timeout",
                    args.canary_hold_timeout is not None,
                ),
            )
            if selected
        ]
        if release_only_options:
            raise UsageError(
                f"{name} cannot be combined with release option {release_only_options[0]}"
            )
        if name == "--cancel":
            _validate_text("--reason", args.reason)
            if not args.reason:
                raise UsageError("--cancel requires --reason TEXT")
        elif args.reason:
            raise UsageError("--reason is valid only with --cancel or --emergency-override")
        return args

    if args.emergency_override:
        _validate_text("--reason", args.reason)
        if not args.reason:
            raise UsageError("--emergency-override requires --reason TEXT")
    elif args.reason:
        raise UsageError("--reason requires --emergency-override or --cancel")
    if args.skip_canary_hold and not (args.emergency_override and args.reason):
        raise UsageError("--skip-canary-hold requires --emergency-override --reason TEXT")
    if args.canary_hold_timeout is None:
        args.canary_hold_timeout = DEFAULT_CANARY_HOLD_TIMEOUT
    if args.canary_hold_timeout <= 0:
        raise UsageError("--canary-hold-timeout must be greater than zero")
    if args.print_plan and args.detach:
        raise UsageError("--print-plan cannot be combined with --detach")
    if args.preflight_only and args.detach:
        raise UsageError("--preflight-only cannot be combined with --detach")
    if args.preflight_only and args.print_plan:
        raise UsageError("--preflight-only cannot be combined with --print-plan")
    if args.preflight_only and (args.emergency_override or args.skip_canary_hold):
        raise UsageError("--preflight-only cannot be combined with execution override options")
    if args.preflight_only and args.canary_hold_timeout != DEFAULT_CANARY_HOLD_TIMEOUT:
        raise UsageError("--preflight-only cannot be combined with --canary-hold-timeout")
    if args.full_fleet and args.limit:
        raise UsageError("--full-fleet cannot be combined with --limit")
    if args.reverify_selected and not args.limit:
        raise UsageError("--reverify-selected requires --limit PATTERN")
    if args.release_scope == PI3_SIGNAGE_ARTIFACT_SCOPE:
        identity = {
            "--signage-source-sha": args.signage_source_sha,
            "--signage-artifact-sha256": args.signage_artifact_sha256,
            "--signage-manifest-sha256": args.signage_manifest_sha256,
            "--signage-payload-digest": args.signage_payload_digest,
        }
        if (
            not isinstance(args.signage_oci_digest, str)
            or OCI_DIGEST_RE.fullmatch(args.signage_oci_digest) is None
            or not isinstance(args.signage_source_sha, str)
            or re.fullmatch(r"[0-9a-f]{40}", args.signage_source_sha) is None
            or any(
                not isinstance(value, str)
                or re.fullmatch(r"[0-9a-f]{64}", value) is None
                for option, value in identity.items()
                if option != "--signage-source-sha"
            )
        ):
            raise UsageError(
                "--release-scope pi3-signage-artifact requires exact Signage "
                "source, OCI, artifact, manifest, and payload identities"
            )
        incompatible = next(
            (
                option
                for option, selected in (
                    ("--limit", bool(args.limit)),
                    ("--full-fleet", args.full_fleet),
                    ("--reverify-selected", args.reverify_selected),
                )
                if selected
            ),
            None,
        )
        if incompatible is not None:
            raise UsageError(
                f"--release-scope pi3-signage-artifact cannot be combined with {incompatible}"
            )
    elif any(
        value is not None
        for value in (
            args.signage_oci_digest,
            args.signage_source_sha,
            args.signage_artifact_sha256,
            args.signage_manifest_sha256,
            args.signage_payload_digest,
        )
    ):
        raise UsageError(
            "Signage release identity requires --release-scope pi3-signage-artifact"
        )
    if args.print_plan and (args.emergency_override or args.skip_canary_hold):
        raise UsageError("--print-plan cannot be combined with execution override options")
    if args.print_plan and args.canary_hold_timeout != DEFAULT_CANARY_HOLD_TIMEOUT:
        raise UsageError("--print-plan cannot be combined with --canary-hold-timeout")

    if not args.branch or not args.inventory:
        raise UsageError("branch and inventory are required")
    _validate_branch(args.branch)
    _validate_text("inventory", args.inventory, maximum=1024)
    _validate_text("--limit", args.limit, maximum=1024) if args.limit else None

    if args.remote_run:
        if not args.sha or not re.fullmatch(r"[0-9a-f]{40}", args.sha):
            raise UsageError("--remote-run requires a full lowercase release SHA")
        if not args.run_id:
            raise UsageError("--remote-run requires --run-id")
        validate_run_id(args.run_id)
        if not args.expected_server_client_id or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", args.expected_server_client_id
        ):
            raise UsageError("--remote-run requires a safe expected server client ID")
        if args.detach or args.print_plan or args.preflight_only:
            raise UsageError(
                "--remote-run cannot be combined with --detach, --print-plan or --preflight-only"
            )
    elif (
        args.sha
        or args.run_id
        or args.expected_server_client_id
        or args.readiness_admission_json
    ):
        raise UsageError(
            "--sha, --run-id, --expected-server-client-id and "
            "--readiness-admission-json are internal remote-run options"
        )
    return args
