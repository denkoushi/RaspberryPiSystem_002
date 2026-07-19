---
id: ADR-20260716-terminal-profile-registry-adapter-boundary
title: Terminal profile registry and executable adapter boundary
status: accepted
date: 2026-07-16
source_of_truth: true
scope: SSH/Ansible/systemd/Git/status-agent Linux and Raspberry Pi terminals
related_code:
  - scripts/deploy/terminal-profile-registry.json
  - scripts/deploy/terminal_profile_registry.py
  - scripts/deploy/rolling_release/terminal_adapters.py
  - scripts/deploy/rolling_release/terminal_preflight.py
  - scripts/deploy/terminal-runtime-manifest.py
  - scripts/deploy/terminal_profile_contracts.py
  - scripts/ci/run-deploy-contracts-local.sh
related_docs:
  - ../architecture/deployment-modules.md
  - ../guides/deployment.md
  - ../plans/terminal-profile-registry-execplan.md
validation: registry-driven CI, isolated fault injection, static inventories, and read-only production plans
open_items:
  - Prove the first future product profile during its normal approved canary rollout.
---

# ADR-20260716: Terminal profile registry and executable adapter boundary

## Status

accepted

## Context

The rolling release originally treated Kiosk and Signage as fixed core roles.
Adding a terminal with another name or runtime structure required coordinated
edits to classification, inventory validation, planning, fleet state, and
execution. A hostname or hardware model cannot safely define deployment
behavior: two identical boards can run different products, and two different
boards can share one release contract.

The directly supported scope is a Linux or Raspberry Pi terminal reachable
through the existing SSH, Ansible, Git, systemd, and status-agent control path.
Android and microcontrollers are outside this decision.

## Decision

A terminal's deployment identity is its validated profile ID. Inventory assigns
that identity by placing a client host in exactly one profile group. Hostname,
hardware `device_type`, and legacy `manage_*` variables are facts or adapter
inputs; none selects the profile.

The strict JSON registry declares the profile ID and group, rollout order,
impact component, adapter and repository-owned playbook, notice duration,
canary group, `human` or `health-only` approval policy, exact systemd units,
rollback paths, health probes, and rendered release authority. Registry data
cannot contain commands, shell fragments, imports, or arbitrary executable
paths.

Planner, policy, fleet state, and coordinator consume validated profiles only.
An executable `TerminalAdapter` owns manifest capture, notice and maintenance,
playbook application, health and ready proof, exact rollback, maintenance
release, and final evidence. The coordinator alone owns ordering, durable state,
cancel, and the decision to rollback. Human gates are appended per profile;
the legacy `canaryHold` remains the current/latest compatibility view, and
`--approve RUN_ID` approves only the current gate.

The adapter also owns one secret-free runtime-manifest contract: exact systemd
units, Docker services, restart-on-restore units, and Compose identity. Runtime
capture and aggregate preflight consume that same value. Before a release unit
can exist, Pi5 reads the exact helper from the immutable candidate Git object
and streams it to the selected terminal. Its `probe-capture` mode inspects the
live state through the same parser as capture but creates no manifest directory,
rollback tag, service transition, checkout, or other mutation. Candidate source
is transported through bounded standard input rather than process arguments.

Aggregate preflight also streams and executes the exact immutable-candidate
agent-health helper. Every enabled optional agent must prove its container,
required supporting socket, and loopback JSON endpoint twice consecutively in a
bounded three-attempt window. Forward verification and rollback observation use
that same helper and stability rule. Interrupted recovery preflights every
sealed runtime manifest before restore or observation, including a manifest
captured before maintenance started; such a manifest may already own rollback
tags and the historical optional-agent health authority.

Profiles that fit `generic-systemd` use the shared serial terminal playbook and
need only registry plus inventory. A genuinely different lifecycle adds one
adapter (and its repository-owned playbook when needed) plus registry data;
core type branches are prohibited by CI. Each inventory still has exactly one
Pi5 control plane.

## Consequences

Production initially registers only Kiosk and Signage. Synthetic profiles prove
extension without inventing a future production device. Unknown repository
paths remain successful but fail closed across every registered profile.

CI reads the registry and validates adapters, inventory membership and canaries,
selected playbooks, literal `serial: 1`, orchestration guards, rollback
ownership, and absence of production profile names from core modules. Adding a
profile does not add a workflow job. The complete deployment contract command
list lives in `scripts/ci/run-deploy-contracts-local.sh`; developers and GitHub
Actions execute that same entry point so a profile or agent contract failure is
visible before push rather than after hosted CI starts.

This generalization does not justify a production rollout. Its first physical
proof occurs with a real product change through the ordinary canary and approval
process. TalkPlaza remains static-only until a real control plane exists.

## Alternatives

- Infer behavior from hostname or board model — rejected because neither
  identifies the installed product or its rollback and health contracts.
- Add a core enum and branch for every type — rejected because every product
  addition would reopen safety-critical planner, state, and coordinator code.
- Put commands or import paths in registry JSON — rejected because data would
  become an unreviewed execution language.
- Generalize immediately to Android or MCU devices — rejected because their
  transport, transactional update, health, and rollback models differ from the
  supported Linux control path.

## Validation

The test-only `inspection-panel` profile executes forward apply, health,
release-bound readiness, cancel, and exact rollback through the unchanged
coordinator. Separate synthetic profiles cover deterministic order, multiple
human gates, health-only policy, timeouts, rollback failure, and unknown
evidence. Production and TalkPlaza inventories and every selected playbook are
validated statically; only the production fleet state is read for plans. The
shared local/CI runner additionally exercises runtime capture with absent and
present optional agents, rejects unsupported external Docker features before
mutation, accepts digest-covered Compose health metadata, and validates a
candidate source larger than Linux's common single-argument limit. It also
proves exact candidate-health source transport, bounded consecutive health,
transient recovery, persistent-instability rejection, and pre-mutation sealed
manifest preflight during interrupted recovery.
