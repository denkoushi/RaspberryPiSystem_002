#!/usr/bin/env python3
"""Promote one attested GHCR API/Web pair into run-scoped Pi5 tags.

The adapter can acquire and validate images, but it cannot run migrations,
change Blue/Green slots, switch traffic, or decide rollback.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

try:
    from .release_artifact_contract import (
        ReleaseArtifactError,
        parse_release_set,
        validate_release_set,
    )
except ImportError:
    from release_artifact_contract import (  # type: ignore[no-redef]
        ReleaseArtifactError,
        parse_release_set,
        validate_release_set,
    )


EX_OK = 0
EX_UNAVAILABLE = 75
EX_DISABLED = 76
EX_INTEGRITY = 78
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
CONFIG_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
LOCAL_TAG_RE = re.compile(
    r"^[a-z0-9][a-z0-9._/-]{0,199}:[0-9a-f][0-9a-f.-]{0,127}$"
)
CONFIG_KEYS = {
    "enabled",
    "repository",
    "workflow",
    "releaseSetRepository",
    "username",
    "token",
}
MAX_CONFIG_BYTES = 64 * 1024
MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
REQUIRED_ATTESTATION_OPTIONS = {
    "--bundle-from-oci",
    "--deny-self-hosted-runners",
    "--signer-workflow",
    "--source-digest",
    "--source-ref",
}
PUBLIC_OCI_VERIFICATION_TOKEN = "public-oci-attestation-verification"


class PromotionUnavailable(RuntimeError):
    pass


class PromotionDisabled(RuntimeError):
    pass


class PromotionIntegrityError(RuntimeError):
    pass


class PromotionInterrupted(RuntimeError):
    def __init__(self, signum: int) -> None:
        super().__init__(f"artifact promotion interrupted by signal {signum}")
        self.signum = signum


def _strict_object(items: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in items:
        if key in result:
            raise PromotionIntegrityError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


@dataclass(frozen=True)
class PromotionConfig:
    enabled: bool
    repository: str
    workflow: str
    release_set_repository: str
    username: str
    token: str


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


CommandRunner = Callable[
    [Sequence[str], str | None, Mapping[str, str] | None], CommandResult
]


def _run_command(
    command: Sequence[str],
    input_text: str | None = None,
    environment: Mapping[str, str] | None = None,
) -> CommandResult:
    completed = subprocess.run(
        list(command),
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
        timeout=300,
        env=dict(environment) if environment is not None else None,
    )
    stdout = completed.stdout[-MAX_COMMAND_OUTPUT_BYTES:]
    stderr = completed.stderr[-MAX_COMMAND_OUTPUT_BYTES:]
    return CommandResult(completed.returncode, stdout, stderr)


def load_config(path: Path) -> PromotionConfig:
    if not path.exists():
        raise PromotionDisabled("artifact promotion config is not installed")
    try:
        metadata = path.lstat()
    except OSError as error:
        raise PromotionUnavailable("artifact promotion config is unavailable") from error
    if (
        stat.S_ISLNK(metadata.st_mode)
        or not stat.S_ISREG(metadata.st_mode)
        or metadata.st_size > MAX_CONFIG_BYTES
        or metadata.st_mode & 0o077
    ):
        raise PromotionIntegrityError("artifact promotion config permissions are unsafe")
    if os.geteuid() == 0 and metadata.st_uid != 0:
        raise PromotionIntegrityError("artifact promotion config is not root-owned")
    try:
        document = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=_strict_object
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise PromotionIntegrityError("artifact promotion config is malformed") from error
    if not isinstance(document, dict) or set(document) != CONFIG_KEYS:
        raise PromotionIntegrityError("artifact promotion config fields are invalid")
    enabled = document["enabled"]
    values = {
        key: document[key]
        for key in CONFIG_KEYS
        if key != "enabled"
    }
    if type(enabled) is not bool or any(
        not isinstance(value, str)
        or "\x00" in value
        or "\r" in value
        or "\n" in value
        or len(value.encode("utf-8")) > 4096
        for value in values.values()
    ):
        raise PromotionIntegrityError("artifact promotion config values are invalid")
    if not enabled:
        raise PromotionDisabled("artifact promotion is disabled")
    if (
        document["repository"] != "denkoushi/RaspberryPiSystem_002"
        or document["workflow"] != ".github/workflows/ci.yml"
        or document["releaseSetRepository"]
        != "ghcr.io/denkoushi/raspisys-release-set"
        or not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})", document["username"])
    ):
        raise PromotionIntegrityError("artifact promotion trust policy is invalid")
    return PromotionConfig(
        enabled=True,
        repository=document["repository"],
        workflow=document["workflow"],
        release_set_repository=document["releaseSetRepository"],
        username=document["username"],
        token=document["token"],
    )


def attestation_command(
    gh: str,
    oci_reference: str,
    config: PromotionConfig,
    sha: str,
) -> list[str]:
    return [
        gh,
        "attestation",
        "verify",
        f"oci://{oci_reference}",
        "--repo",
        config.repository,
        "--signer-workflow",
        f"{config.repository}/{config.workflow}",
        "--source-digest",
        sha,
        "--source-ref",
        "refs/heads/main",
        "--deny-self-hosted-runners",
        "--bundle-from-oci",
    ]


def _require_success(
    runner: CommandRunner,
    command: Sequence[str],
    *,
    input_text: str | None = None,
    environment: Mapping[str, str] | None = None,
    unavailable: bool = False,
    label: str,
) -> CommandResult:
    try:
        result = runner(command, input_text, environment)
    except (OSError, subprocess.SubprocessError) as error:
        if unavailable:
            raise PromotionUnavailable(f"{label} is unavailable") from error
        raise PromotionIntegrityError(f"{label} could not be verified") from error
    if result.returncode != 0:
        if unavailable:
            raise PromotionUnavailable(f"{label} is unavailable")
        raise PromotionIntegrityError(f"{label} verification failed")
    return result


def _json_output(result: CommandResult, label: str) -> Any:
    try:
        return json.loads(result.stdout, object_pairs_hook=_strict_object)
    except (json.JSONDecodeError, UnicodeError) as error:
        raise PromotionIntegrityError(f"{label} output is malformed") from error


def _inspect_image(
    runner: CommandRunner,
    docker: str,
    reference: str,
    sha: str,
    config_hash: str,
) -> str:
    result = _require_success(
        runner,
        [docker, "image", "inspect", reference],
        label="Docker image inspection",
    )
    document = _json_output(result, "Docker image inspection")
    if not isinstance(document, list) or len(document) != 1:
        raise PromotionIntegrityError("Docker image inspection is ambiguous")
    image = document[0]
    labels = (
        image.get("Config", {}).get("Labels")
        if isinstance(image, dict) and isinstance(image.get("Config"), dict)
        else None
    )
    image_id = image.get("Id") if isinstance(image, dict) else None
    if (
        image.get("Os") != "linux"
        or image.get("Architecture") != "arm64"
        or not isinstance(labels, dict)
        or labels.get("org.opencontainers.image.revision") != sha
        or labels.get("org.opencontainers.image.config-hash") != config_hash
        or not isinstance(image_id, str)
        or re.fullmatch(r"sha256:[0-9a-f]{64}", image_id) is None
    ):
        raise PromotionIntegrityError("Docker image provenance or platform is invalid")
    return image_id


def _resolve_repo_digest(
    runner: CommandRunner,
    docker: str,
    tagged_reference: str,
    repository: str,
) -> str:
    result = _require_success(
        runner,
        [docker, "image", "inspect", "--format", "{{json .RepoDigests}}", tagged_reference],
        label="release-set digest inspection",
    )
    values = _json_output(result, "release-set digest inspection")
    matches = [
        value
        for value in values
        if isinstance(value, str)
        and re.fullmatch(re.escape(repository) + r"@sha256:[0-9a-f]{64}", value)
    ] if isinstance(values, list) else []
    if len(matches) != 1:
        raise PromotionIntegrityError("release-set digest is unavailable or ambiguous")
    return matches[0]


def _verification_environment(
    config: PromotionConfig, gh_config_directory: Path
) -> dict[str, str]:
    environment = os.environ.copy()
    environment["GH_CONFIG_DIR"] = str(gh_config_directory)
    environment["GH_TOKEN"] = config.token or PUBLIC_OCI_VERIFICATION_TOKEN
    environment.pop("GITHUB_TOKEN", None)
    return environment


def _require_verifier_capability(
    runner: CommandRunner,
    gh: str,
    environment: Mapping[str, str],
) -> None:
    result = _require_success(
        runner,
        [gh, "attestation", "verify", "--help"],
        environment=environment,
        unavailable=True,
        label="GitHub attestation verifier",
    )
    if any(option not in result.stdout for option in REQUIRED_ATTESTATION_OPTIONS):
        raise PromotionUnavailable("GitHub attestation verifier is too old")


def _cleanup_image(
    runner: CommandRunner,
    docker: str,
    reference: str,
    docker_config: Path,
) -> None:
    runner(
        [docker, "--config", str(docker_config), "image", "rm", reference],
        None,
        None,
    )


def promote(
    *,
    config_path: Path,
    sha: str,
    config_hash: str,
    run_id: str,
    api_tag: str,
    web_tag: str,
    runner: CommandRunner = _run_command,
) -> dict[str, object]:
    if (
        FULL_SHA_RE.fullmatch(sha) is None
        or CONFIG_HASH_RE.fullmatch(config_hash) is None
        or RUN_ID_RE.fullmatch(run_id) is None
        or LOCAL_TAG_RE.fullmatch(api_tag) is None
        or LOCAL_TAG_RE.fullmatch(web_tag) is None
        or api_tag == web_tag
    ):
        raise PromotionIntegrityError("artifact promotion request is malformed")

    config = load_config(config_path)
    docker = shutil.which("docker")
    gh = shutil.which("gh")
    if not docker or not gh:
        raise PromotionUnavailable("artifact promotion tools are unavailable")

    release_tag = (
        f"{config.release_set_repository}:{sha}-{config_hash}"
    )
    container_name = f"raspi-release-set-{run_id}"
    with tempfile.TemporaryDirectory(prefix=f"raspi-artifact-{run_id}-") as directory:
        temporary = Path(directory)
        docker_config = temporary / "docker"
        docker_config.mkdir(mode=0o700)
        gh_config = temporary / "gh"
        gh_config.mkdir(mode=0o700)
        verifier_environment = _verification_environment(config, gh_config)
        _require_verifier_capability(runner, gh, verifier_environment)
        release_json = temporary / "release-set.json"
        release_digest_ref = ""
        pulled_refs: list[str] = []
        promoted_tags: list[str] = []
        try:
            if config.token:
                _require_success(
                    runner,
                    [
                        docker,
                        "--config",
                        str(docker_config),
                        "login",
                        "ghcr.io",
                        "--username",
                        config.username,
                        "--password-stdin",
                    ],
                    input_text=config.token,
                    unavailable=True,
                    label="GHCR authentication",
                )
            _require_success(
                runner,
                [docker, "--config", str(docker_config), "pull", release_tag],
                unavailable=True,
                label="signed release set",
            )
            pulled_refs.append(release_tag)
            release_digest_ref = _resolve_repo_digest(
                runner, docker, release_tag, config.release_set_repository
            )
            _require_success(
                runner,
                attestation_command(gh, release_digest_ref, config, sha),
                environment=verifier_environment,
                label="release-set attestation",
            )
            _inspect_image(runner, docker, release_digest_ref, sha, config_hash)

            _require_success(
                runner,
                [
                    docker,
                    "create",
                    "--name",
                    container_name,
                    release_digest_ref,
                    "/release-set.json",
                ],
                label="release-set extraction container",
            )
            try:
                _require_success(
                    runner,
                    [docker, "cp", f"{container_name}:/release-set.json", str(release_json)],
                    label="release-set extraction",
                )
            finally:
                runner([docker, "rm", "-f", container_name], None, None)
            try:
                release_set = parse_release_set(release_json.read_text(encoding="utf-8"))
                validate_release_set(
                    release_set,
                    config.repository,
                    sha,
                    config_hash,
                    config.workflow,
                )
            except (OSError, UnicodeError, ReleaseArtifactError) as error:
                raise PromotionIntegrityError("release-set content is invalid") from error

            image_ids: dict[str, str] = {}
            upstream: dict[str, str] = {}
            for service, artifact, local_tag in (
                ("api", release_set.api, api_tag),
                ("web", release_set.web, web_tag),
            ):
                reference = f"{artifact.repository}@{artifact.digest}"
                _require_success(
                    runner,
                    attestation_command(gh, reference, config, sha),
                    environment=verifier_environment,
                    label=f"{service} image attestation",
                )
                _require_success(
                    runner,
                    [docker, "--config", str(docker_config), "pull", reference],
                    unavailable=True,
                    label=f"{service} image",
                )
                pulled_refs.append(reference)
                image_ids[service] = _inspect_image(
                    runner, docker, reference, sha, config_hash
                )
                _require_success(
                    runner,
                    [docker, "image", "tag", reference, local_tag],
                    label=f"{service} image promotion",
                )
                promoted_tags.append(local_tag)
                upstream[service] = artifact.digest

            return {
                "status": "promoted",
                "source": "ghcr",
                "releaseSetDigest": release_digest_ref.split("@", 1)[1],
                "workflowRunId": release_set.workflow.run_id,
                "workflowRunAttempt": release_set.workflow.run_attempt,
                "images": {
                    "api": {
                        "digest": upstream["api"],
                        "imageId": image_ids["api"],
                    },
                    "web": {
                        "digest": upstream["web"],
                        "imageId": image_ids["web"],
                    },
                },
            }
        except Exception:
            for tag in reversed(promoted_tags):
                _cleanup_image(runner, docker, tag, docker_config)
            raise
        finally:
            runner([docker, "rm", "-f", container_name], None, None)
            for reference in reversed(pulled_refs):
                _cleanup_image(runner, docker, reference, docker_config)


def _write_result(path: Path, document: Mapping[str, object]) -> None:
    if not path.is_absolute() or "\x00" in str(path):
        raise PromotionIntegrityError("artifact promotion result path is malformed")
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=".artifact-promotion-", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(document, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--config-hash", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--api-tag", required=True)
    parser.add_argument("--web-tag", required=True)
    parser.add_argument("--result", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    previous_handlers: dict[int, Any] = {}

    def interrupt(signum: int, _frame: Any) -> None:
        raise PromotionInterrupted(signum)

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous_handlers[signum] = signal.signal(signum, interrupt)
    try:
        try:
            result = promote(
                config_path=args.config,
                sha=args.sha,
                config_hash=args.config_hash,
                run_id=args.run_id,
                api_tag=args.api_tag,
                web_tag=args.web_tag,
            )
            _write_result(args.result, result)
            return EX_OK
        except PromotionDisabled as error:
            _write_result(args.result, {"status": "disabled", "reason": str(error)})
            return EX_DISABLED
        except PromotionUnavailable as error:
            _write_result(args.result, {"status": "unavailable", "reason": str(error)})
            return EX_UNAVAILABLE
        except (PromotionIntegrityError, ReleaseArtifactError) as error:
            _write_result(
                args.result, {"status": "integrity-failure", "reason": str(error)}
            )
            print(f"artifact promotion failed integrity checks: {error}", file=sys.stderr)
            return EX_INTEGRITY
        except PromotionInterrupted as error:
            _write_result(
                args.result,
                {"status": "interrupted", "signal": error.signum},
            )
            return 128 + error.signum
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    raise SystemExit(main())
