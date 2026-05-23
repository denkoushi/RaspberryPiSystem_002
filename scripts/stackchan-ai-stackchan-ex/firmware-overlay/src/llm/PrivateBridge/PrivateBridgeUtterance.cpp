#include "PrivateBridgeUtterance.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClient.h>

#include "driver/Audio.h"

#ifndef STACKCHAN_UTTERANCE_URL
#define STACKCHAN_UTTERANCE_URL ""
#endif

#ifndef CHATGPT_STACKCHAN_TOKEN
#define CHATGPT_STACKCHAN_TOKEN ""
#endif

namespace {

bool utterance_enabled() { return strlen(STACKCHAN_UTTERANCE_URL) > 0; }

String post_wav(const uint8_t* body, size_t body_len) {
  String payload = "";
  if (!utterance_enabled()) {
    return payload;
  }
  if (String(STACKCHAN_UTTERANCE_URL).startsWith("https://")) {
    Serial.println("[UTTERANCE] https not supported on device; use http:// Pi5 bridge");
    return payload;
  }

  HTTPClient http;
  http.setTimeout(90000);
  WiFiClient client;
  Serial.printf("[UTTERANCE] POST %s (%u bytes)\n", STACKCHAN_UTTERANCE_URL, (unsigned)body_len);
  if (!http.begin(client, STACKCHAN_UTTERANCE_URL)) {
    Serial.println("[UTTERANCE] http.begin failed");
    return payload;
  }
  http.addHeader("Content-Type", "audio/wav");
  if (strlen(CHATGPT_STACKCHAN_TOKEN) > 0) {
    http.addHeader("X-Stackchan-Token", CHATGPT_STACKCHAN_TOKEN);
  }
  const int httpCode = http.POST(const_cast<uint8_t*>(body), body_len);
  if (httpCode > 0) {
    payload = http.getString();
    Serial.printf("[UTTERANCE] code=%d payload_len=%d\n", httpCode, payload.length());
  } else {
    Serial.printf("[UTTERANCE] POST failed: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
  return payload;
}

String parse_reply_text(const String& payload) {
  if (payload.length() == 0) {
    return "";
  }
  StaticJsonDocument<4096> doc;
  const DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.printf("[UTTERANCE] json error: %s\n", error.c_str());
    return "";
  }
  const char* reply = doc["replyText"];
  if (reply && strlen(reply) > 0) {
    return String(reply);
  }
  const char* err = doc["error"]["message"];
  if (err) {
    Serial.printf("[UTTERANCE] api error: %s\n", err);
  }
  return "";
}

}  // namespace

bool private_bridge_utterance_enabled() { return utterance_enabled(); }

String private_bridge_utterance_turn() {
  if (!utterance_enabled()) {
    return "";
  }

  Audio* audio = new Audio();
  Serial.println("[UTTERANCE] record start");
  audio->Record();
  Serial.println("[UTTERANCE] record end");

  const size_t header_len = sizeof(audio->paddedHeader);
  const size_t wav_len = audio->wavDataSize;
  const size_t total = header_len + wav_len;
  uint8_t* body = (uint8_t*)heap_caps_malloc(total, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!body) {
    Serial.println("[UTTERANCE] malloc failed");
    delete audio;
    return "";
  }
  memcpy(body, audio->paddedHeader, header_len);
  memcpy(body + header_len, audio->wavData, wav_len);

  const String payload = post_wav(body, total);
  heap_caps_free(body);
  delete audio;

  return parse_reply_text(payload);
}
