#include <Arduino.h>
#include <Avatar.h>
#include <M5Unified.h>

using namespace m5avatar;

namespace {

Avatar avatar;
uint32_t last_overlay_ms = 0;
uint32_t overlay_tick = 0;

void logLine(const char* line) {
  Serial.println(line);
  Serial.flush();
}

void redrawProbeOverlay() {
  auto& d = M5.Display;
  d.setBrightness(128);
  const uint16_t bg = (overlay_tick % 2 == 0) ? TFT_NAVY : TFT_MAROON;
  d.fillScreen(bg);
  d.setTextColor(TFT_WHITE, bg);
  d.setTextSize(2);
  d.setCursor(8, 8);
  d.printf("CoreS3 probe C2 #%lu", static_cast<unsigned long>(overlay_tick));
  d.setTextSize(1);
  d.setCursor(8, 36);
  d.println("1Hz fillScreen+text");
  d.println("avatar.init(16) running");
  d.printf("uptime %lu s", static_cast<unsigned long>(millis() / 1000));
}

}  // namespace

void setup() {
  auto cfg = M5.config();
  cfg.serial_baudrate = 115200;
  M5.begin(cfg);

  Serial.begin(115200);
  delay(300);

  logLine("");
  logLine("=== CoreS3 probe C2 boot ===");
  logLine("step: init(16) + 1Hz display overwrite (brightness 128)");

  redrawProbeOverlay();
  overlay_tick = 1;
  last_overlay_ms = millis();

  logLine("avatar: calling init(16) ...");
  avatar.init(16);
  logLine("avatar: init OK (draw/facial tasks started)");

  logLine("setup complete — loop will overlay display every 1s");
}

void loop() {
  M5.update();
  const uint32_t now = millis();
  if (now - last_overlay_ms >= 1000) {
    last_overlay_ms = now;
    overlay_tick++;
    redrawProbeOverlay();
    Serial.printf("overlay: tick=%lu brightness=128 fill+text\n",
                  static_cast<unsigned long>(overlay_tick));
    Serial.flush();
  }
  delay(10);
}
