import os
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
ADAPTER = MODULE_DIR / "qwen38-flash-next-adapter.sh"


class Qwen38FlashAdapterTests(unittest.TestCase):
    def test_profile_adapter_keeps_existing_container_noop(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_bin = Path(tmp) / "bin"
            fake_bin.mkdir()
            (fake_bin / "docker").write_text(
                "#!/usr/bin/env bash\n"
                "if [[ \"$1\" == ps ]]; then printf '%s\\n' system-prod-trtllm; fi\n",
                encoding="utf-8",
            )
            (fake_bin / "docker").chmod(0o755)
            env = {
                **os.environ,
                "PATH": f"{fake_bin}:{os.environ['PATH']}",
                "BLUE_SERVER_ADAPTER": "qwen38_flash_next",
                "BLUE_SERVER_MODE": "container",
                "BLUE_CONTAINER_NAME": "system-prod-trtllm",
                "BLUE_SERVER_LOG_PATH": str(Path(tmp) / "server.log"),
            }
            result = subprocess.run(
                ["bash", str(MODULE_DIR / "start-trtllm-server.sh")],
                env=env,
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0)
            self.assertIn("already running container=system-prod-trtllm", result.stdout)

    def test_adapter_forwards_local_cache_profile_to_pinned_recipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            recipe = root / "recipe"
            recipe.mkdir()
            (recipe / ".env").write_text("IMAGE=unused\n", encoding="utf-8")
            capture = root / "capture"
            (recipe / "start.sh").write_text(
                "#!/usr/bin/env bash\n"
                "printf '%s\\n' \"$TP1_MODEL_ID|$TP1_CONTAINER_NAME|$IMAGE|$SERVED_MODEL_NAME|$HF_HOME|$PORT|$MAX_MODEL_LEN|$MAX_NUM_SEQS|$MAX_NUM_BATCHED_TOKENS|$KV_CACHE_DTYPE|$PLE_OFFLOAD|$COMPILATION_MODE|$EXTRA_DOCKER_ARGS\" > \"$CAPTURE\"\n",
                encoding="utf-8",
            )
            (recipe / "start.sh").chmod(0o755)
            subprocess.run(["git", "-C", str(recipe), "init", "-q"], check=True)
            subprocess.run(["git", "-C", str(recipe), "config", "user.email", "test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(recipe), "config", "user.name", "adapter-test"], check=True)
            subprocess.run(["git", "-C", str(recipe), "add", "."], check=True)
            subprocess.run(["git", "-C", str(recipe), "commit", "-qm", "fixture"], check=True)
            revision = subprocess.check_output(["git", "-C", str(recipe), "rev-parse", "HEAD"], text=True).strip()

            model_dir = root / "hf-cache" / "hub" / "models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
            (model_dir / "refs").mkdir(parents=True)
            (model_dir / "snapshots" / "snapshot-test").mkdir(parents=True)
            (model_dir / "refs" / "main").write_text("snapshot-test\n", encoding="utf-8")
            env = {
                "BLUE_SERVER_MODE": "container",
                "BLUE_CONTAINER_NAME": "system-prod-trtllm",
                "BLUE_SERVER_PORT": "38083",
                "BLUE_HF_CACHE_DIR": str(root / "hf-cache"),
                "BLUE_MODEL_DIR": str(model_dir),
                "BLUE_SERVER_IMAGE": "vllm/vllm-openai:qwen38-flash-next",
                "BLUE_QWEN38_MODEL_REVISION": "snapshot-test",
                "BLUE_QWEN38_RECIPE_DIR": str(recipe),
                "BLUE_QWEN38_RECIPE_REVISION": revision,
                "VLLM_SERVED_MODEL_NAME": "system-prod-primary",
                "VLLM_MAX_MODEL_LEN": "262144",
                "VLLM_MAX_NUM_SEQS": "4",
                "VLLM_MAX_NUM_BATCHED_TOKENS": "2048",
                "VLLM_KV_CACHE_DTYPE": "fp8",
                "BLUE_EXTRA_DOCKER_ARGS": "--ipc host",
                "CAPTURE": str(capture),
            }
            subprocess.run([str(ADAPTER)], check=True, env={**os.environ, **env})
            self.assertEqual(
                capture.read_text(encoding="utf-8").strip(),
                "Mia-AiLab/Qwen3.8-Flash-Next-NVFP4|system-prod-trtllm|"
                "vllm/vllm-openai:qwen38-flash-next|system-prod-primary|"
                f"{root / 'hf-cache'}|38083|262144|4|2048|fp8|true|0|--ipc host",
            )

    def test_adapter_requires_clean_pinned_recipe_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            recipe = Path(tmp) / "recipe"
            recipe.mkdir()
            model_dir = Path(tmp) / "models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
            (model_dir / "refs").mkdir(parents=True)
            (model_dir / "snapshots" / "snapshot-test").mkdir(parents=True)
            (model_dir / "refs" / "main").write_text("snapshot-test\n", encoding="utf-8")
            env = {
                **os.environ,
                "BLUE_MODEL_DIR": str(model_dir),
                "BLUE_SERVER_IMAGE": "vllm/vllm-openai:qwen38-flash-next",
                "BLUE_QWEN38_MODEL_REVISION": "snapshot-test",
                "BLUE_QWEN38_RECIPE_DIR": str(recipe),
            }
            result = subprocess.run([str(ADAPTER)], env=env, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("checkout is unavailable", result.stderr)


if __name__ == "__main__":
    unittest.main()
