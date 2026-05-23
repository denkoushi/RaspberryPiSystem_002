#!/usr/bin/env python3
"""Copy utterance overlay sources and patch AiStackChanMod.cpp."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

INCLUDE_LINE = '#include "llm/PrivateBridge/PrivateBridgeUtterance.h"'
MARKER = '  avatar.setSpeechText("御用でしょうか？");'
INSERT = """
#if __has_include("llm/PrivateBridge/PrivateBridgeUtterance.h")
  if (base64_buf == NULL && private_bridge_utterance_enabled()) {
    String reply = private_bridge_utterance_turn();
    avatar.setSpeechText("");
#ifdef USE_SERVO
    servo_home = false;
#endif
    if (reply != "") {
      Serial.println(reply);
      robot->speech(reply);
      avatar.setExpression(Expression::Neutral);
      servo_home = true;
      return;
    }
    avatar.setExpression(Expression::Sad);
    avatar.setSpeechText("聞き取れませんでした");
    delay(2000);
    avatar.setSpeechText("");
    avatar.setExpression(Expression::Neutral);
    servo_home = true;
    return;
  }
#endif

"""


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} /path/to/AI_StackChan_Ex", file=sys.stderr)
        raise SystemExit(2)
    clone = Path(sys.argv[1]).resolve()
    root = Path(__file__).resolve().parent
    overlay_src = root / "firmware-overlay/src/llm/PrivateBridge"
    target_dir = clone / "firmware/src/llm/PrivateBridge"
    mod = clone / "firmware/src/mod/AiStackChan/AiStackChanMod.cpp"

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
    if "private_bridge_utterance_turn" not in text:
        if MARKER not in text:
            raise SystemExit("AiStackChanMod.cpp: STT_ChatGPT marker missing")
        text = text.replace(MARKER, MARKER + INSERT, 1)
    mod.write_text(text, encoding="utf-8")
    print("utterance overlay applied:", mod)


if __name__ == "__main__":
    main()
