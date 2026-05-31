#!/usr/bin/env python3
"""Copy voice-rework overlay and patch AiStackChanMod + WebAPI (no utterance path)."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

INCLUDE_LINE = '#include "llm/PrivateBridge/PrivateBridgeVoiceTurn.h"'
MARKER = '  avatar.setSpeechText("御用でしょうか？");'
INSERT = """
#if __has_include("llm/PrivateBridge/PrivateBridgeVoiceTurn.h")
  if (base64_buf == NULL && private_bridge_voice_turn_enabled()) {
    if (private_bridge_voice_turn_run()) {
      avatar.setSpeechText("");
#ifdef USE_SERVO
      servo_home = true;
#endif
      avatar.setExpression(Expression::Neutral);
      return;
    }
    avatar.setExpression(Expression::Sad);
    avatar.setSpeechText("聞き取れませんでした");
    delay(2000);
    avatar.setSpeechText("");
    avatar.setExpression(Expression::Neutral);
#ifdef USE_SERVO
    servo_home = true;
#endif
    return;
  }
#endif

"""

WEBAPI_INCLUDE = '#include "llm/PrivateBridge/PrivateBridgeWebHandlers.h"'
WEBAPI_ANCHOR = '  server.on("/speech", handle_speech);'
WEBAPI_INSERT = """  server.on("/speech", handle_speech);
#if __has_include("llm/PrivateBridge/PrivateBridgeWebHandlers.h")
  private_bridge_register_web_handlers();
#endif"""


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} /path/to/AI_StackChan_Ex", file=sys.stderr)
        raise SystemExit(2)
    clone = Path(sys.argv[1]).resolve()
    root = Path(__file__).resolve().parent
    overlay_src = root / "firmware-overlay/src/llm/PrivateBridge"
    target_dir = clone / "firmware/src/llm/PrivateBridge"
    mod = clone / "firmware/src/mod/AiStackChan/AiStackChanMod.cpp"
    webapi = clone / "firmware/src/WebAPI.cpp"

    if not overlay_src.is_dir():
        raise SystemExit(f"missing overlay: {overlay_src}")
    if target_dir.exists():
        shutil.rmtree(target_dir)
    shutil.copytree(overlay_src, target_dir)

    text = mod.read_text(encoding="utf-8")
    if INCLUDE_LINE not in text:
        needle = '#include "stt/CloudSpeechClient.h"'
        if needle not in text:
            raise SystemExit("AiStackChanMod.cpp: include anchor missing")
        text = text.replace(needle, needle + "\n" + INCLUDE_LINE, 1)
    if "private_bridge_voice_turn_run" not in text:
        if MARKER not in text:
            raise SystemExit("AiStackChanMod.cpp: STT_ChatGPT marker missing")
        text = text.replace(MARKER, MARKER + INSERT, 1)
    mod.write_text(text, encoding="utf-8")

    api = webapi.read_text(encoding="utf-8")
    if WEBAPI_INCLUDE not in api:
        anchor = '#include "Robot.h"'
        if anchor not in api:
            raise SystemExit("WebAPI.cpp: include anchor missing")
        api = api.replace(anchor, anchor + "\n" + WEBAPI_INCLUDE, 1)
    if "private_bridge_register_web_handlers" not in api:
        if WEBAPI_ANCHOR not in api:
            raise SystemExit("WebAPI.cpp: speech route anchor missing")
        api = api.replace(WEBAPI_ANCHOR, WEBAPI_INSERT, 1)
    webapi.write_text(api, encoding="utf-8")
    print("voice rework overlay applied:", mod, webapi)


if __name__ == "__main__":
    main()
