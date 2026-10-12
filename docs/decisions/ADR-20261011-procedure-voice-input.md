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

## Direction for kiosks (2026-10-12, not yet implemented)

- Recognition for kiosk terminals runs on the plant GPU host. The kiosk
  browser records from a USB microphone and uploads audio to the Pi5 API;
  the API forwards it to the GPU host over the existing business path
  (`:38081`, existing business principal). Audio stays on the plant network.
- The GPU host side belongs to `denkoushi/DGXSparkControlPlane` and goes
  first, as a backward-compatible addition with its own ExecPlan, branch and
  PR. The closest precedent is the business text-embedding endpoint: opt-in,
  its own unit on loopback, served before inference admission and outside the
  heavy-compute lease.
- Open on the GPU host: CPU or GPU for whisper (coexistence with the business
  LLM pool on unified memory is unproven), latency on that host, and upload
  size limits through the proxy and gateway.
- The kiosk screen keeps the approved buttons (話す / 続き / 直す / 戻す). Only
  the recognition endpoint differs per device.

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
