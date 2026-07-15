"""Live host observations that may promote fleet evidence to ``verified``."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any, Protocol


class Runtime(Protocol):
    PROJECT: Path
    ANSIBLE_DIRECTORY: Path
    FULL_SHA_RE: Any

    def run(self, command: list[str], **kwargs: Any) -> str: ...

    def remote_previous_sha(self, inventory: str, host: str) -> str: ...

    def probe_terminal_identity(
        self, inventory: str, host: str, client_id: str
    ) -> dict[str, Any]: ...

    def phase3_status(self) -> dict[str, Any]: ...

    def normalized_pi5_phase3_state(self, phase3: dict[str, Any]) -> bool: ...

    def candidate_image_matches_sha(self, image: Any, sha: str) -> bool: ...


def _digest_files(project: Path, relative_paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for relative in sorted(relative_paths, key=lambda value: value.as_posix()):
        absolute = project / relative
        if not absolute.is_file():
            raise RuntimeError(f"evidence file is unavailable: {relative}")
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(absolute.read_bytes())
        digest.update(b"\0")
    return "sha256:" + digest.hexdigest()


def config_digest(project: Path) -> str:
    return _digest_files(
        project,
        [
            Path("infrastructure/docker/.env"),
            Path("infrastructure/docker/docker-compose.phase3.yml"),
            Path("infrastructure/docker/Caddyfile.gateway.template"),
            Path("infrastructure/docker/Caddyfile.gateway.maintenance.template"),
            Path("infrastructure/docker/Caddyfile.slot.template"),
        ],
    )


def verified_config_digest(project: Path, runtime_digest: str) -> str:
    """Bind source configuration identity to a proven live environment."""

    if re.fullmatch(r"sha256:[0-9a-f]{64}", runtime_digest) is None:
        raise RuntimeError("Pi5 runtime configuration digest is malformed")
    source_digest = config_digest(project)
    digest = hashlib.sha256()
    digest.update(b"source\0")
    digest.update(source_digest.encode("ascii"))
    digest.update(b"\0runtime\0")
    digest.update(runtime_digest.encode("ascii"))
    return "sha256:" + digest.hexdigest()


def migration_digest(project: Path) -> str:
    migration_root = project / "apps/api/prisma/migrations"
    paths = [path.relative_to(project) for path in migration_root.glob("*/migration.sql")]
    if not paths:
        raise RuntimeError("migration evidence is unavailable")
    return _digest_files(project, paths)


def _image_release_sha(image: Any) -> str | None:
    if not isinstance(image, str):
        return None
    _repository, separator, tag = image.rpartition(":")
    if not separator:
        return None
    match = re.fullmatch(r"([0-9a-f]{40})-[0-9a-f]{12}", tag)
    return match.group(1) if match is not None else None


def observe_terminal(
    inventory: str,
    host: str,
    role: str,
    client_id: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    if role not in {"kiosk", "signage"}:
        raise ValueError(f"unsupported terminal evidence role: {role}")
    sha = runtime.remote_previous_sha(inventory, host)
    if not runtime.FULL_SHA_RE.fullmatch(sha):
        raise RuntimeError(f"terminal HEAD is not immutable: {host}")
    services = (
        [
            "lightdm.service",
            "kiosk-browser.service",
            "status-agent.timer",
        ]
        if role == "kiosk"
        else [
            "lightdm.service",
            "signage-lite.service",
            "signage-lite-update.timer",
            "signage-lite-watchdog.timer",
            "signage-daily-reboot.timer",
            "status-agent.timer",
        ]
    )
    # systemctl returns success for a multi-unit query when at least one unit
    # is active. Probe each required unit independently so either failure
    # prevents promotion to verified evidence.
    for service in services:
        runtime.run(
            [
                "ansible",
                "-i",
                inventory,
                host,
                "-b",
                "-m",
                "command",
                "-a",
                f"systemctl is-active --quiet {service}",
            ],
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
        )
    # status-agent.service is Type=oneshot and normally inactive after a
    # successful run. Its last invocation must nevertheless have succeeded;
    # the active timer alone is insufficient terminal-health evidence.
    runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "shell",
            "-a",
            'test "$(systemctl show --property=Result --value '
            'status-agent.service)" = success',
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    identity = runtime.probe_terminal_identity(inventory, host, client_id)
    if identity != {"authenticated": True, "statusClientId": client_id}:
        raise RuntimeError(f"terminal identity is not authenticated: {host}")
    return {
        "currentSha": sha,
        "services": services,
        "oneshotServices": ["status-agent.service"],
        "authenticatedEndpoint": True,
        "statusClientId": client_id,
    }


def observe_pi5(
    expected_sha: str | None,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    checkout_sha = runtime.run(
        ["git", "-C", str(runtime.PROJECT), "rev-parse", "HEAD"], capture=True
    ).strip()
    if not runtime.FULL_SHA_RE.fullmatch(checkout_sha):
        raise RuntimeError("Pi5 HEAD is not immutable")
    if expected_sha is not None and checkout_sha != expected_sha:
        raise RuntimeError("Pi5 HEAD does not match the desired release")
    runtime.run(["systemctl", "is-active", "status-agent.timer"], capture=True)
    phase3 = runtime.phase3_status()
    if not runtime.normalized_pi5_phase3_state(phase3):
        raise RuntimeError("Pi5 Blue/Green runtime is not normalized")
    runtime_config_digest = phase3.get("runtimeConfigDigest")
    if phase3.get("runtimeConfigStatus") != "verified":
        raise RuntimeError("Pi5 active API environment is not verified")
    if not isinstance(runtime_config_digest, str):
        raise RuntimeError("Pi5 runtime configuration digest is unavailable")
    active_slot = phase3.get("activeSlot")
    slots = phase3.get("slots")
    active = slots.get(active_slot) if isinstance(slots, dict) else None
    images = active.get("images") if isinstance(active, dict) else None
    api_image = images.get("api") if isinstance(images, dict) else None
    web_image = images.get("web") if isinstance(images, dict) else None
    api_sha = _image_release_sha(api_image)
    web_sha = _image_release_sha(web_image)
    if api_sha is None or web_sha is None or api_sha != web_sha:
        raise RuntimeError("Pi5 active images do not share an immutable release SHA")
    current_sha = api_sha
    if expected_sha is not None:
        if not runtime.candidate_image_matches_sha(api_image, expected_sha):
            raise RuntimeError("Pi5 API image does not match the desired release")
        if not runtime.candidate_image_matches_sha(web_image, expected_sha):
            raise RuntimeError("Pi5 Web image does not match the desired release")
        current_sha = expected_sha
    elif checkout_sha != current_sha:
        # These source digests come from the checked-out tree. They may only
        # be attached to the active image release when both identities match.
        # A first migration run with an older active slot therefore remains
        # unknown and safely includes Pi5 in the plan.
        raise RuntimeError(
            "Pi5 checkout does not match the active release; source digests cannot be attributed"
        )
    return {
        # The bootstrap checks out coordinator code before planning, so the
        # live release baseline is the active image SHA.  On post-release
        # verification both checkout and images must equal expected_sha.
        "currentSha": current_sha,
        "checkoutSha": checkout_sha,
        "activeSlot": active_slot,
        "apiImage": api_image,
        "webImage": web_image,
        "configDigest": verified_config_digest(
            runtime.PROJECT, runtime_config_digest
        ),
        "runtimeConfigDigest": runtime_config_digest,
        "migrationDigest": migration_digest(runtime.PROJECT),
    }
