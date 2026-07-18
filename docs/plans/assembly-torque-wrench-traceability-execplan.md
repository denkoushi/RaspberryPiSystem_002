---
title: Assembly Torque Wrench Traceability
id: plan-assembly-torque-wrench-traceability
status: active
scope: assembly template tightening conditions, torque wrench master, physical-tool confirmation, torque-agent, private HID capture tooling, torque audit records, responsive kiosk UI
date: 2026-07-17
source_of_truth: this file
related_code: apps/api/prisma/schema.prisma, apps/api/src/routes/assembly, apps/api/src/services/assembly, apps/web/src/features/assembly, apps/web/src/pages/kiosk, packages/shared-types, clients/torque-agent
related_docs: ../decisions/ADR-20260717-assembly-torque-wrench-traceability.md, ../decisions/ADR-20260718-assembly-torque-input-operator-ui.md, ../design-previews/assembly-torque-wrench-traceability-preview.html, ../design-previews/kiosk-assembly-torque-input-operator-preview.html, ./kiosk-assembly-torque-management-mvp.md
validation: preview approved; traceability DB/API/agent/infrastructure and Draft PR CI contracts pass through commit 3566cade; three normal CEM3-BTLA frames are sanitized and the strict unregistered parser adapter passes; Milestone 4A CSS-pixel callout and marker-nudge focused tests, Web lint/build, responsive E2E, and browser inspection pass; Milestone 4B operator-input preview is pending approval; production parser promotion and physical acceptance remain pending
open_items: approve Milestone 4B torque-input operator preview; capture repeated-memory and rapid-consecutive CEM3-BTLA fixtures; record firmware; restore and verify a stable Pi HID bond; register the fixture-proven parser only after the remaining transport matrix passes; perform final Raspberry Pi HID and production-screen acceptance
---

# Add Physical Torque Wrench Traceability to Assembly Work

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current while work proceeds. Maintain this document in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

After this change, an operator can configure one tightening condition once and reuse it across many uniquely numbered circle markers. A required-traceability template identifies the permitted torque-wrench capability rather than one irreplaceable physical tool. At work time, the operator confirms a specific serial-numbered wrench and its displayed settings, and every accepted or rejected torque event records the physical wrench and setting snapshot.

The system must refuse an incompatible, unregistered, uncalibrated, expired, wrongly configured, or unexpected wrench without advancing the current marker. It must still retain the input and reason as an audit event. Existing assembly templates and records remain usable in a legacy mode.

Two explicit gates protect the implementation. First, the user must approve a three-screen interactive design preview at 1920x1080 and 1366x768 before production UI, API, or database changes begin. Second, a real CEM3-BTLA HOGP payload must be captured before the production parser contract is fixed. No guessed separator or field order may cross that gate.

The real-device gate does not prevent preparation of a read-only capture kit. Before the wrench is available, the repository can provide a network-free command that records exact Linux HID key events outside Git, replays synthetic events on macOS, sanitizes literal identifiers, and validates fixture coverage. This preparation must not register a CEM3-BTLA parser or create a sample that could be mistaken for observed device output.

## Progress

- [x] (2026-07-17 06:13Z) Confirmed the original worktree was clean and fetched the latest `origin/main`.
- [x] (2026-07-17 06:13Z) Created `feat/assembly-torque-wrench-traceability` directly from `origin/main` because `main` is checked out by another worktree at `/private/tmp/raspi-phase3`; no other worktree was changed.
- [x] (2026-07-17 06:13Z) Re-read repository safety, architecture, documentation, Git, test, UI, and ExecPlan rules.
- [x] (2026-07-17 06:13Z) Recorded the implementation contract and the preview/payload approval gates in this ExecPlan.
- [x] (2026-07-17 06:32Z) Created and visually verified the interactive design preview for torque-wrench master, template editor, and work/exception states.
- [x] (2026-07-17 06:40Z) Presented the preview evidence and received explicit user approval to proceed with production implementation.
- [x] (2026-07-18 00:55Z) Captured three complete normal CEM3-BTLA transmissions without a discarded warm-up event and committed only literal-redacted `SERIAL_A` evidence.
- [x] (2026-07-18 02:46Z) Implemented the fixture-driven strict parser adapter, derived malformed fixtures, lossless capture buffering/reconnect handling, and tests while keeping the production profile unregistered.
- [ ] Capture repeated-memory and rapid-consecutive evidence, record firmware, restore a stable HID bond, and promote the parser profile only after the remaining gate passes.
- [x] (2026-07-17 07:48Z) Implemented shared types, additive Prisma schema, safe migration, torque-wrench master services, unit conversion, and centralized eligibility policy.
- [x] (2026-07-17 07:48Z) Implemented template condition inheritance, range copy, global marker uniqueness, and hidden server-generated tightening IDs.
- [x] (2026-07-17 07:48Z) Implemented work confirmation, agent event intake, rejected-event audit, idempotency, admin override, and Excel traceability.
- [x] (2026-07-17 07:48Z) Implemented the parser-independent `clients/torque-agent` boundaries and integrated Docker Compose, Ansible, terminal profiles, and health checks.
- [x] (2026-07-17 07:48Z) Ran focused unit/integration, migration/upgrade, EXPLAIN, agent, Docker-runtime, infrastructure, lint, and build validation using disposable resources only.
- [x] (2026-07-17 09:06Z) Updated the canonical assembly/measuring-instrument documents and added an operator-focused torque-agent runbook.
- [x] (2026-07-17 09:28Z) Hardened condition-confirmation reuse, runtime eligibility, event idempotency, future-setting handling, local HID-error retention, and loopback CORS; reran final disposable-resource validation.
- [x] (2026-07-17 10:22Z) Implemented and validated the offline private-capture, replay, sanitization, and fixture-validation kit without importing `evdev` on macOS or registering a CEM3-BTLA parser.
- [x] (2026-07-17 11:20Z) Remediated the first Draft PR CI findings: upgraded the vulnerable FastAPI/Starlette lock, made rate limiting and DOM text construction explicit for CodeQL, and brought torque-agent release lifecycle ownership under the deployment safety contract.
- [x] (2026-07-17 11:31Z) Pushed remediation commit `3776a953` and confirmed Draft PR #1038 passes every required CI job, including the aggregate `ci-required` gate.
- [x] (2026-07-18 03:10Z) Passed 34 agent/capture/parser tests, Ruff, zero-warning root lint, document audit, 621 deployment regressions, deployment safety contracts, and disposable Linux image replay/parser/gate checks; removed the image and left the Pi4 in its normal service state.
- [x] (2026-07-18 03:22Z) Pushed capture/parser commit `c6841ad8` and device-contract documentation commit `3566cade`; Draft PR #1038 passed API, Web, DB, E2E, CodeQL, gitleaks, both Docker-security jobs, deploy contracts, and aggregate `ci-required`.
- [x] (2026-07-18 04:15Z) Reproduced the assembly callout scale defect, traced it to the assembly-only `100 x 100` SVG coordinate space, and confirmed the existing 12 focused unit checks plus four responsive E2E checks do not assert rendered geometry.
- [x] (2026-07-18 04:29Z) Completed Milestone 4A: assembly editor/work/preview now share measured CSS-pixel callout geometry, bolt/check markers use the shared 0.0025 ratio nudge controls, inspection compatibility remains intact, and 23 focused plus 1458 full Web tests, zero-warning root lint, Web build, two-viewport E2E, document audit, and browser inspection pass without database work.
- [x] (2026-07-18 06:10Z) Created child branch `feat/assembly-torque-input-operator-ui` from the clean, synchronized traceability branch and recorded Milestone 4B's preview approval gate.
- [ ] Create and obtain approval for the interactive legacy/agent torque-input operator preview before modifying production React code.
- [ ] Capture the real-device fixtures, complete hardware acceptance, and close the final retrospective.

## Surprises & Discoveries

- Observation: The repository-local `main` branch could not be checked out in this worktree.
  Evidence: `git switch main` returned `fatal: 'main' is already used by worktree at '/private/tmp/raspi-phase3'`. The fetched `origin/main` commit `b4c7d01a` was therefore used directly as the feature-branch base.

- Observation: The existing assembly schema cannot prove that a circle marker is unique across areas in one template.
  Evidence: `AssemblyTemplateBolt` has area-scoped ordering and tightening-ID constraints, while `markerNo` is only indexed by area. The editor also derives a new number from the selected area's current bolt count and renumbers later bolts after deletion.

- Observation: The existing assembly work path treats a wrench as free text and does not preserve a physical serial or settings.
  Evidence: `AssemblyLot.torqueWrenchId` and `AssemblyWorkSession.torqueWrenchId` are strings, while `AssemblyTorqueRecord` records torque value/source/raw payload but has no physical-wrench relation.

- Observation: CEM3-BTLA exposes one-way Bluetooth HOGP keyboard output; system code cannot remotely read the setting displayed on the wrench.
  Evidence: The official product page documents selectable output fields and HOGP communication but not remote setting read/write. This makes operator confirmation plus append-only setting history a required control rather than a UI preference.

- Observation: The in-app browser's explicit viewport override uses a 0.67 device scale, so integer outer dimensions produce CSS viewports one pixel above or below the requested height.
  Evidence: The responsive pass reported 1366x769 for a 915x515 override and 1919x1081 for a 1286x724-equivalent calculation. The default browser rendered clean screenshots at 1910x1075. Acceptance measurements use the CSS viewport and treat the one-pixel height difference as browser instrumentation, not application overflow.

- Observation: The feature migration safely supports both fresh installation and legacy upgrade, and refuses ambiguous historical marker identity.
  Evidence: All 149 migrations applied from zero. A database migrated to the prior version retained representative legacy values after the feature migration. A separate database containing a cross-area duplicate marker failed with SQLSTATE `P0001`; the migration rolled back and the original rows remained unchanged.

- Observation: The intended indexes serve the five high-volume traceability lookups.
  Evidence: With 5,000 profiles, 15,000 settings, 5,000 groups, 10,000 records, `EXPLAIN (ANALYZE, BUFFERS)` selected the serial-key unique index, profile/effective setting index, fastener/group indexes, source-device/event unique index, and session/recorded index respectively. A profile/memory/recorded index was subsequently included in the migration for replay-audit lookup.

- Observation: Runtime health testing caught an incorrect Python module working directory in the first agent image.
  Evidence: The Dockerfile was corrected to copy under `/app/torque-agent` and execute there. The rebuilt multi-stage image was 214 MB and returned `{ok: true, queuedEvents: 0, bound: false}` from its loopback health endpoint.

- Observation: The first confirmation fingerprint incorrectly included the template Bolt ID, so identical conditions on successive unique markers could not reuse one physical-display confirmation.
  Evidence: Resume-time review traced the stale check through policy, API, and Web state. The fingerprint now contains only normalized fastener, capability, and torque condition values; current confirmations search the session and select the latest valid confirmation per physical profile. Integration coverage proves marker ① confirmation is reused at marker ②, while a new setting history immediately makes it stale.

- Observation: Inputs received without a live browser binding or with an invalid payload were only logged and then lost.
  Evidence: HID ingestion was extracted behind `TorqueEventIngestor`. Such inputs now enter a bounded SQLite `torque_local_audit` with reason, raw text, device path, parser profile, and parse error; they are never guessed into a work session. Agent tests prove audit survival across SQLite reopen and normal bound-event queueing.

- Observation: Binding the loopback heartbeat API with wildcard CORS would allow an unrelated browser page to submit a binding request to `127.0.0.1`.
  Evidence: The agent now derives the API origin, accepts only explicitly configured additional Web origins, rejects wildcard/non-origin values during configuration, and limits CORS request headers. A live disposable image returned 200 to the configured kiosk origin and 400 without an allow-origin header to an untrusted origin.

- Observation: Keeping the prior confirmation visible while loading the next marker could leave the previous local binding alive for its heartbeat TTL if the compatibility request failed.
  Evidence: Marker changes now clear the Web confirmation and connection display before fetching reusable confirmation data. An unconfirmed heartbeat explicitly clears the agent binding; a live image test proved the transition `bound=false → true → false`. A same-condition confirmation is then reselected automatically only after the API revalidates it.

- Observation: Before Milestone 2A, `HidLineDecoder` returned only decoded text, discarded unsupported key codes, and did not preserve whether TAB or ENTER terminated the frame.
  Evidence: The pre-kit decoder mapped a small key set and returned a string for any configured terminator. The implemented forensic path now records exact EV_KEY events before decoding and retains unsupported keys and terminators so an unknown character cannot disappear silently.

- Observation: Installing the project root into the Docker builder with Poetry produced an editable console script that referenced the builder-only `/build` path.
  Evidence: The first disposable runtime image found `/opt/venv/bin/torque-capture` but raised `ModuleNotFoundError: torque_agent`. Building a wheel and installing it non-editably into `/opt/venv` fixed the boundary; the rebuilt image ran help, replay, schema-resource, and fixture-validation checks successfully.

- Observation: Standard HID shift/modifier handling is required to preserve payload text without assuming any CEM3-BTLA field format.
  Evidence: The decoder now tracks left/right Shift key-down/up state, supports standard keyboard punctuation, and still retains every unsupported key plus the exact terminator. Unknown-key frames are locally audited and are never forwarded as silently altered payloads.

- Observation: The first Draft PR exposed three independent CI contract gaps rather than a feature-behavior failure.
  Evidence: API/Web/DB/E2E and agent tests passed, while Trivy identified three HIGH findings in the locked Starlette 0.37.2, CodeQL identified one implicit rate-limit and one `innerHTML` flow, and the deploy contract rejected the torque-agent `.env` destination and unowned Compose command.

- Observation: Importing the loopback FastAPI application on macOS also imported Linux-only `evdev` through `main.py`.
  Evidence: The new dependency compatibility test failed during collection with `ModuleNotFoundError: evdev`. Moving `hid_reader` import into `run_agent` preserved the Linux runtime and allowed 21 agent tests to pass without `evdev` on macOS.

- Observation: Per-key durability work in the first capture implementation could lose the beginning of the first real transmission even though later frames decoded completely.
  Evidence: Older captures contained only five or six fields in their first frame. Replacing per-event `fsync` with a bounded in-memory event buffer and one final durable flush produced three complete seven-field frames in one run, with no warm-up measurement discarded. `SYN_DROPPED` and reconnect failure remain fail-closed rather than silently omitting keys.

- Observation: The deployed CEM3-BTLA configuration emits exactly seven TAB-delimited fields and ends a frame with ENTER.
  Evidence: Three sanitized observed frames had memory counter, torque, padded unit, two-character judgement, seven-character serial, date, and time in that order. The active settings were `Cn_o=ON`, `An_o=OFF`, `Jd_o=ON`, `Sn_o=ON`, `dt_o=ON`, `bA_o=OFF`, `Un_o=ON`, `dLm=TAB`, `End=ENTER`, `kEY=JP`, and `ZEro=OFF`. The Pi decoded the Japanese-keyboard time separators as apostrophes, so the adapter accepts that observed form only.

- Observation: Below/above-limit values are not a required device-contract scenario for this workflow.
  Evidence: The manual states that `NG_MAN` requires a MEM operation to transmit NG data, while `NG_AUTO` sends it automatically. The user selected a workflow in which the kiosk waits for the next valid value and the server remains authoritative for range acceptance. Derived malformed/boundary fixtures test rejection without claiming that the wrench transmitted those samples.

- Observation: The post-clear pairing failure occurs below the parser and HID layers.
  Evidence: Repeated Pi4 HCI traces completed an LE connection but failed `LE Read Remote Used Features` with status `0x3e` before SMP key exchange or HID service resolution. Two `bluetoothctl` success messages were rejected as false positives because no bonded device or SMP exchange remained. After restoring the controller and services to their normal configuration, a final 30-second powered-on observation saw no wrench advertisement. The same Pi/wrench pair had transmitted complete frames earlier, so this is recorded as an unresolved link/bond stability issue, not as a proven platform incompatibility.

- Observation: Assembly and inspection drawing already share `ImageMarkerCalloutOverlay`, but assembly supplies a synthetic `100 x 100` coordinate space instead of the rendered image layout.
  Evidence: At a roughly 906 x 624 CSS-pixel assembly image, the SVG still rendered `viewBox="0 0 100 100"` with stroke width 1.8 and marker width 6, scaling the line and arrowhead into an unusably large triangle. Inspection drawing passes its measured canvas layout and does not exhibit the defect.

- Observation: Existing callout tests prove presence, not visual scale.
  Evidence: Twelve focused Vitest checks and all four `assembly-library-editor-ui.spec.ts` cases passed before the fix because they count SVG lines and markers without comparing the SVG coordinate space to its CSS pixel bounds.

- Observation: One coherent CSS-pixel layout fixes both editor and work-view scale without changing stored marker or callout ratios.
  Evidence: The new regression checks compare the SVG viewBox with its rendered layer, exercise the work-view image wrapper, and passed at both required viewports through zoom and fit. Browser inspection showed compact arrowheads at 1366x768 and no outer horizontal overflow; the 1920-class measured SVG and viewBox differed by less than one pixel.

- Observation: The current work-session marker state loses NG feedback for the active bolt.
  Evidence: `latestStatusByBolt` records `ng` and then unconditionally replaces the current bolt with `current`; the canvas only receives one string status. The record remains in the audit trail, but the drawing cannot distinguish an untouched current marker from one requiring NG retry.

- Observation: The right-side torque panel uses full-width default controls and a fixed three-column `text-xs` history list.
  Evidence: The LEGACY `トルク記録` button has `w-full`, the workflow buttons use equal grid columns regardless of label width, and history renders marker/timestamp, value, and judgement at `text-xs`. The panel has no presentation boundary that separates cursor state from last input outcome.

## Decision Log

- Decision: Reuse `MeasuringInstrument` as the physical asset record and add a one-to-one torque-wrench profile rather than duplicating storage location, calibration, and lifecycle state.
  Rationale: It preserves the existing asset-management source of truth and keeps torque-specific rules in a separate module.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Templates select a capability group that can contain multiple models; work records select and snapshot one physical serial-numbered wrench.
  Rationale: A template should describe an allowed capability, while an audit record must prove which replaceable physical asset was actually used.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Existing templates are backfilled as `LEGACY`; new templates and revisions saved by the new editor are `REQUIRED`.
  Rationale: This prevents historical data from becoming invalid while making new work enforce the stronger contract.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Circle-marker identity and copied tightening conditions are separate concerns.
  Rationale: Marker numbers remain unique and stable. Bulk copy changes only condition fields and never coordinates, page references, callouts, ordering, or internal IDs.
  Date/Author: 2026-07-17 / Codex, clarified by user.

- Decision: Store wrench settings as append-only history and require first-use confirmation of the current history row against the physical display.
  Rationale: The device cannot be queried remotely; overwriting one current-value row would destroy auditability.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Preserve rejected device inputs as `IGNORED` torque records and do not advance the work position.
  Rationale: Rejection controls safety, while retention proves what was attempted and why it was refused.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: A dedicated local `torque-agent` owns HID reading, durable delivery, and multi-device multiplexing. The API owns authorization, eligibility, current-position validation, and final acceptance.
  Rationale: Device I/O changes independently from assembly policy. A durable outbox prevents transient network failures from losing measurements.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Do not begin production UI, API, schema, migration, or agent implementation before preview approval; do not fix the parser contract before real payload capture.
  Rationale: These are explicit acceptance gates in the approved plan and prevent expensive UI rework or an invented device protocol.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Physical-display confirmation identity excludes marker/Bolt identity and includes the normalized tightening condition, capability group, and canonical torque limits.
  Rationale: Circle markers are always unique, but the user explicitly requires one set of equal input conditions to be reusable across many markers. Session, physical profile, and latest setting still constrain reuse; any change forces reconfirmation.
  Date/Author: 2026-07-17 / Codex, derived from the confirmed requirement and verified on resume.

- Decision: Unbound or unparseable HID input is retained in a separate bounded local audit, not the API delivery outbox.
  Rationale: It prevents measurement loss without inventing a session assignment. Keeping it separate also prevents later automatic delivery of an event that was never safely bound.
  Date/Author: 2026-07-17 / Codex.

- Decision: The loopback heartbeat endpoint permits the API origin and explicitly configured kiosk Web origins only; wildcard CORS is invalid configuration.
  Rationale: Loopback limits network reachability but does not by itself stop an unrelated page open in the same browser from attempting a cross-origin request.
  Date/Author: 2026-07-17 / Codex.

- Decision: Every marker transition disarms the local agent before condition-based confirmation reuse is revalidated.
  Rationale: A brief disarmed state is safer than displaying or retaining a stale binding during an API failure. Reuse remains automatic after successful validation and does not require another physical check when all reuse keys are unchanged.
  Date/Author: 2026-07-17 / Codex.

- Decision: Add one standard-library `torque-capture` CLI with `capture`, `replay`, `sanitize`, and `validate` commands before the physical wrench is available.
  Rationale: One independently testable boundary keeps device I/O, private evidence, redaction, and committed fixtures separate without adding a dependency or coupling capture to the API/outbox process.
  Date/Author: 2026-07-17 / Codex, approved by user.

- Decision: Unsanitized payload text and key events must remain outside every Git worktree with directory mode 0700 and file mode 0600; only fail-closed literal-redacted fixtures may enter `tests/fixtures/cem3_btla`.
  Rationale: Key codes themselves can reconstruct a serial number. Ignoring filenames is only a secondary defense, so the CLI must reject a private output path below a Git root and must never print payload text.
  Date/Author: 2026-07-17 / Codex, approved by user.

- Decision: Upgrade torque-agent to FastAPI 0.139.2 and the resulting Starlette 1.3.1 lock, and add an OS-independent loopback API contract test.
  Rationale: This removes the observed HIGH vulnerabilities while proving that health, CORS, and disarm behavior remain compatible with the newer ASGI stack.
  Date/Author: 2026-07-17 / Codex, approved as CI remediation by user.

- Decision: Treat torque-agent configuration distribution and Docker lifecycle as separate Ansible adapters, matching the existing NFC and barcode ownership boundary.
  Rationale: Release-only must be able to choose build, recreate, or no-build from the immutable Git diff, and every Docker mutation and rollback destination must be statically auditable.
  Date/Author: 2026-07-17 / Codex, approved as CI remediation by user.

- Decision: Never discard the first production measurement as a transport warm-up.
  Rationale: A test that succeeds only after sacrificing the first operation does not prove the production workflow. Capture buffering must preserve the first frame or fail closed and surface an incomplete capture.
  Date/Author: 2026-07-18 / Codex, confirmed by user.

- Decision: Require observed `normal`, `repeated_memory`, and `rapid_consecutive` fixtures for parser promotion; model `partial`, `missing_field`, `bad_number`, and `unsupported_unit` as derived rejection fixtures, and do not require observed below/above-limit payloads.
  Rationale: Repeated memory and rapid input prove transport/idempotency boundaries. Torque range acceptance is server-owned, and the selected device mode may suppress NG output, so manufacturing NG observations would not strengthen the parser contract.
  Date/Author: 2026-07-18 / Codex, confirmed by user and supported by the device manual.

- Decision: Keep `cem3-btla-hogp-v1` out of the production registry until the remaining observed transport fixtures pass, even though its strict adapter and normal/malformed tests now exist.
  Rationale: Isolating parser construction from profile activation allows verified implementation progress without presenting a partially proven device contract as production-ready.
  Date/Author: 2026-07-18 / Codex.

- Decision: Every callout consumer supplies one measured `ZoomedImageCanvasLayout` expressed in CSS pixels; placeholder coordinate spaces are invalid.
  Rationale: One coherent layout object prevents image, content, line, and arrowhead geometry from drifting independently and gives assembly the exact rendering contract already used by inspection drawing.
  Date/Author: 2026-07-18 / Codex, approved by user.

- Decision: Extract the existing inspection-drawing ratio nudge into the domain-neutral image-canvas module and keep inspection exports as compatibility wrappers.
  Rationale: Assembly and inspection drawing need the same four on-screen buttons, 0.0025 ratio step, clamp, and accessibility labels, while neither business domain should depend on the other.
  Date/Author: 2026-07-18 / Codex, approved by user.

- Decision: Assembly nudge controls apply to bolt and check markers in template editing only; they do not move callout tips and do not install global physical-keyboard handlers.
  Rationale: Both editable marker kinds need precise placement, while callout-tip placement remains the existing tap/delete workflow and work sessions remain read-only views of saved geometry.
  Date/Author: 2026-07-18 / Codex, approved recommended defaults.

- Decision: In the Milestone 4B preview, waiting is conveyed by the current-marker focus ring without a `待` badge; NG retry uses a red `×` rather than an exclamation mark.
  Rationale: The marker number remains easier to read without a redundant waiting glyph, while the multiplication/cross symbol communicates a required retry more directly than a generic warning sign.
  Date/Author: 2026-07-18 / Codex, directed by user during preview review.

## Outcomes & Retrospective

The feature branch, living plan, ADR, and interactive three-screen preview now exist on the latest remote main. Browser validation exercised condition inheritance, range copy, all five work states, and both target responsive classes without console errors, outer overflow, or clipped controls. Milestone 4A now also keeps assembly callout geometry at inspection-drawing scale and permits precise on-screen movement of either editable marker kind without changing any business identity or condition. Production behavior, database state, existing Docker resources, and deployed hosts remain unchanged.

At the preview gate, update this section with the approved/rejected layout and any requested changes. At completion, summarize traceable user behavior, migration compatibility, device-capture evidence, test counts, EXPLAIN results, and any deferred operational work.

The user approved the preview without requested layout changes on 2026-07-17. Production schema, API, and UI work may now proceed. The separate real-device payload gate still applies to the CEM3-BTLA production parser; parser-independent agent boundaries and durable-delivery behavior may be implemented and tested with an explicitly labeled synthetic profile.

At the 2026-07-17 17:00 JST safety checkpoint, parser-independent production work is implemented on the feature branch. Validation includes 22 focused API integration tests, 6 torque-agent unit tests, 130 deployment/profile/probe tests, root lint with zero warnings, shared/API/Web production builds, full fresh and legacy-upgrade migrations, duplicate-marker rollback, representative EXPLAIN plans, Compose configuration, Ansible syntax, image build, and live container health. The only supported agent parser remains explicitly synthetic; no CEM3-BTLA field order or delimiter has been guessed. Final completion is therefore intentionally held behind the real-device fixture gate and remaining runbook/canonical-document updates.

Work resumed at 17:54 JST. Review corrected condition-based confirmation reuse, safe disarm/rearm across marker transitions, runtime fastener/group revalidation, cross-session event-ID misuse, future-dated setting ambiguity, local preservation of unbound/malformed HID input, and wildcard loopback CORS.
A final disposable database applied all 149 migrations and passed the 22 combined assembly/traceability integration tests. Unit/UI evidence includes 19 converter/policy checks, 7 focused Web checks, and 8 agent checks with Ruff 0.4.2.
The final pass also completed zero-warning root lint, Shared Types/API/Web production builds, 136 deployment/profile/probe contracts, Compose configuration, Ansible syntax, and a disposable agent image health/CORS/binding runtime check.
Every temporary database, volume, network, container, and feature image created by this pass was removed. Canonical assembly, measuring-instrument API/UI, agent README, INDEX, and operations Runbook now describe the implemented/not-deployed state and the remaining hardware gate.

Milestone 2A completed at 19:22 JST without a physical wrench. The standard-library CLI now records exclusive EV_KEY streams only to new Git-external 0700/0600 sessions, preserves incomplete manifests, replays without payload output, performs fail-closed literal redaction, and validates strict observed/derived fixture contracts. The synthetic `capture_contract` remains explicitly non-CEM evidence, and no `cem3_btla` fixture or production parser was added. Validation passed 20 agent/capture tests, Ruff 0.4.2, zero-warning root lint, document inventory/link audit, and disposable Docker wheel/runtime replay/validation; temporary containers and images were removed.

Draft PR #1038 initially passed the functional API, Web, DB, E2E, and client suites but exposed security and deployment-contract gaps. The approved remediation now passes 21 torque-agent tests, Ruff, API build, zero-warning root lint, 621 deploy regression tests, the release safety audit, four relevant Ansible syntax checks, a targeted Trivy scan with zero findings for `poetry.lock`, and a disposable Linux image build/runtime health check. The disposable container and image were removed. GitHub then passed `docker-security (api)`, `deploy-contract`, the CodeQL workflow, API/Web/DB/E2E, and the aggregate `ci-required` gate for commit `3776a953`; the additional CodeQL alert check completed with no new finding. The physical CEM3-BTLA gate is unchanged.

Physical work on 2026-07-18 established the normal payload contract without sacrificing a warm-up measurement. Three observed frames were sanitized to `SERIAL_A`; raw key events, the real serial, the replacement map, and HCI logs remain outside Git. A strict seven-field adapter and derived rejection fixtures now pass on macOS, but the production registry remains deliberately closed until repeated-memory and rapid-consecutive observations are available. Pairing was later cleared during root-cause diagnosis and could not be re-established: the failure is before SMP/HID and is tracked separately from payload parsing. The Pi4 controller, Bluetooth service, kiosk browser, and display manager were restored to their normal state; no application deployment or database change was performed during capture.

The post-capture implementation pass now has 34 passing torque-agent tests, Ruff, zero-warning root lint, a current document inventory, `git diff --check`, 621 deployment regression tests, client lifecycle selection, and deployment safety contracts. A disposable Linux image replayed the synthetic capture contract, parsed a documented surrogate through the strict CEM adapter, and proved the production registry remains closed; its temporary tag was removed. The incomplete fixture validator correctly returns exit code 3 naming only `repeated_memory` and `rapid_consecutive`. Final Pi4 readback showed `bluetooth`, `kiosk-browser`, and `lightdm` active, controller powered, discovery off, and no `btmon`/`bluetoothctl` diagnostic process.

Draft PR #1038 then passed every selected GitHub check at commit `3566cade`: API, Web, DB infrastructure, E2E and smoke, workspace quality, client and repository policy, deploy contract, CodeQL, gitleaks, and both API/Web Docker security jobs. The aggregate `ci-required` gate passed. The PR remains Draft and no deployment was performed.

## Context and Orientation

The Prisma schema is `apps/api/prisma/schema.prisma`. Generic physical measuring instruments already live in `MeasuringInstrument` with management number, storage location, calibration expiry, and lifecycle status. Torque-specific models must reference it rather than copy those columns.

Assembly API routes are registered under `apps/api/src/routes/assembly/index.ts`. Template normalization and revisions are handled in `apps/api/src/services/assembly/assembly-template.service.ts`. Work progression is controlled by `apps/api/src/services/assembly/assembly-work-session.service.ts`, and Excel output is produced by `apps/api/src/services/assembly/assembly-excel-export.service.ts`.

The template editor is `apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx`, with draft mutation helpers in `apps/web/src/features/assembly/assemblyTemplateDraft.ts`. The operator work page is `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx`. Existing local agent patterns live under `clients/nfc-agent`, `clients/barcode-agent`, and `clients/haizen-agent`, but none combines durable API acknowledgement with torque-specific parsing.

Shared image zoom, measured contain layout, callout rendering, and pointer conversion live in `apps/web/src/features/kiosk/image-canvas`. Inspection drawing already passes the measured CSS-pixel layout to the shared callout renderer and owns compatibility wrappers for its older import names. Assembly must consume the same neutral contract rather than importing inspection-specific code or inventing a percentage-sized SVG coordinate space.

The parser-independent agent lives under `clients/torque-agent`. `hid_reader.py` is the Linux `evdev` adapter, and `hid_line_decoder.py` preserves decoded frames, exact terminators, and unsupported keys. `cem3_btla_parser.py` contains the strict adapter proven by the observed normal fixture, while `parser_registry.py` deliberately keeps that profile unregistered until the remaining physical transport scenarios pass. The offline capture core does not import `evdev`; the Linux adapter is loaded only by the `capture` command so `replay`, `sanitize`, `validate`, and their tests run on macOS without a physical device.

A capability group is a named fastener condition—nominal diameter, length, material, and strength class—associated with one or more torque-wrench models. A physical wrench is one serial-numbered `MeasuringInstrument` with a torque profile. A confirmation is a work-session record saying the operator compared one physical wrench's display with the latest registered setting for the current condition.

## Plan of Work

### Milestone 1: preview and approval

Create `docs/design-previews/assembly-torque-wrench-traceability-preview.html` as one self-contained, interactive mock. It must expose tabs for the master, template editor, and work screen. Work-screen state controls must show confirmed/armed, disconnected, wrong wrench, expired calibration, and admin exception states. The template screen must demonstrate a two-row maximum toolbar, a narrow condition pane without an editable tightening ID, default-on inheritance, and range copy from a selected marker to existing markers only.

Serve the directory through a local loopback HTTP server and inspect the actual rendered page at 1920x1080 and 1366x768. Exercise every tab and state, check horizontal and vertical overflow, and capture screenshots. Add a short entry to `docs/design-previews/README.md`. Present the evidence to the user and stop until approval.

### Milestone 2A: offline private-capture readiness kit

Add a `torque-capture` console command to `clients/torque-agent` using Python's standard `argparse`. The command has four subcommands. `capture` exclusively opens one explicit `/dev/input/by-id/*` device, records all EV_KEY states, relative timing, frame number, and exact terminator into a private JSONL session, and never initializes the API client, work binding, or SQLite outbox. It requires an output path outside any Git worktree, creates the directory as 0700 and its files as 0600, does not echo payloads, preserves partial data on timeout or interruption, and never stops a running agent automatically.

`replay` feeds saved events through the OS-independent decoder and reports only frame counts, terminators, and unsupported-key counts. `sanitize` reads a 0600 literal-replacement JSON file outside Git, requires every source literal to occur, verifies that no source remains, and emits only sanitized payload text, terminator, scenario, sequence, and observed/derived provenance. `validate` verifies the fixture schema and the observed scenario matrix: normal, repeated memory, and rapid consecutive. Partial, missing-field, bad-number, and unsupported-unit fixtures are marked derived and may be added only after the observed payload shape is known. Below/above-limit values are server-side range cases rather than required observed device fixtures. When the operator declares that two devices are available, validation requires two anonymized device aliases.

Refactor the HID decoding boundary so a frame preserves its terminator and any unsupported key codes instead of silently discarding evidence. Keep the existing string callback behavior at the production ingestion boundary, but reject or audit an undecodable frame rather than forwarding altered text. Add a synthetic capture-contract fixture for macOS replay; do not create anything under `tests/fixtures/cem3_btla` during this milestone. Update `.gitignore`, the agent README, and the operations Runbook with private-data handling and commands. This milestone is accepted when its CLI and synthetic tests pass without `evdev` on macOS, the Docker image exposes the command, and no parser named `cem3-btla-hogp-v1` is registered.

### Milestone 2B: real device contract

The tested CEM3-BTLA is configured to send memory counter, torque, unit, judgement, serial number, date, and time, separated by TAB and terminated by ENTER. Normal capture is complete: three consecutive frames were recorded without a warm-up discard. Capture repeated-memory and rapid-consecutive transmissions next; record firmware when it can be displayed. When multiple physical wrenches are available, capture at least two serial aliases.

Store sanitized samples under `clients/torque-agent/tests/fixtures/cem3_btla/`. The observed adapter accepts only seven fields, the observed padded `nm` unit, documented memory/serial/judgement widths, `YY/MM/DD`, the apostrophe-separated time produced by the deployed `kEY=JP` Linux path, and ENTER. `partial`, `missing_field`, `bad_number`, and `unsupported_unit` remain explicitly derived. Do not register the production profile until the observed normal/repeated/rapid matrix is complete, and do not add speculative alternate shapes.

### Milestone 3: additive domain model and master API

Add shared DTOs and enums under `packages/shared-types/src/torque-wrenches`. Add `AssemblyTorqueTraceabilityMode` with `LEGACY` and `REQUIRED`. In Prisma add `TorqueWrenchModel`, `TorqueWrenchProfile`, `TorqueWrenchCapabilityGroup`, the group/model join, and `TorqueWrenchSettingHistory`. Store original unit values and canonical N·m decimals. Use normalized manufacturer/model/serial keys for deterministic uniqueness.

Add `templateId`, structured fastener fields, and capability-group reference to `AssemblyTemplateBolt`. Backfill the template ID through its area and add a template-wide marker unique constraint only after an explicit duplicate check. The migration must abort with an actionable error when duplicates exist and must never renumber historical markers. Make the legacy lot/session wrench strings nullable without modifying existing values. Add confirmation and torque-record audit columns additively so existing rows remain valid.

Implement separate torque-wrench routes/services. Keep normalization in pure helpers, conversion behind `TorqueUnitConverter`, and all compatibility decisions behind `TorqueWrenchEligibilityPolicy`. Master reads accept JWT or registered client key. Writes and setting-history append operations require ADMIN or MANAGER JWT. Referenced entities are retired, never hard-deleted.

### Milestone 4: template editing behavior

Make new templates `REQUIRED` and convert revisions saved by the new editor to `REQUIRED`. The server generates the internal tightening ID. Required templates reject missing structured fields or capability groups.

Use the globally smallest unused positive marker number for new tightening markers. Deleting a marker never renumbers another marker. Add a default-on inheritance toggle: the next marker receives the selected or most recently used condition, or existing defaults when no source exists.

Add a range-copy command using the selected marker as source and inclusive target marker numbers. It updates only existing tightening markers across all areas/pages, skips gaps, and reports changed/skipped counts. Copy nominal diameter, length, material, strength class, nominal/lower/upper torque, unit, and capability group only. Preserve marker number, coordinates, page, area, sort order, callout, persistent ID, and internal tightening ID.

### Milestone 4A: assembly callout and marker-position parity

Change `ImageMarkerCalloutOverlay` to accept one measured `ZoomedImageCanvasLayout`. Render assembly callouts in the content coordinate layer using the same CSS-pixel geometry as inspection drawing, while keeping marker buttons positioned by ratios inside the image rectangle. Apply this renderer to template editing, the work-session sequence viewer, and the development preview. Line weight, arrowhead, and same-number tip badge remain owned by the shared component; bolt/check tone differences remain domain presentation only.

Extract the inspection-drawing position calculation and four accessible on-screen direction buttons into the domain-neutral image-canvas module. Preserve inspection-drawing exports through wrappers. In the assembly template editor, show the controls for the selected bolt or check marker, disable them while busy or read-only, move by ratio 0.0025, and clamp to 0 through 1. Each action changes only `xRatio` and `yRatio`; marker identity, page, condition, callout tip, and ordering remain unchanged.

No API, DTO, Prisma schema, migration, SQL, or EXPLAIN work belongs to this milestone because both assembly marker models already persist validated ratio coordinates. If implementation contradicts that fact, stop and revise this plan before touching a database.

### Milestone 4B: torque-input operator density and outcome parity

Before production code, create `docs/design-previews/kiosk-assembly-torque-input-operator-preview.html` as a self-contained interactive mock. It must switch LEGACY waiting and NG retry, REQUIRED pre-confirmation, REQUIRED agent-armed waiting, and REQUIRED offline/rejected states. The preview must show compact current-condition information, content-width workflow controls, a three-row readable history, and numbered bolt markers with distinct neutral, waiting, complete, NG, and unaccepted outcomes. Waiting uses its strong focus ring without a `待` badge; NG retry uses a red `×`. Inspect it at 1366x768 and 1920x1080, then stop for explicit approval.

After approval, introduce a pure assembly presentation selector that determines each bolt's display state from the current work cursor and the latest torque record by stable timestamp order. It must preserve a current bolt's NG retry state instead of replacing it with a generic current state. Keep the marker number visible; pair color with a short badge and accessible label. Existing coordinate, callout, check-marker, API, DTO, persistence, and session-transition behavior stay unchanged.

Split the right panel into reusable assembly UI components for current condition, mode-specific entry/agent readiness, workflow actions, and recent torque history. LEGACY keeps the existing numeric input/source/record behavior but renders it in one compact row. REQUIRED never renders ordinary manual input. The latest three entries remain visible in larger rows while the rest scroll. Do not run Docker, database, migration, SQL, or EXPLAIN validation unless implementation reveals a backend contract change; then stop and revise this plan before using a uniquely named disposable database.

### Milestone 5: confirmation, event intake, audit, and export

Add compatible-wrench lookup and confirmation endpoints. Eligibility requires exact structured fastener match, model membership, model range coverage, AVAILABLE or IN_USE state, non-null calibration valid through the current Asia/Tokyo date, exact latest-setting match after canonical conversion, and a current confirmation.

Extend agent torque intake with source event ID, expected template bolt, confirmation ID, serial, value, unit, raw payload, optional device time, memory counter, and device judgement. Match the client-key device to the session owner and make `(sourceClientDeviceId, sourceEventKey)` unique. Repeated delivery returns the original outcome. Wrong, unknown, expired, ineligible, stale-position, stale-confirmation, or unsupported-unit input is stored as `IGNORED` with a stable reason code and does not advance the marker.

Keep the existing legacy input shape only for LEGACY templates. REQUIRED templates accept ordinary work events from the agent. Add an ADMIN/MANAGER-only override endpoint and page that require a valid confirmation, value/unit, and non-empty reason; an override replaces the transport but does not bypass eligibility.

Update Excel output to include marker, required condition, actual value, physical serial, manufacturer/model, setting snapshot, acceptance/rejection reason, and override actor/reason. Retain the internal tightening ID only as an audit/compatibility column.

### Milestone 6: local torque-agent and deployment contracts

Create `clients/torque-agent` with independent HID adapter, parser registry, SQLite outbox, HTTP delivery adapter, and loopback control server. Only configured stable `/dev/input/by-id` paths may be opened, and input devices must be grabbed so measurements do not leak into kiosk text fields. Persist each event before network delivery; delete it only after a terminal 2xx acknowledgement; retry timeout and 5xx responses with the same event ID and bounded backoff.

The browser sends a short-lived binding heartbeat containing session, expected bolt, confirmed physical wrench, and confirmation ID to `127.0.0.1:7073`. An event without a live binding is retained as a local error and never guessed into a session. Multiple configured wrenches are multiplexed by their payload serial and events are serialized through the durable outbox.

Add the service to the client Docker Compose, a dedicated Dockerfile, Ansible configuration and lifecycle tasks, terminal profile/runtime registries, deployment change classification, and health-probe tests. Do not deploy or modify any real host.

### Milestone 7: documentation and final verification

Update the compact current-state sections in `docs/plans/kiosk-assembly-torque-management-mvp.md` and the measuring-instrument module docs. Correct any authentication documentation that disagrees with code. Add an operations README/runbook for Bluetooth pairing, configured HID paths, queue inspection, and safe restart. Link canonical documents from thin indexes without copying narrative logs.

Run focused tests after each milestone and the full affected suites at the end. Record only concise evidence in this plan, leaving generated logs and screenshots in designated artifact paths.

## Concrete Steps

Run all repository commands from `/Users/tsudatakashi/RaspberryPiSystem_002`. The branch has already been created from fetched `origin/main` as described in Progress.

For the preview, start a local server bound to loopback:

    cd docs/design-previews
    python3 -m http.server 8765 --bind 127.0.0.1

Open `http://127.0.0.1:8765/assembly-torque-wrench-traceability-preview.html`, exercise all tabs/states, then terminate the server. This process has no application or database access.

For production code, use the existing workspace commands and add focused tests before full suites:

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/web build
    pnpm lint --max-warnings=0
    cd clients/torque-agent
    poetry run pytest
    poetry run ruff check .

For offline capture-kit verification on macOS, run from `clients/torque-agent`:

    poetry run torque-capture replay --input tests/fixtures/capture_contract/synthetic-key-events.jsonl --synthetic
    poetry run torque-capture validate --fixtures tests/fixtures/capture_contract

On the Raspberry Pi, stop the agent through the approved operational procedure, then capture each observed scenario into a new directory outside the repository. The command refuses `/dev/input/event*`, never offers a non-exclusive mode, and defaults to a 120-second timeout:

    poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/captures/<normal-id> --scenario normal --expected-frames 3 --firmware <firmware> --output-config <configuration-label> --terminator enter
    poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/captures/<repeat-id> --scenario repeated_memory --expected-frames 2 --firmware <firmware> --output-config <configuration-label> --terminator enter
    poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/captures/<rapid-id> --scenario rapid_consecutive --expected-frames 5 --firmware <firmware> --output-config <configuration-label> --terminator enter

After all observations, place a 0600 redaction file outside Git, sanitize each capture to a candidate fixture, and validate the complete matrix. The redaction file contains a JSON object whose `literals` array has `{ "source": "<real value>", "replacement": "SERIAL_A" }` rows; do not put a real literal on the command line.

    poetry run torque-capture sanitize --input /var/lib/torque-agent/captures/<capture-id> --redactions /var/lib/torque-agent/private/cem3.torque-redactions.json --output tests/fixtures/cem3_btla/SERIAL_A/<scenario>.jsonl
    poetry run torque-capture validate --fixtures tests/fixtures/cem3_btla --available-device-count 1 --redactions /var/lib/torque-agent/private/cem3.torque-redactions.json

Database tests must use a unique temporary container, volume, and network based on one run ID. Do not use the repository helper that owns the fixed `postgres-test-local` name. Bind a random container port only to `127.0.0.1`, export the resulting disposable `DATABASE_URL`, and install an EXIT/INT/TERM trap before migration. Use `pgvector/pgvector:pg15`; pulling the image is allowed. The trap must remove the temporary container, volume, and network, and a final `docker ps`, `docker volume ls`, and `docker network ls` filter must prove the run ID is absent.

Deploy migrations from zero. In a second disposable database, deploy through the migration immediately before this feature, insert representative legacy template/lot/session/record rows with SQL, apply the new migration, and assert the old values and counts remain unchanged. Run relevant integration tests against the same disposable server.

Load representative master, group, setting, session, and event volumes and run `EXPLAIN (ANALYZE, BUFFERS)` for normalized serial lookup, latest setting, compatible-group lookup, event idempotency, and session history. Record the chosen indexes and actual plan nodes in this document. Finish with infrastructure contract tests, agent image build, `git diff --check`, Markdown-link validation, and a review that no secret or generated database file is tracked.

## Validation and Acceptance

The preview milestone is accepted when all controls work in the standalone mock, all five work states are reachable, the template toolbar occupies no more than two rows, short fields are not stretched, no action is clipped, and the document pane remains the dominant surface at both required viewports. User approval is mandatory.

The device-contract milestone is accepted when sanitized normal, repeated-memory, and rapid-consecutive samples exist and parser tests distinguish complete events from derived partial/missing/malformed/unsupported-unit input, with two serial aliases only when multiple physical devices are available. The first normal operation must be captured without a warm-up discard. No parser behavior may rely only on manual prose.

The offline capture-kit milestone is accepted before hardware when `/dev/input/event0` and Git-contained private output are rejected, synthetic TAB/ENTER/partial/continuous/unsupported-key events replay without loss, interruption releases the device and preserves an incomplete manifest, output permissions are 0700/0600, stdout contains no payload, literal redaction fails closed, incomplete fixture coverage is detected, and all capture tests run on macOS without importing `evdev`.

The domain milestone is accepted when legacy rows migrate unchanged, new required templates enforce structured fields, template-wide marker duplicates fail at both service and database boundaries, and referenced master data cannot be physically deleted.

The work milestone is accepted when a correct confirmed wrench advances an in-range marker and snapshots its serial/settings; each incompatible case creates one ignored audit row and leaves the marker unchanged; a retried event key returns one stored row; and an admin override is authenticated and reasoned.

The UI milestone is accepted when markers 1 through 35 can share condition values while retaining unique identity and placement, required work has no ordinary manual input, and legacy work keeps its existing flow. The export must prove the actual wrench and setting per record.

Milestone 4A is accepted when the assembly callout SVG viewBox matches the measured CSS-pixel content layer instead of `100 x 100`, both assembly marker kinds move by exactly 0.0025 ratio per on-screen direction-button press, all other draft fields remain byte-for-byte equivalent, inspection-drawing compatibility tests remain green, and editor/work views show the same fixed-size callout geometry at 1366 x 768 and 1920 x 1080 through zoom and fit transitions.

The agent milestone is accepted when two simulated HID sources, API outage/recovery, SQLite restart, binding expiry, duplicate acknowledgement, and malformed input pass without data loss, double insert, cross-session assignment, or keyboard leakage.

## Idempotence and Recovery

All schema work is additive before constraints. Migration tests run only on disposable databases. If existing marker duplicates are found, stop and report the template/marker groups; do not repair them automatically. A later data-remediation plan requires explicit authorization.

The torque agent's outbox makes delivery retryable. Restarting it replays the same event IDs. A 2xx acknowledgement is the only condition that removes a queued event. Parser fixtures are immutable evidence and may only be replaced by a documented new capture/profile.

Every capture uses a new output directory and refuses to overwrite an existing session. It writes a manifest with `in_progress` first and atomically replaces it with `complete`, `timeout`, or `interrupted` at the end. Sanitization also writes to a temporary sibling and atomically replaces only a new target. A failed capture or sanitization is retryable with a new identifier; no command deletes raw evidence or a redaction map automatically.

Preview files and documentation are ordinary feature-branch commits and can be reverted independently from later schema/API commits. No push, merge, deploy, real-host Ansible operation, existing database mutation, or existing Docker-resource deletion is authorized by this plan.

## Artifacts and Notes

Expected preview artifact:

    docs/design-previews/assembly-torque-wrench-traceability-preview.html

Expected design decision record:

    docs/decisions/ADR-20260717-assembly-torque-wrench-traceability.md

Observed and derived production-parser evidence, currently incomplete until repeated-memory and rapid-consecutive capture:

    clients/torque-agent/tests/fixtures/cem3_btla/

Expected synthetic evidence for the capture tool, which must never be described as CEM3-BTLA output:

    clients/torque-agent/tests/fixtures/capture_contract/

Private raw evidence and redaction maps use names matching `*.torque-capture-private.jsonl`, `capture-private/`, or `*.torque-redactions.json`; these patterns are ignored defensively, but the capture command must still reject any destination inside a Git worktree.

Keep screenshots and short validation summaries as artifacts; do not commit transient server logs, SQLite queues, credentials, or raw production identifiers.

Preview evidence captured on 2026-07-17:

    1910x1075 master: no clipped controls; body 1910x1075 with no outer scroll.
    1910x1075 template: document pane 1267px, condition pane 350px, toolbar 43px high, no clipped controls.
    1910x1075 work: document pane 1511px, work pane 356px, no clipped controls.
    1366x769 master: body/app/screen dimensions equal scroll dimensions; no clipped controls.
    1366x769 template: document pane 792px, condition pane 320px, toolbar scrollWidth equals clientWidth, no clipped controls.
    1366x769 work: document pane 1003px, work pane 330px, no ordinary manual input, footer visible, no clipped controls.
    Range-copy interaction: 2–35 reported 31 updated and 3 missing; condition chips changed while marker identity remained represented separately.
    Inheritance interaction: switch changed from checked to unchecked and copy changed to the default-value explanation.
    Work states: confirmed/ARMED, disconnected/OFFLINE, wrong/REJECTED, expired/BLOCKED, and override/ADMIN all rendered; override form was visible only in the ADMIN state.
    Browser console: zero warning or error entries.

## Interfaces and Dependencies

The shared type package will expose `AssemblyTorqueTraceabilityMode`, torque-wrench master DTOs, confirmation DTOs, agent event DTOs, and stable rejection reason codes. The API will keep legacy assembly input types at the boundary and convert them to domain commands rather than leaking legacy strings into the new policy.

`TorqueUnitConverter` is a pure interface accepting decimal value and observed unit and returning a canonical N·m decimal or an unsupported-unit result. `TorqueWrenchEligibilityPolicy` accepts an immutable template condition, model capability, physical asset state, latest setting, current date, and optional confirmation; it returns either eligible data or one stable rejection code. HTTP handlers, Prisma queries, and React components must not duplicate these rules.

The shared image-canvas package exposes callout rendering against one `ZoomedImageCanvasLayout` and a domain-neutral marker-position nudge primitive accepting only `xRatio` and `yRatio`. Inspection drawing keeps its existing exported names as adapters; assembly imports only the neutral contracts. Neither UI domain may depend on the other's business types.

The torque agent defines independent ports for HID events, payload parsing, durable outbox persistence, work binding, and API delivery. The CEM3-BTLA adapter is selected by a fixture-derived output-profile identifier only after that profile is registered; construction and activation remain separate. SQLite, evdev, WebSocket, and HTTP are implementation details behind those ports.

The capture package exposes an OS-independent `CapturedKeyEvent` value with sequence, relative nanoseconds, key code, key state, and frame number; a decoded frame with text, exact terminator, source key codes, and unsupported key codes; an asynchronous event-source protocol; a recorder; a literal sanitizer; and a fixture validator. The Linux event source is the only component allowed to import `evdev`. The CLI returns 0 for success, 2 for usage or safety validation, 3 for timeout/interruption/incomplete capture, and 4 for OS or device failures.

Revision note 2026-07-17 06:32Z: Created this self-contained execution plan after branching from fetched `origin/main`, then added the approved-scope interactive preview and responsive browser evidence. The production implementation remains deliberately paused at the user approval gate.

Revision note 2026-07-17 06:40Z: Recorded the user's preview approval. Opened the production schema/API/UI milestones while retaining the independent real-device payload gate for the final CEM3-BTLA parser profile.

Revision note 2026-07-17 07:48Z: Recorded the production checkpoint, disposable-database migration and EXPLAIN evidence, affected test/build results, and the remaining real-device fixture gate before the requested 17:00 JST safe pause.

Revision note 2026-07-17 09:06Z: After the user resumed work, corrected confirmation reuse and local input-audit behavior, reran disposable-Postgres/API/agent/Ruff/build/lint validation, and completed canonical documentation plus the torque-agent operations Runbook. The real CEM3-BTLA fixture gate remains unchanged.

Revision note 2026-07-17 09:28Z: Completed the resume-time hardening pass, including future-setting rejection and strict loopback CORS, and recorded the final disposable Postgres, image-runtime, build, lint, and deployment-contract results. The real CEM3-BTLA fixture gate remains unchanged.

Revision note 2026-07-17 10:00Z: Split the device milestone into offline capture readiness (2A) and physical fixture/parser promotion (2B). Fixed the private evidence format, fail-closed redaction, macOS replay boundary, CLI exit codes, and the rule that no CEM3-BTLA parser or fixture may be invented before observed hardware output.

Revision note 2026-07-17 10:22Z: Completed Milestone 2A with the read-only capture CLI, Linux adapter/OS-independent recorder split, strict decoder/audit boundary, synthetic contract fixtures, fail-closed sanitizer/validator, defensive ignores, Docker console entry, and operator Runbook. Recorded 20 passing tests plus Ruff, root lint, document audit, and disposable image runtime evidence. Milestone 2B remains gated on physical output.

Revision note 2026-07-17 11:20Z: Recorded the approved Draft PR CI remediation: dependency vulnerability removal, explicit rate-limit and safe DOM construction, portable loopback API testing, and torque-agent Ansible lifecycle ownership. Local security, deployment, lint, build, agent, and disposable-image validation pass; GitHub CI rerun remains pending.

Revision note 2026-07-17 11:31Z: Recorded the successful Draft PR #1038 rerun for remediation commit `3776a953`. Every required GitHub Actions job and the `ci-required` aggregate passed; the separate real-device parser gate remains open.

Revision note 2026-07-18 02:46Z: Recorded three complete normal CEM3-BTLA frames captured without a warm-up discard, the exact seven-field TAB/ENTER `kEY=JP` contract, the bounded-buffer first-frame-loss fix, strict but unregistered parser adapter, and derived rejection fixtures. Narrowed the remaining observed gate to repeated-memory and rapid-consecutive transport behavior, kept firmware and stable Pi HID bonding open, and separated the observed pre-SMP `0x3e` link failure from parser/API work.

Revision note 2026-07-18 03:10Z: Recorded final local validation for the capture reliability and unregistered parser changes, including the expected incomplete-fixture exit, disposable Linux image evidence/removal, deployment contracts, document audit, and safe Pi4 service state. No deployment, database mutation, or production profile activation occurred.

Revision note 2026-07-18 03:22Z: Recorded successful Draft PR #1038 checks for commits `c6841ad8` and `3566cade`, including the aggregate `ci-required` gate. The remaining work is limited to the explicitly open hardware/fixture promotion gates.

Revision note 2026-07-18 04:15Z: Added approved Milestone 4A after reproducing the assembly-only callout scale defect. Fixed the planned contract to measured CSS-pixel layout, shared ratio nudge controls, both editable assembly marker kinds, all assembly callout views, and Web-only validation without database work.

Revision note 2026-07-18 04:29Z: Completed Milestone 4A with a single measured-layout callout contract, domain-neutral coordinate nudge logic/UI, inspection compatibility wrappers, assembly editor/work/preview integration, 23 focused and 1458 full Web tests, zero-warning root lint, Web build, responsive geometry E2E, document audit, and browser inspection. No API, DTO, Prisma, Docker, or database resource changed; push, PR update, CI, and deployment remain unauthorized.

Revision note 2026-07-18 06:10Z: Started Milestone 4B on child branch `feat/assembly-torque-input-operator-ui`. The production UI gate is intentionally closed until the interactive preview is approved. The recorded root cause is presentation-only: current cursor state overwrites NG marker feedback, while existing API/DTO/DB contracts already contain the required torque record facts.

Revision note 2026-07-18 06:30Z: Refined the unapproved Milestone 4B preview at user direction: removed the `待` badge from the current marker while retaining its focus ring, and replaced the NG exclamation mark with `×`. Rechecked the interactive states and two responsive target sizes; the production UI gate remains closed.
