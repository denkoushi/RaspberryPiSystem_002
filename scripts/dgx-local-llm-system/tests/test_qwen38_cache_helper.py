import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
HELPER = MODULE_DIR / "prepare-qwen38-flash-next-cache.sh"
MODEL_REVISION = "model-revision-test"
IMAGE = "vllm/vllm-openai:qwen38-flash-next@sha256:test"


class Qwen38CacheHelperTests(unittest.TestCase):
    def _fixture(self, root: Path) -> dict[str, str]:
        recipe = root / "recipe"
        recipe.mkdir()
        for name in ("download.sh", "start.sh"):
            path = recipe / name
            path.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
            path.chmod(0o755)
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
        (model_dir / "refs" / "main").write_text(f"{MODEL_REVISION}\n", encoding="utf-8")
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


if __name__ == "__main__":
    unittest.main()
