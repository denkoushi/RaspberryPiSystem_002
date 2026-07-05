#!/usr/bin/env python3
"""Apply private Pi5 bridge STT routing to CloudSpeechClient.cpp (Scope-2 prep)."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

MARKER = "[STT_BRIDGE] private Pi5 bridge path"
PATCH_BEGIN = "/* STT_BRIDGE_PATCH_BEGIN */"
PATCH_END = "/* STT_BRIDGE_PATCH_END */"

MACROS = f"""
{PATCH_BEGIN}
// {MARKER} — optional build-flag URL; empty keeps upstream Google STT behavior.
#ifndef STT_BRIDGE_URL
#define STT_BRIDGE_URL ""
#endif

#ifndef STT_BRIDGE_STACKCHAN_TOKEN
#define STT_BRIDGE_STACKCHAN_TOKEN ""
#endif
{PATCH_END}
"""

INCLUDES = f"""
{PATCH_BEGIN}
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <esp_heap_caps.h>
{PATCH_END}
"""

BRIDGE_HELPER = f"""
{PATCH_BEGIN}
namespace {{
// {MARKER}
String TranscribeAudioViaBridge(Audio* audio) {{
  if (strlen(STT_BRIDGE_URL) == 0) {{
    return String("");
  }}
  const size_t headerLen = 44;
  const size_t pcmLen = audio->wavDataSize;
  const size_t totalLen = headerLen + pcmLen;
  uint8_t* body = (uint8_t*)heap_caps_malloc(totalLen, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (body == nullptr) {{
    body = (uint8_t*)malloc(totalLen);
  }}
  if (body == nullptr) {{
    Serial.println("[STT_BRIDGE] wav buffer alloc failed");
    return String("");
  }}
  memcpy(body, audio->paddedHeader, headerLen);
  memcpy(body + headerLen, audio->wavData, pcmLen);

  HTTPClient http;
  http.setTimeout(120000);
  WiFiClient plainClient;
  String payload = "";
  if (!http.begin(plainClient, STT_BRIDGE_URL)) {{
    Serial.println("[STT_BRIDGE] http begin failed");
    free(body);
    return String("");
  }}
  http.addHeader("Content-Type", "audio/wav");
  if (strlen(STT_BRIDGE_STACKCHAN_TOKEN) > 0) {{
    http.addHeader("X-Stackchan-Token", STT_BRIDGE_STACKCHAN_TOKEN);
  }}
  const int httpCode = http.POST(body, totalLen);
  free(body);
  if (httpCode > 0) {{
    Serial.printf("[STT_BRIDGE] POST... code: %d\\n", httpCode);
    payload = http.getString();
  }} else {{
    Serial.printf("[STT_BRIDGE] POST failed: %s\\n", http.errorToString(httpCode).c_str());
    http.end();
    return String("");
  }}
  http.end();

  StaticJsonDocument<1024> doc;
  const DeserializationError error = deserializeJson(doc, payload);
  if (error) {{
    Serial.println("[STT_BRIDGE] JSON parse failed");
    return String("");
  }}
  if (!doc["ok"].as<bool>()) {{
    Serial.println("[STT_BRIDGE] bridge returned ok=false");
    return String("");
  }}
  const char* text = doc["text"];
  if (text == nullptr || text[0] == '\\0') {{
    Serial.println("[STT_BRIDGE] empty text");
    return String("");
  }}
  Serial.println("[STT_BRIDGE] transcription ok");
  return String(text);
}}
}}  // namespace
{PATCH_END}
"""

SPEECH_TO_TEXT_BRIDGE_GUARD = f"""
{PATCH_BEGIN}
  if (strlen(STT_BRIDGE_URL) > 0) {{
    Serial.println("[STT_BRIDGE] using private bridge STT");
    ret = TranscribeAudioViaBridge(audio);
    delete audio;
    return ret;
  }}
{PATCH_END}
"""


def _remove_patch_blocks(text: str) -> str:
    while PATCH_BEGIN in text:
        start = text.index(PATCH_BEGIN)
        end = text.index(PATCH_END, start)
        text = text[:start] + text[end + len(PATCH_END) :]
    return re.sub(r"\n{3,}", "\n\n", text)


def apply(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    changed = False

    if PATCH_BEGIN not in text:
        anchor = '#include "rootCA/rootCAgoogle.h"'
        if anchor not in text:
            raise SystemExit(f"{path}: anchor not found for STT_BRIDGE macros")
        text = text.replace(anchor, anchor + MACROS + INCLUDES, 1)
        changed = True

    if "TranscribeAudioViaBridge" not in text:
        anchor = "String CloudSpeechClient::Transcribe(Audio* audio) {"
        if anchor not in text:
            raise SystemExit(f"{path}: Transcribe anchor not found")
        text = text.replace(anchor, BRIDGE_HELPER + "\n" + anchor, 1)
        changed = True

    if "[STT_BRIDGE] using private bridge STT" not in text:
        anchor = '  Serial.println("音声認識開始");'
        if anchor not in text:
            raise SystemExit(f"{path}: speech_to_text anchor not found")
        text = text.replace(anchor, anchor + SPEECH_TO_TEXT_BRIDGE_GUARD, 1)
        changed = True

    if changed:
        path.write_text(text, encoding="utf-8")
    return changed


def revert(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if PATCH_BEGIN not in text:
        return False
    cleaned = _remove_patch_blocks(text)
    if cleaned == text:
        raise SystemExit(f"{path}: patch markers found but removal failed")
    path.write_text(cleaned, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply or revert STT_BRIDGE patch on AI_StackChan_Ex")
    parser.add_argument("root", type=Path, help="AI_StackChan_Ex repository root")
    parser.add_argument("--revert", action="store_true", help="Remove STT_BRIDGE patch")
    parser.add_argument("--check", action="store_true", help="Exit 0 if patch already applied")
    args = parser.parse_args()

    target = args.root.resolve() / "firmware/src/stt/CloudSpeechClient.cpp"
    if not target.is_file():
        raise SystemExit(f"missing {target}")

    if args.check:
        content = target.read_text(encoding="utf-8")
        raise SystemExit(0 if PATCH_BEGIN in content and "TranscribeAudioViaBridge" in content else 1)

    if args.revert:
        if revert(target):
            print("reverted", target)
        else:
            print("already clean", target)
        return

    if apply(target):
        print("patched", target)
    else:
        print("already patched", target)


if __name__ == "__main__":
    main()
