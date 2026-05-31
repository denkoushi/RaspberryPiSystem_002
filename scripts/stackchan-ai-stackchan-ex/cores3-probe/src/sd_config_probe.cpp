#include "sd_config_probe.h"

#include <ArduinoJson.h>
#include <SD.h>
#include <ArduinoYaml.hpp>

namespace sd_config_probe {

namespace {

constexpr char kBasicConfigPath[] = "/yaml/SC_BasicConfig.yaml";

// Canonical copy: scripts/stackchan-ai-stackchan-ex/fixtures/sd/yaml/SC_BasicConfig.yaml
constexpr char kMinimalBasicConfigYaml[] = R"(servo:
  pin:
    x: 18
    y: 17
  center:
    x: 90
    y: 90
  offset:
    x: 0
    y: 0

servo_type: "PWM"
takao_base: false
)";

FileProbeResult fail(const char* detail) {
  FileProbeResult r;
  r.detail = detail;
  return r;
}

}  // namespace

FileProbeResult probeConfigFile(const char* path) {
  if (!SD.exists(path)) {
    return fail("missing");
  }

  FileProbeResult r;
  r.exists = true;

  File file = SD.open(path, FILE_READ);
  if (!file) {
    return fail("open fail");
  }

  const size_t size = file.size();
  if (size == 0) {
    file.close();
    r.detail = "empty";
    return r;
  }
  if (size >= kYamlDocBytes) {
    file.close();
    r.detail = "too large";
    return r;
  }

  DynamicJsonDocument doc(kYamlDocBytes);
  const DeserializationError err = deserializeYml(doc, file);
  file.close();

  if (err) {
    r.detail = err.c_str();
    return r;
  }

  r.yaml_ok = true;
  r.detail = "OK";
  return r;
}

void logProbeResult(const char* label, const FileProbeResult& result) {
  Serial.printf("config[%s]: exists=%s yaml=%s (%s)\n",
                label,
                result.exists ? "yes" : "no",
                result.yaml_ok ? "OK" : "FAIL",
                result.detail);
  Serial.flush();
}

bool provisionMinimalBasicConfigIfMissing() {
  if (SD.exists(kBasicConfigPath)) {
    Serial.println("provision: SC_BasicConfig.yaml already present");
    return true;
  }

  if (!SD.exists("/yaml")) {
    if (!SD.mkdir("/yaml")) {
      Serial.println("provision: mkdir /yaml FAIL");
      return false;
    }
  }

  File file = SD.open(kBasicConfigPath, FILE_WRITE);
  if (!file) {
    Serial.println("provision: open SC_BasicConfig.yaml for write FAIL");
    return false;
  }

  const size_t written = file.print(kMinimalBasicConfigYaml);
  file.close();

  if (written == 0) {
    Serial.println("provision: write SC_BasicConfig.yaml FAIL (0 bytes)");
    return false;
  }

  Serial.println("provision: wrote minimal SC_BasicConfig.yaml to SD");
  return true;
}

}  // namespace sd_config_probe
