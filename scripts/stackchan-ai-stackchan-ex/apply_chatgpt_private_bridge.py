#!/usr/bin/env python3
"""Apply private Pi5 bridge ChatGPT.cpp changes (replaces broken monolithic patch)."""

from __future__ import annotations

import sys
from pathlib import Path

MACROS = """
#ifndef CHATGPT_API_URL
#define CHATGPT_API_URL "https://api.openai.com/v1/chat/completions"
#endif

#ifndef CHATGPT_API_USE_AUTH_BEARER
#define CHATGPT_API_USE_AUTH_BEARER 1
#endif

#ifndef CHATGPT_STACKCHAN_TOKEN
#define CHATGPT_STACKCHAN_TOKEN ""
#endif

#ifndef CHATGPT_HTTP_MAX_ATTEMPTS
#define CHATGPT_HTTP_MAX_ATTEMPTS 2
#endif
"""

HTTPS_POST_JSON_NEW = r'''String ChatGPT::https_post_json(const char* url, const char* json_string, const char* root_ca) {
  String payload = "";
  const bool isHttps = String(url).startsWith("https://");
  for (int attempt = 1; attempt <= CHATGPT_HTTP_MAX_ATTEMPTS; attempt++) {
    HTTPClient http;
    http.setTimeout(65000);
    int httpCode = -1;

    if (isHttps) {
      WiFiClientSecure secureClient;
      secureClient.setCACert(root_ca);
      Serial.printf("[HTTPS] begin... %s (attempt=%d/%d)\n", url, attempt, CHATGPT_HTTP_MAX_ATTEMPTS);
      if (http.begin(secureClient, url)) {
        http.addHeader("Content-Type", "application/json");
        if (strlen(CHATGPT_STACKCHAN_TOKEN) > 0) {
          http.addHeader("X-Stackchan-Token", CHATGPT_STACKCHAN_TOKEN);
        }
#if CHATGPT_API_USE_AUTH_BEARER
        if (param.api_key.length() > 0) {
          http.addHeader("Authorization", String("Bearer ") + param.api_key);
        }
#endif
        httpCode = http.POST((uint8_t *)json_string, strlen(json_string));
      }
      if (httpCode > 0) {
        Serial.printf("[HTTP] POST... code: %d (attempt=%d/%d)\n", httpCode, attempt, CHATGPT_HTTP_MAX_ATTEMPTS);
        payload = http.getString();
        Serial.printf("[HTTP] payload length: %d\n", payload.length());
        if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
          if (payload != "") {
            Serial.println("//////////////");
            Serial.println(payload);
            Serial.println("//////////////");
            http.end();
            return payload;
          }
          Serial.println("[HTTP] empty payload; retrying");
        } else if (attempt == CHATGPT_HTTP_MAX_ATTEMPTS) {
          http.end();
          return payload;
        }
      } else {
        String errorMessage = http.errorToString(httpCode);
        Serial.printf("[HTTP] POST... failed, error: %s (attempt=%d/%d)\n", errorMessage.c_str(), attempt, CHATGPT_HTTP_MAX_ATTEMPTS);
        payload = String("{\"error\":{\"message\":\"http post failed: ") + errorMessage + String("\"}}");
        if (attempt == CHATGPT_HTTP_MAX_ATTEMPTS) {
          http.end();
          return payload;
        }
      }
      http.end();
    } else {
      WiFiClient plainClient;
      Serial.printf("[HTTP] begin... %s (attempt=%d/%d)\n", url, attempt, CHATGPT_HTTP_MAX_ATTEMPTS);
      if (http.begin(plainClient, url)) {
        http.addHeader("Content-Type", "application/json");
        if (strlen(CHATGPT_STACKCHAN_TOKEN) > 0) {
          http.addHeader("X-Stackchan-Token", CHATGPT_STACKCHAN_TOKEN);
        }
#if CHATGPT_API_USE_AUTH_BEARER
        if (param.api_key.length() > 0) {
          http.addHeader("Authorization", String("Bearer ") + param.api_key);
        }
#endif
        httpCode = http.POST((uint8_t *)json_string, strlen(json_string));
      }
      if (httpCode > 0) {
        Serial.printf("[HTTP] POST... code: %d (attempt=%d/%d)\n", httpCode, attempt, CHATGPT_HTTP_MAX_ATTEMPTS);
        payload = http.getString();
        Serial.printf("[HTTP] payload length: %d\n", payload.length());
        if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
          if (payload != "") {
            Serial.println("//////////////");
            Serial.println(payload);
            Serial.println("//////////////");
            http.end();
            return payload;
          }
          Serial.println("[HTTP] empty payload; retrying");
        } else if (attempt == CHATGPT_HTTP_MAX_ATTEMPTS) {
          http.end();
          return payload;
        }
      } else {
        String errorMessage = http.errorToString(httpCode);
        Serial.printf("[HTTP] POST... failed, error: %s (attempt=%d/%d)\n", errorMessage.c_str(), attempt, CHATGPT_HTTP_MAX_ATTEMPTS);
        payload = String("{\"error\":{\"message\":\"http post failed: ") + errorMessage + String("\"}}");
        if (attempt == CHATGPT_HTTP_MAX_ATTEMPTS) {
          http.end();
          return payload;
        }
      }
      http.end();
    }
  }
  return payload;
}'''

REPLY_TEXT_BLOCK = """
      const char* simple_reply = doc["replyText"];
      if(simple_reply != 0){
        Serial.println(simple_reply);
        response = String(simple_reply);
        std::replace(response.begin(),response.end(),'\\n',' ');
        calledFunc = String("");
        return response;
      }

      const char* error_message = doc["error"]["message"];
      if(error_message != 0){
        Serial.println(error_message);
        avatar.setExpression(Expression::Sad);
        avatar.setSpeechText("エラーです");
        response = String(error_message);
        delay(1000);
        avatar.setSpeechText("");
        avatar.setExpression(Expression::Neutral);
        return response;
      }

"""


def apply(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "CHATGPT_API_URL" not in text:
        anchor = "extern Avatar avatar;"
        if anchor not in text:
            raise SystemExit("ChatGPT.cpp: anchor not found for macros")
        text = text.replace(anchor, anchor + "\n" + MACROS.strip() + "\n", 1)
    if '#include <WiFiClient.h>' not in text:
        text = text.replace("#include <HTTPClient.h>", "#include <HTTPClient.h>\n#include <WiFiClient.h>", 1)

    start = text.find("String ChatGPT::https_post_json")
    end = text.find("\nvoid ChatGPT::chat", start)
    if end == -1:
        end = text.find("\n\n#define MAX_REQUEST_COUNT", start)
    if start == -1 or end == -1:
        raise SystemExit("ChatGPT.cpp: https_post_json block not found")
    if "[HTTP] payload length" not in text[start:end]:
        text = (
            text[:start]
            + HTTPS_POST_JSON_NEW
            + "\n\n#define MAX_REQUEST_COUNT  (10)\n"
            + text[end + 1 :]
        )

    text = text.replace(
        'https_post_json("https://api.openai.com/v1/chat/completions"',
        "https_post_json(CHATGPT_API_URL",
    )

    marker = '      const char* data = doc["choices"][0]["message"]["content"];'
    if 'doc["replyText"]' not in text and marker in text:
        text = text.replace(marker, REPLY_TEXT_BLOCK.strip() + "\n\n" + marker, 1)

    path.write_text(text, encoding="utf-8")
    print("patched", path)


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} /path/to/AI_StackChan_Ex", file=sys.stderr)
        raise SystemExit(2)
    root = Path(sys.argv[1]).resolve()
    chatgpt = root / "firmware/src/llm/ChatGPT/ChatGPT.cpp"
    platformio = root / "firmware/platformio.ini"
    if not chatgpt.is_file():
        raise SystemExit(f"missing {chatgpt}")
    apply(chatgpt)
    if platformio.is_file():
        ini = platformio.read_text(encoding="utf-8")
        if "M5Unified @ 0.1.17" in ini:
            ini = ini.replace("M5Unified @ 0.1.17", "M5Unified @ 0.2.7")
            platformio.write_text(ini, encoding="utf-8")
            print("updated M5Unified -> 0.2.7 in platformio.ini")


if __name__ == "__main__":
    main()
