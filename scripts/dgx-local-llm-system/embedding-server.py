#!/usr/bin/env python3
"""
DGX system-prod 用の軽量 image embedding server。

- /healthz は 200 ok
- /embed は POST { jpegBase64, modelId? } -> { embedding, modelId }
- 既定では Hugging Face の CLIP ViT-B/32 を読み、512 次元ベクトルを返す

想定:
  このスクリプト自体は host Python ではなく、torch / transformers を含む
  Docker container 内で実行する。

環境変数:
  EMBEDDING_LISTEN_HOST      既定: 0.0.0.0
  EMBEDDING_LISTEN_PORT      既定: 38100
  EMBEDDING_MODEL_ID         既定: clip-ViT-B-32
  EMBEDDING_HF_MODEL         既定: openai/clip-vit-base-patch32
  EMBEDDING_DEVICE           既定: auto (cuda -> cpu)
  EMBEDDING_NORMALIZE        既定: true
  EMBEDDING_BACKEND          既定: clip (clip / embeddinggemma2)
  EMBEDDING_TRUNCATE_DIM     既定: 未設定 (切り詰めなし、設定時は正の整数)
"""

from __future__ import annotations

import base64
import json
import math
import os
import sys
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO

HOST = (os.environ.get("EMBEDDING_LISTEN_HOST") or "0.0.0.0").strip()
PORT = int((os.environ.get("EMBEDDING_LISTEN_PORT") or "38100").strip())
MODEL_ID = (os.environ.get("EMBEDDING_MODEL_ID") or "clip-ViT-B-32").strip()
HF_MODEL = (os.environ.get("EMBEDDING_HF_MODEL") or "openai/clip-vit-base-patch32").strip()
DEVICE_RAW = (os.environ.get("EMBEDDING_DEVICE") or "auto").strip().lower()
NORMALIZE = (os.environ.get("EMBEDDING_NORMALIZE") or "true").strip().lower() not in ("0", "false", "no")
BACKEND = (os.environ.get("EMBEDDING_BACKEND") or "clip").strip().lower()
if BACKEND not in ("clip", "embeddinggemma2"):
    raise ValueError(f"Unknown EMBEDDING_BACKEND: {BACKEND!r}; expected clip or embeddinggemma2")
TRUNCATE_DIM_RAW = (os.environ.get("EMBEDDING_TRUNCATE_DIM") or "").strip()
try:
    TRUNCATE_DIM = int(TRUNCATE_DIM_RAW) if TRUNCATE_DIM_RAW else None
except ValueError as exc:
    raise ValueError("EMBEDDING_TRUNCATE_DIM must be an integer") from exc
if TRUNCATE_DIM is not None and TRUNCATE_DIM < 1:
    raise ValueError("EMBEDDING_TRUNCATE_DIM must be at least 1")

IMAGE_EMBEDDER: Callable[[bytes], list[float]] | None = None


def resolve_device() -> str:
    import torch

    if DEVICE_RAW == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return DEVICE_RAW


def load_image_embedder() -> Callable[[bytes], list[float]]:
    import torch
    from PIL import Image

    device = resolve_device()
    print(
        f"[dgx-embedding-server] loading backend={BACKEND} truncateDim={TRUNCATE_DIM} "
        f"hfModel={HF_MODEL} modelId={MODEL_ID} device={device}",
        file=sys.stderr,
    )
    if BACKEND == "embeddinggemma2":
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(HF_MODEL, device=device, config_kwargs={"audio_config": None})

        def embed(jpeg_bytes: bytes) -> list[float]:
            image = Image.open(BytesIO(jpeg_bytes)).convert("RGB")
            return [float(v) for v in model.encode([image], normalize_embeddings=NORMALIZE)[0]]

    else:
        from transformers import CLIPModel, CLIPProcessor

        processor = CLIPProcessor.from_pretrained(HF_MODEL)
        model = CLIPModel.from_pretrained(HF_MODEL).eval().to(device)

        def embed(jpeg_bytes: bytes) -> list[float]:
            image = Image.open(BytesIO(jpeg_bytes)).convert("RGB")
            inputs = processor(images=image, return_tensors="pt")
            if "pixel_values" not in inputs:
                raise ValueError("processor did not produce pixel_values")
            pixel_values = inputs["pixel_values"].to(device)
            with torch.inference_mode():
                vision_outputs = model.vision_model(pixel_values=pixel_values)
                pooled_output = vision_outputs[1]
                features = model.visual_projection(pooled_output)
                if NORMALIZE:
                    features = torch.nn.functional.normalize(features, p=2, dim=-1)
                vector = features[0].detach().float().cpu().tolist()
            return [float(v) for v in vector]

    return embed


def image_embedding_from_jpeg(jpeg_bytes: bytes) -> list[float]:
    global IMAGE_EMBEDDER
    if IMAGE_EMBEDDER is None:
        IMAGE_EMBEDDER = load_image_embedder()
    vector = IMAGE_EMBEDDER(jpeg_bytes)
    if TRUNCATE_DIM is not None:
        if TRUNCATE_DIM < 1 or TRUNCATE_DIM > len(vector):
            raise ValueError(f"EMBEDDING_TRUNCATE_DIM must be between 1 and {len(vector)}, got {TRUNCATE_DIM}")
        vector = vector[:TRUNCATE_DIM]
        if NORMALIZE:
            norm = max(math.sqrt(sum(v * v for v in vector)), 1e-12)
            vector = [v / norm for v in vector]
    return [float(v) for v in vector]


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, object]:
    length = int(handler.headers.get("Content-Length", "0"))
    body = handler.rfile.read(length) if length > 0 else b"{}"
    return json.loads(body.decode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    server_version = "dgx-embedding-server/1.0"

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_text(self, status: int, text: str) -> None:
        encoded = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._send_text(200, "ok\n")
            return
        self._send_text(404, "not found")

    def do_POST(self) -> None:
        if self.path != "/embed":
            self._send_text(404, "not found")
            return
        try:
            payload = read_json(self)
            jpeg_base64 = str(payload.get("jpegBase64") or "").strip()
            if not jpeg_base64:
                self._send_json(400, {"error": "jpegBase64 is required"})
                return
            jpeg_bytes = base64.b64decode(jpeg_base64, validate=True)
            embedding = image_embedding_from_jpeg(jpeg_bytes)
            self._send_json(
                200,
                {
                    "embedding": embedding,
                    "modelId": str(payload.get("modelId") or MODEL_ID),
                },
            )
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid json"})
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:  # pragma: no cover
            self._send_json(500, {"error": str(exc)})

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("[dgx-embedding-server] " + (fmt % args) + "\n")


if __name__ == "__main__":
    IMAGE_EMBEDDER = load_image_embedder()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[dgx-embedding-server] listening on http://{HOST}:{PORT}", file=sys.stderr)
    httpd.serve_forever()
