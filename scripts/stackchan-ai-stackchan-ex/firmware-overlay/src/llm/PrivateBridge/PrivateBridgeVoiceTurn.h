#ifndef PRIVATE_BRIDGE_VOICE_TURN_H
#define PRIVATE_BRIDGE_VOICE_TURN_H

#include <Arduino.h>

bool private_bridge_voice_turn_enabled();
/** Record mic, POST WAV to STACKCHAN_VOICE_TURN_URL, play Pi5 audioUrl. Returns true if handled. */
bool private_bridge_voice_turn_run();

#endif
