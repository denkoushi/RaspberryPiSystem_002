#include "PrivateBridgeVoiceTurn.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClient.h>

#include "PrivateBridgePlayback.h"
#include "Robot.h"
#include "driver/Audio.h"

extern Robot* robot;

#ifndef STACKCHAN_VOICE_TURN_URL
#define STACKCHAN_VOICE_TURN_URL ""
#endif

#ifndef CHATGPT_STACKCHAN_TOKEN
#define CHATGPT_STACKCHAN_TOKEN ""
#endif

namespace {

bool voice_turn_enabled() { return strlen(STACKCHAN_VOICE_TURN_URL) > 0; }

String post_wav(const uint8_t* body, size_t body_len) {
  String payload = "";
  if (!voice_turn_enabled()) {
    return payload;
  }
  if (String(STACKCHAN_VOICE_TURN_URL).startsWith("https://")) {
    Serial.println("[VOICE] https not supported on device; use http:// Pi5 bridge");
    return payload;
  }

  HTTPClient http;
  http.setTimeout(120000);
  WiFiClient client;
  Serial.printf("[VOICE] POST %s (%u bytes)\n", STACKCHAN_VOICE_TURN_URL, (unsigned)body_len);
  if (!http.begin(client, STACKCHAN_VOICE_TURN_URL)) {
    Serial.println("[VOICE] http.begin failed");
    return payload;
  }
  http.addHeader("Content-Type", "audio/wav");
  http.addHeader("X-Trigger-Device-Playback", "false");
  if (strlen(CHATGPT_STACKCHAN_TOKEN) > 0) {
    http.addHeader("X-Stackchan-Token", CHATGPT_STACKCHAN_TOKEN);
  }
  const int httpCode = http.POST(const_cast<uint8_t*>(body), body_len);
  if (httpCode > 0) {
    payload = http.getString();
    Serial.printf("[VOICE] code=%d payload_len=%d\n", httpCode, payload.length());
  } else {
    Serial.printf("[VOICE] POST failed: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
  return payload;
}

struct VoiceTurnParsed {
  String reply_text;
  String audio_url;
  bool ok;
};

VoiceTurnParsed parse_payload(const String& payload) {
  VoiceTurnParsed out;
  out.ok = false;
  if (payload.length() == 0) {
    return out;
  }
  StaticJsonDocument<8192> doc;
  const DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.printf("[VOICE] json error: %s\n", error.c_str());
    return out;
  }
  if (doc["ok"] == false) {
    const char* err = doc["error"]["message"];
    if (err) {
      Serial.printf("[VOICE] api error: %s\n", err);
    }
    return out;
  }
  const char* reply = doc["replyText"];
  if (reply && strlen(reply) > 0) {
    out.reply_text = String(reply);
  }
  const char* audio_url = doc["audioUrl"];
  if (audio_url && strlen(audio_url) > 0) {
    out.audio_url = String(audio_url);
  }
  out.ok = out.audio_url.length() > 0 || out.reply_text.length() > 0;
  return out;
}

}  // namespace

bool private_bridge_voice_turn_enabled() { return voice_turn_enabled(); }

bool private_bridge_voice_turn_run() {
  if (!voice_turn_enabled()) {
    return false;
  }

  private_bridge_set_state("listening");

  Audio* audio = new Audio();
  Serial.println("[VOICE] record start");
  audio->Record();
  Serial.println("[VOICE] record end");

  const size_t header_len = sizeof(audio->paddedHeader);
  const size_t wav_len = audio->wavDataSize;
  const size_t total = header_len + wav_len;
  uint8_t* body = (uint8_t*)heap_caps_malloc(total, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!body) {
    Serial.println("[VOICE] malloc failed");
    delete audio;
    private_bridge_set_state("error");
    return true;
  }
  memcpy(body, audio->paddedHeader, header_len);
  memcpy(body + header_len, audio->wavData, wav_len);

  private_bridge_set_state("thinking");
  const String payload = post_wav(body, total);
  heap_caps_free(body);
  delete audio;

  const VoiceTurnParsed parsed = parse_payload(payload);
  if (!parsed.ok) {
    private_bridge_set_state("error");
    return true;
  }

  if (parsed.reply_text.length() > 0) {
    Serial.println(parsed.reply_text);
  }

  if (parsed.audio_url.length() > 0) {
    private_bridge_set_state("speaking");
    if (!private_bridge_play_wav_url(parsed.audio_url.c_str()) && parsed.reply_text.length() > 0 && robot != nullptr) {
      Serial.println("[VOICE] audioUrl playback failed; fallback to device speech");
      robot->speech(parsed.reply_text);
    }
  } else if (parsed.reply_text.length() > 0 && robot != nullptr) {
    private_bridge_set_state("speaking");
    robot->speech(parsed.reply_text);
  }

  private_bridge_set_state("idle");
  return true;
}
