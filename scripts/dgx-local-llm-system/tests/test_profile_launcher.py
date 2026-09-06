import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from model_profiles import load_model_profile_manifest  # noqa: E402
from profile_launcher import launcher_env_for_profile  # noqa: E402


class ProfileLauncherTests(unittest.TestCase):
    def test_business_qwen38_profile_selects_pinned_adapter_and_preserves_alias(self):
        manifest = MODULE_DIR / "model-registry.examples" / "business_qwen38_flash_next_nvfp4" / "manifest.json"
        profile = load_model_profile_manifest(manifest)
        env = launcher_env_for_profile(profile)
        self.assertEqual(profile.id, "business_qwen38_flash_next_nvfp4")
        self.assertEqual(profile.served_alias, "system-prod-primary")
        self.assertEqual(profile.declared_capabilities, ("text", "vision"))
        self.assertEqual(profile.legacy_names, ())
        self.assertEqual(env["BLUE_SERVER_ADAPTER"], "qwen38_flash_next")
        self.assertEqual(
            env["BLUE_MODEL_DIR"],
            "/srv/dgx/system-prod/data/hf-cache/hub/models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4",
        )
        self.assertEqual(
            env["BLUE_SERVER_IMAGE"],
            "vllm/vllm-openai:qwen38-flash-next@sha256:3b0e188ffceb3d07e09c3cb5215433a0020eacf02d7f882ed3a8bfd15454477e",
        )
        self.assertEqual(env["VLLM_SERVED_MODEL_NAME"], "system-prod-primary")
        self.assertEqual(env["VLLM_MAX_MODEL_LEN"], "262144")
        self.assertEqual(env["VLLM_MAX_NUM_SEQS"], "1")
        self.assertEqual(env["VLLM_SCHEDULING_POLICY"], "priority")
        self.assertEqual(env["VLLM_GPU_MEMORY_UTILIZATION"], "0.71")
        self.assertEqual(env["VLLM_KV_CACHE_DTYPE"], "fp8")
        self.assertEqual(env["BLUE_QWEN38_RECIPE_REVISION"], "09d4424be2b777818471b9bba8c7775ddd538833")
        self.assertEqual(env["BLUE_QWEN38_MODEL_REVISION"], "925d7be6c14c6c9442ef83e8f05b5a3c39304f69")
        self.assertEqual(env["BLUE_SERVER_COMMAND"], "")

    def test_legacy_business_profile_remains_a_rollback_target(self):
        manifest = MODULE_DIR / "model-registry.examples" / "business_qwen36_27b_nvfp4" / "manifest.json"
        profile = load_model_profile_manifest(manifest)
        env = launcher_env_for_profile(profile)
        self.assertEqual(profile.source_model_ref, "sakamakismile/Qwen3.6-27B-NVFP4")
        self.assertEqual(profile.served_alias, "system-prod-primary")
        self.assertNotIn("BLUE_SERVER_ADAPTER", env)

    def test_maps_launcher_hints_to_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "modelProfileId": "business_qwen35_35b_gguf",
                        "displayNameJa": "35B",
                        "backend": "green",
                        "servedAlias": "system-prod-primary",
                        "launcherHints": {
                            "llamaServerModel": "/srv/dgx/shared-models/llm/gguf/model.gguf",
                            "llamaServerMmproj": "/srv/dgx/shared-models/llm/gguf/mmproj-F16.gguf",
                        },
                    }
                ),
                encoding="utf-8",
            )
            profile = load_model_profile_manifest(manifest)
            env = launcher_env_for_profile(profile)
            self.assertEqual(env["LLAMA_SERVER_MODEL"], "/srv/dgx/shared-models/llm/gguf/model.gguf")
            self.assertEqual(env["LLAMA_SERVER_MMPROJ"], "/srv/dgx/shared-models/llm/gguf/mmproj-F16.gguf")

    def test_maps_runtime_profile_budget_to_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "modelProfileId": "business_qwen36_27b_nvfp4",
                        "displayNameJa": "27B",
                        "backend": "blue",
                        "servedAlias": "system-prod-primary",
                        "runtimeProfile": {
                            "engine": "vllm",
                            "memoryPolicy": "known_good_business_text_tools",
                            "vllm": {
                                "gpuMemoryUtilization": 0.65,
                                "maxModelLen": 16384,
                                "maxNumSeqs": 4,
                                "maxNumBatchedTokens": 16384,
                                "languageModelOnly": True,
                                "quantization": "compressed-tensors",
                                "disableCustomAllReduce": True,
                                "tensorParallelSize": 2,
                                "moeBackend": "marlin",
                                "nvfp4GemmBackend": "marlin",
                                "enableChunkedPrefill": False,
                                "enablePrefixCaching": True,
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )
            profile = load_model_profile_manifest(manifest)
            env = launcher_env_for_profile(profile)
            self.assertEqual(env["DGX_RUNTIME_ENGINE"], "vllm")
            self.assertEqual(env["DGX_MEMORY_POLICY"], "known_good_business_text_tools")
            self.assertEqual(env["VLLM_GPU_MEMORY_UTILIZATION"], "0.65")
            self.assertEqual(env["VLLM_MAX_MODEL_LEN"], "16384")
            self.assertEqual(env["VLLM_MAX_NUM_SEQS"], "4")
            self.assertEqual(env["VLLM_MAX_NUM_BATCHED_TOKENS"], "16384")
            self.assertEqual(env["VLLM_LANGUAGE_MODEL_ONLY"], "true")
            self.assertEqual(env["VLLM_QUANTIZATION"], "compressed-tensors")
            self.assertEqual(env["VLLM_DISABLE_CUSTOM_ALL_REDUCE"], "true")
            self.assertEqual(env["VLLM_TENSOR_PARALLEL_SIZE"], "2")
            self.assertEqual(env["VLLM_MOE_BACKEND"], "marlin")
            self.assertEqual(env["VLLM_NVFP4_GEMM_BACKEND"], "marlin")
            self.assertEqual(env["VLLM_ENABLE_CHUNKED_PREFILL"], "false")
            self.assertEqual(env["VLLM_ENABLE_PREFIX_CACHING"], "true")
            self.assertEqual(env["VLLM_SERVED_MODEL_NAME"], "system-prod-primary")
            self.assertEqual(env["BLUE_SERVER_COMMAND"], "")
            self.assertEqual(env["TRTLLM_SERVER_COMMAND"], "")


if __name__ == "__main__":
    unittest.main()
