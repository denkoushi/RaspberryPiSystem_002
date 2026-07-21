from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.rolling_release import runtime_artifacts


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class RuntimeArtifactsTest(unittest.TestCase):
    def _project(self, root: Path) -> tuple[Path, dict[str, bytes]]:
        source = (
            Path(__file__).parents[3]
            / "infrastructure/ansible/files/stonebase-local-ansible/runtime-lock.json"
        )
        lock = json.loads(source.read_text(encoding="utf-8"))
        payloads: dict[str, bytes] = {}
        members = [
            lock["pythonDistribution"],
            *lock["pythonPackages"],
            lock["collections"]["community.general"],
        ]
        for index, member in enumerate(members):
            payload = f"sealed-{index}".encode("ascii")
            payloads[member["filename"]] = payload
            member["source"] = f"https://files.pythonhosted.org/{index}/{member['filename']}"
            member["size"] = len(payload)
            member["sha256"] = hashlib.sha256(payload).hexdigest()
        lock_path = root / runtime_artifacts.LOCK_RELATIVE
        lock_path.parent.mkdir(parents=True)
        lock_path.write_text(json.dumps(lock), encoding="utf-8")
        requirements = "\n".join(
            f"{package['name']}=={package['version']} --hash=sha256:{package['sha256']}"
            for package in lock["pythonPackages"]
        )
        (root / runtime_artifacts.REQUIREMENTS_RELATIVE).write_text(
            requirements + "\n", encoding="utf-8"
        )
        return root, payloads

    def test_prefetch_is_atomic_digest_bound_and_reuses_valid_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project, payloads = self._project(root / "project")
            cache = root / "cache"
            calls = []

            def opener(request, **_kwargs):
                calls.append(request.full_url)
                filename = request.full_url.rsplit("/", 1)[-1]
                return _Response(payloads[filename])

            first = runtime_artifacts.prefetch_runtime_artifacts(
                project, cache_root=cache, opener=opener, retries=1
            )
            self.assertEqual(first["receipt"]["memberCount"], 11)
            self.assertEqual(first["receipt"]["downloaded"], 11)
            self.assertEqual(len(calls), 11)
            self.assertNotIn("sourcePath", json.dumps(first["receipt"]))
            manifest = json.loads(
                Path(first["ansibleVarsPath"]).read_text(encoding="utf-8")
            )
            self.assertEqual(
                len(manifest["stonebase_local_runtime_cache"]["members"]), 11
            )

            second = runtime_artifacts.prefetch_runtime_artifacts(
                project,
                cache_root=cache,
                opener=lambda *_args, **_kwargs: self.fail("network used"),
                retries=1,
            )
            self.assertEqual(second["receipt"]["cacheHits"], 11)
            self.assertEqual(second["receipt"]["downloaded"], 0)

    def test_prefetch_rejects_digest_mismatch_without_ready_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project, _payloads = self._project(root / "project")
            cache = root / "cache"
            with self.assertRaisesRegex(
                runtime_artifacts.RuntimeArtifactError, "python-distribution"
            ):
                runtime_artifacts.prefetch_runtime_artifacts(
                    project,
                    cache_root=cache,
                    opener=lambda *_args, **_kwargs: _Response(b"tampered"),
                    retries=1,
                )
            self.assertEqual(list(cache.rglob("ansible-vars.json")), [])

    def test_prefetch_rejects_symlink_or_extra_cache_member(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project, payloads = self._project(root / "project")
            cache = root / "cache"

            def opener(request, **_kwargs):
                return _Response(payloads[request.full_url.rsplit("/", 1)[-1]])

            prepared = runtime_artifacts.prefetch_runtime_artifacts(
                project, cache_root=cache, opener=opener, retries=1
            )
            cache_dir = Path(prepared["ansibleVarsPath"]).parent
            (cache_dir / "unexpected").write_bytes(b"unexpected")
            with self.assertRaisesRegex(
                runtime_artifacts.RuntimeArtifactError, "unexpected members"
            ):
                runtime_artifacts.prefetch_runtime_artifacts(
                    project, cache_root=cache, opener=opener, retries=1
                )
            (cache_dir / "unexpected").unlink()
            victim = next(
                path
                for path in cache_dir.iterdir()
                if path.name != "ansible-vars.json"
            )
            victim.unlink()
            victim.symlink_to("/etc/passwd")
            with self.assertRaises(runtime_artifacts.RuntimeArtifactError):
                runtime_artifacts.prefetch_runtime_artifacts(
                    project, cache_root=cache, opener=opener, retries=1
                )
            self.assertTrue(os.path.islink(victim))

    def test_prefetch_rejects_unsafe_member_name_before_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project, _payloads = self._project(root / "project")
            lock_path = project / runtime_artifacts.LOCK_RELATIVE
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            lock["pythonPackages"][0]["filename"] = ".hidden.whl"
            lock_path.write_text(json.dumps(lock), encoding="utf-8")
            with self.assertRaisesRegex(
                runtime_artifacts.RuntimeArtifactError,
                "lock member is invalid",
            ):
                runtime_artifacts.prefetch_runtime_artifacts(
                    project,
                    cache_root=root / "cache",
                    opener=lambda *_args, **_kwargs: self.fail("network used"),
                    retries=1,
                )


if __name__ == "__main__":
    unittest.main()
