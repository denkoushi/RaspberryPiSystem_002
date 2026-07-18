# ADR-20260717: Assembly Torque Wrench Traceability Boundaries

- Status: accepted
- Date: 2026-07-17
- Scope: torque-wrench master, assembly templates, work confirmation, torque input, audit records, and local HID agent
- related_code:
  - `apps/api/prisma/schema.prisma`
  - `apps/api/src/routes/assembly/index.ts`
  - `apps/api/src/services/assembly`
  - `apps/web/src/features/assembly`
  - `clients/torque-agent`
- related_docs:
  - `docs/plans/assembly-torque-wrench-traceability-execplan.md`
  - `docs/plans/kiosk-assembly-torque-management-mvp.md`
  - `docs/design-previews/assembly-torque-wrench-traceability-preview.html`

## Context

Assembly work currently stores a torque-wrench label as free text and records torque values without a physical serial-numbered wrench or setting snapshot. Template bolt conditions are free-form, and the database does not enforce circle-marker uniqueness across all areas of one template. Operators also need to reuse one condition across many unique marker numbers without copying marker identity or placement.

The physical CEM3-BTLA sends one-way Bluetooth HOGP keyboard output. The system can receive configured fields such as serial number, torque, unit, judgement, date/time, and memory counter, but it cannot remotely read or change the displayed torque settings. A safe design must therefore separate registered settings, operator confirmation, device events, and server-side acceptance.

## Decision

1. `MeasuringInstrument` remains the source of truth for a physical asset's management number, storage location, calibration expiry, and lifecycle status. A torque-wrench profile references it one-to-one and adds serial/model information only.
2. A template selects a capability group containing structured fastener conditions and one or more permitted models. It does not normally bind one physical serial number. Work confirmation selects the physical wrench, and torque records snapshot the actual serial, model, and setting.
3. Torque settings are append-only history. The latest row is displayed as current, and the operator confirms it against the physical display before the session is armed. A changed wrench, condition, or latest setting invalidates the prior confirmation.
4. Compatibility is decided by one server-side policy using fastener condition, model membership and range, physical status, calibration date, latest setting, current work position, and confirmation. The same policy serves candidate lookup, confirmation, agent intake, and admin override.
5. Existing templates are `LEGACY`. New templates and revisions saved by the new editor are `REQUIRED`. Legacy transport stays at the API boundary; it does not become part of new domain interfaces.
6. Circle markers are unique and stable within a template. Deletion never renumbers another marker. Condition inheritance and range copy update only tightening-condition fields, never identity, coordinates, page, order, callout, or internal tightening ID.
7. Rejected physical inputs are stored as ignored audit records with raw input and a stable reason code, and never advance work. A client-device/event-key unique constraint makes delivery retry idempotent.
8. A dedicated loopback-only torque agent reads configured HID devices, persists events in a SQLite outbox before delivery, and deletes them only after API acknowledgement. The API, not the agent, owns authorization and acceptance policy.
9. ADMIN/MANAGER manual override replaces failed transport only. It requires a valid wrench confirmation and reason and cannot bypass eligibility.
10. Production implementation is gated by an approved interactive preview. The production parser is separately gated by captured real-device output; field order and delimiters must not be guessed.
11. Production parser registration requires observed normal and rapid-consecutive fixtures. Same-memory resend remains optional observed evidence when the device exposes that operation and is otherwise mandatory synthetic transport/idempotency coverage. Parser construction and activation are separate boundaries.
12. The server is authoritative for lower/upper torque acceptance. In the selected `NG_MAN` workflow, observed below/above-limit device output is not required; partial, missing-field, malformed-number, and unsupported-unit cases are explicit derived rejection fixtures.
13. No production measurement is discarded as a warm-up. The capture and HID boundary must preserve the first complete frame or fail closed, and Bluetooth link/bond failures are diagnosed separately from payload parsing and API acceptance.
14. External Bluetooth-controller identity and wrench HID identity are separate deployment adapters. Match the controller by exact USB vendor/product and the wrench by exact Bluetooth HID bustype, vendor/product, name, and unique address. Never persist transient `hciN` or `eventN` names, and never fall back to an unconfigured keyboard.

## Alternatives

- Create a completely separate torque-wrench asset master: rejected because it duplicates calibration, storage, and lifecycle data already owned by `MeasuringInstrument`.
- Bind every template marker to one physical serial: rejected because maintenance or calibration replacement would require template revision even when an equivalent model is available.
- Match only nominal diameter: rejected because length, material, strength class, torque range, setting, status, and calibration are independent safety constraints.
- Overwrite current wrench settings: rejected because it destroys the historical state needed to interpret old torque records.
- Drop wrong-wrench input before persistence: rejected because refusal without evidence weakens auditability and diagnosis.
- Let the browser consume HID keystrokes and post directly: rejected because it risks input leakage, loss during network outages, and cross-session ambiguity.
- Parse the expected CEM3-BTLA format from documentation alone: rejected because the accessible product documentation does not establish the deployed output order and separators.
- Require the wrench to transmit NG values before the server can enforce limits: rejected because device output mode can suppress NG transmissions, while the server already owns the authoritative condition and received-value comparison.
- Ignore the first event as a Bluetooth/HID warm-up: rejected because it would lose the first real assembly operation and hide an unresolved acquisition defect.

## Consequences

The schema and UI become larger, but responsibilities remain separated and testable. Multiple models and physical wrenches can scale under one capability group. Existing records remain readable through legacy mode. Required work gains a deliberate operator-confirmation step because automatic setting readback is unavailable.

Rejected inputs consume audit storage, and the agent requires a small durable local volume. Adding a template-wide marker constraint can expose previously created cross-area duplicates; migration must stop rather than silently change visible numbering.

## Validation

Validate the decision with an interactive three-screen preview at 1920x1080 and 1366x768, real CEM3-BTLA fixture capture, pure policy/conversion unit tests, isolated-Postgres migration and API integration tests, idempotency tests, SQLite retry/restart tests, multi-HID tests, responsive UI tests, and SQL `EXPLAIN (ANALYZE, BUFFERS)` for the main lookup paths.

## Supersedes / Superseded By

- Supersedes: none. This extends the assembly MVP while retaining its legacy path.
- Superseded by: none.

## References

- [Tohnichi CEM3-BTLA product page](https://www.tohnichi.co.jp/products/detail/296)
- `docs/plans/assembly-torque-wrench-traceability-execplan.md`
- `docs/decisions/ADR-20260709-assembly-work-session-operator-layout.md`

## Local Notes JA

- 丸数字は一意のまま維持する。同じにするのは、呼び径、長さ、材質、強度区分、規定値、上下限値、単位、適合トルクレンチ群などの締付条件である。
- 実機payloadとデザインの承認前には、本番DB、API、UI、エージェントを確定実装しない。
