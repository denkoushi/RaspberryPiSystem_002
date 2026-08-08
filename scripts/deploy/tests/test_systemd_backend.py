from __future__ import annotations

import base64
import json
import shlex
import unittest
from pathlib import PurePosixPath

from scripts.deploy.rolling_release.backends import systemd as backend_module
from scripts.deploy.rolling_release.backends.command import CommandResult, SshTransport
from scripts.deploy.rolling_release.backends.systemd import SystemdBackend


RUN_ID = '20260715-123456-a1b2c3'
SHA = 'a' * 40
OCI_DIGEST = 'sha256:' + 'd' * 64


class FakeRunner:
    def __init__(self) -> None:
        self.calls = []

    def run(self, argv, *, cwd=None, env=None, input_text=None):
        command = tuple(argv)
        self.calls.append({
            'argv': command,
            'cwd': cwd,
            'env': env,
            'input_text': input_text,
        })
        return CommandResult(command, 0, '', '')


class SystemdBackendTest(unittest.TestCase):
    def backend(self):
        runner = FakeRunner()
        transport = SshTransport(
            'operator@pi5.example',
            runner,
            ssh_options=('-o', 'BatchMode=yes'),
        )
        return SystemdBackend(
            transport,
            remote_project=PurePosixPath('/opt/RaspberryPiSystem_002'),
            signage_artifact_stage_source='TRUSTED_SIGNAGE_STAGE_SOURCE',
            distribution_verifier_source='TRUSTED_DISTRIBUTION_VERIFIER_SOURCE',
        ), runner

    def test_dedicated_signage_artifact_preflight_is_digest_pinned_and_has_no_launch_spec(self):
        backend, runner = self.backend()
        target = {
            'host': 'raspberrypi3',
            'profile': 'signage',
            'address': '100.64.0.3',
            'user': 'pi',
            'port': 22,
        }

        backend.preflight_pi3_signage_artifact(
            source_sha=SHA,
            oci_digest=OCI_DIGEST,
            preflight_id=RUN_ID,
            target=target,
        )

        remote = tuple(shlex.split(runner.calls[-1]['argv'][-1]))
        self.assertEqual(
            remote[:3],
            (
                '/usr/bin/python3',
                '-c',
                backend_module.SIGNAGE_ARTIFACT_STAGE_LOADER,
            ),
        )
        payload = json.loads(base64.b64decode(remote[-1]).decode('utf-8'))
        self.assertEqual(payload['mode'], 'artifact-preflight')
        self.assertEqual(payload['expectedOciDigest'], OCI_DIGEST)
        self.assertEqual(
            payload['artifactRef'],
            f'{backend_module.signage_artifact_stage.ARTIFACT_REPOSITORY}:{SHA}',
        )
        self.assertEqual(payload['runId'], RUN_ID)
        self.assertFalse(payload['retain'])
        self.assertEqual(payload['target'], target)


if __name__ == '__main__':
    unittest.main()
