#!/usr/bin/env python3
"""Prove a signage terminal is on the requested release, then ACK ready.

The client key is read only from the terminal-local status-agent config.  It is
never accepted as a command-line argument and failures deliberately suppress
exception details so credentials cannot leak through deployment logs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shlex
import ssl
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


CONFIG_PATH = Path("/etc/raspi-status-agent.conf")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
FULL_RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
VERIFICATION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
MAX_RESPONSE_BYTES = 64 * 1024
MAX_ARTIFACT_BYTES = 1024 * 1024
MAX_ARTIFACT_ENTRIES = 34
MAX_ARTIFACT_ENTRY_BYTES = 512 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SIGNAGE_ARTIFACT_PATH = Path(
    "/usr/local/bin/raspi-signage-status-agent.pyz"
)
SIGNAGE_ARTIFACT_MANIFEST = "SIGNAGE-RELEASE.json"


class _RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        request: urllib.request.Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> urllib.request.Request | None:
        del new_url
        raise urllib.error.HTTPError(
            request.full_url,
            code,
            "ready acknowledgement redirects are forbidden",
            headers,
            file_pointer,
        )


def _read_config(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, raw_value = line.partition("=")
        key = key.strip()
        if not separator or re.fullmatch(r"[A-Z][A-Z0-9_]*", key) is None:
            continue
        if key not in {
            "API_BASE_URL",
            "CLIENT_ID",
            "CLIENT_KEY",
            "REQUEST_TIMEOUT",
            "TLS_SKIP_VERIFY",
        }:
            continue
        try:
            parsed = shlex.split(raw_value, comments=True, posix=True)
        except ValueError as error:
            raise ValueError("status-agent configuration is malformed") from error
        if len(parsed) != 1 or key in values:
            raise ValueError("status-agent configuration is malformed")
        values[key] = parsed[0]

    required = {"API_BASE_URL", "CLIENT_ID", "CLIENT_KEY"}
    if not required.issubset(values) or not all(values[key] for key in required):
        raise ValueError("status-agent configuration is incomplete")
    if any(ord(character) < 32 or ord(character) == 127 for character in values["CLIENT_KEY"]):
        raise ValueError("status-agent configuration is malformed")
    return values


def _positive_timeout(value: str) -> float:
    try:
        timeout = float(value)
    except ValueError as error:
        raise ValueError("status-agent timeout is malformed") from error
    if not math.isfinite(timeout) or timeout <= 0 or timeout > 60:
        raise ValueError("status-agent timeout is outside the safe range")
    return timeout


def _tls_context(value: str) -> ssl.SSLContext:
    if value not in {"0", "1"}:
        raise ValueError("status-agent TLS setting is malformed")
    if value == "1":
        return ssl._create_unverified_context()
    return ssl.create_default_context()


def _ack_url(base_url: str) -> str:
    parsed = urllib.parse.urlsplit(base_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("status-agent API URL is malformed")
    return base_url.rstrip("/") + "/system/deploy-status/ack"


def _local_head(repo: Path) -> str:
    if not repo.is_dir():
        raise RuntimeError("terminal repository is unavailable")
    try:
        completed = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={repo}",
                "-C",
                str(repo),
                "rev-parse",
                "--verify",
                "HEAD^{commit}",
            ],
            check=True,
            text=True,
            capture_output=True,
            env={
                "PATH": "/usr/bin:/bin",
                "LANG": "C",
                "LC_ALL": "C",
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": "/dev/null",
                "GIT_ATTR_NOSYSTEM": "1",
                "GIT_TERMINAL_PROMPT": "0",
            },
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("terminal repository HEAD cannot be verified") from error
    head = completed.stdout.strip()
    if FULL_RELEASE_SHA_RE.fullmatch(head) is None:
        raise RuntimeError("terminal repository HEAD is malformed")
    return head


def _signage_artifact_identity(path: Path) -> tuple[str, str]:
    try:
        metadata = path.lstat()
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_size <= 0
            or metadata.st_size > MAX_ARTIFACT_BYTES
        ):
            raise RuntimeError("installed signage artifact is unsafe")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if (
                len(names) != len(set(names))
                or len(names) > MAX_ARTIFACT_ENTRIES
                or SIGNAGE_ARTIFACT_MANIFEST not in names
                or any(
                    not name
                    or name.startswith("/")
                    or ".." in Path(name).parts
                    for name in names
                )
            ):
                raise RuntimeError("installed signage artifact archive is unsafe")
            for entry in archive.infolist():
                mode = entry.external_attr >> 16
                if (
                    not stat.S_ISREG(mode)
                    or entry.file_size > MAX_ARTIFACT_ENTRY_BYTES
                ):
                    raise RuntimeError(
                        "installed signage artifact entry is unsafe"
                    )
            manifest = json.loads(
                archive.read(SIGNAGE_ARTIFACT_MANIFEST).decode("utf-8")
            )
    except (OSError, UnicodeError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        raise RuntimeError("installed signage artifact cannot be verified") from error
    if (
        not isinstance(manifest, dict)
        or set(manifest)
        != {
            "schemaVersion",
            "profile",
            "sourceSha",
            "installPath",
            "pathCount",
            "pathManifestSha256",
            "pythonRequires",
            "sources",
        }
        or manifest.get("schemaVersion") != 1
        or manifest.get("profile") != "signage"
        or FULL_RELEASE_SHA_RE.fullmatch(str(manifest.get("sourceSha") or ""))
        is None
        or manifest.get("installPath") != SIGNAGE_ARTIFACT_PATH.as_posix()
        or manifest.get("pythonRequires") != ">=3.10"
    ):
        raise RuntimeError("installed signage artifact identity is malformed")
    return manifest["sourceSha"], digest


def probe(
    run_id: str,
    release_sha: str,
    verification_id: str,
    expected_client_id: str,
    *,
    identity_mode: str,
    repo: Path | None = None,
    artifact_path: Path | None = None,
    artifact_sha256: str | None = None,
    config_path: Path = CONFIG_PATH,
) -> dict[str, Any]:
    if RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("run ID is malformed")
    if FULL_RELEASE_SHA_RE.fullmatch(release_sha) is None:
        raise ValueError("release SHA is malformed")
    if VERIFICATION_ID_RE.fullmatch(verification_id) is None:
        raise ValueError("verification ID is malformed")
    if CLIENT_ID_RE.fullmatch(expected_client_id) is None:
        raise ValueError("expected client identity is malformed")

    config = _read_config(config_path)
    if config["CLIENT_ID"] != expected_client_id:
        raise RuntimeError("local client identity does not match inventory")
    if identity_mode == "legacy-repository":
        if repo is None or artifact_path is not None or artifact_sha256 is not None:
            raise ValueError("legacy repository ready identity is malformed")
        if _local_head(repo) != release_sha:
            raise RuntimeError("terminal repository HEAD does not match the release")
    elif identity_mode == "artifact":
        if (
            repo is not None
            or artifact_path is None
            or not isinstance(artifact_sha256, str)
            or SHA256_RE.fullmatch(artifact_sha256) is None
        ):
            raise ValueError("signage artifact ready identity is malformed")
        source_sha, digest = _signage_artifact_identity(artifact_path)
        if source_sha != release_sha or digest != artifact_sha256:
            raise RuntimeError(
                "installed signage artifact does not match the release"
            )
    else:
        raise ValueError("ready identity mode is malformed")

    expected = {
        "acknowledged": True,
        "runId": run_id,
        "phase": "ready",
        "releaseSha": release_sha,
        "verificationId": verification_id,
    }
    payload = {
        "runId": run_id,
        "phase": "ready",
        "releaseSha": release_sha,
        "verificationId": verification_id,
    }
    request = urllib.request.Request(
        _ack_url(config["API_BASE_URL"]),
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "x-client-key": config["CLIENT_KEY"],
            "accept": "application/json",
            "content-type": "application/json",
        },
        method="POST",
    )
    context = _tls_context(config.get("TLS_SKIP_VERIFY", "0"))
    timeout = _positive_timeout(config.get("REQUEST_TIMEOUT", "10"))
    opener = urllib.request.build_opener(
        _RejectRedirect(), urllib.request.HTTPSHandler(context=context)
    )
    with opener.open(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError("ready acknowledgement was rejected")
        response_payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(response_payload) > MAX_RESPONSE_BYTES:
        raise RuntimeError("ready acknowledgement response is too large")
    decoded = json.loads(response_payload.decode("utf-8"))
    if (
        not isinstance(decoded, dict)
        or decoded.keys() != expected.keys()
        or decoded.get("acknowledged") is not True
        or decoded.get("runId") != run_id
        or decoded.get("phase") != "ready"
        or decoded.get("releaseSha") != release_sha
        or decoded.get("verificationId") != verification_id
    ):
        raise RuntimeError("ready acknowledgement response is malformed")
    return expected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--release-sha", required=True)
    parser.add_argument("--verification-id", required=True)
    parser.add_argument("--expected-client-id", required=True)
    parser.add_argument(
        "--identity-mode",
        required=True,
        choices=("artifact", "legacy-repository"),
    )
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--artifact-path", type=Path)
    parser.add_argument("--artifact-sha256")
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    args = parser.parse_args()
    try:
        result = probe(
            args.run_id,
            args.release_sha,
            args.verification_id,
            args.expected_client_id,
            identity_mode=args.identity_mode,
            repo=args.repo,
            artifact_path=args.artifact_path,
            artifact_sha256=args.artifact_sha256,
            config_path=args.config,
        )
    except Exception:
        # Never print exception details: HTTP/config errors can contain endpoint
        # context, and the terminal-local client key must never enter logs.
        print("terminal ready verification failed", file=sys.stderr)
        return 1
    print("TERMINAL_READY_OK:" + result["releaseSha"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
