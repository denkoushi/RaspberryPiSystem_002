#!/usr/bin/env python3
"""
DGX system-prod の VLM 単体疎通確認。

`RoutedVisionCompletionAdapter` が送る current `photo_label` payload と同形の
`/v1/chat/completions` を直接投げる。

使い方:
  python3 ./probe-photo-label-vlm.py /path/to/image.jpg

主な環境変数:
  LLM_BASE_URL                既定: http://127.0.0.1:38081
  LLM_SHARED_TOKEN            必須
  LLM_MODEL                   既定: system-prod-primary
  PHOTO_LABEL_USER_PROMPT     既定: アプリ既定 prompt と同文
  PHOTO_LABEL_MAX_TOKENS      既定: 64
  PHOTO_LABEL_TEMPERATURE     既定: 0.2
  PHOTO_LABEL_TIMEOUT_MS      既定: 120000
  PHOTO_LABEL_MIME_TYPE       既定: image/jpeg
  LLM_RUNTIME_CONTROL_TOKEN   `/start` `/stop` を使う場合に必須
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_USER_PROMPT = (
    "画像の中で最も目立つ工具を1つだけ選び、日本語の短い工具名だけを答えてください。"
    "説明文や句読点は不要です。"
)


def env_str(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None:
        return default
    value = value.strip()
    return value if value else default


def env_int(name: str, default: int) -> int:
    raw = env_str(name)
    if raw is None:
        return default
    return int(raw)


def env_float(name: str, default: float) -> float:
    raw = env_str(name)
    if raw is None:
        return default
    return float(raw)


def request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout_sec: float = 120,
) -> tuple[int, bytes, str]:
    req = urllib.request.Request(url, data=body if method != "GET" else None, method=method)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as response:
            return (
                response.status,
                response.read(),
                response.headers.get("Content-Type", "application/octet-stream"),
            )
    except urllib.error.HTTPError as exc:
        return (
            exc.code,
            exc.read(),
            exc.headers.get("Content-Type", "text/plain; charset=utf-8"),
        )


def wait_until_ready(
    base_url: str,
    shared_token: str,
    timeout_sec: float,
    poll_sec: float,
) -> None:
    deadline = time.monotonic() + timeout_sec
    models_url = f"{base_url.rstrip('/')}/v1/models"
    headers = {"X-LLM-Token": shared_token}
    last_detail = "not ready"
    while time.monotonic() < deadline:
        try:
            status, body, _ = request("GET", models_url, headers=headers, timeout_sec=min(poll_sec + 2, 10))
            if status == 200:
                return
            last_detail = f"status={status} body={body.decode('utf-8', errors='replace')[:300]}"
        except Exception as exc:  # pragma: no cover
            last_detail = str(exc)
        time.sleep(poll_sec)
    raise RuntimeError(f"/v1/models ready timeout: {last_detail}")


def extract_assistant_text(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    message = first.get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str):
        trimmed = content.strip()
        return trimmed or None
    if isinstance(content, list):
        texts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    texts.append(text.strip())
        return "\n".join(texts) if texts else None
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe current photo_label payload against a VLM endpoint")
    parser.add_argument("image_path", help="JPEG/PNG などの入力画像 path")
    parser.add_argument("--start-runtime", action="store_true", help="先に /start を叩いて ready 待ちする")
    parser.add_argument("--stop-runtime", action="store_true", help="終了時に /stop を叩く")
    parser.add_argument(
        "--ready-timeout-sec",
        type=float,
        default=90.0,
        help="/start 後に /v1/models ready を待つ秒数",
    )
    parser.add_argument(
        "--ready-poll-sec",
        type=float,
        default=2.0,
        help="/v1/models ready poll 間隔",
    )
    args = parser.parse_args()

    base_url = env_str("LLM_BASE_URL", "http://127.0.0.1:38081")
    shared_token = env_str("LLM_SHARED_TOKEN")
    model = env_str("LLM_MODEL", "system-prod-primary")
    runtime_control_token = env_str("LLM_RUNTIME_CONTROL_TOKEN")
    user_prompt = env_str("PHOTO_LABEL_USER_PROMPT", DEFAULT_USER_PROMPT)
    max_tokens = env_int("PHOTO_LABEL_MAX_TOKENS", 64)
    temperature = env_float("PHOTO_LABEL_TEMPERATURE", 0.2)
    timeout_ms = env_int("PHOTO_LABEL_TIMEOUT_MS", 120_000)

    if not shared_token:
        print("LLM_SHARED_TOKEN is required", file=sys.stderr)
        return 2

    image_path = Path(args.image_path)
    if not image_path.is_file():
        print(f"image file not found: {image_path}", file=sys.stderr)
        return 2

    mime_type = env_str("PHOTO_LABEL_MIME_TYPE")
    if not mime_type:
        guessed, _ = mimetypes.guess_type(str(image_path))
        mime_type = guessed or "image/jpeg"

    if (args.start_runtime or args.stop_runtime) and not runtime_control_token:
        print("LLM_RUNTIME_CONTROL_TOKEN is required when using --start-runtime / --stop-runtime", file=sys.stderr)
        return 2

    image_bytes = image_path.read_bytes()
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"

    started_runtime = False
    try:
        if args.start_runtime:
            status, body, _ = request(
                "POST",
                f"{base_url.rstrip('/')}/start",
                headers={"X-Runtime-Control-Token": runtime_control_token or ""},
                body=b"",
                timeout_sec=min(timeout_ms / 1000, 30),
            )
            print(f"/start -> {status} {body.decode('utf-8', errors='replace').strip()}")
            if status >= 400:
                return 1
            started_runtime = True
            wait_until_ready(base_url, shared_token, args.ready_timeout_sec, args.ready_poll_sec)
            print("/v1/models ready")

        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_url}},
                        {"type": "text", "text": user_prompt},
                    ],
                }
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "chat_template_kwargs": {"enable_thinking": False},
        }

        status, body, content_type = request(
            "POST",
            f"{base_url.rstrip('/')}/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "X-LLM-Token": shared_token,
            },
            body=json.dumps(payload).encode("utf-8"),
            timeout_sec=timeout_ms / 1000,
        )
        print(f"/v1/chat/completions -> {status} [{content_type}]")
        decoded = body.decode("utf-8", errors="replace")

        if "application/json" in content_type:
            parsed = json.loads(decoded)
            assistant_text = extract_assistant_text(parsed)
            print(json.dumps(parsed, ensure_ascii=False, indent=2))
            if assistant_text:
                print(f"\nassistant_text: {assistant_text}")
        else:
            print(decoded)

        return 0 if status < 400 else 1
    finally:
        if args.stop_runtime and started_runtime:
            try:
                status, body, _ = request(
                    "POST",
                    f"{base_url.rstrip('/')}/stop",
                    headers={"X-Runtime-Control-Token": runtime_control_token or ""},
                    body=b"",
                    timeout_sec=min(timeout_ms / 1000, 30),
                )
                print(f"/stop -> {status} {body.decode('utf-8', errors='replace').strip()}")
            except Exception as exc:  # pragma: no cover
                print(f"/stop failed: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
