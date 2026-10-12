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

1. Speech recognition follows the relay/fallback decision below. The browser
   records at most 60 seconds; audio stays on the plant network when relayed,
   or on the device when using whisper.cpp at `http://127.0.0.1:8178/inference`.
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

- Central recognition was initially deferred; the Pi5 measurement below
  led to the plant GPU relay decision.
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

## Pi5 measurement (2026-10-12)

whisper.cpp (CPU, 4 threads, built in a Debian trixie container with
`armv8.2-a+fp16+dotprod`) on the production Pi5, 09:00 with load average
about 5, synthetic Japanese clips of 5.6 s and 17.0 s. Wall time per clip
includes model load.

| Model | 5.6 s clip | 17.0 s clip | Text |
| --- | --- | --- | --- |
| `ggml-small` | 25.5 s | 25.1 s | wrong words (以内→位内, 砥石→トイシ), missing 句点 |
| `ggml-large-v3-turbo` q5_0 | 69.5 s | 71.8 s | one wrong word (チャック→チャックス) |
| `ggml-large-v3-turbo` | 95.4 s | 93.5 s | same as q5_0 |

The same turbo model on the Mac answers in about 7 s. The Pi5 is rejected as
the recognition host for kiosks. The bench folder and image were removed from
the Pi5 afterwards.

## Direction for kiosks (2026-10-12, implemented behind a flag)

- `PROCEDURE_SPEECH_TO_TEXT_ENABLED` defaults to off. With it on and the host
  healthy, every terminal including the Mac sends audio through the Pi5 API
  to the plant GPU host: audio stays on the plant network. The API uses the
  existing `business_hermes` provider origin and business principal, without
  acquiring an LLM runtime lease. The GPU contract belongs to
  `denkoushi/DGXSparkControlPlane` and is already deployed.
- Otherwise (including a failed availability check), terminals fall back to
  the existing on-device whisper server. Recognition failures after choosing
  the relay are shown inline; busy responses retry once.
- Recording limits: 60 seconds, 2,000,000 audio bytes for the relay, 64 kbit/s.
  WebM/Opus is preferred when supported. Audio is buffered in memory only;
  audio, filenames and transcripts are never stored or logged by the relay.
  Existing explicit document saving remains authoritative.
- Live acceptance is not yet done: real kiosk microphone, Firefox/Ogg
  recording, and proxy body limits. Buttons and layout are unchanged.

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
