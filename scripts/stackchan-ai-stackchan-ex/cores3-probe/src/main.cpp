#include <Arduino.h>
#include <M5Unified.h>
#include <SD.h>
#include <SPI.h>

#include "sd_config_probe.h"

namespace {

constexpr int kSdCsPin = GPIO_NUM_4;
constexpr uint32_t kSdSpiHz = 25000000;

void logLine(const char* line) {
  Serial.println(line);
  Serial.flush();
}

void showSummaryScreen(bool sd_ok, const sd_config_probe::FileProbeResult results[3]) {
  auto& d = M5.Display;
  d.fillScreen(TFT_BLACK);
  d.setTextColor(TFT_WHITE, TFT_BLACK);
  d.setTextSize(2);
  d.setCursor(8, 4);
  d.println("CoreS3 probe B");

  d.setTextSize(1);
  int y = 32;
  auto row = [&](const char* label, bool ok) {
    d.setCursor(8, y);
    d.printf("%s: %s", label, ok ? "OK" : "FAIL");
    y += 16;
  };

  row("SD", sd_ok);
  row(sd_config_probe::kConfigPaths[0].label, results[0].yaml_ok);
  row(sd_config_probe::kConfigPaths[1].label, results[1].yaml_ok);
  row(sd_config_probe::kConfigPaths[2].label, results[2].yaml_ok);
}

}  // namespace

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);

  Serial.begin(115200);
  delay(300);

  logLine("");
  logLine("=== CoreS3 probe B boot ===");
  logLine("step: SD mount + AI_StackChan_Ex YAML paths (no restart on error)");

  logLine("sd: calling SD.begin(GPIO_NUM_4, SPI, 25000000) ...");
  const bool sd_ok = SD.begin(kSdCsPin, SPI, kSdSpiHz);
  if (!sd_ok) {
    logLine("sd: FAIL");
    showSummaryScreen(false, {});
    logLine("setup halted — fix SD card; no restart");
    return;
  }

  logLine("sd: OK");
  Serial.printf("sd: total=%llu used=%llu\n",
                static_cast<unsigned long long>(SD.totalBytes()),
                static_cast<unsigned long long>(SD.usedBytes()));

  if (!sd_config_probe::provisionMinimalBasicConfigIfMissing()) {
    logLine("provision: SC_BasicConfig.yaml skipped or failed (continuing)");
  }

  sd_config_probe::FileProbeResult results[3] = {};
  for (size_t i = 0; i < 3; ++i) {
    const auto& entry = sd_config_probe::kConfigPaths[i];
    results[i] = sd_config_probe::probeConfigFile(entry.path);
    sd_config_probe::logProbeResult(entry.label, results[i]);
  }

  showSummaryScreen(true, results);
  logLine("display: summary on screen (SD + 3 YAML checks)");
  logLine("setup complete — idle loop (no restart)");
}

void loop() {
  M5.update();
  delay(1000);
}
