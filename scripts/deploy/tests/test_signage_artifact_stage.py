from __future__ import annotations

import base64
import copy
from contextlib import nullcontext
import gzip
import hashlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.deploy.rolling_release import signage_artifact_stage as stage


PROJECT = Path(__file__).resolve().parents[3]
SOURCE_SHA = "e1bcd74d5b114d4a5ee3f54df48b94b1019780c3"
OCI_DIGEST = "sha256:" + "d" * 64
ARTIFACT_REF = f"ghcr.io/denkoushi/raspisys-pi3-signage:{SOURCE_SHA}"
RUN_ID = "20260806-160000-abcdef"
HOST = "raspberrypi3"
VERIFIER_SOURCE = (
    PROJECT / "scripts/deploy/signage-distribution-artifact.py"
).read_text(encoding="utf-8")
SIGNED_FIXTURE_SOURCE_SHA = "c42d5e7ea35ec5d92b314b28a07bdf233613102e"
SIGNED_FIXTURE_OCI_DIGEST = "sha256:eafe28097e3d9e28095e7a94ebad99d17469ca1ad01d2ff4fabace2e48789b1b"
SIGNED_FIXTURE_ARTIFACT_SHA256 = "1aaf4a98b6d60d7804b49c3e3c40512ba8f84a1884827594b291062f1cf6e190"
SIGNED_FIXTURE_MANIFEST_SHA256 = "3c3255e6b7614405ebbbaeaba803ce128d47bb7859deed19b74f3378da52a134"
SIGNED_FIXTURE_BUNDLE_SHA256 = "53a84c861ef0d2fa0c1a2908d0b1a35defeb7ae53363311fc9e6dfd3542dfdca"
_SIGNED_FIXTURE_BUNDLE_GZIP_B64 = (
    "H4sIAAAAAAACE61625KzyJXu/X4Kx39bni5Ahyo5whcgzhKoSMhMyPFccCohSA6SkEA4HDEPsZ9wP8ks9Pff7q5oO7wnfFFR"
    "hcRh5crvtKT667fses215p7ztsu//emv37r4wds4+/anb/nD/sxMPjDfWlt1IWSmMh1O7/eYLvvM2AjJY9Ulj02QGbrAqMiT"
    "xrtnpXbab+0po/aZUVewyi6B+9wieN8q2xOTijI9Pa+rGF1dkgWZYqO6p7U+pQaf8tDpU6Oa9qHbMWlVMAnP96timvF04Z0O"
    "zfWUSkXhlFh63o/qNQuspaNWCxa41YHix0GVVy7FiyiooC67YGq1Yqq2cNVoFUnaGFFvcKj3YHUksFo/RdTlTo2Fg5ouD9Qa"
    "o5O9+STC1WqUB6OoiyRYH0Gr1MCnw8luMxMN6dTe91LWZUYhRqdVmUjCnRnkFksbEerr9qJdpAvlxEL7kROlwws+ZQbpw0ke"
    "nNOmgHvAelCRGfyeNM79y5r7tCZXWNvE/I3k+NZva4H9gJ4WaYM6qL/MtL5Lam+ubYgD6J/Em6TWG+aLcM3Io9Dl1mk4RaEt"
    "xJQV0QIFsaE93CCCa2C90EPX0FYHw5KYGg0M+uCo6OSqvHQkPEWTN7iB9ohqbcnKoxAF2vKgekunTMVDgE5OWY2OGj1YqZes"
    "ZNwJqmF+XkL1GzxvXuevnwf3c+Bvwt3aWrilJriqLMI+naJa5xHsF+zfFEl4dMqictXsFJXp0g044IVUTsBP7oRqZ3IWBwMV"
    "bmAXTuAI8/NSyW0BhwWpyQN6cE9O1trx59dhT2qXY8DNjBlYz4Op8HyJFM5EeDSR6hDYJ2fShKi0llEgL6IanlE6E9Q3OYH8"
    "YD5gwvvzn7/98QdBgsfMl29x1/FTGventnm9N9lPp+Y/+rZvX8pr28DJ19OxifvbJb9++9N//nU+hGsczdta22bXDbl3e02m"
    "9Ea7o7gfOe13p9rWV+rq5CzfXpn6dkvzNZJPyvnxlvLxQ/QN7LaJe4kiWWmznT+s86J7FFrQvN7qY/Cw2Fzk3/7rb3/8VufZ"
    "Kf4HVWb5/Seo5dq3l/yn5NZkPP/pLvy0+FH2Pb+cPn++wIl7OIr5LA5pfum/v/HUiks8KI9+Xts3x7JMp9xulUt+lAdLkY8W"
    "jtdb/uJdhcN4mTpzeyJXUfaiTY7u1rA9RtauZdZUChpQYnAnjTiKY8gi1raF48wgBuCAMOAbEEty0HIw5UglnqdqI4gGzYBQ"
    "G9gYsUsaIFMtcmZwIBQezCJ1nTIaAEiSox7h3tZAf/va+HytlGVHrwZtiMyfa9lCgT/qUmUvVb2jrNmi9SrpDfdeVOZm9qk2"
    "N+ycOWXYVabseGuhXB4XDr+NbLFUX5bJkhuTV39cWRwIySH6uN0WSs5yyUjoORuKMVos49f1Yatk0XA8hr4jL+d1Z+qgKa+D"
    "B/2wzKMqB8rRJaaPNVWVd8rxeFGOmq5ATfIkZ8/3vKWmHz3sb92U4/iqN/rhYpWv8WMXmbfbfrmrBnOAniGhVJTjoLcyXmw+"
    "ukmMKo0lq7NbdjudnsbTMmLq+xB7z3OR7Jmviv4+hBFLYhMJqems949NE4eozah1i6RNv5cQT+r+noVuG/sbH0RmiGbiQZti"
    "4q5g73hC3gdHte77+odQbhbJwr6werxnC+ceSdUtp+LVM23OQARjgxTMdO4gHF1Syivl2M5r1uTo8OrImqJs+7+LL2Ajlsht"
    "PwvgdxG9MYkLsUlOUBPgwb3PuABTetbrKJaxPV0N2fOU49v7IHuWppgKiDXg4xjtdkOkKLKh3idZkQev/V+JRCB7X2rWFNlW"
    "/UDuv7yuK8pvDRA/DdDmaWOvsMGDPHRnU/10VPnhKMKX2iNNXfxuz96+PMdStoKzk/5u3sCZC6NLMGQXzGBzSx+rn/fVhl6Q"
    "B/TqBkZ1y7ZPUxvi4be92XooU/X+32CC77/s136RAc/7OjE2i/SxKWN/tUroKIMJ1nAMoq5X8LuPKL8Bd7/0otV2x+F/u1/Z"
    "l37tFfndUemPNYltspj3wRu8LxgBcRBU9d8QBkp5+aUGV9m2zs5wBKf2RBZkPAocMEj4UatHVDqja1iPg6ENrmRXrLQmZ4pG"
    "WOcAIWbm+2/rPHpIlUEnKZv2UgEGi+C3WECIG4yvaxo8gFsLZl4tXXgO3HdwtsNv+41kzTwO6b+kC4HMvqwNKfLV2QYWPMNZ"
    "OCp+OKVy+XKOr+iCQ3+F2V9wMnPa/9d5s/8F29Y9kzaPWGLXZJHB+t1u3/A+0ZTf7ctB/m1ftME7q9uidFW7moMlo9rkUlK6"
    "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"
    "QJ7h82cy4yqaXPAx/ZJrYgx5YGQ6glmmCw+Bq8bC6gZ56hrA+TAv84RuFoAFA+ZngusC+gt5SxKrWT9RtalgvQ+YObaJttIP"
    "BPlJiOZ+zfjGtEEHFLoLyjMhA/6RgLig4SEzIHMKm8ivNqE3FXumk6tPsj43IT8BEOH+B/CpM2lgjUbRAb53MC1asakTyBc7"
    "YLHh14hAVkEOwQKeZDGT3EuqAhZxOxGcCinkfcoRzgMeU9hPikWNNgzmyeIc1KA/JJqSSSHxAvgqdZDXrIdLihCODWJ0bSZp"
    "U6whmM86jdIV7Mk8H3MP0838ecz8eQtwa+N7wj//PIZNELQbMfsMhfm77lOT8tv11DYfl7Y+XZ9f+s5faefZ/EHhI/jxgeLz"
    "S228tWRjOYk8l14U/tiog/6+Dnq/umhtCwN896I+GsdspbukLzv5pMmNhkv7lOqvnWoqcrTfd6l6D3elHwSFLG/oCdKLvdyJ"
    "uyJ6foD563Laz+cX0kWeVl17avr5KP/l/1i+XfKqvfz9O+4sv//hP/4gipsFBNTNarMR1+vVeiWs/9JI0mK1entfLuHvj+w6"
    "1g71mkHz9urxLC52b58rCb2/GrvCd1nl+pdcSJKP9fHPf2n+0vy///6/f/idJw2utYlLRZNP8ubz8/LCpku3NYqPJEoOi2En"
    "v97Zxu23+AIZf0SNV7efkexZRzX0vZu8rXTvINriCQU7aUVeztr00XZsJ8U56s+5ECRn8wqPnztSxNfi+XHtt3q078uxOAr1"
    "lE+FbvLV+q0sjoZ1CJOP9Fy+yCjBTS8V7/K8s6+fEQrGMMvHomnLtbii4WviGDfVsQfLXch5vz4Gt6SVl958+puRSq+ycNa6"
    "aOn5Axu3lft61+9CvrqyfoNyxy4z+TXaXZ359PfdPfwsFvoH36un/f5jytj4YZz1w75fVq9AnON2Wb4HaFte59P1zI76j33Q"
    "Xt7Kt+ti6AsjjY+9Jb+MnblUt84ULi913q35E5Wa+djZh1QV5PygB7lZcm8hxrbkxVP0okp0H78/Tl390rF2Pr06JdVV+eAy"
    "DCt4THe2deLr2za1H3WQbQI9tPbWNhanV+NZu3GUrUtbvXx86relfFOsVhQU09Xuy/cs2XQKPavjOycvW/PZSE93qqK5nV4X"
    "64t/x9t7V11fCljpuGaWIC+dbfQiXTYv4vH47IyID03+xs/O6pXfxu1rTrd6Io79xyIkbyS77pCyFffB0n/ePbdH+1BQX2v8"
    "XJFN3dy1Ash/kS8/UZS/5N5lkfC3l6mprPl0f1kX9YJtKv+d1u+52r6n1/72WebmtYx7t1KFsqkUs7qPz6XuPMlOxqFAK2md"
    "HT2pZw17fJzPJjk6ksSd43v+2eKjErbPRmofn7Hnn+lo3k7652P6THvXExbiJSbB+WXFPFS9VmNzvdnP2ivy+Cwh32W+cpfP"
    "ja2Q8R50ySv5UHebaTqvXvsxLsYmKdL59Ju0aKjBFb/1Dk5+D7s3ye0+YrW8ucI5VQTxJL4dsvQK+ecpTSvG33V2UYdxq96l"
    "XFLdg+S82/cOvaaiqPH7lvmrxWufP4sZzVd1e8335mWT79ooeD9fD4jt3iaIjUZEzRvpr+SiblYDSM1//fEbb49WA+wAKflZ"
    "IKTNBu4DwtObQDp4/f9HLODK/pLn/mnK/35HkJzvqtbnx0vc59msp/C2+Pa+FoTFeik+0dtkJL/MqjdL3HwIp8z/tff9/3S+"
    "v/FN+En4SZzvNheePc/MH/Mf355i1HsGn14I/Tys9+hxNJce/oxe3+kS6cMpWJ1WFB0V4c8/bvBj5YvV2/JdWq3F+V+K/vZ/"
    "/gdkOVXGLigAAA=="
)
SIGNED_FIXTURE_BUNDLE_BYTES = gzip.decompress(
    base64.b64decode(_SIGNED_FIXTURE_BUNDLE_GZIP_B64, validate=True)
)
assert hashlib.sha256(SIGNED_FIXTURE_BUNDLE_BYTES).hexdigest() == SIGNED_FIXTURE_BUNDLE_SHA256


def load_distribution_builder():
    path = PROJECT / "scripts/deploy/signage-distribution-artifact.py"
    spec = importlib.util.spec_from_file_location("_stage2_distribution_builder", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(spec.name, None)
    return module


class FixtureAcquisition:
    """External OCI transport fixture; core still verifies every acquired byte."""

    def __init__(self, artifact: Path, descriptor: Path, *, digest: str = OCI_DIGEST):
        self.artifact = artifact
        self.descriptor = descriptor
        self.digest = digest
        self.events: list[str] = []

    def acquire(self, artifact_ref: str, directory: Path) -> dict[str, object]:
        self.events.append(f"acquire:{artifact_ref}")
        target_artifact = directory / "signage-release.tar"
        target_descriptor = directory / "signage-release-descriptor.json"
        shutil.copyfile(self.artifact, target_artifact)
        shutil.copyfile(self.descriptor, target_descriptor)
        return {
            "artifactPath": target_artifact,
            "descriptorPath": target_descriptor,
            "ociDigest": self.digest,
        }


class FixtureAttestor:
    """Signature transport fixture returning the statement the verifier must bind."""

    def __init__(self, statement: dict[str, object]):
        self.statement = statement
        self.events: list[str] = []

    def verify(
        self,
        artifact_ref: str,
        exact_reference: str,
        source_sha: str,
    ) -> dict[str, object]:
        self.events.append(f"attest:{exact_reference}:{source_sha}")
        return copy.deepcopy(self.statement)


def attestation_statement(descriptor: dict[str, object]) -> dict[str, object]:
    return {
        "_type": stage.STATEMENT_TYPE,
        "subject": [
            {
                "name": "ghcr.io/denkoushi/raspisys-pi3-signage",
                "digest": {"sha256": OCI_DIGEST.removeprefix("sha256:")},
            }
        ],
        "predicateType": stage.PREDICATE_TYPE,
        "predicate": {
            "schemaVersion": 1,
            "artifactKind": "pi3-signage-release",
            "sourceSha": descriptor["sourceSha"],
            "artifactSha256": descriptor["artifactSha256"],
            "manifestSha256": descriptor["manifestSha256"],
        },
    }


class FakeHttpResponse:
    def __init__(self, payload: bytes, headers: dict[str, str] | None = None):
        self.payload = payload
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, amount: int = -1) -> bytes:
        return self.payload if amount < 0 else self.payload[:amount]


def oci_layer(name: str, payload: bytes) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        member = tarfile.TarInfo(name)
        member.type = tarfile.REGTYPE
        member.mode = 0o600
        member.uid = 0
        member.gid = 0
        member.mtime = 0
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))
    return gzip.compress(buffer.getvalue(), mtime=0)


def rewrite_tar_member(artifact: Path, name: str, payload: bytes) -> None:
    with tarfile.open(artifact, "r:") as archive:
        members = []
        for member in archive.getmembers():
            stream = archive.extractfile(member)
            assert stream is not None
            members.append((member, payload if member.name == name else stream.read()))
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for original, value in members:
            member = copy.copy(original)
            member.size = len(value)
            archive.addfile(member, io.BytesIO(value))
    artifact.write_bytes(output.getvalue())


class SignageArtifactStageE2E(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.controller = self.root / "controller"
        self.controller.mkdir()
        self.source_artifact = self.root / "source.tar"
        self.source_descriptor = self.root / "source.json"
        builder = load_distribution_builder()
        self.descriptor = builder.build_artifact(
            PROJECT,
            self.source_artifact,
            self.source_descriptor,
            source_sha=SOURCE_SHA,
        )
        self.stage_root = self.root / "target-stage"
        self.stage_root.mkdir(mode=0o711)
        self.target = {
            "host": HOST,
            "profile": "signage",
            "address": "127.0.0.1",
            "user": "pi",
            "port": 22,
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def transport(self, **kwargs):
        return stage.LocalFilesystemTransport(
            allowed_staging_root=self.stage_root,
            verifier_source=VERIFIER_SOURCE,
            **kwargs,
        )

    def execute(
        self,
        *,
        retain: bool,
        acquisition: FixtureAcquisition | None = None,
        attestor: FixtureAttestor | None = None,
        transport=None,
        run_id: str = RUN_ID,
        release_authority: dict[str, object] | None = None,
    ) -> dict[str, object]:
        acquisition = acquisition or FixtureAcquisition(
            self.source_artifact, self.source_descriptor
        )
        attestor = attestor or FixtureAttestor(
            attestation_statement(self.descriptor)
        )
        return stage.acquire_and_stage(
            ARTIFACT_REF,
            self.target,
            run_id,
            self.stage_root,
            retain,
            acquisition=acquisition,
            attestor=attestor,
            transport=transport or self.transport(),
            verifier_source=VERIFIER_SOURCE,
            controller_root=self.controller,
            release_authority=release_authority,
        )

    def test_retain_false_runs_real_transfer_verify_promote_cleanup_and_zero_residue(self):
        transport = self.transport()

        report = self.execute(retain=False, transport=transport)

        self.assertEqual(report["status"], "passed")
        self.assertFalse(report["retain"])
        self.assertEqual(
            report["lifecycle"],
            [
                "acquired",
                "attested",
                "controller-verified",
                "target-prepared",
                "transferred",
                "temporary-verified",
                "atomically-promoted",
                "ready-verified",
                "cleaned",
            ],
        )
        self.assertEqual(report["artifact"]["sourceSha"], SOURCE_SHA)
        self.assertEqual(
            report["artifact"]["artifactSha256"],
            self.descriptor["artifactSha256"],
        )
        receipt = report["cleanupReceipt"]
        self.assertEqual(receipt["status"], "passed")
        self.assertIs(receipt["residue"], False)
        self.assertTrue(receipt["removedPaths"])
        self.assertEqual(receipt["residuePaths"], [])
        self.assertFalse(self.stage_root.joinpath(RUN_ID).exists())
        self.assertEqual(
            transport.events,
            ["prepare", "copy:signage-release.tar", "copy:signage-release-descriptor.json", "verify-temporary", "promote", "verify-ready", "cleanup"],
        )

    def test_digest_pinned_acquisition_rejects_tag_drift_before_target_prepare(self):
        acquisition = FixtureAcquisition(
            self.source_artifact,
            self.source_descriptor,
            digest="sha256:" + "e" * 64,
        )
        transport = self.transport()

        report = self.execute(
            retain=False,
            acquisition=stage.DigestPinnedAcquisition(acquisition, OCI_DIGEST),
            transport=transport,
        )

        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["failure"]["stage"], "acquisition")
        self.assertEqual(report["failure"]["code"], "oci-digest-mismatch")
        self.assertEqual(transport.events, [])
        self.assertFalse((self.stage_root / RUN_ID).exists())

    def test_digest_pinned_acquisition_uses_the_real_zero_residue_lifecycle(self):
        acquisition = stage.DigestPinnedAcquisition(
            FixtureAcquisition(self.source_artifact, self.source_descriptor),
            OCI_DIGEST,
        )
        transport = self.transport()

        report = self.execute(
            retain=False,
            acquisition=acquisition,
            transport=transport,
        )

        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["artifact"]["ociDigest"], OCI_DIGEST)
        self.assertEqual(report["lifecycle"][-1], "cleaned")
        self.assertFalse(report["cleanupReceipt"]["residue"])
        self.assertFalse((self.stage_root / RUN_ID).exists())

    def test_locked_release_mismatch_blocks_before_target_prepare(self):
        locked_release = {
            "releaseScope": "pi3-signage-artifact",
            "sourceSha": SOURCE_SHA,
            "exactReference": (
                "ghcr.io/denkoushi/raspisys-pi3-signage@" + OCI_DIGEST
            ),
            "ociDigest": OCI_DIGEST,
            "artifactSha256": self.descriptor["artifactSha256"],
            "manifestSha256": self.descriptor["manifestSha256"],
            "payloadDigest": self.descriptor["payloadDigest"],
            "claimIdentity": (
                f"git:{SOURCE_SHA}@sha256:{self.descriptor['artifactSha256']}"
            ),
        }
        replacements = {
            "sourceSha": "a" * 40,
            "artifactSha256": "a" * 64,
            "manifestSha256": "a" * 64,
            "payloadDigest": "a" * 64,
        }

        for index, (field, replacement) in enumerate(replacements.items()):
            with self.subTest(field=field):
                transport = self.transport()
                report = self.execute(
                    retain=False,
                    transport=transport,
                    run_id=f"20260806-1700{index:02d}-abcdef",
                    release_authority={**locked_release, field: replacement},
                )

                self.assertEqual(report["status"], "blocked")
                self.assertEqual(
                    report["failure"]["code"], "release-authority-mismatch"
                )
                self.assertEqual(transport.events, [])

        transport = self.transport()
        wrong_exact = "ghcr.io/denkoushi/raspisys-pi3-signage@sha256:" + "a" * 64
        report = stage.acquire_and_stage(
            wrong_exact,
            self.target,
            "20260806-170010-abcdef",
            self.stage_root,
            False,
            acquisition=FixtureAcquisition(
                self.source_artifact, self.source_descriptor
            ),
            attestor=FixtureAttestor(attestation_statement(self.descriptor)),
            transport=transport,
            verifier_source=VERIFIER_SOURCE,
            controller_root=self.controller,
            release_authority={
                **locked_release,
                "exactReference": wrong_exact,
                "ociDigest": "sha256:" + "a" * 64,
            },
        )
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["failure"]["code"], "release-authority-mismatch")
        self.assertEqual(transport.events, [])

    def test_dedicated_preflight_spec_requires_an_exact_oci_digest(self):
        payload = {
            "version": 1,
            "mode": "artifact-preflight",
            "artifactRef": ARTIFACT_REF,
            "expectedOciDigest": OCI_DIGEST,
            "runId": RUN_ID,
            "stagingRoot": str(stage.DEFAULT_STAGING_ROOT),
            "retain": False,
            "target": self.target,
            "configPath": str(stage.DEFAULT_CONFIG_PATH),
        }

        parsed = stage.parse_preflight_spec(json.dumps(payload))

        self.assertEqual(parsed, payload)
        payload["expectedOciDigest"] = "sha256:" + "z" * 64
        with self.assertRaisesRegex(stage.StageError, "digest"):
            stage.parse_preflight_spec(json.dumps(payload))

    def test_retain_true_leaves_the_same_verified_ready_bytes(self):
        transport = self.transport()

        report = self.execute(retain=True, transport=transport)

        self.assertEqual(report["status"], "passed")
        self.assertTrue(report["retain"])
        self.assertIsNone(report["cleanupReceipt"])
        ready = self.stage_root / RUN_ID / "ready"
        self.assertTrue(ready.is_dir())
        self.assertEqual(
            hashlib.sha256(ready.joinpath("signage-release.tar").read_bytes()).hexdigest(),
            self.descriptor["artifactSha256"],
        )
        verified = stage.target_verify_ready(
            stage.target_request(
                self.target,
                RUN_ID,
                self.stage_root,
                self.descriptor,
                OCI_DIGEST,
            ),
            allowed_staging_root=self.stage_root,
            verifier_source=VERIFIER_SOURCE,
        )
        self.assertEqual(verified["state"], "ready")

    def test_interrupted_transfer_cleans_partial_bytes_without_runtime_mutation(self):
        runtime_before = b"services=active\nmaintenance=off\ncurrent=legacy\n"
        runtime_after = bytearray(runtime_before)
        transport = self.transport(fail_copy_after=1)

        report = self.execute(retain=False, transport=transport)

        self.assertEqual(report["status"], "incomplete")
        self.assertEqual(report["failure"]["code"], "transfer-copy")
        self.assertEqual(report["failure"]["stage"], "transfer")
        self.assertEqual(bytes(runtime_after), runtime_before)
        self.assertEqual(report["cleanupReceipt"]["status"], "passed")
        self.assertIs(report["cleanupReceipt"]["residue"], False)
        self.assertFalse(self.stage_root.joinpath(RUN_ID).exists())

    def test_in_transit_digest_change_is_rejected_before_atomic_promote(self):
        transport = self.transport(corrupt_copy_name="signage-release.tar")

        report = self.execute(retain=False, transport=transport)

        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["failure"]["code"], "target-verification")
        self.assertNotIn("promote", transport.events)
        self.assertEqual(report["cleanupReceipt"]["status"], "passed")
        self.assertIs(report["cleanupReceipt"]["residue"], False)

    def test_artifact_manifest_and_attestation_tampering_fail_before_promotion(self):
        cases: list[tuple[str, FixtureAcquisition, FixtureAttestor, str]] = []

        changed_artifact = self.root / "changed-artifact.tar"
        shutil.copyfile(self.source_artifact, changed_artifact)
        changed_artifact.write_bytes(changed_artifact.read_bytes() + b"changed")
        cases.append(
            (
                "artifact",
                FixtureAcquisition(changed_artifact, self.source_descriptor),
                FixtureAttestor(attestation_statement(self.descriptor)),
                "artifact-verification",
            )
        )

        changed_manifest = self.root / "changed-manifest.tar"
        changed_descriptor = self.root / "changed-manifest.json"
        shutil.copyfile(self.source_artifact, changed_manifest)
        shutil.copyfile(self.source_descriptor, changed_descriptor)
        rewrite_tar_member(changed_manifest, "SIGNAGE-ARTIFACT.json", b"{}\n")
        changed_descriptor_value = json.loads(changed_descriptor.read_text())
        changed_descriptor_value["artifactSha256"] = hashlib.sha256(
            changed_manifest.read_bytes()
        ).hexdigest()
        changed_descriptor_value["artifactSize"] = changed_manifest.stat().st_size
        changed_descriptor.write_text(
            json.dumps(changed_descriptor_value, sort_keys=True, separators=(",", ":")) + "\n"
        )
        cases.append(
            (
                "manifest",
                FixtureAcquisition(changed_manifest, changed_descriptor),
                FixtureAttestor(attestation_statement(changed_descriptor_value)),
                "artifact-verification",
            )
        )

        changed_statement = attestation_statement(self.descriptor)
        changed_statement["predicate"]["artifactSha256"] = "a" * 64
        cases.append(
            (
                "attestation",
                FixtureAcquisition(self.source_artifact, self.source_descriptor),
                FixtureAttestor(changed_statement),
                "attestation-verification",
            )
        )

        for index, (name, acquisition, attestor, code) in enumerate(cases, start=1):
            with self.subTest(name=name):
                transport = self.transport()
                report = self.execute(
                    retain=False,
                    acquisition=acquisition,
                    attestor=attestor,
                    transport=transport,
                    run_id=f"20260806-1600{index:02d}-abcde{index}",
                )
                self.assertEqual(report["status"], "blocked")
                self.assertEqual(report["failure"]["code"], code)
                self.assertNotIn("promote", transport.events)

    def test_path_traversal_symlink_and_existing_path_collisions_fail_closed(self):
        traversal = self.execute(retain=False, run_id="../escape")
        self.assertEqual(traversal["failure"]["code"], "request-validation")

        run_path = self.stage_root / RUN_ID
        run_path.symlink_to(self.root / "outside", target_is_directory=True)
        symlink = self.execute(retain=False)
        self.assertEqual(symlink["failure"]["code"], "staging-path")
        run_path.unlink()

        run_path.mkdir()
        collision = self.execute(retain=False)
        self.assertEqual(collision["failure"]["code"], "staging-path")
        self.assertTrue(run_path.is_dir())

    def test_atomic_promote_and_cleanup_failures_remain_distinct(self):
        promote = self.execute(
            retain=False,
            transport=self.transport(fail_promote=True),
        )
        self.assertEqual(promote["failure"]["code"], "atomic-promote")
        self.assertEqual(promote["cleanupReceipt"]["status"], "passed")

        cleanup = self.execute(
            retain=False,
            transport=self.transport(fail_cleanup=True),
            run_id="20260806-160001-abcdef",
        )
        self.assertEqual(cleanup["status"], "incomplete")
        self.assertEqual(cleanup["failure"]["code"], "cleanup-verification")
        self.assertEqual(cleanup["cleanupReceipt"]["status"], "failed")
        self.assertIsNot(cleanup["cleanupReceipt"]["residue"], False)

        self.stage_root = self.root / "target-stage-transfer-cleanup"
        self.stage_root.mkdir(mode=0o711)
        transfer_cleanup = self.execute(
            retain=False,
            transport=self.transport(fail_copy_after=1, fail_cleanup=True),
            run_id="20260806-160002-abcdef",
        )
        self.assertEqual(
            transfer_cleanup["failure"],
            {
                "stage": "cleanup",
                "code": "cleanup-verification",
                "primary": {"stage": "transfer", "code": "transfer-copy"},
            },
        )
        self.assertEqual(transfer_cleanup["cleanupReceipt"]["status"], "failed")


class GhcrAcquisitionContract(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        builder = load_distribution_builder()
        self.artifact = self.root / "artifact.tar"
        self.descriptor_path = self.root / "descriptor.json"
        builder.build_artifact(
            PROJECT,
            self.artifact,
            self.descriptor_path,
            source_sha=SOURCE_SHA,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def fixture(self, *, corrupt_layer: bool = False):
        layers = [
            oci_layer("signage-release.tar", self.artifact.read_bytes()),
            oci_layer(
                "signage-release-descriptor.json",
                self.descriptor_path.read_bytes(),
            ),
        ]
        layer_descriptors = [
            {
                "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
                "digest": "sha256:" + hashlib.sha256(payload).hexdigest(),
                "size": len(payload),
            }
            for payload in layers
        ]
        manifest = json.dumps(
            {
                "schemaVersion": 2,
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "config": {
                    "mediaType": "application/vnd.oci.image.config.v1+json",
                    "digest": "sha256:" + "1" * 64,
                    "size": 2,
                },
                "layers": layer_descriptors,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        manifest_digest = "sha256:" + hashlib.sha256(manifest).hexdigest()
        index = json.dumps(
            {
                "schemaVersion": 2,
                "mediaType": "application/vnd.oci.image.index.v1+json",
                "manifests": [
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": manifest_digest,
                        "size": len(manifest),
                        "platform": {
                            "architecture": "arm",
                            "os": "linux",
                            "variant": "v7",
                        },
                    },
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": "sha256:" + "2" * 64,
                        "size": 123,
                        "platform": {"architecture": "unknown", "os": "unknown"},
                    },
                ],
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        index_digest = "sha256:" + hashlib.sha256(index).hexdigest()
        responses = {
            "https://ghcr.io/token?service=ghcr.io&scope=repository%3Adenkoushi%2Fraspisys-pi3-signage%3Apull": FakeHttpResponse(
                b'{"token":"fixture-bearer"}'
            ),
            f"https://ghcr.io/v2/denkoushi/raspisys-pi3-signage/manifests/{SOURCE_SHA}": FakeHttpResponse(
                index, {"Docker-Content-Digest": index_digest}
            ),
            f"https://ghcr.io/v2/denkoushi/raspisys-pi3-signage/manifests/{index_digest}": FakeHttpResponse(
                index, {"Docker-Content-Digest": index_digest}
            ),
            f"https://ghcr.io/v2/denkoushi/raspisys-pi3-signage/manifests/{manifest_digest}": FakeHttpResponse(
                manifest, {"Docker-Content-Digest": manifest_digest}
            ),
        }
        for descriptor, payload in zip(layer_descriptors, layers):
            responses[
                "https://ghcr.io/v2/denkoushi/raspisys-pi3-signage/blobs/"
                + descriptor["digest"]
            ] = FakeHttpResponse(
                payload + (b"corrupt" if corrupt_layer and payload is layers[0] else b"")
            )

        def opener(request, timeout):
            self.assertIn(timeout, {30, 60})
            response = responses.get(request.full_url)
            if response is None:
                raise AssertionError(f"unexpected registry request: {request.full_url}")
            return response

        return opener, index_digest

    def test_real_oci_index_manifest_layers_are_resolved_and_extracted(self):
        opener, index_digest = self.fixture()
        destination = self.root / "download"
        destination.mkdir()
        acquisition = stage.GhcrAcquisition(
            {"username": "denkoushi", "token": "fixture-token"},
            opener=opener,
        )

        result = acquisition.acquire(ARTIFACT_REF, destination)

        self.assertEqual(result["ociDigest"], index_digest)
        self.assertEqual(
            Path(result["artifactPath"]).read_bytes(), self.artifact.read_bytes()
        )
        self.assertEqual(
            Path(result["descriptorPath"]).read_bytes(),
            self.descriptor_path.read_bytes(),
        )

    def test_exact_reference_is_the_registry_selector(self):
        opener, index_digest = self.fixture()
        destination = self.root / "download-exact"
        destination.mkdir()
        acquisition = stage.GhcrAcquisition(
            {"username": "denkoushi", "token": "fixture-token"},
            opener=opener,
        )

        result = acquisition.acquire(
            f"{stage.ARTIFACT_REPOSITORY}@{index_digest}", destination
        )

        self.assertEqual(result["ociDigest"], index_digest)
        self.assertEqual(
            Path(result["artifactPath"]).read_bytes(), self.artifact.read_bytes()
        )

    def test_layer_digest_mismatch_is_rejected_before_target_transfer(self):
        opener, _index_digest = self.fixture(corrupt_layer=True)
        destination = self.root / "download"
        destination.mkdir()
        acquisition = stage.GhcrAcquisition(
            {"username": "denkoushi", "token": "fixture-token"},
            opener=opener,
        )

        with self.assertRaisesRegex(stage.StageError, "blob digest"):
            acquisition.acquire(ARTIFACT_REF, destination)

    def test_existing_gh_verifier_command_binds_custom_predicate_and_source(self):
        descriptor = json.loads(self.descriptor_path.read_text())
        statement = attestation_statement(descriptor)
        output = json.dumps(
            [{
                "verificationResult": {
                    "statement": statement,
                    "signature": {
                        "certificate": {
                            "certificateIssuer": "CN=sigstore-intermediate,O=sigstore.dev",
                            "subjectAlternativeName": stage.SIGNER_IDENTITY,
                            "issuer": stage.OIDC_ISSUER,
                            "githubWorkflowSHA": SOURCE_SHA,
                            "githubWorkflowRepository": stage.SOURCE_REPOSITORY,
                            "githubWorkflowRef": "refs/heads/main",
                            "buildSignerURI": stage.SIGNER_IDENTITY,
                            "runnerEnvironment": "github-hosted",
                            "sourceRepositoryURI": f"https://github.com/{stage.SOURCE_REPOSITORY}",
                            "sourceRepositoryDigest": SOURCE_SHA,
                            "sourceRepositoryRef": "refs/heads/main",
                            "sourceRepositoryOwnerURI": "https://github.com/denkoushi",
                        }
                    },
                }
            }],
            sort_keys=True,
        )
        version = SimpleNamespace(returncode=0, stdout=stage.GH_VERSION + "\n")
        verified = SimpleNamespace(returncode=0, stdout=output)

        def run_command(command, **_kwargs):
            if command[1:] == ["--version"]:
                return version
            trusted_root = Path(command[command.index("--custom-trusted-root") + 1])
            self.assertEqual(
                hashlib.sha256(trusted_root.read_bytes()).hexdigest(),
                stage.TRUSTED_ROOT_SHA256,
            )
            return verified

        with patch.object(stage.subprocess, "run", side_effect=run_command) as run:
            result = stage.GhAttestor(
                {"username": "denkoushi", "token": "fixture-token"},
                gh="/usr/bin/gh",
            ).verify(
                ARTIFACT_REF,
                f"{stage.ARTIFACT_REPOSITORY}@{OCI_DIGEST}",
                SOURCE_SHA,
            )

        self.assertEqual(result, statement)
        self.assertEqual(run.call_count, 2)
        command = run.call_args_list[1].args[0]
        self.assertIn("--bundle-from-oci", command)
        self.assertIn("--custom-trusted-root", command)
        self.assertIn("--deny-self-hosted-runners", command)
        self.assertEqual(command[command.index("--cert-identity") + 1], stage.SIGNER_IDENTITY)
        self.assertEqual(command[command.index("--cert-oidc-issuer") + 1], stage.OIDC_ISSUER)
        self.assertNotIn("--signer-workflow", command)
        self.assertEqual(command[command.index("--predicate-type") + 1], stage.PREDICATE_TYPE)
        self.assertEqual(command[command.index("--source-digest") + 1], SOURCE_SHA)
        self.assertEqual(command[command.index("--source-ref") + 1], "refs/heads/main")

    def test_gh_verifier_rejects_any_version_other_than_the_production_pin(self):
        completed = SimpleNamespace(returncode=0, stdout="2.95.0\n")
        with patch.object(stage.subprocess, "run", return_value=completed) as run:
            with self.assertRaisesRegex(stage.StageError, "pinned version"):
                stage.GhAttestor({}, gh="/usr/bin/gh").verify(
                    ARTIFACT_REF,
                    f"{stage.ARTIFACT_REPOSITORY}@{OCI_DIGEST}",
                    SOURCE_SHA,
                )

        self.assertEqual(run.call_count, 1)

    def test_gh_verifier_rejects_verified_output_with_wrong_certificate_identity(self):
        descriptor = json.loads(self.descriptor_path.read_text())
        output = json.dumps([{
            "verificationResult": {
                "statement": attestation_statement(descriptor),
                "signature": {
                    "certificate": {
                        "certificateIssuer": "CN=sigstore-intermediate,O=sigstore.dev",
                        "subjectAlternativeName": "https://github.com/attacker/repo/.github/workflows/ci.yml@refs/heads/main",
                        "issuer": stage.OIDC_ISSUER,
                        "githubWorkflowSHA": SOURCE_SHA,
                        "githubWorkflowRepository": stage.SOURCE_REPOSITORY,
                        "githubWorkflowRef": "refs/heads/main",
                        "runnerEnvironment": "github-hosted",
                    }
                },
            }
        }])
        results = [
            SimpleNamespace(returncode=0, stdout=stage.GH_VERSION + "\n"),
            SimpleNamespace(returncode=0, stdout=output),
        ]
        with patch.object(stage.subprocess, "run", side_effect=results):
            with self.assertRaisesRegex(stage.StageError, "identity"):
                stage.GhAttestor({}, gh="/usr/bin/gh").verify(
                    ARTIFACT_REF,
                    f"{stage.ARTIFACT_REPOSITORY}@{OCI_DIGEST}",
                    SOURCE_SHA,
                )


class ProductionAttestationBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.executable = os.environ.get("SIGNAGE_GH", "")
        if not cls.executable:
            raise unittest.SkipTest(
                "SIGNAGE_GH is required for the real trust-boundary test"
            )

    def gh(self) -> str:
        return self.executable

    def verify(self, *, source_sha: str = SIGNED_FIXTURE_SOURCE_SHA, digest: str = SIGNED_FIXTURE_OCI_DIGEST):
        exact_reference = f"{stage.ARTIFACT_REPOSITORY}@{digest}"
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory) / "public-good-main.bundle.json"
            bundle.write_bytes(SIGNED_FIXTURE_BUNDLE_BYTES)
            statement = stage.GhAttestor(
                {}, gh=self.gh(), bundle=bundle
            ).verify(
                f"{stage.ARTIFACT_REPOSITORY}:{source_sha}",
                exact_reference,
                source_sha,
            )
        stage.verify_attestation_statement(
            statement,
            exact_reference=exact_reference,
            descriptor={
                "sourceSha": SIGNED_FIXTURE_SOURCE_SHA,
                "artifactSha256": SIGNED_FIXTURE_ARTIFACT_SHA256,
                "manifestSha256": SIGNED_FIXTURE_MANIFEST_SHA256,
            },
        )

    def test_real_gh_verifies_the_frozen_public_good_bundle_and_policy(self):
        self.verify()

    def test_real_gh_rejects_tampered_issuer_repository_workflow_and_digest(self):
        attempts = (
            ("issuer", {"OIDC_ISSUER": "https://issuer.invalid"}, {}),
            ("repository", {"SOURCE_REPOSITORY": "attacker/repository"}, {}),
            ("workflow", {"SIGNER_IDENTITY": "https://github.com/attacker/repository/.github/workflows/ci.yml@refs/heads/main"}, {}),
            ("digest", {}, {"digest": "sha256:" + "0" * 64}),
        )
        for name, constants, arguments in attempts:
            policy_patch = patch.multiple(stage, **constants) if constants else nullcontext()
            with self.subTest(name=name), policy_patch:
                with self.assertRaises(stage.StageError):
                    self.verify(**arguments)


if __name__ == "__main__":
    unittest.main()
