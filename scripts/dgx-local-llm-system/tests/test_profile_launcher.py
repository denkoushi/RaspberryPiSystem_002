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
                                "maxModelLen": 8192,
                                "maxNumSeqs": 4,
                                "maxNumBatchedTokens": 16384,
                                "kvCacheDtype": "fp8",
                                "languageModelOnly": True,
                                "quantization": "compressed-tensors",
                                "disableCustomAllReduce": True,
                                "tensorParallelSize": 2,
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
            self.assertEqual(env["VLLM_MAX_MODEL_LEN"], "8192")
            self.assertEqual(env["VLLM_MAX_NUM_SEQS"], "4")
            self.assertEqual(env["VLLM_MAX_NUM_BATCHED_TOKENS"], "16384")
            self.assertEqual(env["VLLM_KV_CACHE_DTYPE"], "fp8")
            self.assertEqual(env["VLLM_LANGUAGE_MODEL_ONLY"], "true")
            self.assertEqual(env["VLLM_QUANTIZATION"], "compressed-tensors")
            self.assertEqual(env["VLLM_DISABLE_CUSTOM_ALL_REDUCE"], "true")
            self.assertEqual(env["VLLM_TENSOR_PARALLEL_SIZE"], "2")
            self.assertEqual(env["VLLM_SERVED_MODEL_NAME"], "system-prod-primary")
            self.assertEqual(env["BLUE_SERVER_COMMAND"], "")
            self.assertEqual(env["TRTLLM_SERVER_COMMAND"], "")


if __name__ == "__main__":
    unittest.main()
