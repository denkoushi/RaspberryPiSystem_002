#include <Arduino.h>
#include <Avatar.h>
#include <M5Unified.h>

using namespace m5avatar;

namespace {

Avatar avatar;

void logLine(const char* line) {
  Serial.println(line);
  Serial.flush();
}

}  // namespace

void setup() {
  auto cfg = M5.config();
  cfg.serial_baudrate = 115200;
  M5.begin(cfg);

  Serial.begin(115200);
  delay(300);

  logLine("");
  logLine("=== CoreS3 probe C1 boot ===");
  logLine("step: m5stack-avatar init() default (colorDepth=1)");

  auto& d = M5.Display;
  d.fillScreen(TFT_BLACK);
  d.setTextColor(TFT_WHITE, TFT_BLACK);
  d.setTextSize(2);
  d.setCursor(8, 8);
  d.println("CoreS3 probe C1");

  logLine("avatar: calling init() (colorDepth default=1) ...");
  avatar.init();
  logLine("avatar: init OK (draw/facial tasks started)");

  d.setTextSize(1);
  d.setCursor(8, 40);
  d.println("Avatar init() OK");
  d.println("colorDepth=1 (default)");
  d.println("See face on display");

  logLine("setup complete — idle loop (no restart)");
}

void loop() {
  M5.update();
  delay(50);
}
