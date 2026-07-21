---
id: stonebase-local-executor-freeze
title: StoneBase Local executor integration freeze
status: pending
scope: production Local executor integration only; Phase B SSH deployment remains active
date: 2026-07-22
source_of_truth: docs/plans/stonebase-local-executor-freeze.md
related_docs:
  - docs/plans/deploy-speed-phase-b-execplan.md
  - docs/guides/deployment.md
  - docs/runbooks/deploy-status-recovery.md
validation: source restoration, deployment contracts, hosted CI; no hardware operation
open_items:
  - do not resume Local executor work through the normal SSH deployment route
  - require a separate design, disposable fixture proof, and hardware decision before any future Local work
---

# StoneBase Local executor integration freeze

This record is the single current decision for the production StoneBase Local
executor integration. It is pending, not accepted for deployment. The supported
route is the existing canonical SSH rolling release, including the Phase B
optimization that skips unnecessary terminal convergence on healthy unchanged
services.

## Progress

- [x] (2026-07-22) Restored the production deployment tree from Local executor
  integration commit range `17d214b4..7d05b4b3` to the release-claims boundary
  `b2c7277a`.
- [x] (2026-07-22) Preserved the post-boundary root ready-probe Git safety
  override required by the normal SSH Kiosk/Signage acknowledgement path.
- [ ] No Local executor implementation or hardware validation is authorized by
  this record.

## Surprises & Discoveries

- Observation: strict aggregate Local preflight and the later locked executor
  selection produced different results.
  Evidence: run `20260721-203422-2fd98e` selected SSH fallback with
  `runner-ineligible: local direct runner preflight is unavailable` before any
  StoneBase notice, maintenance, artifact transfer, Local unit, or repository
  mutation.

- Observation: `ansible-playbook -c local` never began on StoneBase.
  Evidence: the canonical cancellation completed with StoneBase still pending;
  cleanup succeeded.

## Decision Log

- Decision: remove the production Local executor integration introduced after
  `b2c7277a`, while preserving Phase B SSH optimization and typed release
  claims.
  Rationale: the Local executor's duplicated admission path remained
  unproven and increased deployment time. The SSH route is production-validated
  and materially faster than the pre-Phase-B route.
  Date/Author: 2026-07-22 / Codex and user.

- Decision: leave historical `local_execution_poc.py` in its `b2c7277a` form.
  Rationale: it is a non-live, non-canonical fixture helper with no deployment
  CLI flag, runtime distribution, or device route. It must not be extended or
  used to justify hardware work.
  Date/Author: 2026-07-22 / Codex and user.

- Decision: retain the constrained, per-invocation `safe.directory` Git command
  in `terminal-ready-probe.py` even though it postdates the restoration boundary.
  Rationale: the normal SSH route invokes the probe as root against a checkout
  owned by the terminal user. Removing the one-command exception makes Git
  reject the release SHA and prevents the ready acknowledgement. It does not
  restore any Local executor capability.
  Date/Author: 2026-07-22 / Codex and automated PR review.

## Outcomes & Retrospective

The production Local executor, its runtime artifacts, artifact transfer,
direct-selection logic, Local-specific host trust, and bootstrap interface are
absent from main. The normal canonical SSH release remains the only device
deployment route. No device cleanup or verification is part of this change, so
previously staged Local files on StoneBase remain inert and unmanaged.

## Re-entry Conditions

Any future Local execution proposal starts as a separate design. Before it may
contact hardware, it must prove its complete admission and execution path in a
disposable fixture, define one non-duplicated selection authority, pass the
repository's deployment contracts and hosted CI, and receive a new hardware
decision for an exact immutable candidate and target list. This freeze must not
be bypassed by a fallback in the ordinary SSH deployment route.

Revision note (2026-07-22): created when the production Local executor
integration was removed in favor of the Phase B SSH route.
