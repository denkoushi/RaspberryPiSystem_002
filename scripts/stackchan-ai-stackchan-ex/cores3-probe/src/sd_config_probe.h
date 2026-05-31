#pragma once

#include <Arduino.h>

namespace sd_config_probe {

constexpr size_t kYamlDocBytes = 2048;

struct ConfigPath {
  const char* label;
  const char* path;
};

// Same SD layout as AI_StackChan_Ex (doc/basic_usage.md).
constexpr ConfigPath kConfigPaths[] = {
    {"SC_ExConfig", "/app/AiStackChanEx/SC_ExConfig.yaml"},
    {"SC_SecConfig", "/yaml/SC_SecConfig.yaml"},
    {"SC_BasicConfig", "/yaml/SC_BasicConfig.yaml"},
};

struct FileProbeResult {
  bool exists = false;
  bool yaml_ok = false;
  const char* detail = "";
};

FileProbeResult probeConfigFile(const char* path);

void logProbeResult(const char* label, const FileProbeResult& result);

/** Writes fixtures/sd/yaml/SC_BasicConfig.yaml content when path is missing. Never overwrites. */
bool provisionMinimalBasicConfigIfMissing();

}  // namespace sd_config_probe
