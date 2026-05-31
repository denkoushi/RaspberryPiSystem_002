#include "PrivateBridgePlayback.h"

#include <HTTPClient.h>
#include <WiFiClient.h>
#include <M5Unified.h>
#include <Avatar.h>

using namespace m5avatar;
extern Avatar avatar;

namespace {

bool http_get_wav(const char* url, uint8_t** out_body, size_t* out_len) {
  *out_body = nullptr;
  *out_len = 0;
  if (url == nullptr || strlen(url) == 0) {
    return false;
  }
  if (String(url).startsWith("https://")) {
    Serial.println("[VOICE] https playback not supported on device");
    return false;
  }

  HTTPClient http;
  http.setTimeout(90000);
  WiFiClient client;
  Serial.printf("[VOICE] GET %s\n", url);
  if (!http.begin(client, url)) {
    Serial.println("[VOICE] http.begin failed");
    return false;
  }
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.printf("[VOICE] GET failed code=%d\n", code);
    http.end();
    return false;
  }
  const int len = http.getSize();
  if (len <= 0) {
    Serial.println("[VOICE] empty response");
    http.end();
    return false;
  }
  uint8_t* body = (uint8_t*)heap_caps_malloc((size_t)len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!body) {
    Serial.println("[VOICE] malloc failed");
    http.end();
    return false;
  }
  WiFiClient* stream = http.getStreamPtr();
  size_t offset = 0;
  const size_t expected = (size_t)len;
  while (http.connected() && offset < expected) {
    const size_t avail = stream->available();
    if (avail) {
      const size_t remaining = expected - offset;
      const size_t chunk = avail < remaining ? avail : remaining;
      const int read = stream->readBytes(body + offset, chunk);
      if (read > 0) {
        offset += (size_t)read;
      }
    }
    delay(1);
  }
  http.end();
  if (offset == 0 || offset != expected) {
    Serial.printf("[VOICE] incomplete wav body offset=%u expected=%u\n", (unsigned)offset, (unsigned)expected);
    heap_caps_free(body);
    return false;
  }
  *out_body = body;
  *out_len = offset;
  return true;
}

}  // namespace

bool private_bridge_play_wav_url(const char* url) {
  uint8_t* body = nullptr;
  size_t len = 0;
  if (!http_get_wav(url, &body, &len)) {
    return false;
  }
  M5.Mic.end();
  const bool ok = M5.Speaker.playWav(body, len, 1, 0, true);
  M5.Speaker.wait();
  M5.Speaker.end();
  M5.Mic.begin();
  heap_caps_free(body);
  Serial.printf("[VOICE] playWav ok=%d len=%u\n", ok ? 1 : 0, (unsigned)len);
  return ok;
}

void private_bridge_set_state(const char* state) {
  if (state == nullptr) {
    return;
  }
  String label = "";
  if (strcmp(state, "listening") == 0) {
    label = "聞いています…";
  } else if (strcmp(state, "thinking") == 0) {
    label = "考え中…";
  } else if (strcmp(state, "speaking") == 0) {
    label = "お話しします";
  } else if (strcmp(state, "error") == 0) {
    label = "エラーです";
  } else {
    label = "";
  }
  avatar.setSpeechText(label.c_str());
}
