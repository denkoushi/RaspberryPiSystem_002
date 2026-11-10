"""GLM business runtime identity, matching glm53-flash-tp2-adapter.sh."""
import os
import re


def glm_runtime_config() -> tuple[str, int, str]:
    name = os.environ.get("BLUE_CONTAINER_NAME") or os.environ.get("TRTLLM_CONTAINER_NAME") or "system-prod-trtllm"
    port = os.environ.get("BLUE_SERVER_PORT") or os.environ.get("TRTLLM_SERVER_PORT") or "38083"
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", name):
        raise ValueError("invalid GLM container name")
    if not re.fullmatch(r"[1-9][0-9]{0,4}", port) or not 1 <= int(port) <= 65535:
        raise ValueError("invalid GLM server port")
    return name, int(port), "http://127.0.0.1:" + port
