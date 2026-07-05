import os
import shlex
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from vllm_command_builder import build_command, build_vllm_argv, resolve_model_path  # noqa: E402


def make_hf_cache(root: Path, snapshot: str = "abc123") -> Path:
    (root / "refs").mkdir(parents=True)
    (root / "snapshots" / snapshot).mkdir(parents=True)
    (root / "refs" / "main").write_text(snapshot, encoding="utf-8")
    return root / "snapshots" / snapshot


class VllmCommandBuilderTests(unittest.TestCase):
    def test_resolves_huggingface_snapshot_from_refs_main(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "models--sakamakismile--Qwen3.6-27B-NVFP4"
            snapshot_path = make_hf_cache(root)
            self.assertEqual(resolve_model_path(str(root)), str(snapshot_path))

    def test_qwen_command_includes_quantization_and_language_model_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "models--sakamakismile--Qwen3.6-27B-NVFP4"
            snapshot_path = make_hf_cache(root)
            env = {
                "BLUE_MODEL_DIR": str(root),
                "VLLM_SERVED_MODEL_NAME": "system-prod-primary",
                "VLLM_QUANTIZATION": "compressed-tensors",
                "VLLM_LANGUAGE_MODEL_ONLY": "true",
                "VLLM_MAX_MODEL_LEN": "16384",
                "VLLM_MOE_BACKEND": "marlin",
                "VLLM_ENABLE_CHUNKED_PREFILL": "false",
            }
            with patch.dict(os.environ, env, clear=True):
                command = build_command()
            parts = shlex.split(command)
            self.assertIn(str(snapshot_path), parts)
            self.assertIn("--quantization", parts)
            self.assertIn("compressed-tensors", parts)
            self.assertIn("--hf-overrides", parts)
            self.assertTrue(any('"language_model_only": true' in part for part in parts))
            self.assertIn("--moe-backend", parts)
            self.assertIn("marlin", parts)
            self.assertNotIn("--enable-chunked-prefill", parts)
            self.assertIn("VLLM_MARLIN_USE_ATOMIC_ADD=1", command)

    def test_marlin_atomic_add_and_moe_backend_in_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "models--test"
            make_hf_cache(root)
            env = {
                "BLUE_MODEL_DIR": str(root),
                "VLLM_MOE_BACKEND": "marlin",
                "VLLM_NVFP4_GEMM_BACKEND": "marlin",
            }
            with patch.dict(os.environ, env, clear=True):
                command = build_command()
            self.assertIn("VLLM_MARLIN_USE_ATOMIC_ADD=1", command)
            self.assertIn("VLLM_NVFP4_GEMM_BACKEND=marlin", command)
            parts = shlex.split(command)
            self.assertIn("--moe-backend", parts)
            self.assertIn("marlin", parts)

    def test_ornith_argv_omits_quantization_and_disables_custom_all_reduce(self):
        with patch.dict(
            os.environ,
            {
                "VLLM_SERVED_MODEL_NAME": "system-prod-primary",
                "VLLM_DISABLE_CUSTOM_ALL_REDUCE": "true",
                "VLLM_MAX_MODEL_LEN": "8192",
                "VLLM_MAX_NUM_SEQS": "4",
                "VLLM_MAX_NUM_BATCHED_TOKENS": "16384",
                "VLLM_GPU_MEMORY_UTILIZATION": "0.65",
                "VLLM_KV_CACHE_DTYPE": "fp8",
            },
            clear=True,
        ):
            argv = build_vllm_argv("/models/ornith")
        self.assertIn("--disable-custom-all-reduce", argv)
        self.assertNotIn("--quantization", argv)
        self.assertNotIn("--hf-overrides", argv)


if __name__ == "__main__":
    unittest.main()
