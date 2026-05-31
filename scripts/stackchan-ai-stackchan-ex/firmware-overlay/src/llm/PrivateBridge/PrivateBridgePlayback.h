#ifndef PRIVATE_BRIDGE_PLAYBACK_H
#define PRIVATE_BRIDGE_PLAYBACK_H

#include <Arduino.h>

/** Fetch http WAV URL and play via M5.Speaker (Pi5 VOICEVOX artifact). */
bool private_bridge_play_wav_url(const char* url);

/** Minimal UI state: idle/listening/thinking/speaking/error */
void private_bridge_set_state(const char* state);

#endif
