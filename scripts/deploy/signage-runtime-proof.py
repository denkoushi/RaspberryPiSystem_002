#!/usr/bin/env python3
"""Controller-owned signage endpoint and displayed-image proof.

The signage credential is read from the already-installed update script on the
terminal.  It is never accepted as an argument, placed in a child-process
argument vector, or emitted in the result marker.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_ASSIGNMENT_RE = re.compile(r'^([A-Z][A-Z0-9_]*)="([^"\\\r\n]*)"$')
_MAX_SCRIPT_BYTES = 256 * 1024
_MAX_STATUS_BYTES = 64 * 1024
_MAX_IMAGE_BYTES = 32 * 1024 * 1024
_MAINTENANCE_PREFIX = "SIGNAGE_MAINTENANCE_V1"
_DEFAULT_SCRIPT = Path("/usr/local/bin/signage-update.sh")
_DEFAULT_CACHE = Path("/run/signage")


class ProofError(RuntimeError):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def _write_all(descriptor: int, value: bytes) -> None:
    offset = 0
    while offset < len(value):
        written = os.write(descriptor, value[offset:])
        if written <= 0:
            raise ProofError("short local image write")
        offset += written


def _read_regular(path: Path, maximum: int) -> tuple[bytes, os.stat_result]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ProofError(f"required local file is unavailable: {path}") from error
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise ProofError(f"required local file is not a sealed regular file: {path}")
        if metadata.st_size < 0 or metadata.st_size > maximum:
            raise ProofError(f"required local file has an invalid size: {path}")
        chunks: list[bytes] = []
        remaining = maximum + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(64 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        value = b"".join(chunks)
        if len(value) > maximum:
            raise ProofError(f"required local file is too large: {path}")
        return value, metadata
    finally:
        os.close(descriptor)


def _decode_script(path: Path) -> str:
    raw, metadata = _read_regular(path, _MAX_SCRIPT_BYTES)
    if metadata.st_mode & 0o022:
        raise ProofError("installed signage configuration is group/other writable")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ProofError("installed signage configuration is not UTF-8") from error


def _literal_assignments(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    interesting = {"SERVER_URL", "IMAGE_CLIENT_KEY", "CLIENT_KEY"}
    for line in text.splitlines():
        if not any(line.startswith(name + "=") for name in interesting):
            continue
        match = _ASSIGNMENT_RE.fullmatch(line)
        if match is None or match.group(1) not in interesting:
            raise ProofError("installed signage configuration assignment is unsafe")
        name, value = match.groups()
        if name in values:
            raise ProofError("installed signage configuration has duplicate assignments")
        # These bytes would be expanded by Bash in the deployed script.  A
        # proof parser must not silently authenticate with a different value.
        if "$" in value or "`" in value or any(ord(character) < 0x20 for character in value):
            raise ProofError("installed signage configuration contains shell expansion")
        values[name] = value
    return values


def _tls_is_insecure(text: str) -> bool:
    lines = [line for line in text.splitlines() if line.startswith("CURL_OPTIONS=")]
    if len(lines) != 1:
        raise ProofError("installed signage TLS policy is unavailable")
    value = lines[0]
    supported = {
        "CURL_OPTIONS=(-sS -f -k)": True,
        "CURL_OPTIONS=(-sS -f)": False,
        'CURL_OPTIONS="-s -f -k"': True,
        'CURL_OPTIONS="-s -f"': False,
        'CURL_OPTIONS="-sS -f -k"': True,
        'CURL_OPTIONS="-sS -f"': False,
    }
    if value not in supported:
        raise ProofError("installed signage TLS policy is unsupported")
    return supported[value]


def _configuration(path: Path) -> tuple[str, str, bool]:
    text = _decode_script(path)
    values = _literal_assignments(text)
    server_url = values.get("SERVER_URL")
    image_key = values.get("IMAGE_CLIENT_KEY")
    legacy_key = values.get("CLIENT_KEY")
    if image_key is not None and legacy_key is not None and image_key != legacy_key:
        raise ProofError("installed signage image credentials disagree")
    client_key = image_key if image_key is not None else legacy_key
    if not isinstance(server_url, str) or not server_url:
        raise ProofError("installed signage server URL is unavailable")
    if not isinstance(client_key, str) or not client_key:
        raise ProofError("installed signage image credential is unavailable")
    if len(client_key) > 4096 or any(ord(character) < 0x20 or ord(character) == 0x7F for character in client_key):
        raise ProofError("installed signage image credential is malformed")
    parsed = urllib.parse.urlsplit(server_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ProofError("installed signage server URL is malformed")
    canonical_url = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, "", "", "")
    )
    return canonical_url, client_key, _tls_is_insecure(text)


def _opener(insecure_tls: bool) -> urllib.request.OpenerDirector:
    context = ssl._create_unverified_context() if insecure_tls else ssl.create_default_context()
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _NoRedirect(),
        urllib.request.HTTPHandler(),
        urllib.request.HTTPSHandler(context=context),
    )


def _request(
    opener: urllib.request.OpenerDirector,
    url: str,
    client_key: str,
    maximum: int,
) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        headers={"x-client-key": client_key, "Accept": "*/*"},
        method="GET",
    )
    try:
        with opener.open(request, timeout=10) as response:
            if response.status != 200:
                raise ProofError("signage endpoint returned a non-success status")
            body = response.read(maximum + 1)
            content_type = response.headers.get_content_type()
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise ProofError("authenticated signage endpoint request failed") from error
    if len(body) > maximum:
        raise ProofError("signage endpoint response is too large")
    return body, content_type


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _prove_endpoints(script: Path) -> bytes:
    server_url, client_key, insecure_tls = _configuration(script)
    opener = _opener(insecure_tls)
    status_body, status_type = _request(
        opener,
        server_url + "/api/signage/render/status",
        client_key,
        _MAX_STATUS_BYTES,
    )
    if status_type != "application/json":
        raise ProofError("signage status endpoint did not return JSON")
    try:
        status_value = json.loads(
            status_body.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=lambda value: (_ for _ in ()).throw(
                ValueError(f"invalid JSON constant: {value}")
            ),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ProofError("signage status endpoint returned malformed JSON") from error
    if (
        not isinstance(status_value, dict)
        or status_value.get("isRunning") is not True
        or isinstance(status_value.get("intervalSeconds"), bool)
        or not isinstance(status_value.get("intervalSeconds"), int)
        or not 1 <= status_value["intervalSeconds"] <= 86400
    ):
        raise ProofError("signage status endpoint contract is malformed")
    image, image_type = _request(
        opener,
        server_url + "/api/signage/current-image",
        client_key,
        _MAX_IMAGE_BYTES,
    )
    if (
        image_type != "image/jpeg"
        or len(image) < 4
        or not image.startswith(b"\xff\xd8")
        or not image.endswith(b"\xff\xd9")
    ):
        raise ProofError("signage current-image endpoint did not return a nonempty JPEG")
    return image


def _cache_directory(path: Path) -> os.stat_result:
    try:
        metadata = path.stat(follow_symlinks=False)
    except OSError as error:
        raise ProofError("signage cache directory is unavailable") from error
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_mode & 0o022:
        raise ProofError("signage cache directory is unsafe")
    return metadata


def _marker_path(cache: Path, run_id: str) -> Path:
    if _RUN_ID_RE.fullmatch(run_id) is None:
        raise ProofError("run ID is malformed")
    return cache / f"release-{run_id}-maintenance.sha256"


def _atomic_write(path: Path, value: bytes, mode: int) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    descriptor = os.open(temporary, flags, mode)
    try:
        _write_all(descriptor, value)
        os.fsync(descriptor)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    finally:
        os.close(descriptor)
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _seal_maintenance(cache: Path, run_id: str, image_path: Path) -> str:
    _cache_directory(cache)
    expected_image = cache / "current.tmp.jpg"
    if image_path != expected_image:
        raise ProofError("maintenance image path is outside the signage cache contract")
    image, _metadata = _read_regular(image_path, _MAX_IMAGE_BYTES)
    if not image:
        raise ProofError("maintenance image is empty")
    digest = hashlib.sha256(image).hexdigest()
    marker = _marker_path(cache, run_id)
    payload = f"{_MAINTENANCE_PREFIX} {digest}\n".encode("ascii")
    if marker.exists():
        existing, metadata = _read_regular(marker, 256)
        if (
            metadata.st_uid != os.geteuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or existing != payload
        ):
            raise ProofError("existing maintenance seal disagrees")
    else:
        _atomic_write(marker, payload, 0o600)
    return digest


def _maintenance_digest(cache: Path, run_id: str) -> str | None:
    marker = _marker_path(cache, run_id)
    try:
        raw, metadata = _read_regular(marker, 256)
    except ProofError:
        if not marker.exists():
            return None
        raise
    if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise ProofError("maintenance seal ownership or mode is invalid")
    try:
        prefix, digest = raw.decode("ascii").strip().split(" ", 1)
    except (UnicodeDecodeError, ValueError) as error:
        raise ProofError("maintenance seal is malformed") from error
    if prefix != _MAINTENANCE_PREFIX or _SHA256_RE.fullmatch(digest) is None:
        raise ProofError("maintenance seal is malformed")
    return digest


def _remove_maintenance_marker(
    cache: Path, run_id: str, expected_digest: str | None
) -> None:
    if expected_digest is None:
        return
    if _maintenance_digest(cache, run_id) != expected_digest:
        raise ProofError("maintenance seal changed during image refresh")
    marker = _marker_path(cache, run_id)
    try:
        os.unlink(marker)
    except OSError as error:
        raise ProofError("maintenance seal could not be removed") from error
    directory = os.open(cache, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _replace_current(cache: Path, image: bytes) -> str:
    directory_metadata = _cache_directory(cache)
    current = cache / "current.jpg"
    try:
        current_metadata = current.stat(follow_symlinks=False)
    except FileNotFoundError:
        current_metadata = None
    if current_metadata is not None:
        if not stat.S_ISREG(current_metadata.st_mode) or current_metadata.st_nlink != 1:
            raise ProofError("current signage image is not a regular file")
        descriptor = os.open(
            current,
            os.O_WRONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            observed = os.fstat(descriptor)
            if (observed.st_dev, observed.st_ino) != (
                current_metadata.st_dev,
                current_metadata.st_ino,
            ):
                raise ProofError("current signage image changed during refresh")
            os.ftruncate(descriptor, 0)
            _write_all(descriptor, image)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    else:
        temporary = current.with_name(f".{current.name}.{os.getpid()}.tmp")
        descriptor = os.open(
            temporary,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            0o644,
        )
        try:
            _write_all(descriptor, image)
            os.fchmod(descriptor, 0o644)
            if os.geteuid() == 0:
                os.fchown(descriptor, directory_metadata.st_uid, directory_metadata.st_gid)
            os.fsync(descriptor)
        except Exception:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
        finally:
            os.close(descriptor)
        os.replace(temporary, current)
    directory = os.open(cache, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    persisted, _metadata = _read_regular(current, _MAX_IMAGE_BYTES)
    digest = hashlib.sha256(image).hexdigest()
    if persisted != image or hashlib.sha256(persisted).hexdigest() != digest:
        raise ProofError("refreshed signage image could not be verified")
    return digest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-script", type=Path, default=_DEFAULT_SCRIPT)
    parser.add_argument("--cache-dir", type=Path, default=_DEFAULT_CACHE)
    parser.add_argument("--run-id")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check-endpoints", action="store_true")
    mode.add_argument("--refresh-image", action="store_true")
    mode.add_argument("--seal-maintenance-image", type=Path)
    parser.add_argument("--ansible-marker", action="store_true")
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.seal_maintenance_image is not None:
            if args.run_id is None:
                raise ProofError("maintenance sealing requires a run ID")
            digest = _seal_maintenance(
                args.cache_dir, args.run_id, args.seal_maintenance_image
            )
            if args.ansible_marker:
                print(f"SIGNAGE_MAINTENANCE_SEALED:{digest}")
            return 0
        image = _prove_endpoints(args.config_script)
        digest = hashlib.sha256(image).hexdigest()
        if args.refresh_image:
            if args.run_id is None:
                raise ProofError("image refresh requires a run ID")
            maintenance_digest = _maintenance_digest(args.cache_dir, args.run_id)
            if maintenance_digest == digest:
                raise ProofError("authenticated image still matches the run maintenance artifact")
            digest = _replace_current(args.cache_dir, image)
            # Both crash boundaries are retry-safe: before unlink the sealed
            # digest is rechecked; after unlink a retry performs another
            # authenticated fetch and verifies the persisted image again.
            _remove_maintenance_marker(args.cache_dir, args.run_id, maintenance_digest)
            if args.ansible_marker:
                print(f"SIGNAGE_RUNTIME_PROOF_OK:{digest}")
        elif args.ansible_marker:
            print(f"SIGNAGE_ENDPOINT_PROOF_OK:{digest}")
        return 0
    except ProofError as error:
        print(f"signage runtime proof failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
