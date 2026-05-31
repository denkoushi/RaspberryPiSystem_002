#include <Arduino.h>
#include <Avatar.h>
#include <M5Unified.h>

using namespace m5avatar;

namespace {

void logLine(const char* line) {
  Serial.println(line);
  Serial.flush();
}

void logDisplayMetrics(const char* label) {
  auto& d = M5.Display;
  Serial.printf("%s: width=%d height=%d brightness=%d\n", label, d.width(),
                d.height(), d.getBrightness());
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
  logLine("=== CoreS3 probe E2 boot ===");
  logLine("step: Face::draw once (no avatar.init)");

  logDisplayMetrics("display: after M5.begin");
  M5.Display.setBrightness(255);
  logDisplayMetrics("display: after setBrightness(255)");

  auto& d = M5.Display;
  d.fillScreen(TFT_NAVY);
  d.setTextColor(TFT_WHITE, TFT_NAVY);
  d.setTextSize(2);
  d.setCursor(8, 8);
  d.println("CoreS3 probe E2");
  d.setTextSize(1);
  d.setCursor(8, 32);
  d.println("wait 3s then Face");
  logLine("display: marker text (NAVY) — visible 3s before Face::draw");

  Serial.println("face: delay(3000) before draw ...");
  Serial.flush();
  delay(3000);

  Avatar avatar;
  logLine("face: Avatar constructed; init() NOT called");

  ColorPalette palette = avatar.getColorPalette();
  Gaze gaze(0.0f, 0.0f);
  DrawContext ctx(Expression::Neutral, 0.0f, &palette, gaze, 1.0f, 0.0f, "",
                  0.0f, 1.0f, 16, BatteryIconStatus::invisible, 0, nullptr);

  logLine("face: getFace()->draw() colorDepth=16 ...");
  avatar.getFace()->draw(&ctx);
  logLine("face: getFace()->draw() done");

  logLine("setup complete — idle loop (no loop draw)");
}

void loop() {
  M5.update();
  delay(50);
}
