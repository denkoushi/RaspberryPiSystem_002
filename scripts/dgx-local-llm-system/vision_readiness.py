from __future__ import annotations

from pathlib import Path

from model_profiles import ModelProfile
from profile_capabilities import CAPABILITY_TEXT, CAPABILITY_VISION


def _read_tail(path: Path, max_bytes: int = 16_384) -> str:
    if not path.exists():
        return ""
    data = path.read_bytes()
    if len(data) > max_bytes:
        data = data[-max_bytes:]
    return data.decode("utf-8", errors="replace")


def _mmproj_from_launcher_context(
    profile: ModelProfile,
    start_env: dict[str, str] | None,
) -> bool:
    if start_env and (start_env.get("LLAMA_SERVER_MMPROJ") or "").strip():
        return True
    hints = profile.launcher_hints or {}
    return bool((hints.get("llamaServerMmproj") or "").strip())


def assess_runtime_readiness(
    profile: ModelProfile,
    *,
    llama_log_path: str = "/srv/dgx/system-prod/logs/llama-server.log",
    start_env: dict[str, str] | None = None,
) -> tuple[tuple[str, ...], str | None]:
    """
    宣言能力に対し、今回の起動で実際に ready とみなす能力を返す。
    戻り値: (runtime_ready_capabilities, vision_ready_reason)
    """
    declared = profile.declared_capabilities
    if CAPABILITY_VISION not in declared:
        return declared, None

    if profile.backend == "blue":
        return declared, "blue_native_vlm"

    if not profile.vision_requires_mmproj:
        return declared, "green_without_mmproj_requirement"

    if _mmproj_from_launcher_context(profile, start_env):
        return declared, "mmproj_configured"

    log_text = _read_tail(Path(llama_log_path))
    if "mmproj=" in log_text:
        return declared, "mmproj_detected"

    # vision 宣言はあるが mmproj 未検出
    text_only = tuple(cap for cap in declared if cap == CAPABILITY_TEXT)
    if not text_only:
        text_only = (CAPABILITY_TEXT,)
    return text_only, "mmproj_missing"
