from __future__ import annotations

from model_profiles import ModelProfile

# manifest launcherHints key -> process env var name
_LAUNCHER_HINT_ENV_MAP: dict[str, str] = {
    "llamaServerModel": "LLAMA_SERVER_MODEL",
    "llamaServerMmproj": "LLAMA_SERVER_MMPROJ",
    "llamaServerAlias": "LLAMA_SERVER_ALIAS",
    "blueModelDir": "BLUE_MODEL_DIR",
    "blueServerImage": "BLUE_SERVER_IMAGE",
    "blueServerEntrypoint": "BLUE_SERVER_ENTRYPOINT",
    "blueServerMode": "BLUE_SERVER_MODE",
    # Fixed, profile-selected adapter.  This is an enum-like selector rather
    # than a command so a registry manifest cannot inject shell code.
    "blueServerAdapter": "BLUE_SERVER_ADAPTER",
    "blueUpstreamRecipeDir": "BLUE_QWEN38_RECIPE_DIR",
    "blueUpstreamRecipeRevision": "BLUE_QWEN38_RECIPE_REVISION",
    "blueModelRevision": "BLUE_QWEN38_MODEL_REVISION",
}

_VLLM_RUNTIME_ENV_MAP: dict[str, str] = {
    "modelPath": "VLLM_MODEL_PATH",
    "speculativeModel": "VLLM_SPECULATIVE_MODEL",
    "numSpeculativeTokens": "VLLM_NUM_SPECULATIVE_TOKENS",
    "mambaBackend": "VLLM_MAMBA_BACKEND",
    "mambaCacheMode": "VLLM_MAMBA_CACHE_MODE",
    "reasoningParser": "VLLM_REASONING_PARSER",
    "toolCallParser": "VLLM_TOOL_CALL_PARSER",
    "localSnapshotsOnly": "VLLM_LOCAL_SNAPSHOTS_ONLY",
    "gpuMemoryUtilization": "VLLM_GPU_MEMORY_UTILIZATION",
    "maxModelLen": "VLLM_MAX_MODEL_LEN",
    "maxNumSeqs": "VLLM_MAX_NUM_SEQS",
    "schedulingPolicy": "VLLM_SCHEDULING_POLICY",
    "maxNumBatchedTokens": "VLLM_MAX_NUM_BATCHED_TOKENS",
    "kvCacheDtype": "VLLM_KV_CACHE_DTYPE",
    "languageModelOnly": "VLLM_LANGUAGE_MODEL_ONLY",
    "quantization": "VLLM_QUANTIZATION",
    "disableCustomAllReduce": "VLLM_DISABLE_CUSTOM_ALL_REDUCE",
    "tensorParallelSize": "VLLM_TENSOR_PARALLEL_SIZE",
    "moeBackend": "VLLM_MOE_BACKEND",
    "nvfp4GemmBackend": "VLLM_NVFP4_GEMM_BACKEND",
    "attentionBackend": "VLLM_ATTENTION_BACKEND",
    "enableChunkedPrefill": "VLLM_ENABLE_CHUNKED_PREFILL",
    "enablePrefixCaching": "VLLM_ENABLE_PREFIX_CACHING",
}

_LLAMA_RUNTIME_ENV_MAP: dict[str, str] = {
    "ctxSize": "LLAMA_SERVER_CTX_SIZE",
    "parallel": "LLAMA_SERVER_PARALLEL",
    "nGpuLayers": "LLAMA_SERVER_N_GPU_LAYERS",
}


def _env_value(value: object) -> str | None:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def launcher_env_for_profile(profile: ModelProfile) -> dict[str, str]:
    """Profile manifest の launcherHints を start コマンド実行時の env 上書きに変換する。"""
    env: dict[str, str] = {}
    hints = profile.launcher_hints or {}
    for hint_key, env_key in _LAUNCHER_HINT_ENV_MAP.items():
        value = hints.get(hint_key)
        if value:
            env[env_key] = value
    runtime_profile = profile.runtime_profile or {}
    engine = _env_value(runtime_profile.get("engine"))
    if engine:
        env["DGX_RUNTIME_ENGINE"] = engine
    if profile.backend == "blue":
        env["VLLM_SERVED_MODEL_NAME"] = profile.served_alias
        # Profile-scoped blue launches must ignore legacy raw command overrides.
        # Otherwise BLUE_SERVER_COMMAND from the production env wins over BLUE_MODEL_DIR.
        env["BLUE_SERVER_COMMAND"] = ""
        env["TRTLLM_SERVER_COMMAND"] = ""
    memory_policy = _env_value(runtime_profile.get("memoryPolicy"))
    if memory_policy:
        env["DGX_MEMORY_POLICY"] = memory_policy

    vllm = runtime_profile.get("vllm")
    if isinstance(vllm, dict):
        if vllm.get("localSnapshotsOnly") is True:
            # Qwen-specific legacy JSON overrides must not change the pinned
            # Nemotron architecture. The manifest supplies its own paths and
            # parsers; no environment settings are persisted across starts.
            env["VLLM_HF_OVERRIDES"] = ""
        for key, env_key in _VLLM_RUNTIME_ENV_MAP.items():
            value = _env_value(vllm.get(key))
            if value is not None:
                env[env_key] = value

    llama = runtime_profile.get("llamaCpp")
    if isinstance(llama, dict):
        for key, env_key in _LLAMA_RUNTIME_ENV_MAP.items():
            value = _env_value(llama.get(key))
            if value is not None:
                env[env_key] = value
    return env
