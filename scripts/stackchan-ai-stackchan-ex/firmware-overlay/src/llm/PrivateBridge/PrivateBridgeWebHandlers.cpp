#include "PrivateBridgeWebHandlers.h"

#include <ESP32WebServer.h>
#include <Avatar.h>

#include "PrivateBridgePlayback.h"

using namespace m5avatar;
extern Avatar avatar;
extern ESP32WebServer server;

namespace {

void handle_private_bridge_play_audio() {
  const String url = server.arg("url");
  if (url.length() == 0) {
    server.send(400, "text/plain", "url required");
    return;
  }
  private_bridge_set_state("speaking");
  const bool ok = private_bridge_play_wav_url(url.c_str());
  private_bridge_set_state("idle");
  if (ok) {
    server.send(200, "text/plain", "OK");
  } else {
    server.send(502, "text/plain", "playback failed");
  }
}

void handle_private_bridge_state() {
  const String state = server.arg("state");
  private_bridge_set_state(state.c_str());
  server.send(200, "text/plain", "OK");
}

}  // namespace

void private_bridge_register_web_handlers(void) {
  server.on("/private-bridge/play-audio", handle_private_bridge_play_audio);
  server.on("/private-bridge/state", handle_private_bridge_state);
  Serial.println("[VOICE] private-bridge web handlers registered");
}
