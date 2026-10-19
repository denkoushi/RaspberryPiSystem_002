# Add expiring maintenance leases for temporarily detached terminal devices

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. This document is maintained in accordance with
`.agent/PLANS.md`.

## Purpose / Big Picture

Operators sometimes disconnect an NFC reader, barcode reader, or torque tool
while developing or maintaining a workstation. The fail-closed terminal health
checks introduced by the production configuration work correctly detect that
absence, but currently treat every inventory-enabled device as permanently
required. After this change, an operator can record a short, reasoned, expiring
maintenance lease for one device. Deploy and the one-minute monitor will show
that device as intentionally detached until the lease expires, while every
other device and every device without a live lease remains fail-closed.

The first production use is the temporarily detached StoneBase barcode reader.
No health check is silently disabled, no queue is deleted, and an expired or
malformed lease restores the ordinary blocking and alerting behavior.

## Progress

- [x] (2026-07-30 16:11+09:00) Confirmed main is clean and equal to
  `origin/main`; created branch `fix/terminal-device-maintenance-leases`.
- [x] (2026-07-30 16:16+09:00) Confirmed there is no existing peripheral
  maintenance contract and diagnosed StoneBase as a real absent USB device,
  not a false health result.
- [x] (2026-07-30 16:18+09:00) Added the pure lease parser and focused unit
  tests.
- [x] (2026-07-30 16:21+09:00) Applied the same lease result to Deploy evidence
  and status-agent monitoring, including explicit sanitized maintenance
  evidence.
- [x] (2026-07-30 16:22+09:00) Added a time-limited StoneBase barcode lease and
  documented the operator workflow.
- [x] (2026-07-30 16:35+09:00) Passed focused tests, all 913 Deploy Python
  tests, disposable PostgreSQL with 156 migrations and SQL EXPLAIN, all
  Ansible/rollback contracts, document audit, and zero run-owned Docker
  residue.
- [x] (2026-07-30 16:53+09:00) Published Draft PR #1125 at one fixed commit;
  required PR checks and an additional hosted full suite passed.
- [x] (2026-07-30 17:33+09:00) Resumed after the requested safe stop and
  merged PR #1125 as main SHA `c5593d0906a88987057965642280f9ae75716849`.
  Its required CI, ARM64 release pair, scans, and signed release set passed.
- [x] (2026-07-30 17:46+09:00) Production aggregate preflight stopped before
  release submission because the independent preflight contract had not
  received the maintenance lease; Pi3 also returned one transient runtime
  observation failure. Production remained unchanged.
- [x] (2026-07-30 17:58+09:00) Added the version 2 aggregate target contract,
  terminal-side expiry re-evaluation, and regression coverage. Passed all 916
  Deploy Python tests, 47 CI classification tests, the complete disposable
  PostgreSQL/Ansible contract runner, documentation audit, and zero run-owned
  Docker residue.
- [ ] Publish and merge the aggregate-preflight correction, then repeat
  read-only plan and aggregate preflight before submitting any release.

## Surprises & Discoveries

- Observation: the new preflight correctly rejected StoneBase before creating
  a release run.
  Evidence: `/dev/ttyACM0`, `/dev/serial/by-id`, and all `ttyACM*`/`ttyUSB*`
  paths were absent while the barcode container was running and its sanitized
  status was `readerConnected=false`, `message=disconnected`.

- Observation: current inventory has only capability switches such as
  `barcode_agent_enabled`; there is no distinction between “software should be
  installed” and “the physical device must be present right now.”
  Evidence: `scripts/deploy/rolling_release/backends/ansible.py` derives all
  mandatory probes directly from those enable switches, and
  `clients/status-agent/terminal_agent_health.py` does the same for alerts.

- Observation: the initial implementation covered normal pre-mutation and
  final evidence probes but not the separate aggregate preflight that runs
  before a release unit exists.
  Evidence: main SHA `c5593d0906a88987057965642280f9ae75716849`
  passed all hosted checks, but production preflight
  `20260730-084317-4b2bd9` rejected StoneBase with
  `terminal.agent.barcode-agent.health` and `releaseSubmitted=false`.

- Observation: Pi3's simultaneous `terminal.runtime.contract` result was
  transient rather than a persistent incompatible runtime.
  Evidence: the exact candidate-owned read-only runtime capture was repeated
  alone through Pi5 and returned `compatible=true`, `unitCount=11`,
  `dockerCount=0`, and `presentDockerCount=0`.

## Decision Log

- Decision: keep inventory enablement and temporary presence as separate
  contracts.
  Rationale: disabling an agent to permit a temporary unplug would also remove
  its software and monitoring intent. A separate lease preserves the intended
  capability and automatically restores enforcement.
  Date/Author: 2026-07-30 / Codex.

- Decision: leases are host-specific, agent-specific, reason-coded, and
  UTC-expiring, with at most seven days remaining when evaluated.
  Rationale: a narrow, versioned lease is auditable and cannot become an
  indefinite bypass. Expired, unknown, malformed, or overlong entries do not
  suppress health enforcement.
  Date/Author: 2026-07-30 / Codex.

- Decision: do not introduce a mutable remote override in this first repair.
  Rationale: the candidate inventory is already SHA-bound, reviewed, and used
  by both preflight and Ansible rendering. It can safely bootstrap the feature
  even though the currently deployed terminal does not yet contain lease
  tooling. A future operator CLI may edit the same contract through a reviewed
  workflow without changing its semantics.
  Date/Author: 2026-07-30 / Codex.

- Decision: a lease relaxes only the physical-presence signal, not the agent
  runtime proof.
  Rationale: even while a reader is intentionally unplugged, its container,
  loopback endpoint, response schema, and NFC queue remain safety-relevant.
  Deploy continues to stop for an agent crash, unreachable endpoint, malformed
  response, or queued NFC business event.
  Date/Author: 2026-07-30 / Codex.

- Decision: add sanitized lease evidence to version 2 of the aggregate
  terminal target contract and re-evaluate its UTC expiry on the terminal.
  Rationale: the pre-release gate is intentionally independent from the
  Ansible backend. Making the lease an explicit typed field preserves that
  isolation while ensuring an expired lease cannot authorize a later probe.
  Every maintained agent still runs the same candidate-owned endpoint probe
  with only the physical-disconnect assertion relaxed.
  Date/Author: 2026-07-30 / Codex.

## Outcomes & Retrospective

Implementation is in progress. Production remains unchanged because aggregate
preflight stopped before a release run was submitted.

The first PR established one pure lease authority shared by ordinary Deploy
evidence and the one-minute collector. The production attempt exposed a third
consumer: the candidate-owned aggregate terminal preflight. Its typed target
contract is now being corrected on
`fix/terminal-maintenance-aggregate-preflight`. StoneBase’s barcode reader is
the sole leased device; NFC and torque remain required.

## Context and Orientation

The standard release entry is `scripts/update-all-clients.sh`. Its Python
coordinator resolves enabled terminal agents from
`infrastructure/ansible/inventory.yml`.
`scripts/deploy/rolling_release/backends/ansible.py` runs the candidate-owned
`scripts/deploy/terminal-agent-health-probe.py` before mutation and again when
collecting terminal evidence. A failed required probe stops the fleet before
later terminals are touched.

`clients/status-agent/status-agent.py` runs every sixty seconds through a
systemd timer. Its `terminal_agent_health.py` collector probes inventory-enabled
NFC, barcode, and torque services. It emits a sanitized alert after two
consecutive failures. An “agent” is the terminal-local process that talks to a
physical device. A “maintenance lease” is a reviewed JSON-compatible inventory
record saying that one agent’s physical device is intentionally absent until a
specific UTC instant.

The lease source is the host variable
`terminal_agent_maintenance_leases`. It is a mapping whose keys are exactly
`nfc-agent`, `barcode-agent`, or `torque-agent`. Each value has exactly
`reasonCode` and `expiresAt`. For example:

    terminal_agent_maintenance_leases:
      barcode-agent:
        reasonCode: temporary-development-detach
        expiresAt: "2026-08-02T08:00:00Z"

No UID, scanned value, token, endpoint, free-form note, or secret is permitted.

## Plan of Work

Add `scripts/deploy/rolling_release/terminal_device_maintenance.py` as a pure
module. It validates exact fields, allowed agents, a conservative reason-code
alphabet, strict UTC timestamps, and the seven-day remaining-duration limit.
It returns immutable lease values and accepts an injected clock for tests.

Change `scripts/deploy/rolling_release/backends/ansible.py` so enabled agents
are evaluated together with explicitly maintained agents using the pure
module. Every enabled agent still has to prove its running container, loopback
endpoint, and response schema. Only an active lease may relax that agent's
physical-presence signal. Return sanitized `maintenanceAgents` evidence
alongside the successfully probed containers. Update
`scripts/deploy/rolling_release/terminal_adapters.py` to validate that evidence
strictly and require every maintained agent to remain among the proven
containers.

Render the same lease JSON into
`infrastructure/ansible/templates/status-agent.conf.j2`. In
`clients/status-agent/terminal_agent_health.py`, import the same pure module
from the repository and continue probing a maintained agent. Suppress only
the leased physical-presence signal and remove stale episode state for that
signal; endpoint failure and queue health remain enforced. When the UTC expiry
passes, the next one-minute run resumes the ordinary two-sample alert contract
automatically.

Add the StoneBase barcode lease to
`infrastructure/ansible/inventory.yml`. The lease expires at
`2026-08-02T08:00:00Z` (17:00 JST), giving a short reviewed development window.
If the reader remains detached then, Deploy blocks and monitoring alerts again.

Update focused contracts, the deployment guide, and the fail-closed ADR/KB so
operators understand that enablement is permanent intent while a lease is a
temporary exception. No database schema, public API, migration, browser, NFC
queue, or peripheral agent behavior changes.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002`.

    git switch main
    git pull --ff-only origin main
    git switch -c fix/terminal-device-maintenance-leases

Run focused tests while implementing:

    python3 -m unittest scripts.deploy.tests.test_terminal_device_maintenance
    python3 -m unittest scripts.deploy.tests.test_ansible_adapter
    python3 -m unittest clients/status-agent/tests/test_terminal_agent_health.py

Then run the repository contracts:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    python3 -m unittest discover -s clients/status-agent/tests -p 'test_*.py'
    bash scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check

After one intentional commit and push, create one Draft PR and wait for all
required checks. Do not add an evidence-only commit. Merge and production
Deploy remain contingent on green CI and the 17:00 stopping rule.

## Validation and Acceptance

Unit tests must show that a valid active lease suppresses only its named agent,
while expired, overlong, unknown-agent, unknown-field, non-string, newline, and
malformed-time records fail closed. Deploy evidence must list the maintained
barcode separately and continue proving NFC and torque. A maintained agent may
not also appear as a proven endpoint.

Status-agent tests must show that a maintained device is still probed, only its
physical-presence alert is suppressed, every other signal remains enforced,
and ordinary enforcement resumes automatically after expiry. Logs and
evidence must contain only agent, reason code, and expiry, not raw device
responses or credentials.

The disposable PostgreSQL runner must apply all migrations, report no migration
anomaly, use the existing `ClientDevice.apiKey` index in `EXPLAIN (ANALYZE,
BUFFERS)`, pass alert routing tests, and leave its run-owned container, volume,
and network absent. Existing Docker resources and BuildKit cache are never
pruned.

Production acceptance starts with `--print-plan`. It must show the expected
Pi5, all Pi4, and Pi3 initial rollout targets. The aggregate preflight and
persisted terminal evidence must then show the sanitized StoneBase barcode
maintenance record while still proving its running container and loopback
endpoint. The standard StoneBase canary and human approval remain. After the
fleet succeeds, the same SHA plan must be a no-op. When the lease expires, an
absent barcode reader must again block a future Deploy and produce the ordinary
two-minute alert.

Local validation on 2026-07-30 produced:

    focused release/Ansible contracts: 87 passed
    status-agent contracts: 22 passed
    Deploy Python contracts before production preflight: 913 passed
    Deploy Python contracts after aggregate-preflight correction: 916 passed
    CI classification contracts after correction: 47 passed
    disposable PostgreSQL migrations: 156 applied, status current
    deploy-status API: 20 passed
    inventory contracts: 24 passed
    run-owned container/volume/network: 0/0/0
    pre-existing Docker volume count after validation: 17

## Idempotence and Recovery

Parsing and evaluating a lease is read-only and deterministic for a supplied
UTC time. Re-running Ansible renders the same configuration. Removing the
inventory record or passing its expiry needs no terminal cleanup; enforcement
resumes automatically.

If any lease or evidence is malformed, stop before terminal mutation. If
validation is incomplete at 17:00 JST, leave the feature branch unmerged and
production unchanged. Never delete queued NFC events, change USB state, restart
a device, or bypass the standard release entry to recover.

## Artifacts and Notes

Pre-implementation StoneBase evidence:

    barcode container: Up
    status: readerConnected=false, message=disconnected
    /dev/ttyACM0: missing
    /dev/serial/by-id: absent
    USB barcode reader: absent

## Interfaces and Dependencies

`scripts/deploy/rolling_release/terminal_device_maintenance.py` defines:

    @dataclass(frozen=True)
    class MaintenanceLease:
        agent: str
        reason_code: str
        expires_at: datetime

    def parse_active_leases(
        value: object,
        *,
        now: datetime | None = None,
    ) -> dict[str, MaintenanceLease]

The module uses only the Python standard library. Deploy and status-agent use
this one parser; neither implements an independent key list or timestamp rule.

Revision note (2026-07-30): Created after production preflight correctly
blocked on a deliberately detached StoneBase barcode reader and the operator
confirmed that temporary device removal is a normal workflow.

Revision note (2026-07-30 16:27 JST): Recorded the completed lease
implementation and full local validation before GitHub publication.

Revision note (2026-07-30 16:35 JST): Tightened maintenance so it permits only
physical absence while continuing to prove the agent runtime and NFC queue,
then repeated the complete local validation.
