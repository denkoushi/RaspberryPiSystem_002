---
title: ADR-20261011 Procedure editor voice input on kiosk devices
status: accepted
date: 2026-10-11
---

# ADR-20261011: Procedure editor voice input on kiosk devices

## Context

The 要領書 editor has one free-text field for TEXT overlays. Operators need to
write procedure text by speaking, with explicit saving and the existing undo
history. Some kiosks have no microphone.

## Decision

1. Speech recognition runs on each device using whisper.cpp `whisper-server` at
   `http://127.0.0.1:8178/inference`. The browser records at most 60 seconds and
   sends audio only to this loopback endpoint. Audio never leaves the device.
2. Only recognized text is sent to
   `POST /assembly/procedure-documents/dictation/rewrite`. It uses the existing
   layout-suggestion inference path: the text completion port from
   `getInferenceRuntime()`, the `business_hermes` use case, and runtime
   `ensureReady`/`release`. No DGX configuration, provider, use-case definition,
   environment variable, or model profile is changed.
3. Voice input is opt-in per device, stored as `on`/`off` under
   `assembly-document-editor-voice-input` in localStorage, defaulting to off.
   Kiosks without microphones keep it off. For TEXT overlays, enabling voice
   input adds the voice buttons under the text field; the existing attribute
   controls stay as they are.
4. New text, appended text, and spoken revisions update the selected TEXT
   overlay once per voice change. The existing undo history and explicit save
   remain authoritative; 戻す restores the text before the last voice change.
5. Selection changes, disabling voice input, and unmounting abort pending work
   and stop media tracks. The API uses kiosk write authorization, a 20/minute
   route limit, and cancellation when the client disconnects. Input text is
   model data, with editing rules confined to the Japanese system message.
6. If rewriting fails, new/append insert the recognized text with
   `そのまま入れました`; revise preserves the current text with `直せませんでした`.

## Alternatives

- Central speech recognition would require sending device audio over the
  network and is outside this decision.
- A new inference use case or provider would expand configuration scope; the
  existing layout-suggestion completion path already serves procedure editing.

- Personal smartphones as microphones (2026-10-11, rejected): phones cannot
  join the plant Wi-Fi, so audio would need an off-site relay; Bluetooth from a
  browser works on Android only. Kiosks get a USB microphone instead.

## Next step (decided 2026-10-11)

- Kiosk (Pi4) terminals get a USB microphone. Pi4 cannot run whisper at a
  usable speed, so recognition for kiosks must run on a plant server. Measure
  whisper on Pi5 after the Mac version is deployed; if too slow, use the plant
  GPU host. This changes the "audio stays on the device" rule to "audio stays
  on the plant network" for those terminals and needs its own ADR update.

## Consequences

- whisper-server must be started with `--convert` and ffmpeg must be installed
  on the device: the browser uploads WebM/Opus, which the server only accepts
  through that conversion.

- Devices must run whisper-server with browser-accessible CORS (`*`). The
  browser may ask for local-network permission as well as microphone access.
- In-house LLM quality and latency have not yet been measured on kiosks.
- Browser recording support and microphone availability remain device-specific.
- Local recognition failures are shown inline. Rewriting output is trimmed,
  stripped of wrappers and leading labels, and rejected if empty or longer
  than 10000 characters. Upstream failure details are not returned to clients.

## References

- Approved mock: [procedure-voice-input-mock.html](../design-previews/procedure-voice-input-mock.html)
- Existing implementation: [procedure-layout-suggestion.service.ts](../../apps/api/src/services/assembly/procedure-layout-suggestion.service.ts)
