#!/usr/bin/env python3
"""Persistent RapidOCR worker for marker-local drawing OCR.

Protocol (JSON Lines over stdin/stdout):
  request:  {"id":"...","imageBase64":"<jpeg bytes base64>"}
  response: {"id":"...","ok":true,"words":[{"text":"...","confidence":0-100,"bbox":{"x0":..,"y0":..,"x1":..,"y1":..}}]}
  or        {"id":"...","ok":false,"error":"..."}

Startup readiness line (before accepting work):
  {"ready":true,"engine":"rapidocr"}
"""

from __future__ import annotations

import base64
import json
import sys
import traceback
from typing import Any


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _word_from_item(item: Any) -> dict[str, Any] | None:
    # RapidOCR typically returns [box, text, score] where box is 4 points.
    if not isinstance(item, (list, tuple)) or len(item) < 2:
        return None
    box = item[0]
    text = str(item[1] if len(item) > 1 else "").strip()
    if not text:
        return None
    score = item[2] if len(item) > 2 else None
    confidence: float | None
    try:
        confidence = float(score) * 100.0 if score is not None else None
    except (TypeError, ValueError):
        confidence = None
    xs: list[float] = []
    ys: list[float] = []
    if isinstance(box, (list, tuple)):
        for point in box:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                try:
                    xs.append(float(point[0]))
                    ys.append(float(point[1]))
                except (TypeError, ValueError):
                    continue
    if not xs or not ys:
        return None
    return {
        "text": text,
        "confidence": confidence,
        "bbox": {
            "x0": min(xs),
            "y0": min(ys),
            "x1": max(xs),
            "y1": max(ys),
        },
    }


def _normalize_result(result: Any) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    # Newer rapidocr may return an object with .result / .txts
    payload = result
    if hasattr(result, "result"):
        payload = getattr(result, "result")
    if payload is None:
        return words
    if isinstance(payload, dict) and "result" in payload:
        payload = payload["result"]
    if not isinstance(payload, (list, tuple)):
        return words
    for item in payload:
        word = _word_from_item(item)
        if word is not None:
            words.append(word)
    return words


def main() -> int:
    try:
        from rapidocr import RapidOCR  # type: ignore
    except Exception as exc:  # noqa: BLE001
        _emit({"ready": False, "error": f"rapidocr import failed: {exc}"})
        return 1

    try:
        engine = RapidOCR()
    except Exception as exc:  # noqa: BLE001
        _emit({"ready": False, "error": f"rapidocr init failed: {exc}"})
        return 1

    _emit({"ready": True, "engine": "rapidocr"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = ""
        try:
            req = json.loads(line)
            request_id = str(req.get("id") or "")
            image_b64 = req.get("imageBase64")
            if not isinstance(image_b64, str) or not image_b64:
                raise ValueError("imageBase64 is required")
            image_bytes = base64.b64decode(image_b64, validate=False)
            result = engine(image_bytes)
            words = _normalize_result(result)
            _emit({"id": request_id, "ok": True, "words": words})
        except Exception as exc:  # noqa: BLE001
            _emit(
                {
                    "id": request_id,
                    "ok": False,
                    "error": str(exc),
                    "traceback": traceback.format_exc(limit=3),
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
