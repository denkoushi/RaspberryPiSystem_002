#ifndef PRIVATE_BRIDGE_UTTERANCE_H
#define PRIVATE_BRIDGE_UTTERANCE_H

#include <Arduino.h>

bool private_bridge_utterance_enabled();
/** Record mic audio, POST WAV to STACKCHAN_UTTERANCE_URL, return replyText (or empty). */
String private_bridge_utterance_turn();

#endif
