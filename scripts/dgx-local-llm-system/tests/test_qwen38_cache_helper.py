import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
HELPER = MODULE_DIR / "prepare-qwen38-flash-next-cache.sh"
MODEL_REVISION = "model-revision-test"
IMAGE = "vllm/vllm-openai:qwen38-flash-next@sha256:test"


class Qwen38CacheHelperTests(unittest.TestCase):
    def _fixture(
        self,
        root: Path,
        *,
        start_contents: str = "#!/usr/bin/env bash\nexit 0\n",
    ) -> dict[str, str]:
        recipe = root / "recipe"
        recipe.mkdir()
        for name in ("download.sh", "start.sh"):
            path = recipe / name
            contents = start_contents if name == "start.sh" else "#!/usr/bin/env bash\nexit 0\n"
            path.write_text(contents, encoding="utf-8")
            path.chmod(0o755)
        (recipe / ".env").write_text("IMAGE=fixture\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(recipe), "init", "-q"], check=True)
        subprocess.run(["git", "-C", str(recipe), "config", "user.email", "test@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(recipe), "config", "user.name", "cache-helper-test"], check=True)
        subprocess.run(["git", "-C", str(recipe), "add", "."], check=True)
        subprocess.run(["git", "-C", str(recipe), "commit", "-qm", "fixture"], check=True)
        recipe_revision = subprocess.check_output(
            ["git", "-C", str(recipe), "rev-parse", "HEAD"], text=True
        ).strip()

        hf_cache = root / "hf-cache"
        model_dir = hf_cache / "hub" / "models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
        snapshot = model_dir / "snapshots" / MODEL_REVISION
        (model_dir / "refs").mkdir(parents=True)
        snapshot.mkdir(parents=True)
        (model_dir / "refs" / "main").write_text(MODEL_REVISION, encoding="utf-8")
        (snapshot / "model.safetensors.index.json").write_text(
            json.dumps({"weight_map": {"model.safetensors": "model.safetensors"}}),
            encoding="utf-8",
        )
        (snapshot / "model.safetensors").write_bytes(b"fixture")

        ple_dir = root / "home" / ".cache" / "vllm" / "ple_cache" / "Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
        ple_dir.mkdir(parents=True)
        (ple_dir / "fixture.packed_u8").write_bytes(b"fixture")

        return {
            "HOME": str(root / "home"),
            "BLUE_HF_CACHE_DIR": str(hf_cache),
            "BLUE_QWEN38_RECIPE_DIR": str(recipe),
            "BLUE_QWEN38_RECIPE_REVISION": recipe_revision,
            "BLUE_QWEN38_MODEL_REVISION": MODEL_REVISION,
            "BLUE_SERVER_IMAGE": IMAGE,
        }

    def test_verify_requires_upstream_preparation_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            env = {**os.environ, **self._fixture(root)}
            missing_marker = subprocess.run(
                [str(HELPER), "verify"], env=env, text=True, capture_output=True
            )
            self.assertNotEqual(missing_marker.returncode, 0)
            self.assertIn("ple_cache_ready=false", missing_marker.stdout)

            marker = (
                root
                / "home"
                / ".cache"
                / "vllm"
                / "ple_cache"
                / "Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
                / ".qwen38-flash-next-ple-ready"
            )
            marker.write_text(
                "recipe_revision=" + env["BLUE_QWEN38_RECIPE_REVISION"] + "\n"
                + f"model_revision={MODEL_REVISION}\n"
                + f"image={IMAGE}\n",
                encoding="utf-8",
            )
            verified = subprocess.run(
                [str(HELPER), "verify"], env=env, text=True, capture_output=True
            )
            self.assertEqual(verified.returncode, 0, verified.stderr)
            self.assertIn("ple_cache_ready=true upstream_prepare_recorded=true", verified.stdout)

    def test_verify_rejects_noncanonical_refs_main_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            env = {**os.environ, **self._fixture(root)}
            marker = (
                root
                / "home"
                / ".cache"
                / "vllm"
                / "ple_cache"
                / "Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
                / ".qwen38-flash-next-ple-ready"
            )
            marker.write_text(
                "recipe_revision=" + env["BLUE_QWEN38_RECIPE_REVISION"] + "\n"
                + f"model_revision={MODEL_REVISION}\n"
                + f"image={IMAGE}\n",
                encoding="utf-8",
            )
            refs = (
                root
                / "hf-cache"
                / "hub"
                / "models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
                / "refs"
                / "main"
            )
            refs.write_text(f"{MODEL_REVISION}\n", encoding="utf-8")
            rejected = subprocess.run(
                [str(HELPER), "verify"], env=env, text=True, capture_output=True
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("exact pinned revision", rejected.stderr)

    def test_prepare_ple_rejects_incomplete_pinned_snapshot_before_upstream(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            called = root / "prepare-called"
            env = {
                **os.environ,
                **self._fixture(
                    root,
                    start_contents='#!/usr/bin/env bash\nprintf called > "$PREPARE_CALLED"\nexit 0\n',
                ),
                "PREPARE_CALLED": str(called),
            }
            model_root = (
                root
                / "hf-cache"
                / "hub"
                / "models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
            )
            (model_root / "snapshots" / "other-complete").mkdir()
            (model_root / "snapshots" / "other-complete" / "model.safetensors.index.json").write_text(
                json.dumps({"weight_map": {"model.safetensors": "model.safetensors"}}),
                encoding="utf-8",
            )
            (model_root / "snapshots" / "other-complete" / "model.safetensors").write_bytes(b"fixture")
            (model_root / "snapshots" / MODEL_REVISION / "model.safetensors").unlink()

            rejected = subprocess.run(
                [str(HELPER), "prepare-ple"], env=env, text=True, capture_output=True
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("model snapshot incomplete", rejected.stderr)
            self.assertFalse(called.exists())

    def test_prepare_ple_forwards_enabled_upstream_speedups(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            capture = root / "prepare-capture"
            start = (
                "#!/usr/bin/env bash\n"
                "printf '%s|%s|%s|%s' \"$ABLIT\" \"$MAMBA_SSM_CACHE_DTYPE\" "
                "\"$MTP_DRAFT_VOCAB\" \"$EXTRA_DOCKER_ARGS\" > \"$PREPARE_CAPTURE\"\n"
                "exit 0\n"
            )
            env = {
                **os.environ,
                **self._fixture(root, start_contents=start),
                "PREPARE_CAPTURE": str(capture),
                "BLUE_EXTRA_DOCKER_ARGS": "--ipc host",
            }
            prepared = subprocess.run(
                [str(HELPER), "prepare-ple"], env=env, text=True, capture_output=True
            )
            self.assertEqual(prepared.returncode, 0, prepared.stderr)
            self.assertEqual(
                capture.read_text(encoding="utf-8"),
                "0|bfloat16|files/draft_vocab_en_code_47k.txt|--ipc host -e VLLM_USE_V2_MODEL_RUNNER=1",
            )

    def test_plan_reports_pinned_model_and_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            env = {**os.environ, **self._fixture(root)}
            planned = subprocess.run(
                [str(HELPER), "plan"], env=env, text=True, capture_output=True
            )
            self.assertEqual(planned.returncode, 0, planned.stderr)
            self.assertIn(f"revision={MODEL_REVISION}", planned.stdout)
            self.assertIn(f"image={IMAGE}", planned.stdout)

    def test_fetch_docker_fallback_uses_host_uid_for_cache_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            env = {**os.environ, **self._fixture(root)}
            refs = (
                root
                / "hf-cache"
                / "hub"
                / "models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
                / "refs"
            )
            shutil.rmtree(refs)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            docker_args = root / "docker-args"
            fake_docker = fake_bin / "docker"
            fake_docker.write_text(
                "#!/bin/sh\n"
                "printf '%s\\n' \"$@\" > \"$DOCKER_ARGS_LOG\"\n"
                "previous=''\n"
                "for argument in \"$@\"; do\n"
                "  if [ \"$previous\" = '--volume' ]; then volume=\"${argument%%:*}\"; fi\n"
                "  previous=\"$argument\"\n"
                "done\n"
                "mkdir -p \"$volume/hub/models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4/snapshots/model-revision-test\"\n"
                "printf '%s' '{\"weight_map\":{\"model.safetensors\":\"model.safetensors\"}}' > \"$volume/hub/models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4/snapshots/model-revision-test/model.safetensors.index.json\"\n"
                "printf '%s' fixture > \"$volume/hub/models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4/snapshots/model-revision-test/model.safetensors\"\n",
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)
            fake_python = fake_bin / "python3"
            fake_python.write_text(
                "#!/bin/sh\n"
                "case \"$*\" in\n"
                "  *huggingface_hub*) exit 1 ;;\n"
                "  *) exec /usr/bin/python3 \"$@\" ;;\n"
                "esac\n",
                encoding="utf-8",
            )
            fake_python.chmod(0o755)
            fake_df = fake_bin / "df"
            fake_df.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = '-Pk' ]; then\n"
                "  printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\n'\n"
                "  printf 'fixture 1000000000 0 500000000 0%% /\\n'\n"
                "else\n"
                "  exec /bin/df \"$@\"\n"
                "fi\n",
                encoding="utf-8",
            )
            fake_df.chmod(0o755)
            env.update(
                PATH=f"{fake_bin}:/usr/bin:/bin",
                DOCKER_ARGS_LOG=str(docker_args),
            )
            fetched = subprocess.run(
                [str(HELPER), "fetch"], env=env, text=True, capture_output=True
            )
            self.assertEqual(fetched.returncode, 0, fetched.stderr)
            self.assertEqual(
                (refs / "main").read_bytes(), MODEL_REVISION.encode("utf-8")
            )
            docker_argv = docker_args.read_text(encoding="utf-8").splitlines()
            self.assertIn("--user", docker_argv)
            user_index = docker_argv.index("--user")
            self.assertEqual(
                docker_argv[user_index + 1], f"{os.getuid()}:{os.getgid()}"
            )


if __name__ == "__main__":
    unittest.main()
