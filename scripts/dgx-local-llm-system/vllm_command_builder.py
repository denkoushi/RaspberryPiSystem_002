from __future__ import annotations

import json
import os
import shlex
from pathlib import Path


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    return value.strip()


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _model_dir() -> str:
    model_dir = _env("BLUE_MODEL_DIR") or _env("TRTLLM_MODEL_DIR")
    if not model_dir:
        raise SystemExit("BLUE_MODEL_DIR/TRTLLM_MODEL_DIR is required when BLUE_SERVER_COMMAND is empty")
    return model_dir


def resolve_model_path(model_dir: str) -> str:
    explicit = _env("VLLM_MODEL_PATH")
    if explicit:
        return explicit

    root = Path(model_dir)
    refs_main = root / "refs" / "main"
    if refs_main.exists():
        snapshot = refs_main.read_text(encoding="utf-8").strip()
        if not snapshot:
            raise SystemExit(f"empty Hugging Face refs/main: {refs_main}")
        snapshot_path = root / "snapshots" / snapshot
        if not snapshot_path.exists():
            raise SystemExit(f"Hugging Face snapshot not found: {snapshot_path}")
        return str(snapshot_path)
    return str(root)


def _append_value(argv: list[str], flag: str, env_name: str, default: str | None = None) -> None:
    value = _env(env_name, default)
    if value is not None:
        argv.extend([flag, value])


def _append_bool(argv: list[str], flag: str, env_name: str, default: bool = False) -> None:
    value = _env(env_name)
    if _truthy(value) or (value is None and default):
        argv.append(flag)


def build_vllm_argv(model_path: str) -> list[str]:
    argv = ["vllm", "serve", model_path]
    _append_value(argv, "--served-model-name", "VLLM_SERVED_MODEL_NAME", "system-prod-primary")
    _append_value(argv, "--host", "VLLM_HOST", "0.0.0.0")
    _append_value(argv, "--port", "BLUE_SERVER_CONTAINER_PORT", _env("TRTLLM_SERVER_CONTAINER_PORT", "8000"))
    _append_value(argv, "--dtype", "VLLM_DTYPE", "auto")
    _append_value(argv, "--quantization", "VLLM_QUANTIZATION")
    _append_value(argv, "--tensor-parallel-size", "VLLM_TENSOR_PARALLEL_SIZE")
    _append_value(argv, "--max-model-len", "VLLM_MAX_MODEL_LEN")
    _append_value(argv, "--max-num-seqs", "VLLM_MAX_NUM_SEQS")
    _append_value(argv, "--max-num-batched-tokens", "VLLM_MAX_NUM_BATCHED_TOKENS")
    _append_value(argv, "--gpu-memory-utilization", "VLLM_GPU_MEMORY_UTILIZATION")
    _append_value(argv, "--kv-cache-dtype", "VLLM_KV_CACHE_DTYPE")
    _append_bool(argv, "--enable-chunked-prefill", "VLLM_ENABLE_CHUNKED_PREFILL", default=True)
    _append_bool(argv, "--enable-prefix-caching", "VLLM_ENABLE_PREFIX_CACHING", default=True)
    _append_value(argv, "--load-format", "VLLM_LOAD_FORMAT", "safetensors")
    _append_bool(argv, "--trust-remote-code", "VLLM_TRUST_REMOTE_CODE", default=True)
    _append_bool(argv, "--disable-custom-all-reduce", "VLLM_DISABLE_CUSTOM_ALL_REDUCE")
    _append_bool(argv, "--enable-auto-tool-choice", "VLLM_ENABLE_AUTO_TOOL_CHOICE", default=True)
    _append_value(argv, "--tool-call-parser", "VLLM_TOOL_CALL_PARSER", "qwen3_coder")
    _append_value(argv, "--reasoning-parser", "VLLM_REASONING_PARSER", "qwen3")

    hf_overrides = _env("VLLM_HF_OVERRIDES")
    if hf_overrides:
        argv.extend(["--hf-overrides", hf_overrides])
    elif _truthy(_env("VLLM_LANGUAGE_MODEL_ONLY")):
        argv.extend(["--hf-overrides", json.dumps({"language_model_only": True})])

    return argv


def build_command(model_dir: str | None = None) -> str:
    model_path = resolve_model_path(model_dir or _model_dir())
    exports = {
        "VLLM_ALLOW_LONG_MAX_MODEL_LEN": _env("VLLM_ALLOW_LONG_MAX_MODEL_LEN", "1"),
        "TORCH_MATMUL_PRECISION": _env("TORCH_MATMUL_PRECISION", "high"),
        "PYTORCH_CUDA_ALLOC_CONF": _env("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True"),
        "NVIDIA_FORWARD_COMPAT": _env("NVIDIA_FORWARD_COMPAT", "1"),
        "VLLM_TEST_FORCE_FP8_MARLIN": _env("VLLM_TEST_FORCE_FP8_MARLIN", "1"),
    }
    export_cmd = " && ".join(f"export {key}={shlex.quote(value)}" for key, value in exports.items() if value)
    serve_cmd = "exec " + shlex.join(build_vllm_argv(model_path))
    return f"{export_cmd} && {serve_cmd}" if export_cmd else serve_cmd


def main() -> None:
    print(build_command())


if __name__ == "__main__":
    main()
