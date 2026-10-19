---
title: DGX Control Plane business proxy consumer contract
status: in_progress
scope: Business DGX API consumers and DGX-only route transition
date: 2026-08-02
source_of_truth: docs/plans/dgx-control-plane-business-proxy-consumer-execplan.md
related_code:
  - infrastructure/ansible/inventory.yml
  - apps/api/src/services/inference
related_docs:
  - ../runbooks/dgx-system-prod-local-llm.md
  - https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/exec-plans/06-business-gateway-proxy.md
  - https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/exec-plans/08-safe-expiry-preemption.md
validation: Documentation checks and post-cutover compatibility probes
open_items: DGX-only expiry and business-preemption production drills
---

# Preserve the business consumer contract through the DGX Arbiter proxy

This ExecPlan is a living document and must be maintained according to
`.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision
Log`, and `Outcomes & Retrospective` reflect the current state.

## Purpose / Big Picture

Business kiosk and administration services continue using the same DGX URL,
models, and tokens while the DGX host begins measuring real business activity
for private Lease safety. No business Raspberry Pi receives a deployment for
this transition. Operators can verify success when the existing business API
still reaches port `38081` and the separate private dashboard records a
non-null last-business-use time after an authenticated heavy request.

## Progress

- [x] (2026-08-02 03:05Z) Confirm the business source uses the DGX Tailscale address on port `38081` throughout inference and runtime control.
- [x] (2026-08-02 03:08Z) Confirm business clients use `X-LLM-Token` and `X-Runtime-Control-Token` and require no code change.
- [x] (2026-08-02 03:22Z) Merge backward-compatible proxy support into `DGXSparkControlPlane` through PR 14 and successful CI.
- [x] (2026-08-02 03:28Z) Merge this consumer contract note through a separate documentation PR.
- [x] (2026-08-02 05:04Z) Perform the approved DGX-only cutover from the Control Plane repository.
- [x] (2026-08-02 05:04Z) Verify business health, model listing, one real inference, metrics, and private dashboard activity without deploying the business fleet.
- [x] (2026-08-02 06:46Z) Merge the backward-compatible safe handoff implementation through Control Plane PR 29 and successful CI.
- [ ] Verify expiry and business preemption on the DGX while keeping the business fleet unchanged.

## Surprises & Discoveries

- Observation: the business API already sends both authentication headers that
  the new proxy supports, so no consumer code or environment change is needed.
  Evidence: `openai-compatible-text.adapter.ts` sends `X-LLM-Token`, and
  `http-on-demand-local-llm-runtime.controller.ts` sends
  `X-Runtime-Control-Token`.
- Observation: many business and legacy private integrations share port
  `38081`, including `/healthz`, `/v1/*`, `/system/*`, `/embed`, and workload
  health probes.
  Evidence: `infrastructure/ansible/inventory.yml` and the existing runbooks
  consistently use the same endpoint. The Control Plane proxy forwards these
  routes unchanged and tracks only authenticated heavy POST requests.
- Observation: the business runtime controller accepts every successful 2xx
  `/start` response and then polls readiness for up to three minutes, while the
  individual start request has a 60-second timeout.
  Evidence: `http-on-demand-local-llm-runtime.controller.ts` checks `res.ok`
  before entering its existing readiness loop. The Control Plane can therefore
  acknowledge a private-to-business handoff with HTTP 202 without a consumer
  code or configuration change.

## Decision Log

- Decision: do not change `infrastructure/ansible/inventory.yml`, business API
  code, token values, or any Raspberry Pi.
  Rationale: the Control Plane proxy preserves the complete consumer-facing
  endpoint and headers. A fleet deployment would add risk without changing
  behavior.
  Date/Author: 2026-08-02 / Codex with operator approval.
- Decision: keep this document in progress until merged-main DGX verification
  is recorded.
  Rationale: `.agent/PLANS.md` prohibits declaring a deployment task complete
  before effective changes are on `origin/main` and production evidence is
  captured separately.
  Date/Author: 2026-08-02 / Codex.
- Decision: preserve the existing business runtime caller unchanged when a
  private Lease is preempted.
  Rationale: Control Plane PR 29 returns HTTP 202 for `/start`, prevents the
  legacy gateway from starting business compute during the fixed countdown,
  and restores business inference before the existing readiness poll succeeds.
  Direct inference receives temporary HTTP 503 with `Retry-After` instead of
  competing with the private GPU workload.
  Date/Author: 2026-08-02 / Codex with operator approval.

## Outcomes & Retrospective

The consumer audit found no required business application change. The DGX-local
route transition and real business-activity verification are complete. The
remaining production actions are the expiry and business-preemption drills
owned by `DGXSparkControlPlane`. Normal fleet deployment remains explicitly out
of scope.

## Context and Orientation

`infrastructure/ansible/inventory.yml` configures business API consumers with
the verified DGX Tailscale URL on port `38081`. Text and vision inference send
`X-LLM-Token`; runtime start and stop send `X-Runtime-Control-Token`. Those are
the public consumer contracts.

The separate repository `denkoushi/DGXSparkControlPlane` owns the DGX Arbiter.
Its phase 06 implementation binds the old gateway process to
`127.0.0.1:38081` and runs an Arbiter-aware proxy on the same port at the
verified DGX Tailscale address. Distinct local addresses allow both listeners
to retain port `38081`. The phase 08 implementation acknowledges business
`/start` with HTTP 202 during private preemption and starts business inference
only after the private workload has stopped. This repository neither installs
those components nor changes their state.

## Plan of Work

Keep all current business URLs and token header behavior unchanged. Merge this
document as the consumer-side coordination record required by the shared
repository boundary. After both repositories contain the contract, enable the
proxy only through `DGXSparkControlPlane` with an explicit `dgx-spark` limit.

After cutover, use existing business credentials in place without printing
them. Verify `/healthz`, authenticated `/v1/models`, `/system/metrics`, and one
small business inference. Confirm the private dashboard records the request and
then enforces the five-minute idle window. Do not acquire a private Lease or
stop a workload during this routing verification.

## Concrete Steps

Documentation validation from `/Users/tsudatakashi/RaspberryPiSystem_002`:

    git diff --check
    node scripts/docs/audit-docs.mjs --write
    node scripts/docs/audit-docs.mjs --check

The first command refreshes the tracked documentation inventory, including
local-link and long-line checks. The second proves that generated outputs are
current. No `scripts/update-all-clients.sh` command is run because there is no
business fleet artifact or configuration change.

Production commands and rollback belong to the linked Control Plane ExecPlan,
not this repository. That repository must use its dedicated inventory and the
explicit `--limit dgx-spark` guard.

## Validation and Acceptance

Acceptance requires the documentation PR and Control Plane PR to be present in
their respective `origin/main` branches. On the DGX, the legacy gateway must be
loopback-only on `127.0.0.1:38081` and the proxy must own the verified Tailscale
listener on `38081`. Existing business probes must return their prior success
status.

One real authenticated inference must cause the private dashboard's business
activity timestamp to become non-null. Health, model-list, and embedding probes
must not refresh that timestamp. The business Pi 5 and Pi 4 deployment records
must remain unchanged for this transition.

## Idempotence and Recovery

There is no business consumer mutation to retry or roll back. If the DGX proxy
cutover fails, the Control Plane rollback restores the old gateway to external
port `38081`; every consumer continues using the same URL. This repository does
not need a compensating deployment.

## Artifacts and Notes

The initial backward-compatible producer change and safe handoff are recorded
by Control Plane PR 14 and PR 29. Both passed CI before merge. The live token
comparison was performed on the DGX and exposed only principal counts and
matches, never token values.

## Interfaces and Dependencies

The stable interface remains HTTP on the verified DGX Tailscale address at
port `38081`. `X-LLM-Token` authenticates inference and system reads;
`X-Runtime-Control-Token` authenticates runtime control. The public model alias
remains `system-prod-primary`. No new package, database, environment variable,
or Raspberry Pi service is introduced in this repository.

Revision note (2026-08-02): created to coordinate the producer-first Control
Plane route change while proving that the business consumer requires no deploy.

Revision note (2026-08-02): recorded the same-port production topology and the
HTTP 202 safe handoff contract. No consumer code, inventory, secret, or fleet
deployment changed.
