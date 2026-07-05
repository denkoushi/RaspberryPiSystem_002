# Restart StackChan as a Spark-backed voice assistant

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `.agent/PLANS.md`. It is self-contained enough for a new agent or human to resume the work without reading prior chat history first.

## Purpose / Big Picture

The user wants StackChan to become a practical voice conversation terminal. A person should be able to speak to StackChan, have the request processed through the private Raspberry Pi 5 and DGX Spark, and hear a spoken answer from StackChan. The implementation method is flexible, but DGX Spark must be used for the language model stage.

The previous attempt failed around firmware stability, display bring-up, and custom firmware overlays. This restart deliberately avoids returning to the same risky path first. The new path uses current community information from July 2026 and starts with the least invasive architecture: keep StackChan firmware as close as possible to current community-supported `AI_StackChan_Ex`, expose a standard OpenAI-compatible Chat Completions endpoint from the private Pi5 bridge, and let that bridge call DGX Spark. Device flashing remains halted by ADR-20260531 until the PlatformIO / M5Unified / board / partition / LCD-init gap analysis is complete and the runbook is updated; build-only success and newer M5Unified evidence are not enough to lift that halt.

The first observable success is text-only: StackChan sends a chat request to the private Pi5 at `http://<private-pi5-lan-ip>:18080/v1/chat/completions`, the Pi5 forwards it to DGX Spark, and StackChan speaks the returned text. The final observable success is voice: StackChan records audio, the private Pi5 transcribes it, DGX Spark generates the answer, and StackChan speaks the answer.

## Progress

- [x] (2026-07-05 10:20Z) Confirmed current StackChan USB connection from the Mac. `/dev/cu.usbmodem1101` and `/dev/tty.usbmodem1101` were visible, and pyserial read a live serial line: `SystemInfo: free sram: ...`.
- [x] (2026-07-05 10:25Z) Confirmed the user's goal through agmsg: use Spark, implementation method may change, investigate current StackChan community information, plan the work, and use coder/reviewer agents to finish.
- [x] (2026-07-05 10:28Z) Reviewed existing repository source of truth for the previous attempt: `docs/plans/stackchan-private-pi5-tailnet-workflow-plan.md`, `docs/knowledge-base/KB-stackchan-community-firmware-supply-chain.md`, `docs/runbooks/stackchan-cores3-bringup-probe.md`, and `docs/decisions/ADR-20260531-stackchan-cores3-probe-display-halt.md`.
- [x] (2026-07-05 10:28Z) Checked current upstream/community sources. The official `stack-chan/stack-chan` repository is active, `AI_StackChan_Ex` was pushed on 2026-06-28, `AI_StackChan2` was last pushed on 2024-08-14, and `stack-chan/awesome-stack-chan` was created in 2026 as a community resource index.
- [x] (2026-07-05 10:28Z) Discovered a critical new difference from the failed attempt: current `AI_StackChan_Ex` uses `M5Unified @ 0.2.15` for `env:m5stack-cores3` with the comment `Add support StackChan board`; the failed local probe path used older M5Unified versions such as `0.2.7`.
- [x] (2026-07-05 10:28Z) Created this restart ExecPlan.
- [x] (2026-07-05 10:28Z) Asked the `coder` agmsg agent to inspect and implement the private Pi5 bridge changes for an OpenAI-compatible `/v1/chat/completions` endpoint and tests.
- [x] (2026-07-05 10:28Z) Asked the `reviewer` agmsg agent to review this plan and later review implementation diffs before any device flash or deployment.
- [x] (2026-07-05 10:32Z) Implemented and tested the private Pi5 bridge OpenAI-compatible endpoint locally. Added `validate_openai_compatible_chat_payload`, added `/v1/chat/completions` route handling, and added unittest coverage.
- [x] (2026-07-05 10:45Z) Received reviewer changes-requested feedback and updated this plan before further implementation or any firmware action. The coder handoff now needs to validate/review existing WIP rather than duplicate the bridge implementation.
- [x] (2026-07-05 10:54Z) Received coder verification for Milestone 1-2 and tightened OpenAI-compatible error responses on `/v1/chat/completions`; local bridge tests now run 35 tests.
- [x] (2026-07-05 10:55Z) Built latest selected `AI_StackChan_Ex` for `m5stack-cores3` without uploading. Build-only succeeded for upstream commit `b5322e0795b2d8b17acfa65953b0194fe75b7dc1` with M5Unified `0.2.15`, M5GFX `0.2.24`, and stackchan-arduino `0.0.7+sha.b7b98f5`.
- [x] (2026-07-05 11:05Z) Completed and documented the ADR-required PlatformIO / M5Unified / board / partition / LCD-init gap analysis in `docs/runbooks/stackchan-cores3-bringup-probe.md`.
- [x] (2026-07-05 11:12Z) Prepared secret-free SD YAML templates for `AI_StackChan_Ex` using `llm.type: 4` and `customEndpoint: http://<PRIVATE_PI5_LAN_IP>:18080/v1/chat/completions`.
- [x] (2026-07-05 11:20Z) Received reviewer additional review with no blocking findings for the OpenAI-compatible error shape, SD templates, build-only evidence, and pre-flash gap analysis.
- [x] (2026-07-05 11:40Z) Hardened the OpenAI-compatible bridge docs and tests. Added bearer-token success coverage for `/v1/chat/completions`, documented the endpoint/error-shape split in the bridge README, and added a private Pi5 loopback smoke to the deploy runbook. Local bridge tests now run 36 tests.
- [ ] Reassess the flash gate with the user. Do not flash StackChan until the gap analysis and runbook update are complete, build-only checks pass, reviewer approves, and the user explicitly approves the exact flash attempt.
- [ ] Validate text-only StackChan to Pi5 to DGX Spark to spoken response.
- [ ] Choose and implement the voice path after text-only success: either current `AI_StackChan_Ex` native STT/TTS configuration, Pi5-compatible STT/TTS endpoints, or a minimal one-turn voice bridge if native configuration cannot target the private Pi5 cleanly.
- [ ] Validate voice end-to-end and update this plan, runbooks, and KB with the final source of truth.

## Surprises & Discoveries

- Observation: Current `AI_StackChan_Ex` has native OpenAI-compatible endpoint support for the LLM stage.
  Evidence: `doc/custom_endpoint_en.md` says `llm.type: 4` uses an OpenAI-compatible Chat Completions URL such as `http://192.168.X.XXX:8080/v1/chat/completions`, with `model` required and `stream: false`.

- Observation: Current `AI_StackChan_Ex` may have addressed the exact class of CoreS3 display issue that stopped the previous attempt.
  Evidence: `firmware/platformio.ini` in upstream `AI_StackChan_Ex` now sets `m5stack/M5Unified @ 0.2.15` for `env:m5stack-cores3` and comments `Add support StackChan board`. The previous local probe records in this repository used older M5Unified versions and concluded that the Arduino/M5Unified display path was incompatible.

- Observation: `stackchan-arduino` now documents that official M5Stack StackChan users should use library version `0.0.7` or later.
  Evidence: current upstream `AI_StackChan_Ex` Basic Usage says, for M5StackChan official products, use `stackchan-arduino` v0.0.7 or higher. The `stack-chan/stackchan-arduino` main branch commit `b7b98f5b19c6cae581782fc127f1fa1274b035a8` is version `0.0.7`.

- Observation: The official StackChan roadmap is moving toward pluggable AI interfaces, but the planned official platform timeline is not the quickest route for this user's Spark goal today.
  Evidence: `stack-chan/stack-chan` roadmap last updated 2026-03-27 lists Phase 3, October to December 2026, for a standardized pluggable AI runtime. For July 2026, `AI_StackChan_Ex` already has the practical OpenAI-compatible LLM hook we need.

- Observation: Local documentation mentions `voice_assistant_core.py`, but the current worktree under `scripts/private-pi5-stackchan-bridge/` does not contain that source file.
  Evidence: `docs/knowledge-base/KB-stackchan-community-firmware-supply-chain.md` lists `voice_assistant_core.py`, while `ls scripts/private-pi5-stackchan-bridge` shows `stackchan_utterance_core.py`, `stt_bridge_core.py`, `stt_runtime_client.py`, and `stackchan_chat_core.py`, but not `voice_assistant_core.py`. Treat the docs as partly stale for this point until code history is checked.

- Observation: The agent sandbox does not permit binding a localhost test server, so the bridge route test should not depend on opening a TCP port.
  Evidence: `python3 -m unittest discover scripts/private-pi5-stackchan-bridge/tests` initially failed with `PermissionError: [Errno 1] Operation not permitted` when a test attempted to bind `127.0.0.1:0`. The test was changed to invoke `Handler._handle_post` with a fake handler object, preserving route behavior coverage without socket binding.

- Observation: Latest selected `AI_StackChan_Ex` builds cleanly for `m5stack-cores3` without touching the device.
  Evidence: `env PLATFORMIO_CORE_DIR=/private/tmp/pio-core pio run -e m5stack-cores3` in `/private/tmp/AI_StackChan_Ex-spark-restart/firmware` finished `SUCCESS` in 00:04:24.450. The firmware image used 68,996 bytes RAM and 2,558,133 bytes flash.

- Observation: M5Unified/M5GFX has improved StackChan recognition, but the official StackChan power/display path is still broader than the `AI_StackChan_Ex` Arduino path.
  Evidence: M5GFX `0.2.24` has `board_M5StackChan` detection through GC0308 and M5IOE1 address `0x6F`, then uses `Panel_M5StackCoreS3` and `Light_M5StackCoreS3`. Current official `stack-chan/stack-chan` develop commit `e33094a4e9688318823a5775979a2620d49d0c0e` has a `m5stackchan_cores3` platform whose `setup-target.js` applies additional AXP2101 power rail writes (`0x90`, `0x97`, `0x69`, `0x30`, `0x94`, `0x95`, `0x27`, `0x62`). This keeps the display/power-init gate meaningful even after build-only success.

## Decision Log

- Decision: DGX Spark remains mandatory, but StackChan firmware should not directly know DGX internals.
  Rationale: The user explicitly required Spark. Keeping Spark behind the private Pi5 bridge preserves the previous architecture's security boundary and avoids embedding DGX tokens or tailnet assumptions into the ESP32 firmware.
  Date/Author: 2026-07-05 / planner

- Decision: Prefer latest `AI_StackChan_Ex` plus its supported OpenAI-compatible LLM endpoint over the previous custom `ChatGPT.cpp` patch path.
  Rationale: The previous patch path was fragile and contributed to drift between local patches, build flags, and flashed firmware. Current `AI_StackChan_Ex` has a documented `llm.type: 4` mode that can target a private OpenAI-compatible server by YAML, so the Pi5 bridge can adapt to StackChan instead of patching StackChan deeply.
  Date/Author: 2026-07-05 / planner

- Decision: Implement the private Pi5 bridge endpoint `/v1/chat/completions` before touching the device firmware.
  Rationale: This can be tested locally with unit tests and curl, proves Spark routing, and gives StackChan a standard endpoint. It reduces the blast radius before any flash.
  Date/Author: 2026-07-05 / planner

- Decision: Do not flash the StackChan device as part of planning or initial bridge implementation.
  Rationale: The previous state was an accepted ADR to keep the device on official firmware because Arduino/M5Unified display was failing. The new M5Unified evidence justifies re-evaluation, not immediate reversal. Flashing requires build evidence, reviewer approval, and explicit user approval.
  Date/Author: 2026-07-05 / planner

- Decision: Treat ADR-20260531 as the controlling flash gate until explicitly superseded.
  Rationale: ADR-20260531 and `docs/runbooks/stackchan-cores3-bringup-probe.md` require no additional probe or `AI_StackChan_Ex` flashes until the PlatformIO / M5Unified / board / partition / LCD-init gap analysis is complete and the runbook is updated. A successful build-only result and newer upstream dependency versions are useful evidence, but they do not by themselves authorize upload.
  Date/Author: 2026-07-05 / planner

- Decision: Treat `AI_StackChan2` as a reference only, not the primary route.
  Rationale: It is a relevant origin project and has voice features, but its main branch has not been pushed since 2024-08-14. `AI_StackChan_Ex` is active in 2026 and includes the OpenAI-compatible endpoint support we need.
  Date/Author: 2026-07-05 / planner

- Decision: Accept both `X-Stackchan-Token` and `Authorization: Bearer <token>` on the private Pi5 bridge when `STACKCHAN_TOKEN` is configured.
  Rationale: Existing StackChan-specific routes already used `X-Stackchan-Token`. Current `AI_StackChan_Ex` OpenAI-compatible endpoint mode sends `SC_SecConfig.yaml` `apikey.aiservice` as an OpenAI-style bearer token, so accepting bearer auth lets the standard firmware configuration authenticate without another firmware patch.
  Date/Author: 2026-07-05 / planner

## Outcomes & Retrospective

The first repo implementation milestone is complete locally. The private Pi5 bridge now has an OpenAI-compatible chat ingress intended for `AI_StackChan_Ex` `llm.type: 4`, while still routing the actual LLM call through DGX Spark. The route accepts `Authorization: Bearer <STACKCHAN_TOKEN>` for the standard firmware configuration path, and the behavior is covered by local route tests. The latest selected `AI_StackChan_Ex` CoreS3 firmware path also builds without upload. This does not deploy anything and does not flash the StackChan device. The remaining gate before any flash discussion is reviewer/user approval of the documented display/power-init gap analysis and the exact first flash candidate.

## Context and Orientation

StackChan is a small M5Stack-based robot. In this repository, "StackChan" refers to the user's M5Stack CoreS3-based physical device connected to the Mac over USB. "Spark" means DGX Spark, the local GPU system that serves OpenAI-compatible LLM endpoints such as `/v1/chat/completions`. "Private Pi5" means the user's home Raspberry Pi 5 that acts as a boundary host between StackChan on the home LAN and DGX Spark.

The intended runtime boundary is:

StackChan on home Wi-Fi sends HTTP requests to private Pi5. Private Pi5 runs `scripts/private-pi5-stackchan-bridge/bridge_server.py`. That bridge calls DGX Spark through `scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py`. StackChan must not carry DGX secrets. StackChan should only know a LAN URL on the private Pi5.

The previous source-of-truth documents are:

- `docs/plans/stackchan-private-pi5-tailnet-workflow-plan.md`: older plan for StackChan through private Pi5 to DGX Spark.
- `docs/knowledge-base/KB-stackchan-community-firmware-supply-chain.md`: failure history, supply-chain notes, and dated observations.
- `docs/runbooks/stackchan-cores3-bringup-probe.md`: previous CoreS3 display probe and the current "do not flash" status.
- `docs/decisions/ADR-20260531-stackchan-cores3-probe-display-halt.md`: accepted decision to halt probe and `AI_StackChan_Ex` flashes after display failures.

The relevant current code is:

- `scripts/private-pi5-stackchan-bridge/bridge_server.py`: Python HTTP server exposing StackChan-specific endpoints such as `/api/stackchan/chat/simple`, `/api/stackchan/stt`, and `/api/stackchan/utterance`.
- `scripts/private-pi5-stackchan-bridge/stackchan_chat_core.py`: validation and DGX chat workflow for StackChan chat payloads.
- `scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py`: client for DGX Spark `/v1/chat/completions`, optional runtime start, and ready polling.
- `scripts/private-pi5-stackchan-bridge/stt_runtime_client.py` and `stt_bridge_core.py`: STT bridge support, including local `faster-whisper` or upstream OpenAI-compatible transcription.
- `scripts/private-pi5-stackchan-bridge/stackchan_utterance_core.py`: one-request audio-to-text-to-chat workflow returning text fields.
- `scripts/stackchan-ai-stackchan-ex/`: local helper scripts and historical overlays for `AI_StackChan_Ex`. These are useful for supply-chain locking and Mac USB workflows, but the restart should avoid the old utterance overlay until text-only is stable.

Current upstream/community facts checked on 2026-07-05:

- `https://github.com/stack-chan/stack-chan` is the official StackChan repository. GitHub API reported default branch `develop`, `pushed_at: 2026-07-05T08:32:49Z`, 1,576 stars, and 193 forks. Its latest release remains `v0.2.1` from 2022, so releases are not a good proxy for current development.
- The official roadmap at `https://raw.githubusercontent.com/stack-chan/stack-chan/develop/docs/ROADMAP.md` was last updated 2026-03-27. It prioritizes browser-first development and later pluggable AI interfaces.
- `https://github.com/ronron-gh/AI_StackChan_Ex` is active and practical for this goal. GitHub API reported `pushed_at: 2026-06-28T07:14:58Z`; the latest commit adds PlatformIO CI and bumps firmware version to `0.22.1`. Its README says it supports Core2 and CoreS3, Module LLM, Realtime API, YAML configuration, user applications, and OpenAI-compatible endpoints.
- `AI_StackChan_Ex` `doc/custom_endpoint_en.md` documents `llm.type: 4` for OpenAI-compatible Chat Completions endpoints. This directly supports a private Pi5 endpoint.
- `AI_StackChan_Ex` `firmware/platformio.ini` currently sets `m5stack/M5Unified @ 0.2.15` for `env:m5stack-cores3` with a comment that this adds StackChan board support.
- `https://github.com/robo8080/AI_StackChan2` is relevant but older. GitHub API reported `pushed_at: 2024-08-14T09:46:01Z`.
- `https://github.com/stack-chan/awesome-stack-chan` is a new community index created in 2026, but as of checking it is still sparse.
- `https://github.com/m5stack/M5Unified/releases/tag/0.2.17` was published 2026-06-02. The exact StackChan support was observed in `AI_StackChan_Ex` through its use of `M5Unified @ 0.2.15`, not by a detailed M5Unified release note.
- `https://github.com/stack-chan/stack-chan` develop was also cloned for source comparison at commit `e33094a4e9688318823a5775979a2620d49d0c0e` from 2026-06-30. Its current `m5stackchan_cores3` platform is useful display/power-init evidence, but it is not the same artifact as the earlier official UserDemo V1.4.1 recovery binary.

## Plan of Work

Milestone 1 created a standard LLM ingress on the private Pi5 bridge. The current WIP adds an OpenAI-compatible `POST /v1/chat/completions` route to `scripts/private-pi5-stackchan-bridge/bridge_server.py`. This route accepts the same shape StackChan sends in OpenAI-compatible mode: `model`, `messages`, optional `max_tokens` or `max_completion_tokens`, optional `temperature`, and `stream`. It rejects streaming with an OpenAI-style JSON error because `AI_StackChan_Ex` type 4 already sends `stream: false`. It reuses the existing `validate_chat_payload`, `ChatCompletionWorkflow`, `DgxUpstreamClient`, and Home Assistant context injection, then returns the raw OpenAI-compatible DGX response to the caller. The model sent by StackChan is accepted for request compatibility, but the bridge continues using the configured DGX model unless a later decision explicitly permits device-chosen models. The next action for coder/reviewer is to validate this WIP, not reimplement it from scratch.

Milestone 2 hardens tests and local validation. The current WIP adds `validate_openai_compatible_chat_payload` in `stackchan_chat_core.py` and tests it directly, plus route behavior tests in `test_bridge_server.py` that invoke the handler without binding a local socket. Existing tests in `scripts/private-pi5-stackchan-bridge/tests/` are unittest-based and can be extended without new dependencies. The expected tests cover valid request, empty messages, `stream: true` rejection, token cap, and successful DGX response pass-through.

Milestone 3 prepares the current community firmware path without touching the device. Update or add a Mac helper under `scripts/stackchan-ai-stackchan-ex/` only if needed to clone a chosen `AI_StackChan_Ex` commit, pin GitHub dependencies, and run build-only for `m5stack-cores3`. Do not apply the previous `utterance` overlay by default. The build-only command must capture the exact upstream commit and the effective `platformio.ini` versions, especially M5Unified and stackchan-arduino. If build-only fails, stop and fix the build path before considering flash.

Milestone 4 prepares SD configuration. The key file is `/app/AiStackChanEx/SC_ExConfig.yaml` on the StackChan SD card. For text-only, set `llm.type: 4`, `llm.model` to a stable label such as `spark-qwen`, and `llm.customEndpoint` to `http://<private-pi5-lan-ip-or-compat-ip>:18080/v1/chat/completions`. Set `SC_SecConfig.yaml` `apikey.aiservice` to a non-secret placeholder if the Pi5 endpoint does not require bearer auth, or to `STACKCHAN_TOKEN` only if the bridge is updated to accept `Authorization: Bearer`. Prefer no real cloud API keys on the SD card.

Milestone 5 is the flash gate. ADR-20260531 is still accepted and the runbook still says `AI_StackChan_Ex` upload is fully stopped. Before uploading any firmware, complete and record the PlatformIO / M5Unified / board / partition / LCD-init gap analysis against the official UserDemo stack, update `docs/runbooks/stackchan-cores3-bringup-probe.md`, confirm the current official firmware still shows a display, confirm USB serial is visible, confirm latest `AI_StackChan_Ex` build-only has succeeded, obtain reviewer approval of the plan and diffs, and obtain the user's explicit approval for the exact flash attempt. The first possible flash candidate after those gates should be the latest upstream `AI_StackChan_Ex` `env:m5stack-cores3` with no custom voice overlay. The acceptance for flash is not "upload succeeded"; it is "display shows a usable UI or serial logs identify a recoverable configuration error without black-screen regression."

Milestone 6 validates text-only. With StackChan on Wi-Fi and the Pi5 bridge running, trigger a short chat request from StackChan. Acceptable evidence is: Pi5 bridge logs `POST /v1/chat/completions`, DGX Spark returns HTTP 200, StackChan receives non-empty assistant text, and the user can hear or see the response. If StackChan returns HTTP 200 but speaks a fallback such as `わかりません`, inspect serial and bridge logs before changing firmware.

Milestone 7 chooses the voice path. There are three acceptable branches. Branch A uses `AI_StackChan_Ex` native STT/TTS settings if they can be pointed safely to local/private endpoints. Branch B adds Pi5 compatibility endpoints that mimic the services expected by `AI_StackChan_Ex`, such as OpenAI-compatible transcription for STT and a VOICEVOX-compatible audio response if the firmware can target it. Branch C revives a minimal one-turn voice endpoint only after text-only is stable, avoiding the old `utterance` overlay unless it is demonstrably the smallest safe change. Spark remains the LLM in every branch.

Milestone 8 completes production documentation. Update this ExecPlan, the relevant runbook, and the KB with the actual selected firmware commit, bridge endpoints, SD YAML, test commands, serial evidence, and final acceptance results. Do not duplicate full details into `docs/INDEX.md`; keep index entries short.

## Concrete Steps

Work from the repository root:

    cd /Users/tsudatakashi/RaspberryPiSystem_002

Check the current USB device:

    find /dev -maxdepth 1 -name 'cu.usb*' -print
    find /dev -maxdepth 1 -name 'tty.usb*' -print

Expected current output includes:

    /dev/cu.usbmodem1101
    /dev/tty.usbmodem1101

Read serial without PlatformIO's interactive terminal if `pio device monitor` fails in this agent environment:

    python3 -c 'import serial,time; p="/dev/cu.usbmodem1101"; s=serial.Serial(p,115200,timeout=0.5); end=time.time()+8; data=b""; print("OPEN",p); \
    while time.time()<end: data += s.read(4096); \
    s.close(); print(data.decode("utf-8","replace") if data else "NO_SERIAL_DATA")'

Expected proof of life is any device log line, for example:

    OPEN /dev/cu.usbmodem1101
    I (...) SystemInfo: free sram: ...

Validate the current Milestone 1 and 2 private Pi5 bridge WIP. Do not duplicate the implementation; review these files:

    scripts/private-pi5-stackchan-bridge/bridge_server.py
    scripts/private-pi5-stackchan-bridge/stackchan_chat_core.py
    scripts/private-pi5-stackchan-bridge/tests/test_stackchan_chat_core.py
    scripts/private-pi5-stackchan-bridge/tests/test_bridge_server.py

Run bridge tests. In this repository's current test layout, use `PYTHONPATH` so direct imports in existing tests resolve:

    env PYTHONPATH=scripts/private-pi5-stackchan-bridge python3 -m unittest discover -s scripts/private-pi5-stackchan-bridge/tests -p 'test_*.py'

If this repository's Python environment changes, use the same unittest command from the repository root before adding dependencies. Expected result is all tests passing, including new tests for `/v1/chat/completions`.

Current observed result:

    ..................................
    ----------------------------------------------------------------------
    Ran 36 tests in 0.029s

    OK

Build-only latest `AI_StackChan_Ex` after bridge tests pass. Do not upload:

    export STACKCHAN_FW_DIR=/tmp/AI_StackChan_Ex-spark-restart
    # clone and checkout the chosen upstream commit
    # run pio build for env:m5stack-cores3 only
    cd "$STACKCHAN_FW_DIR/firmware"
    pio run -e m5stack-cores3

Observed build-only result:

    upstream commit: b5322e0795b2d8b17acfa65953b0194fe75b7dc1
    build command: env PLATFORMIO_CORE_DIR=/private/tmp/pio-core pio run -e m5stack-cores3
    result: SUCCESS, 00:04:24.450
    RAM: 21.1%, 68996 bytes from 327680 bytes
    Flash: 39.0%, 2558133 bytes from 6553600 bytes
    firmware.bin: 2.4M

Observed dependency versions:

    Platform espressif32 @ 6.3.2
    framework-arduinoespressif32 @ 3.20009.0
    M5Unified @ 0.2.15
    M5GFX @ 0.2.24
    stackchan-arduino @ 0.0.7+sha.b7b98f5
    ArduinoJson @ 7.4.3
    ESP8266Audio @ 1.9.9
    YAMLDuino @ 1.5.0

Build-only evidence is not a flash authorization.

Before any upload, complete the ADR-required gap analysis and runbook update:

    docs/decisions/ADR-20260531-stackchan-cores3-probe-display-halt.md
    docs/runbooks/stackchan-cores3-bringup-probe.md

The gap analysis must cover at least PlatformIO environment, M5Unified version and board support, board selection, partition layout, Arduino core or IDF baseline, LCD initialization, and backlight/power initialization compared with the official UserDemo path. Do not upload while this analysis is incomplete.

Prepare SD YAML with the OpenAI-compatible endpoint. Example values:

    # /app/AiStackChanEx/SC_ExConfig.yaml
    llm:
      type: 4
      model: "spark-qwen"
      customEndpoint: "http://<PRIVATE_PI5_LAN_IP>:18080/v1/chat/completions"

    # /yaml/SC_SecConfig.yaml
    wifi:
      ssid: "<home wifi ssid>"
      password: "<home wifi password>"
    apikey:
      aiservice: "not-used-local-bridge"

Use the current private Pi5 LAN IP or compatibility alias (`<PRIVATE_PI5_LAN_IP>` or `<PRIVATE_PI5_COMPAT_ALIAS>`). Confirm the live value with `hostname -I` on the private Pi5 before writing SD YAML. Historical DHCP / compatibility-alias drift is documented in [bridge README §LAN IP drift](../../scripts/private-pi5-stackchan-bridge/README.md#lan-ip-drift-の注意) and [KB-stackchan-community-firmware-supply-chain](../../docs/knowledge-base/KB-stackchan-community-firmware-supply-chain.md); do not copy literal IPs into this plan.

Secret-free templates now exist for manual SD preparation:

    scripts/stackchan-ai-stackchan-ex/fixtures/sd/app/AiStackChanEx/SC_ExConfig.spark.template.yaml
    scripts/stackchan-ai-stackchan-ex/fixtures/sd/yaml/SC_SecConfig.spark.template.yaml
    scripts/stackchan-ai-stackchan-ex/fixtures/sd/README.md

These templates are not written to the SD card automatically. Replace `<PRIVATE_PI5_LAN_IP>`, Wi-Fi placeholders, and `STACKCHAN_TOKEN` only outside git. DGX/Spark details stay on the private Pi5 bridge, not on the StackChan SD card.

## Validation and Acceptance

Local bridge acceptance:

- `env PYTHONPATH=scripts/private-pi5-stackchan-bridge python3 -m unittest discover -s scripts/private-pi5-stackchan-bridge/tests -p 'test_*.py'` passes.
- A local HTTP request to `POST /v1/chat/completions` with `stream:false` and a small `messages` array returns an OpenAI-compatible JSON object with `choices[0].message.content`.
- A local HTTP request with `stream:true` is rejected with a clear JSON error and does not call DGX.
- OpenAI-compatible route errors use an OpenAI-style `{"error": ...}` payload, while existing `/api/stackchan/*` routes keep the bridge `{"ok": false, "error": ...}` shape.
- If DGX Spark is stopped and auto-start is enabled, the bridge behavior matches the existing `ChatCompletionWorkflow` retry contract.

Firmware build acceptance:

- Latest selected `AI_StackChan_Ex` commit builds with `pio run -e m5stack-cores3`.
- The build evidence records M5Unified and stackchan-arduino versions.
- No upload occurs during build acceptance.

Current observed firmware build acceptance:

- `env PLATFORMIO_CORE_DIR=/private/tmp/pio-core pio run -e m5stack-cores3` succeeded for `b5322e0795b2d8b17acfa65953b0194fe75b7dc1`.
- `env PLATFORMIO_CORE_DIR=/private/tmp/pio-core pio pkg list -e m5stack-cores3` recorded the dependency versions above.
- No upload occurred.

Flash acceptance:

- The PlatformIO / M5Unified / board / partition / LCD-init gap analysis is complete and `docs/runbooks/stackchan-cores3-bringup-probe.md` has been updated.
- User explicitly approves the exact flashing attempt after seeing the build, gap analysis, runbook update, and review status.
- Upload succeeds.
- After reset, the display is not black, or serial logs show a clear recoverable configuration error.
- If the display regresses to black, stop, document logs, and restore official firmware or M5Burner flow before further experiments.

Text-only end-to-end acceptance:

- StackChan is on Wi-Fi.
- The Pi5 bridge logs a new `POST /v1/chat/completions`.
- DGX Spark is the upstream LLM, verified by bridge logs or DGX request logs.
- The response contains non-empty assistant content.
- The user can hear or see the response on StackChan.

Voice end-to-end acceptance:

- The user speaks a short Japanese phrase to StackChan.
- STT returns the correct or acceptably close text.
- DGX Spark receives the text and returns a reply.
- StackChan speaks the reply.
- The round-trip latency is recorded. The first acceptable target is correctness and repeatability, not minimum latency.

## Idempotence and Recovery

All bridge code changes must be additive and testable before deployment. Re-running tests is safe. Re-running the build-only firmware step is safe if it uses the same pinned upstream commit and does not upload.

Device upload is not idempotent in the safety sense because it changes the physical device's firmware. Treat every upload as a gated operation. If a flash causes black screen or no response, use the already documented official firmware recovery path from `docs/runbooks/stackchan-cores3-bringup-probe.md`: power cycle first, then M5Burner or the known official UserDemo recovery if needed. Do not repeatedly upload experimental firmware while the display state is unknown.

Do not place DGX tokens, OpenAI keys, or other secrets on the StackChan SD card. The private Pi5 bridge is the boundary that may hold secrets. If authentication is needed between StackChan and Pi5, prefer a LAN-only token checked by the Pi5 bridge; document exactly where it is stored.

## Artifacts and Notes

Current USB proof:

    /dev/cu.usbmodem1101
    /dev/tty.usbmodem1101
    OPEN /dev/cu.usbmodem1101
    I (860775) SystemInfo: free sram: 165075 minimal sram: 165075

Current web/community findings from 2026-07-05:

    stack-chan/stack-chan:
      default_branch: develop
      pushed_at: 2026-07-05T08:32:49Z
      latest release: v0.2.1, published 2022-09-05
      roadmap last updated: 2026-03-27

    ronron-gh/AI_StackChan_Ex:
      pushed_at: 2026-06-28T07:14:58Z
      latest commit: b5322e0795b2d8b17acfa65953b0194fe75b7dc1
      latest commit summary: Add CI build; firmware version 0.22.1
      relevant feature: OpenAI-compatible Chat Completions endpoint through llm.type 4
      CoreS3 env uses: M5Unified @ 0.2.15, comment "Add support StackChan board"

    robo8080/AI_StackChan2:
      pushed_at: 2024-08-14T09:46:01Z
      relevant as historical reference, not primary restart path

    stack-chan/stackchan-arduino:
      latest main commit: b7b98f5b19c6cae581782fc127f1fa1274b035a8
      commit date: 2026-05-07
      version raised to 0.0.7

Current build-only evidence from 2026-07-05:

    command:
      env PLATFORMIO_CORE_DIR=/private/tmp/pio-core pio run -e m5stack-cores3
    working directory:
      /private/tmp/AI_StackChan_Ex-spark-restart/firmware
    result:
      SUCCESS in 00:04:24.450
    output artifact:
      /private/tmp/AI_StackChan_Ex-spark-restart/firmware/.pio/build/m5stack-cores3/firmware.bin
      size: 2.4M
    note:
      build-only did not upload or otherwise touch the StackChan device

Current SD YAML template evidence from 2026-07-05:

    SC_ExConfig template:
      scripts/stackchan-ai-stackchan-ex/fixtures/sd/app/AiStackChanEx/SC_ExConfig.spark.template.yaml
      llm.type: 4
      llm.model: spark-qwen
      llm.customEndpoint: http://<PRIVATE_PI5_LAN_IP>:18080/v1/chat/completions
    SC_SecConfig template:
      scripts/stackchan-ai-stackchan-ex/fixtures/sd/yaml/SC_SecConfig.spark.template.yaml
      apikey.aiservice: <STACKCHAN_TOKEN_OR_DUMMY>
    note:
      templates contain placeholders only and were not written to the SD card

## Interfaces and Dependencies

At the end of Milestone 1, the private Pi5 bridge must expose:

    POST /v1/chat/completions

Input contract:

    {
      "model": "spark-qwen",
      "messages": [
        {"role": "user", "content": "こんにちは"}
      ],
      "max_tokens": 160,
      "temperature": 0.35,
      "stream": false
    }

Output contract on success:

    {
      "model": "...",
      "choices": [
        {"message": {"content": "..."}}
      ],
      "usage": {...}
    }

The route may return the DGX upstream response directly as long as it is OpenAI-compatible. On `/v1/chat/completions` errors, return OpenAI-style JSON with a top-level `error` object. Existing bridge-specific routes may continue returning the bridge `ok:false` envelope. Do not silently fall back to a cloud endpoint.

Current implementation status:

    scripts/private-pi5-stackchan-bridge/stackchan_chat_core.py
      validate_openai_compatible_chat_payload(...)

    scripts/private-pi5-stackchan-bridge/bridge_server.py
      POST /v1/chat/completions
      token auth accepts X-Stackchan-Token or Authorization: Bearer when STACKCHAN_TOKEN is configured

    scripts/private-pi5-stackchan-bridge/tests/test_stackchan_chat_core.py
      OpenAI-compatible validation tests

    scripts/private-pi5-stackchan-bridge/tests/test_bridge_server.py
      route behavior and OpenAI-compatible error-shape tests without binding a local socket

The bridge implementation should keep request validation and OpenAI-compatible request normalization in a testable function, for example:

    def validate_openai_compatible_chat_payload(
        payload: dict[str, Any] | None,
        config: ChatValidationConfig | None = None,
    ) -> tuple[ValidatedChatRequest | None, str | None]:
        ...

This function is implemented in `stackchan_chat_core.py`; `bridge_server.py` calls it for `/v1/chat/completions` while existing `/api/stackchan/chat` paths continue using `validate_chat_payload`.

StackChan SD YAML must eventually use:

    llm.type: 4
    llm.model: "spark-qwen"
    llm.customEndpoint: "http://<private-pi5-lan-ip-or-compat-ip>:18080/v1/chat/completions"

The exact model string in StackChan YAML is a client label. The bridge decides the actual DGX model through `DGX_MODEL` or the existing bridge configuration unless a later decision changes this.

## Revision Notes

- 2026-07-05 / planner: Initial ExecPlan created after current community investigation and local USB proof of life. The main design shift is to use `AI_StackChan_Ex` OpenAI-compatible endpoint support and adapt the private Pi5 bridge, instead of returning first to the previous custom firmware overlay path.
- 2026-07-05 / planner: Updated after implementing the local bridge milestone and running `env PYTHONPATH=scripts/private-pi5-stackchan-bridge python3 -m unittest discover -s scripts/private-pi5-stackchan-bridge/tests -p 'test_*.py'` successfully.
- 2026-07-05 / planner: Addressed reviewer changes-requested feedback. Strengthened the pre-flash gate to preserve ADR-20260531 until gap analysis and runbook update are complete, changed coder handoff from implementation to WIP validation, and replaced the failing bare unittest command with the working `PYTHONPATH` command.
- 2026-07-05 / planner: Recorded successful `AI_StackChan_Ex` `m5stack-cores3` build-only evidence and completed the pre-flash PlatformIO / M5Unified / board / partition / LCD-init gap analysis in the runbook. Flash remains blocked until reviewer and user explicitly approve the exact first flash candidate.
- 2026-07-05 / planner: Tightened `/v1/chat/completions` error responses to OpenAI-style `{"error": ...}` after coder flagged the compatibility detail. Bridge tests then ran 35 tests successfully.
- 2026-07-05 / planner: Added secret-free SD YAML templates for `AI_StackChan_Ex` `llm.type: 4` pointing to the private Pi5 bridge placeholder endpoint. No SD write occurred.
- 2026-07-05 / planner: Recorded reviewer additional review: no blocking findings. Flash remains blocked pending current official display check and explicit user approval for the exact no-overlay upstream candidate.
- 2026-07-05 / coder: Hardened bearer-token coverage and deploy runbook smoke; bridge tests now run 36 tests successfully.
- 2026-07-05 / coder: Replaced concrete private LAN IPs in this plan with `<PRIVATE_PI5_LAN_IP>` / `<PRIVATE_PI5_COMPAT_ALIAS>` placeholders per reviewer request-changes (blocking safety).
