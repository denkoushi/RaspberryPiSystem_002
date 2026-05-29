from __future__ import annotations

from model_profiles import ModelProfile

# manifest launcherHints key -> process env var name
_LAUNCHER_HINT_ENV_MAP: dict[str, str] = {
    "llamaServerModel": "LLAMA_SERVER_MODEL",
    "llamaServerMmproj": "LLAMA_SERVER_MMPROJ",
    "llamaServerAlias": "LLAMA_SERVER_ALIAS",
    "blueModelDir": "BLUE_MODEL_DIR",
    "blueServerImage": "BLUE_SERVER_IMAGE",
}


def launcher_env_for_profile(profile: ModelProfile) -> dict[str, str]:
    """Profile manifest の launcherHints を start コマンド実行時の env 上書きに変換する。"""
    env: dict[str, str] = {}
    hints = profile.launcher_hints or {}
    for hint_key, env_key in _LAUNCHER_HINT_ENV_MAP.items():
        value = hints.get(hint_key)
        if value:
            env[env_key] = value
    return env
