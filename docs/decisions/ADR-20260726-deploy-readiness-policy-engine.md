---
id: ADR-20260726-deploy-readiness-policy-engine
title: Data-driven release-readiness policy and sealed admission
status: accepted
date: 2026-07-26
source_of_truth: true
scope: canonical SSH rolling release preflight selection and scope-drift guard
related_code:
  - scripts/deploy/readiness-gates.json
  - scripts/deploy/rolling_release/readiness_policy.py
  - scripts/deploy/rolling_release/application.py
  - scripts/deploy/rolling_release/coordinator.py
related_docs:
  - ../plans/deploy-readiness-policy-engine-20260726.md
  - ../plans/deploy-release-readiness-review-20260725.md
validation: static registry contracts, pure policy fixtures, complete deploy contracts, required CI, and exact-head production preflight
open_items:
  - complete implementation and production rollout
---

# ADR-20260726: Data-driven release-readiness policy and sealed admission

## Status

Accepted for implementation. Production rollout remains conditional on exact
tested source, required CI, and read-only preflight.

## Context

The standard rolling-release application already runs eight readiness checks
before submitting a release unit. Their descriptions live in a Python tuple,
but their applicability is decided by hand-written conditionals in
`application.py`. Terminal preflight scope is also derived from selected
inventory before the planner identifies actual mutation, activation, and
verification work. This duplicates deployment knowledge and makes a new
component easy to add without a readiness decision.

The planner already emits the necessary typed facts: changed components,
server work, terminal profile, mutation, activation, verification, execution
flags, and required release claims. The missing boundary is a data-only policy
that maps those facts to repository-owned read-only probes.

## Decision

Readiness rules move to `scripts/deploy/readiness-gates.json`. The file may use
only a bounded, closed condition grammar, closed scope selectors, and closed
probe capability IDs. It cannot contain commands, imports, module paths, or
arbitrary expressions. A strict validator rejects unknown values, uncovered
impact components, invalid rollout evidence, and regression-test references
that do not exist.

`readiness_policy.py` is the single pure decision layer. It normalizes the
planner result, selects gates and exact work targets, assigns structured probe
evidence, classifies every gate, and aggregates the existing exit semantics.
Missing or malformed planner facts and unowned probe issues are
`incomplete`; inventory-wide fallback is prohibited.

The first seven existing blocking rules remain `enforce`. The interrupted-run
notification remains `observe`. A new gate normally starts as `observe` and
requires at least three recorded production run IDs plus a separate reviewed
registry change before promotion. An immediate `enforce` gate is permitted
only for a safety rule with a concrete impact and reason. Promotion is never
automatic.

Successful preflight creates a secret-free `ReadinessAdmission` containing the
source SHA, policy digest, components, hosts, profiles, action levels, claims,
capabilities, and applicable gates. After prior sealed-run recovery, the
coordinator compares its new locked plan to the admission before any
new-release mutation. Scope reduction and action downgrade are allowed. New
hosts, action escalation, claims, capabilities, source, or policy are rejected.
The admission summary is persisted for status and audit.

## Consequences

Future product changes generally need only a component-coverage decision in
the registry. A genuinely new observation adds one small typed probe adapter
and one capability registration, not feature-name branching in the
application or planner.

Deployments will no longer probe unrelated terminals. Conversely, malformed
plans no longer receive a conservative all-inventory fallback; they stop
before release submission because the system cannot prove what it will touch.

The registry becomes a safety-critical source and therefore needs strict,
fast tests in the existing deploy-contract job. Remote probes remain
sequential because they share one fleet lock. This decision does not add a
database migration, automatic repair, terminal exclusion, or automatic
relaxation of failed gates.

## Alternatives Considered

Keeping Python conditionals was rejected because it preserves the duplicated
knowledge that caused this work. Registering commands in JSON was rejected
because it creates an untyped execution surface. Probing all inventory as a
fallback was rejected because unrelated hardware can block a release while a
missing intended target can still be misunderstood. Automatically promoting a
gate after three runs was rejected because observations are evidence for human
review, not authority to create a production blocker.
