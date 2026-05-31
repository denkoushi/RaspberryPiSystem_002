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
  logLine("=== CoreS3 probe C3 boot ===");
  logLine("step: AI_StackChan_Ex local m5stack-avatar + init(16)");

  auto& d = M5.Display;
  d.fillScreen(TFT_BLACK);
  d.setTextColor(TFT_WHITE, TFT_BLACK);
  d.setTextSize(2);
  d.setCursor(8, 8);
  d.println("CoreS3 probe C3");

  logLine("avatar: calling init(16) ...");
  avatar.init(16);
  logLine("avatar: init OK (draw/facial tasks started)");

  d.setTextSize(1);
  d.setCursor(8, 40);
  d.println("Avatar init(16) OK");
  d.println("lib: AI_StackChan_Ex local");
  d.println("See face on display");

  logLine("setup complete — idle loop (no restart)");
}

void loop() {
  M5.update();
  delay(50);
}
