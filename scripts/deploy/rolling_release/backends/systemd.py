"""Systemd transport used by the explicit Pi3 artifact preflight."""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path, PurePosixPath

from .. import signage_artifact_stage
from .command import CommandResult, SshTransport


DEFAULT_REMOTE_PROJECT = PurePosixPath('/opt/RaspberryPiSystem_002')
DEFAULT_REMOTE_USER = 'denkon5sd02'
DEFAULT_REMOTE_HOME = PurePosixPath('/home/denkon5sd02')
REMOTE_PYTHON = '/usr/bin/python3'
SIGNAGE_ARTIFACT_STAGE_LOADER = (
    "import base64,sys;stage,verifier,payload=sys.argv[1:];"
    "stage_source=base64.b64decode(stage).decode('utf-8');"
    "verifier_source=base64.b64decode(verifier).decode('utf-8');"
    "request=base64.b64decode(payload).decode('utf-8');"
    "ns={'__name__':'_embedded_signage_stage',"
    "'EMBEDDED_SIGNAGE_STAGE_SOURCE':stage_source,"
    "'EMBEDDED_DISTRIBUTION_VERIFIER_SOURCE':verifier_source};"
    "exec(compile(stage_source,'<signage-artifact-stage>','exec'),ns);"
    "raise SystemExit(ns['main']([request]))"
)
_USER_RE = re.compile(r'^[a-z_][a-z0-9_-]{0,30}$')


def _load_signage_artifact_stage_source() -> str:
    source_path = Path(signage_artifact_stage.__file__ or '')
    if not source_path.is_file():
        raise RuntimeError('Signage artifact stage source is unavailable')
    return source_path.read_text(encoding='utf-8')


def _load_distribution_verifier_source() -> str:
    source_path = Path(__file__).resolve().parents[2] / 'signage-distribution-artifact.py'
    if not source_path.is_file():
        raise RuntimeError('Signage distribution verifier source is unavailable')
    return source_path.read_text(encoding='utf-8')


def _encode_argument(value: str) -> str:
    return base64.b64encode(value.encode('utf-8')).decode('ascii')


class SystemdBackend:
    def __init__(
        self,
        transport: SshTransport,
        *,
        remote_project: PurePosixPath = DEFAULT_REMOTE_PROJECT,
        remote_user: str = DEFAULT_REMOTE_USER,
        remote_home: PurePosixPath = DEFAULT_REMOTE_HOME,
        signage_artifact_stage_source: str | None = None,
        distribution_verifier_source: str | None = None,
    ) -> None:
        project = str(remote_project)
        if (
            not remote_project.is_absolute()
            or '..' in remote_project.parts
            or '\x00' in project
            or str(PurePosixPath(project)) != project
        ):
            raise ValueError('remote project must be a normalized absolute POSIX path')
        home = str(remote_home)
        if (
            not isinstance(remote_user, str)
            or not _USER_RE.fullmatch(remote_user)
            or not remote_home.is_absolute()
            or '..' in remote_home.parts
            or '\x00' in home
            or str(PurePosixPath(home)) != home
        ):
            raise ValueError('remote execution identity is malformed')
        self.transport = transport
        self.remote_project = remote_project
        self.remote_user = remote_user
        self.remote_home = remote_home
        self.signage_artifact_stage_source = (
            signage_artifact_stage_source
            if signage_artifact_stage_source is not None
            else _load_signage_artifact_stage_source()
        )
        if not self.signage_artifact_stage_source.strip():
            raise ValueError('Signage artifact stage source must not be empty')
        self.distribution_verifier_source = (
            distribution_verifier_source
            if distribution_verifier_source is not None
            else _load_distribution_verifier_source()
        )
        if not self.distribution_verifier_source.strip():
            raise ValueError('Signage distribution verifier source must not be empty')

    def build_pi3_signage_artifact_preflight_command(
        self,
        *,
        source_sha: str,
        oci_digest: str,
        preflight_id: str,
        target: dict[str, object],
    ) -> tuple[str, ...]:
        """Build the explicit non-Deploy, digest-pinned Pi3 stage proof."""

        selected = {
            key: target.get(key)
            for key in ('host', 'profile', 'address', 'user', 'port')
        }
        payload = {
            'version': 1,
            'mode': 'artifact-preflight',
            'artifactRef': f'{signage_artifact_stage.ARTIFACT_REPOSITORY}:{source_sha}',
            'expectedOciDigest': oci_digest,
            'runId': preflight_id,
            'stagingRoot': str(signage_artifact_stage.DEFAULT_STAGING_ROOT),
            'retain': False,
            'target': selected,
            'configPath': str(signage_artifact_stage.DEFAULT_CONFIG_PATH),
        }
        serialized = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(',', ':'),
        )
        signage_artifact_stage.parse_preflight_spec(serialized)
        return (
            REMOTE_PYTHON,
            '-c',
            SIGNAGE_ARTIFACT_STAGE_LOADER,
            _encode_argument(self.signage_artifact_stage_source),
            _encode_argument(self.distribution_verifier_source),
            _encode_argument(serialized),
        )

    def preflight_pi3_signage_artifact(
        self,
        *,
        source_sha: str,
        oci_digest: str,
        preflight_id: str,
        target: dict[str, object],
    ) -> CommandResult:
        return self.transport.run(
            self.build_pi3_signage_artifact_preflight_command(
                source_sha=source_sha,
                oci_digest=oci_digest,
                preflight_id=preflight_id,
                target=target,
            )
        )
