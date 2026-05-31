#include <Arduino.h>
#include <M5Unified.h>

namespace {

constexpr int kSpriteW = 320;
constexpr int kSpriteH = 240;

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
  logLine("=== CoreS3 probe E1 boot ===");
  logLine("step: simple sprite only (no m5stack-avatar)");

  logDisplayMetrics("display: after M5.begin");
  M5.Display.setBrightness(255);
  logDisplayMetrics("display: after setBrightness(255)");

  auto& d = M5.Display;
  d.fillScreen(TFT_BLACK);
  d.setTextColor(TFT_WHITE, TFT_BLACK);
  d.setTextSize(2);
  d.setCursor(8, 8);
  d.println("CoreS3 probe E1");
  d.setTextSize(1);
  d.setCursor(8, 32);
  d.println("sprite only");
  logLine("display: title text drawn (M5.Display direct)");

  logLine("sprite: --- M5Canvas probe ---");
  logDisplayMetrics("sprite: before createSprite");

  M5Canvas canvas(&M5.Display);
  canvas.setColorDepth(16);

  Serial.printf("sprite: createSprite(%d,%d) ...\n", kSpriteW, kSpriteH);
  Serial.flush();
  const bool created = canvas.createSprite(kSpriteW, kSpriteH);
  Serial.printf("sprite: createSprite -> %s (writeError=%d)\n",
                created ? "OK" : "FAIL", canvas.getWriteError());
  Serial.flush();

  if (created) {
    canvas.fillSprite(TFT_BLACK);
    canvas.drawCircle(kSpriteW / 2, kSpriteH / 2, 60, TFT_WHITE);
    canvas.drawLine(40, 40, kSpriteW - 40, kSpriteH - 40, TFT_WHITE);
    canvas.drawLine(kSpriteW - 40, 40, 40, kSpriteH - 40, TFT_WHITE);
    canvas.setTextColor(TFT_WHITE, TFT_BLACK);
    canvas.setTextSize(2);
    canvas.setCursor(70, kSpriteH / 2 + 70);
    canvas.print("SPRITE OK");

    logLine("sprite: pushSprite(0,0) ...");
    canvas.pushSprite(0, 0);
    logLine("sprite: pushSprite done");
    canvas.deleteSprite();
  }

  logLine("setup complete — idle loop (no loop draw)");
}

void loop() {
  M5.update();
  delay(50);
}
