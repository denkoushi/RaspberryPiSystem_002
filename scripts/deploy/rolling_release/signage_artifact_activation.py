"""Pi3-only immutable Signage release activation and pointer rollback.

The module owns filesystem mutation below one fixed release root and the
sixteen Stage 1 install facades.  Fleet/run authority remains in the existing
coordinator; this module returns receipts but never creates another ledger.
"""

from __future__ import annotations

import hashlib
import importlib.util
import argparse
import base64
import binascii
import json
import os
import re
import shutil
import stat
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import Any, Mapping, Protocol


SCHEMA_VERSION = 1
RELEASE_MANIFEST = "SIGNAGE-RELEASE.json"
DEFAULT_RELEASE_ROOT = Path("/opt/raspisystem-signage")
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
OCI_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
RELEASE_ID_RE = re.compile(r"^(?:legacy-[0-9a-f]{64}|[0-9a-f]{64})$")

ACTIVE_RUNTIME_UNITS = (
    "lightdm.service",
    "signage-lite.service",
    "signage-lite-update.timer",
    "signage-lite-watchdog.timer",
    "signage-daily-reboot.timer",
    "status-agent.timer",
)
QUIESCE_ORDER = (
    "status-agent.timer",
    "signage-lite-update.timer",
    "signage-lite-watchdog.timer",
    "signage-daily-reboot.timer",
    "signage-lite-update.service",
    "signage-lite-watchdog.service",
    "signage-lite.service",
    "lightdm.service",
)
QUIESCE_ALWAYS = {
    "signage-lite-update.service",
    "signage-lite-watchdog.service",
}
RESUME_ORDER = (
    "lightdm.service",
    "status-agent.timer",
    "signage-lite-update.timer",
    "signage-lite-watchdog.timer",
    "signage-daily-reboot.timer",
    "signage-lite.service",
)
MARKER = "SIGNAGE_ARTIFACT_ACTIVATION_RESULT:"

PAYLOAD_PATHS = (
    ("bin/raspi-signage-status-agent.pyz", "/usr/local/bin/raspi-signage-status-agent.pyz", 0o755),
    ("bin/signage-display.sh", "/usr/local/bin/signage-display.sh", 0o755),
    ("bin/signage-lite-watchdog.sh", "/usr/local/bin/signage-lite-watchdog.sh", 0o755),
    ("bin/signage-stop.sh", "/usr/local/bin/signage-stop.sh", 0o755),
    ("bin/signage-update.sh", "/usr/local/bin/signage-update.sh", 0o755),
    ("share/signage-maintenance.svg", "/usr/local/share/signage-maintenance.svg", 0o644),
    ("systemd/signage-daily-reboot.service", "/etc/systemd/system/signage-daily-reboot.service", 0o644),
    ("systemd/signage-daily-reboot.timer", "/etc/systemd/system/signage-daily-reboot.timer", 0o644),
    ("systemd/signage-lite-update.service", "/etc/systemd/system/signage-lite-update.service", 0o644),
    ("systemd/signage-lite-update.timer", "/etc/systemd/system/signage-lite-update.timer", 0o644),
    ("systemd/signage-lite-watchdog.service", "/etc/systemd/system/signage-lite-watchdog.service", 0o644),
    ("systemd/signage-lite-watchdog.timer", "/etc/systemd/system/signage-lite-watchdog.timer", 0o644),
    ("systemd/signage-lite.service", "/etc/systemd/system/signage-lite.service", 0o644),
    ("systemd/status-agent.service", "/etc/systemd/system/status-agent.service", 0o644),
    ("systemd/status-agent.timer", "/etc/systemd/system/status-agent.timer", 0o644),
    ("tmpfiles/signage-lite.conf", "/etc/tmpfiles.d/signage-lite.conf", 0o644),
)


class ActivationError(RuntimeError):
    def __init__(self, code: str, message: str, *, switched: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.switched = switched


class Runtime(Protocol):
    def capture(self) -> dict[str, object]: ...
    def quiesce(self, units: list[str]) -> None: ...
    def daemon_reload(self) -> None: ...
    def tmpfiles(self) -> None: ...
    def resume(self, units: list[str]) -> None: ...
    def verify(self, units: list[str]) -> dict[str, object]: ...


class SystemdRuntime:
    """Production runtime boundary used only by the Pi3 target helper."""

    def _run(self, command: list[str]) -> str:
        import subprocess

        completed = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=180,
            check=False,
        )
        if completed.returncode != 0:
            raise ActivationError("systemd-operation", "Signage systemd operation failed")
        return completed.stdout.strip()

    def capture(self) -> dict[str, object]:
        active = []
        for unit in ACTIVE_RUNTIME_UNITS:
            import subprocess

            result = subprocess.run(
                ["/usr/bin/systemctl", "is-active", "--quiet", unit],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=False,
            )
            if result.returncode == 0:
                active.append(unit)
        image = Path("/run/signage/current.jpg")
        if not image.is_file() or image.is_symlink():
            raise ActivationError("runtime-capture", "Signage display image is unavailable")
        return {
            "activeSystemdUnits": active,
            "displaySha256": _sha256_file(image),
        }

    def quiesce(self, units: list[str]) -> None:
        selected = set(units)
        for unit in QUIESCE_ORDER:
            if unit in selected or unit in QUIESCE_ALWAYS:
                self._run(["/usr/bin/systemctl", "stop", unit])

    def daemon_reload(self) -> None:
        self._run(["/usr/bin/systemctl", "daemon-reload"])

    def tmpfiles(self) -> None:
        self._run(
            [
                "/usr/bin/systemd-tmpfiles",
                "--create",
                "/etc/tmpfiles.d/signage-lite.conf",
            ]
        )

    def resume(self, units: list[str]) -> None:
        selected = set(units)
        for unit in RESUME_ORDER:
            if unit in selected:
                self._run(["/usr/bin/systemctl", "start", unit])

    def verify(self, units: list[str]) -> dict[str, object]:
        for unit in units:
            self._run(["/usr/bin/systemctl", "is-active", "--quiet", unit])
        image = Path("/run/signage/current.jpg")
        if not image.is_file() or image.is_symlink():
            raise ActivationError("runtime-verification", "Signage display image is unavailable")
        return {
            "activeSystemdUnits": list(units),
            "displaySha256": _sha256_file(image),
        }


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _system_path(system_root: Path, install_path: str) -> Path:
    if not install_path.startswith("/") or ".." in Path(install_path).parts:
        raise ActivationError("path-policy", "Signage install path is unsafe")
    return system_root / install_path.removeprefix("/")


def _release_file(release: Path, install_path: str) -> Path:
    return release / "root" / install_path.removeprefix("/")


def _ensure_roots(release_root: Path) -> Path:
    if not release_root.is_absolute() or ".." in release_root.parts:
        raise ActivationError("path-policy", "Signage release root is unsafe")
    release_root.mkdir(mode=0o755, parents=True, exist_ok=True)
    if release_root.is_symlink() or not release_root.is_dir():
        raise ActivationError("path-policy", "Signage release root is unsafe")
    releases = release_root / "releases"
    releases.mkdir(mode=0o755, exist_ok=True)
    if releases.is_symlink() or not releases.is_dir():
        raise ActivationError("path-policy", "Signage releases directory is unsafe")
    return releases


def _safe_release(release_root: Path, release_id: str) -> Path:
    if not isinstance(release_id, str) or RELEASE_ID_RE.fullmatch(release_id) is None:
        raise ActivationError("release-reference", "Signage release ID is malformed")
    return release_root / "releases" / release_id


def _load_distribution_module():
    try:
        import signage_distribution_artifact as module  # type: ignore
        return module
    except ImportError:
        path = Path(__file__).resolve().parents[1] / "signage-distribution-artifact.py"
        spec = importlib.util.spec_from_file_location("_stage3_signage_distribution", path)
        if spec is None or spec.loader is None:
            raise ActivationError("artifact-verification", "Stage 1 verifier is unavailable")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        try:
            spec.loader.exec_module(module)
        except Exception as error:
            raise ActivationError("artifact-verification", "Stage 1 verifier could not load") from error
        finally:
            sys.modules.pop(spec.name, None)
        return module


def _write_file(path: Path, payload: bytes, mode: int, *, require_root_owner: bool) -> None:
    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        raise ActivationError("release-collision", "Signage release file already exists")
    path.write_bytes(payload)
    path.chmod(mode)
    if require_root_owner:
        os.chown(path, 0, 0)


def _write_manifest(directory: Path, value: dict[str, Any], *, require_root_owner: bool) -> str:
    payload = _canonical(value)
    path = directory / RELEASE_MANIFEST
    _write_file(path, payload, 0o444, require_root_owner=require_root_owner)
    return _sha256_bytes(payload)


def _read_manifest(release: Path) -> tuple[dict[str, Any], str]:
    path = release / RELEASE_MANIFEST
    try:
        metadata = path.lstat()
        raw = path.read_bytes()
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ActivationError("release-verification", "Signage release manifest is unavailable") from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or raw != _canonical(value)
        or not isinstance(value, dict)
    ):
        raise ActivationError("release-verification", "Signage release manifest is unsafe")
    return value, _sha256_bytes(raw)


def _validate_runtime_health(value: Any) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ActivationError("runtime-capture", "Signage runtime health is malformed")
    units = value.get("activeSystemdUnits")
    if (
        not isinstance(units, list)
        or any(unit not in ACTIVE_RUNTIME_UNITS for unit in units)
        or len(units) != len(set(units))
    ):
        raise ActivationError("runtime-capture", "Signage runtime unit capture is malformed")
    return dict(value)


def _runtime_reference(value: Mapping[str, object]) -> dict[str, object]:
    units = value["activeSystemdUnits"]
    assert isinstance(units, list)
    return {
        "manifestSha256": _sha256_bytes(_canonical(value)),
        "unitCount": len(units),
        "dockerCount": 0,
    }


def _verify_release(
    release_root: Path,
    release_id: str,
    *,
    expected_manifest_sha256: str | None = None,
    require_root_owner: bool,
) -> dict[str, Any]:
    release = _safe_release(release_root, release_id)
    try:
        metadata = release.lstat()
    except FileNotFoundError as error:
        raise ActivationError("release-verification", "Signage release is missing") from error
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ActivationError("release-verification", "Signage release directory is unsafe")
    manifest, digest = _read_manifest(release)
    if expected_manifest_sha256 is not None and digest != expected_manifest_sha256:
        raise ActivationError("release-verification", "Signage release manifest digest changed")
    expected_root = {
        "artifactSha256", "files", "legacyRepositorySha", "manifestSha256",
        "ociDigest", "payloadDigest", "releaseKind", "schemaVersion", "sourceSha",
    }
    if (
        set(manifest) != expected_root
        or manifest.get("schemaVersion") != SCHEMA_VERSION
        or manifest.get("releaseKind") not in {"legacy", "artifact"}
        or not isinstance(manifest.get("files"), list)
        or len(manifest["files"]) != len(PAYLOAD_PATHS)
    ):
        raise ActivationError("release-verification", "Signage release manifest schema is invalid")
    expected = {archive: (install, mode) for archive, install, mode in PAYLOAD_PATHS}
    seen: set[str] = set()
    for record in manifest["files"]:
        if not isinstance(record, dict):
            raise ActivationError("release-verification", "Signage release file record is malformed")
        archive = record.get("path")
        if archive not in expected or archive in seen:
            raise ActivationError("release-verification", "Signage release file allowlist changed")
        seen.add(archive)
        install, mode = expected[archive]
        if record.get("installPath") != install or record.get("mode") != f"{mode:04o}":
            raise ActivationError("release-verification", "Signage release file policy changed")
        present = record.get("present")
        if type(present) is not bool:
            raise ActivationError("release-verification", "Signage release presence is malformed")
        path = _release_file(release, install)
        if not present:
            if path.exists() or path.is_symlink():
                raise ActivationError("release-verification", "Absent Signage release file exists")
            continue
        try:
            item = path.lstat()
        except FileNotFoundError as error:
            raise ActivationError("release-verification", "Signage release payload is missing") from error
        if (
            not stat.S_ISREG(item.st_mode)
            or stat.S_ISLNK(item.st_mode)
            or stat.S_IMODE(item.st_mode) != mode
            or record.get("renderedSha256") != _sha256_file(path)
            or (require_root_owner and (item.st_uid != 0 or item.st_gid != 0))
        ):
            raise ActivationError("release-verification", "Signage release payload changed")
    if seen != set(expected):
        raise ActivationError("release-verification", "Signage release payload is incomplete")
    if manifest["releaseKind"] == "artifact":
        if (
            FULL_SHA_RE.fullmatch(str(manifest.get("sourceSha") or "")) is None
            or OCI_DIGEST_RE.fullmatch(str(manifest.get("ociDigest") or "")) is None
            or SHA256_RE.fullmatch(str(manifest.get("artifactSha256") or "")) is None
            or SHA256_RE.fullmatch(str(manifest.get("manifestSha256") or "")) is None
            or SHA256_RE.fullmatch(str(manifest.get("payloadDigest") or "")) is None
            or manifest.get("legacyRepositorySha") is not None
        ):
            raise ActivationError("release-verification", "Artifact release identity is malformed")
    else:
        if (
            FULL_SHA_RE.fullmatch(str(manifest.get("sourceSha") or "")) is None
            or manifest.get("legacyRepositorySha") != manifest.get("sourceSha")
            or any(manifest.get(key) is not None for key in ("ociDigest", "artifactSha256", "manifestSha256", "payloadDigest"))
        ):
            raise ActivationError("release-verification", "Legacy release identity is malformed")
    return {**manifest, "release": release_id, "releaseManifestSha256": digest}


def _pointer_release(release_root: Path) -> str | None:
    current = release_root / "current"
    try:
        metadata = current.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISLNK(metadata.st_mode):
        raise ActivationError("pointer-verification", "Signage current pointer is unsafe")
    target = os.readlink(current)
    prefix = "releases/"
    release_id = target[len(prefix):] if target.startswith(prefix) else ""
    if RELEASE_ID_RE.fullmatch(release_id) is None or target != f"releases/{release_id}":
        raise ActivationError("pointer-verification", "Signage current pointer target is unsafe")
    return release_id


def _atomic_pointer(release_root: Path, release_id: str) -> None:
    release = _safe_release(release_root, release_id)
    if not release.is_dir() or release.is_symlink():
        raise ActivationError("pointer-switch", "Signage pointer target is unavailable")
    temporary = release_root / f".current-{os.getpid()}"
    if temporary.exists() or temporary.is_symlink():
        raise ActivationError("pointer-switch", "Signage pointer temporary path exists")
    temporary.symlink_to(f"releases/{release_id}")
    try:
        os.replace(temporary, release_root / "current")
    finally:
        temporary.unlink(missing_ok=True)


def _facade_target(release_root: Path, install_path: str) -> str:
    return os.fspath(release_root / "current" / "root" / install_path.removeprefix("/"))


def _verify_facades(system_root: Path, release_root: Path, manifest: Mapping[str, Any]) -> None:
    records = {record["installPath"]: record for record in manifest["files"]}
    for _archive, install, _mode in PAYLOAD_PATHS:
        live = _system_path(system_root, install)
        try:
            metadata = live.lstat()
        except FileNotFoundError as error:
            raise ActivationError("facade-verification", "Signage facade is missing") from error
        if not stat.S_ISLNK(metadata.st_mode) or os.readlink(live) != _facade_target(release_root, install):
            raise ActivationError("facade-verification", "Signage facade is not canonical")
        record = records[install]
        if record["present"]:
            if not live.is_file() or _sha256_file(live) != record["renderedSha256"]:
                raise ActivationError("facade-verification", "Signage facade payload changed")
        elif live.exists():
            raise ActivationError("facade-verification", "Absent Signage facade resolves")


def _install_facades(system_root: Path, release_root: Path, baseline: Mapping[str, Any]) -> None:
    _atomic_pointer(release_root, str(baseline["previousRelease"]))
    for _archive, install, _mode in PAYLOAD_PATHS:
        live = _system_path(system_root, install)
        live.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        temporary = live.parent / f".{live.name}.stage3-link"
        if temporary.exists() or temporary.is_symlink():
            raise ActivationError("facade-migration", "Signage facade temporary path exists")
        temporary.symlink_to(_facade_target(release_root, install))
        try:
            os.replace(temporary, live)
        finally:
            temporary.unlink(missing_ok=True)
    previous = _verify_release(
        release_root,
        str(baseline["previousRelease"]),
        expected_manifest_sha256=str(baseline["previousReleaseManifestSha256"]),
        require_root_owner=bool(baseline["requireRootOwner"]),
    )
    _verify_facades(system_root, release_root, previous)


def _restore_initial_topology(system_root: Path, release_root: Path, baseline: Mapping[str, Any]) -> None:
    previous = _verify_release(
        release_root,
        str(baseline["previousRelease"]),
        expected_manifest_sha256=str(baseline["previousReleaseManifestSha256"]),
        require_root_owner=bool(baseline["requireRootOwner"]),
    )
    release = _safe_release(release_root, str(baseline["previousRelease"]))
    records = {record["installPath"]: record for record in previous["files"]}
    for _archive, install, mode in PAYLOAD_PATHS:
        live = _system_path(system_root, install)
        if live.exists() or live.is_symlink():
            live.unlink()
        record = records[install]
        if not record["present"]:
            continue
        source = _release_file(release, install)
        live.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        shutil.copyfile(source, live, follow_symlinks=False)
        live.chmod(mode)
        uid = int(record["sourceUid"])
        gid = int(record["sourceGid"])
        if bool(baseline["requireRootOwner"]):
            os.chown(live, uid, gid)
    (release_root / "current").unlink(missing_ok=True)


def _verify_initial_topology(
    system_root: Path, release_root: Path, baseline: Mapping[str, Any]
) -> dict[str, Any]:
    previous = _verify_release(
        release_root,
        str(baseline["previousRelease"]),
        expected_manifest_sha256=str(baseline["previousReleaseManifestSha256"]),
        require_root_owner=bool(baseline["requireRootOwner"]),
    )
    records = {record["installPath"]: record for record in previous["files"]}
    for _archive, install, mode in PAYLOAD_PATHS:
        live = _system_path(system_root, install)
        record = records[install]
        metadata = live.lstat() if live.exists() or live.is_symlink() else None
        if not record["present"]:
            if metadata is not None:
                raise ActivationError(
                    "rollback-verification", "Absent legacy Signage path exists"
                )
            continue
        if (
            metadata is None
            or not stat.S_ISREG(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or stat.S_IMODE(metadata.st_mode) != mode
            or _sha256_file(live) != record["renderedSha256"]
            or (
                bool(baseline["requireRootOwner"])
                and (
                    metadata.st_uid != record["sourceUid"]
                    or metadata.st_gid != record["sourceGid"]
                )
            )
        ):
            raise ActivationError(
                "rollback-verification", "Legacy Signage topology changed"
            )
    return previous


def capture_baseline(
    *,
    system_root: Path,
    release_root: Path,
    legacy_repository_sha: str | None,
    runtime: Runtime,
    require_root_owner: bool = True,
) -> dict[str, object]:
    releases = _ensure_roots(release_root)
    current = _pointer_release(release_root)
    runtime_health = _validate_runtime_health(runtime.capture())
    if current is not None:
        previous = _verify_release(
            release_root, current, require_root_owner=require_root_owner
        )
        return {
            "schemaVersion": SCHEMA_VERSION,
            "kind": "signage-artifact-baseline",
            "pointerWasPresent": True,
            "previousRelease": current,
            "previousReleaseKind": previous["releaseKind"],
            "previousReleaseManifestSha256": previous["releaseManifestSha256"],
            "previousSourceSha": previous["sourceSha"],
            "previousArtifactSha256": previous["artifactSha256"],
            "legacyRepositorySha": previous["legacyRepositorySha"],
            "runtimeHealth": runtime_health,
            "runtime": _runtime_reference(runtime_health),
            "requireRootOwner": require_root_owner,
        }
    if not isinstance(legacy_repository_sha, str) or FULL_SHA_RE.fullmatch(legacy_repository_sha) is None:
        raise ActivationError("legacy-capture", "Legacy repository SHA is unavailable")
    temporary = Path(tempfile.mkdtemp(prefix=".legacy-capture-", dir=releases))
    try:
        records: list[dict[str, Any]] = []
        for archive, install, mode in PAYLOAD_PATHS:
            live = _system_path(system_root, install)
            try:
                metadata = live.lstat()
            except FileNotFoundError:
                records.append({
                    "installPath": install, "mode": f"{mode:04o}", "path": archive,
                    "present": False, "renderedSha256": None, "sourceGid": None,
                    "sourceSha256": None, "sourceUid": None, "templated": False,
                })
                continue
            if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != mode:
                raise ActivationError("legacy-capture", "Legacy Signage live path is unsafe")
            payload = live.read_bytes()
            destination = _release_file(temporary, install)
            _write_file(destination, payload, mode, require_root_owner=require_root_owner)
            records.append({
                "installPath": install, "mode": f"{mode:04o}", "path": archive,
                "present": True, "renderedSha256": _sha256_bytes(payload),
                "sourceGid": metadata.st_gid, "sourceSha256": _sha256_bytes(payload),
                "sourceUid": metadata.st_uid, "templated": False,
            })
        manifest = {
            "artifactSha256": None,
            "files": records,
            "legacyRepositorySha": legacy_repository_sha,
            "manifestSha256": None,
            "ociDigest": None,
            "payloadDigest": None,
            "releaseKind": "legacy",
            "schemaVersion": SCHEMA_VERSION,
            "sourceSha": legacy_repository_sha,
        }
        digest = _write_manifest(temporary, manifest, require_root_owner=require_root_owner)
        release_id = f"legacy-{digest}"
        final = releases / release_id
        if final.exists():
            existing = _verify_release(
                release_root, release_id, expected_manifest_sha256=digest,
                require_root_owner=require_root_owner,
            )
            del existing
            shutil.rmtree(temporary)
        else:
            os.replace(temporary, final)
        return {
            "schemaVersion": SCHEMA_VERSION,
            "kind": "signage-artifact-baseline",
            "pointerWasPresent": False,
            "previousRelease": release_id,
            "previousReleaseKind": "legacy",
            "previousReleaseManifestSha256": digest,
            "previousSourceSha": legacy_repository_sha,
            "previousArtifactSha256": None,
            "legacyRepositorySha": legacy_repository_sha,
            "runtimeHealth": runtime_health,
            "runtime": _runtime_reference(runtime_health),
            "requireRootOwner": require_root_owner,
        }
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise


def prepare_candidate(
    *,
    artifact: Path,
    descriptor: Path,
    rendered_root: Path,
    release_root: Path,
    oci_digest: str,
    require_root_owner: bool = True,
) -> dict[str, object]:
    if OCI_DIGEST_RE.fullmatch(oci_digest) is None:
        raise ActivationError("artifact-identity", "Exact OCI digest is malformed")
    verifier = _load_distribution_module()
    try:
        verified = verifier.verify_artifact(artifact, descriptor)
    except Exception as error:
        raise ActivationError("artifact-verification", "Stage 1 artifact verification failed") from error
    binding = verified["descriptor"]
    artifact_manifest = verified["manifest"]
    expected_rendered = {
        record["path"]
        for record in artifact_manifest["files"]
        if record["templated"] is True
    }
    try:
        rendered_metadata = rendered_root.lstat()
        rendered_entries = list(rendered_root.rglob("*"))
    except OSError as error:
        raise ActivationError(
            "render-verification", "Rendered Signage root is unavailable"
        ) from error
    rendered_files: set[str] = set()
    if not stat.S_ISDIR(rendered_metadata.st_mode) or stat.S_ISLNK(rendered_metadata.st_mode):
        raise ActivationError("render-verification", "Rendered Signage root is unsafe")
    for entry in rendered_entries:
        metadata = entry.lstat()
        if stat.S_ISLNK(metadata.st_mode) or not (
            stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode)
        ):
            raise ActivationError("render-verification", "Rendered Signage tree is unsafe")
        if stat.S_ISREG(metadata.st_mode):
            rendered_files.add(entry.relative_to(rendered_root).as_posix())
    if rendered_files != expected_rendered:
        raise ActivationError(
            "render-verification", "Rendered Signage payload allowlist changed"
        )
    releases = _ensure_roots(release_root)
    release_id = binding["artifactSha256"]
    temporary = Path(tempfile.mkdtemp(prefix=f".{release_id}-", dir=releases))
    try:
        with tarfile.open(artifact, "r:") as archive:
            payloads = {
                member.name: archive.extractfile(member).read()
                for member in archive.getmembers()
                if member.isfile()
            }
        records: list[dict[str, Any]] = []
        expected = {archive: (install, mode) for archive, install, mode in PAYLOAD_PATHS}
        for source in artifact_manifest["files"]:
            archive_path = source["path"]
            if archive_path not in expected:
                raise ActivationError("artifact-verification", "Artifact install allowlist changed")
            install, mode = expected[archive_path]
            if source["installPath"] != install or source["mode"] != f"{mode:04o}":
                raise ActivationError("artifact-verification", "Artifact install policy changed")
            if source["templated"]:
                rendered = rendered_root / archive_path
                try:
                    metadata = rendered.lstat()
                except FileNotFoundError as error:
                    raise ActivationError("render-verification", "Rendered Signage payload is missing") from error
                if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != mode:
                    raise ActivationError("render-verification", "Rendered Signage payload is unsafe")
                payload = rendered.read_bytes()
            else:
                payload = payloads[archive_path]
            if not payload:
                raise ActivationError("render-verification", "Rendered Signage payload is empty")
            destination = _release_file(temporary, install)
            _write_file(destination, payload, mode, require_root_owner=require_root_owner)
            metadata = destination.lstat()
            records.append({
                "installPath": install,
                "mode": f"{mode:04o}",
                "path": archive_path,
                "present": True,
                "renderedSha256": _sha256_bytes(payload),
                "sourceGid": metadata.st_gid,
                "sourceSha256": source["sha256"],
                "sourceUid": metadata.st_uid,
                "templated": source["templated"],
            })
        records.sort(key=lambda item: item["path"])
        release_manifest = {
            "artifactSha256": binding["artifactSha256"],
            "files": records,
            "legacyRepositorySha": None,
            "manifestSha256": binding["manifestSha256"],
            "ociDigest": oci_digest,
            "payloadDigest": binding["payloadDigest"],
            "releaseKind": "artifact",
            "schemaVersion": SCHEMA_VERSION,
            "sourceSha": binding["sourceSha"],
        }
        release_manifest_digest = _write_manifest(
            temporary, release_manifest, require_root_owner=require_root_owner
        )
        final = releases / release_id
        if final.exists():
            _verify_release(
                release_root, release_id,
                expected_manifest_sha256=release_manifest_digest,
                require_root_owner=require_root_owner,
            )
            shutil.rmtree(temporary)
        else:
            os.replace(temporary, final)
        return {
            "schemaVersion": SCHEMA_VERSION,
            "release": release_id,
            "releaseKind": "artifact",
            "sourceSha": binding["sourceSha"],
            "ociDigest": oci_digest,
            "artifactSha256": binding["artifactSha256"],
            "manifestSha256": binding["manifestSha256"],
            "payloadDigest": binding["payloadDigest"],
            "releaseManifestSha256": release_manifest_digest,
        }
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise


def _validate_baseline(release_root: Path, baseline: Mapping[str, Any]) -> dict[str, Any]:
    required = {
        "kind", "legacyRepositorySha", "pointerWasPresent", "previousArtifactSha256",
        "previousRelease", "previousReleaseKind", "previousReleaseManifestSha256",
        "previousSourceSha", "requireRootOwner", "runtime", "runtimeHealth", "schemaVersion",
    }
    if not isinstance(baseline, Mapping) or set(baseline) != required or baseline.get("schemaVersion") != SCHEMA_VERSION or baseline.get("kind") != "signage-artifact-baseline" or type(baseline.get("pointerWasPresent")) is not bool or type(baseline.get("requireRootOwner")) is not bool:
        raise ActivationError("baseline-verification", "Signage rollback baseline is malformed")
    previous = _verify_release(
        release_root,
        str(baseline["previousRelease"]),
        expected_manifest_sha256=str(baseline["previousReleaseManifestSha256"]),
        require_root_owner=bool(baseline["requireRootOwner"]),
    )
    if (
        previous["releaseKind"] != baseline["previousReleaseKind"]
        or previous["sourceSha"] != baseline["previousSourceSha"]
        or previous["artifactSha256"] != baseline["previousArtifactSha256"]
        or previous["legacyRepositorySha"] != baseline["legacyRepositorySha"]
    ):
        raise ActivationError("baseline-verification", "Signage rollback identity changed")
    _validate_runtime_health(baseline["runtimeHealth"])
    if baseline["runtime"] != _runtime_reference(baseline["runtimeHealth"]):
        raise ActivationError("baseline-verification", "Signage runtime reference changed")
    return previous


def _validate_candidate(release_root: Path, candidate: Mapping[str, Any], *, require_root_owner: bool) -> dict[str, Any]:
    required = {
        "artifactSha256", "manifestSha256", "ociDigest", "payloadDigest", "release",
        "releaseKind", "releaseManifestSha256", "schemaVersion", "sourceSha",
    }
    if not isinstance(candidate, Mapping) or set(candidate) != required or candidate.get("schemaVersion") != SCHEMA_VERSION or candidate.get("releaseKind") != "artifact":
        raise ActivationError("candidate-verification", "Signage candidate reference is malformed")
    release = _verify_release(
        release_root,
        str(candidate["release"]),
        expected_manifest_sha256=str(candidate["releaseManifestSha256"]),
        require_root_owner=require_root_owner,
    )
    for key in ("sourceSha", "ociDigest", "artifactSha256", "manifestSha256", "payloadDigest"):
        if release[key] != candidate[key]:
            raise ActivationError("candidate-verification", "Signage candidate identity changed")
    return release


def preflight_release(
    *,
    release_root: Path,
    baseline: Mapping[str, Any],
    candidate: Mapping[str, Any] | None,
    require_root_owner: bool = True,
) -> dict[str, Any]:
    """Verify the sealed rollback baseline and an optional prepared candidate."""

    previous = _validate_baseline(release_root, baseline)
    desired = (
        _validate_candidate(
            release_root,
            candidate,
            require_root_owner=require_root_owner,
        )
        if candidate is not None
        else None
    )
    return {
        "ready": True,
        "issues": [],
        "previousRelease": previous["release"],
        "candidateRelease": desired["release"] if desired is not None else None,
        "runtimeHealth": baseline["runtimeHealth"],
    }


def probe_current(
    *, system_root: Path, release_root: Path, require_root_owner: bool = True
) -> dict[str, Any]:
    release_id = _pointer_release(release_root)
    if release_id is None:
        raise ActivationError("pointer-verification", "Signage current pointer is absent")
    release = _verify_release(
        release_root, release_id, require_root_owner=require_root_owner
    )
    _verify_facades(system_root, release_root, release)
    return release


def probe_baseline(
    *, system_root: Path, release_root: Path, require_root_owner: bool = True
) -> dict[str, Any]:
    release_id = _pointer_release(release_root)
    if release_id is None:
        return {"schemaVersion": SCHEMA_VERSION, "state": "absent", "profile": "signage"}
    release = probe_current(
        system_root=system_root,
        release_root=release_root,
        require_root_owner=require_root_owner,
    )
    if release["releaseKind"] == "legacy":
        return {
            "schemaVersion": SCHEMA_VERSION,
            "state": "legacy",
            "profile": "signage",
            "sourceSha": release["sourceSha"],
            "legacyRepositorySha": release["legacyRepositorySha"],
        }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "state": "installed",
        "profile": "signage",
        "sourceSha": release["sourceSha"],
        "artifactSha256": release["artifactSha256"],
        "identity": (
            f"git:{release['sourceSha']}@sha256:{release['artifactSha256']}"
        ),
    }


def activate(
    *,
    system_root: Path,
    release_root: Path,
    baseline: Mapping[str, Any],
    candidate: Mapping[str, Any],
    runtime: Runtime,
    require_root_owner: bool = True,
) -> dict[str, Any]:
    switched = False
    migration_started = False
    try:
        previous = _validate_baseline(release_root, baseline)
        desired = _validate_candidate(
            release_root, candidate, require_root_owner=require_root_owner
        )
        units = list(_validate_runtime_health(baseline["runtimeHealth"])["activeSystemdUnits"])
        runtime.quiesce(units)
        if baseline["pointerWasPresent"]:
            if _pointer_release(release_root) != baseline["previousRelease"]:
                raise ActivationError("pointer-verification", "Current release changed before activation")
            _verify_facades(system_root, release_root, previous)
        else:
            migration_started = True
            _install_facades(system_root, release_root, baseline)
        _atomic_pointer(release_root, str(candidate["release"]))
        switched = True
        runtime.daemon_reload()
        runtime.tmpfiles()
        runtime.resume(units)
        runtime_proof = runtime.verify(units)
        current = probe_current(
            system_root=system_root,
            release_root=release_root,
            require_root_owner=require_root_owner,
        )
        if current["release"] != desired["release"]:
            raise ActivationError("activation-verification", "Activated Signage release changed", switched=True)
        return {
            "schemaVersion": SCHEMA_VERSION,
            "state": "verified",
            "previousRelease": baseline["previousRelease"],
            "currentRelease": current["release"],
            "artifactSha256": current["artifactSha256"],
            "releaseManifestSha256": current["releaseManifestSha256"],
            "runtime": runtime_proof,
        }
    except Exception as error:
        if not switched:
            if migration_started:
                try:
                    _restore_initial_topology(system_root, release_root, baseline)
                except Exception as restore_error:
                    raise ActivationError(
                        "pre-switch-restore", "Initial Signage topology could not be restored",
                        switched=False,
                    ) from restore_error
            try:
                units = list(_validate_runtime_health(baseline["runtimeHealth"])["activeSystemdUnits"])
                runtime.resume(units)
            except Exception:
                pass
        if isinstance(error, ActivationError):
            error.switched = error.switched or switched
            raise
        raise ActivationError(
            "post-switch-failure" if switched else "pre-switch-failure",
            "Signage activation did not complete",
            switched=switched,
        ) from error


def rollback(
    *,
    system_root: Path,
    release_root: Path,
    baseline: Mapping[str, Any],
    candidate: Mapping[str, Any],
    runtime: Runtime,
    require_root_owner: bool = True,
) -> dict[str, Any]:
    previous = _validate_baseline(release_root, baseline)
    units = list(_validate_runtime_health(baseline["runtimeHealth"])["activeSystemdUnits"])
    try:
        current_before = _pointer_release(release_root)
        if current_before == baseline["previousRelease"]:
            _verify_facades(system_root, release_root, previous)
            runtime.resume(units)
            runtime_proof = runtime.verify(units)
            current = previous
        elif current_before is None and baseline["pointerWasPresent"] is False:
            current = _verify_initial_topology(system_root, release_root, baseline)
            runtime.resume(units)
            runtime_proof = runtime.verify(units)
        else:
            _validate_candidate(
                release_root, candidate, require_root_owner=require_root_owner
            )
            runtime.quiesce(units)
            _atomic_pointer(release_root, str(baseline["previousRelease"]))
            runtime.daemon_reload()
            runtime.tmpfiles()
            runtime.resume(units)
            runtime_proof = runtime.verify(units)
            current = probe_current(
                system_root=system_root,
                release_root=release_root,
                require_root_owner=require_root_owner,
            )
        if current["release"] != previous["release"]:
            raise ActivationError("rollback-verification", "Rollback pointer changed", switched=True)
        return {
            "schemaVersion": SCHEMA_VERSION,
            "state": "verified",
            "restoredRelease": current["release"],
            "releaseKind": current["releaseKind"],
            "sourceSha": current["sourceSha"],
            "artifactSha256": current["artifactSha256"],
            "releaseManifestSha256": current["releaseManifestSha256"],
            "runtime": runtime_proof,
        }
    except Exception as error:
        if isinstance(error, ActivationError):
            raise
        raise ActivationError(
            "rollback-verification", "Signage rollback could not be verified", switched=True
        ) from error


def cleanup_candidate(
    *,
    release_root: Path,
    candidate: Mapping[str, Any],
    keep_current: bool,
    stage_run_path: Path | None = None,
) -> dict[str, Any]:
    release_id = str(candidate.get("release"))
    release = _safe_release(release_root, release_id)
    current = _pointer_release(release_root)
    removed: list[str] = []
    if not keep_current or current != release_id:
        if release.exists() and not release.is_symlink():
            shutil.rmtree(release)
            removed.append(os.fspath(release))
    if stage_run_path is not None:
        allowed = Path("/var/tmp/raspisystem-signage-stage")
        if stage_run_path.parent != allowed or not stage_run_path.name:
            raise ActivationError("cleanup-policy", "Stage cleanup path is outside the allowlist")
        if stage_run_path.exists() and not stage_run_path.is_symlink():
            shutil.rmtree(stage_run_path)
            removed.append(os.fspath(stage_run_path))
        if allowed.exists() and allowed.is_dir() and not any(allowed.iterdir()):
            allowed.rmdir()
            removed.append(os.fspath(allowed))
    residue = bool(stage_run_path is not None and (stage_run_path.exists() or stage_run_path.is_symlink()))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": "passed" if not residue else "incomplete",
        "removedPaths": removed,
        "stageResidue": residue,
        "currentRelease": current,
    }


def cleanup_stage(*, stage_run_path: Path) -> dict[str, Any]:
    allowed = Path("/var/tmp/raspisystem-signage-stage")
    if stage_run_path.parent != allowed or not stage_run_path.name:
        raise ActivationError("cleanup-policy", "Stage cleanup path is outside the allowlist")
    removed: list[str] = []
    if stage_run_path.exists() and not stage_run_path.is_symlink():
        shutil.rmtree(stage_run_path)
        removed.append(os.fspath(stage_run_path))
    if allowed.exists() and allowed.is_dir() and not any(allowed.iterdir()):
        allowed.rmdir()
        removed.append(os.fspath(allowed))
    residue = stage_run_path.exists() or stage_run_path.is_symlink()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": "passed" if not residue else "incomplete",
        "removedPaths": removed,
        "stageResidue": residue,
    }


def _decode_request(raw: str) -> dict[str, Any]:
    try:
        payload = base64.urlsafe_b64decode(raw.encode("ascii"))
        if base64.urlsafe_b64encode(payload).decode("ascii") != raw:
            raise ValueError("noncanonical")
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, binascii.Error, ValueError, json.JSONDecodeError) as error:
        raise ActivationError("request-validation", "Activation request is malformed") from error
    if not isinstance(value, dict):
        raise ActivationError("request-validation", "Activation request is malformed")
    return value


def _marker(value: Mapping[str, Any]) -> str:
    return MARKER + base64.urlsafe_b64encode(_canonical(value)[:-1]).decode("ascii")


def dispatch(action: str, request: Mapping[str, Any]) -> dict[str, Any]:
    if os.geteuid() != 0:
        raise ActivationError("privilege", "Signage activation requires root")
    runtime = SystemdRuntime()
    root = Path("/")
    release_root = DEFAULT_RELEASE_ROOT
    if action == "capture":
        if set(request) != {"legacyRepositorySha"}:
            raise ActivationError("request-validation", "Capture request is malformed")
        return capture_baseline(
            system_root=root,
            release_root=release_root,
            legacy_repository_sha=request["legacyRepositorySha"],
            runtime=runtime,
        )
    if action == "prepare":
        if set(request) != {"artifact", "descriptor", "renderedRoot", "ociDigest"}:
            raise ActivationError("request-validation", "Prepare request is malformed")
        return prepare_candidate(
            artifact=Path(request["artifact"]),
            descriptor=Path(request["descriptor"]),
            rendered_root=Path(request["renderedRoot"]),
            release_root=release_root,
            oci_digest=request["ociDigest"],
        )
    if action == "probe":
        if request:
            raise ActivationError("request-validation", "Probe request is malformed")
        return probe_current(system_root=root, release_root=release_root)
    if action == "baseline":
        if request:
            raise ActivationError("request-validation", "Baseline request is malformed")
        return probe_baseline(system_root=root, release_root=release_root)
    if action == "preflight":
        if set(request) not in ({"baseline"}, {"baseline", "candidate"}):
            raise ActivationError("request-validation", "Preflight request is malformed")
        return preflight_release(
            release_root=release_root,
            baseline=request["baseline"],
            candidate=request.get("candidate"),
        )
    if action == "activate":
        if set(request) != {"baseline", "candidate"}:
            raise ActivationError("request-validation", "Activate request is malformed")
        return activate(
            system_root=root,
            release_root=release_root,
            baseline=request["baseline"],
            candidate=request["candidate"],
            runtime=runtime,
        )
    if action == "rollback":
        if set(request) != {"baseline", "candidate"}:
            raise ActivationError("request-validation", "Rollback request is malformed")
        return rollback(
            system_root=root,
            release_root=release_root,
            baseline=request["baseline"],
            candidate=request["candidate"],
            runtime=runtime,
        )
    if action == "cleanup":
        if set(request) != {"candidate", "keepCurrent", "stageRunPath"} or type(request["keepCurrent"]) is not bool:
            raise ActivationError("request-validation", "Cleanup request is malformed")
        return cleanup_candidate(
            release_root=release_root,
            candidate=request["candidate"],
            keep_current=request["keepCurrent"],
            stage_run_path=Path(request["stageRunPath"]),
        )
    if action == "cleanup-stage":
        if set(request) != {"stageRunPath"}:
            raise ActivationError("request-validation", "Stage cleanup request is malformed")
        return cleanup_stage(stage_run_path=Path(request["stageRunPath"]))
    raise ActivationError("request-validation", "Activation action is unsupported")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("action", choices=("capture", "prepare", "probe", "baseline", "preflight", "activate", "rollback", "cleanup", "cleanup-stage"))
    parser.add_argument("--request", required=True)
    args = parser.parse_args(argv)
    try:
        result = dispatch(args.action, _decode_request(args.request))
        envelope = {"ok": True, "result": result, "failure": None}
        code = 0
    except ActivationError as error:
        envelope = {
            "ok": False,
            "result": None,
            "failure": {
                "code": error.code,
                "switched": error.switched,
            },
        }
        code = 78
    print(_marker(envelope))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
