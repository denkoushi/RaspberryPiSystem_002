---
id: KB-406
title: Pi4 canary initial deploy-status gate and runtime recreation drift
status: active
scope: standard Pi4 kiosk activation and terminal rollback
date: 2026-08-05
source_of_truth: true
related_code:
  - apps/web/src/layouts/KioskLayout.tsx
  - scripts/deploy/terminal-runtime-manifest.py
  - scripts/deploy/tests/test-terminal-runtime-manifest-docker.sh
related_docs:
  - ../plans/standard-release-production-path-audit-execplan.md
  - ../runbooks/deploy-status-recovery.md
validation: Kiosk layout behavioral test, runtime manifest unit tests, real Compose force-recreate/restore contract, incident mutations, and full deploy contracts
open_items:
  - pass review and required hosted CI
  - pass the exact-main ARM64 five-sample rehearsal
  - prepare and obtain separate approval for production recovery
---

# KB-406: Pi4 canary initial deploy-status gate and runtime recreation drift

## Context

Separately approved standard run `20260804-185819-598324` deployed exact main
`0f9c5c67773433e83fb4772bc6b45455af3eff0a`. Pi5 candidate preparation,
migration, traffic switch, the fixed 300-second monitor, and forward cleanup
all succeeded. Green became the stable active Pi5 slot. The first Pi4 canary,
`raspi4-kensaku-stonebase01`, then completed its forward Ansible apply with
`ok=144`, `changed=8`, `unreachable=0`, and `failed=0`, but its exact-SHA ready
acknowledgement timed out.

Rollback restored the prior Git SHA and recreated all three agent containers,
but final runtime verification failed. Maintenance therefore remained in
place, the kiosk browser stayed stopped after the rollback attempt, and every
remaining terminal stayed pending. No manual service restart, maintenance
clear, state edit, internal deployment command, or new run is permitted while
the audit is open.

## Read-only evidence

The Pi5 API log for the seven-minute failure window recorded 391 successful
`GET /api/system/deploy-status` requests and no deploy-status `POST`. The ready
claim was never sent; it was not rejected by the API.

The stopped Firefox profile retained the exact activation record. At
`2026-08-04T19:24:30.489Z`, the stale bundle stored run ID
`20260804-185819-598324`, verification ID
`139a2faf0ebfb093e5200982d8ac4109`, desired exact SHA `0f9c5c67...`, and
`attempts=1`, then replaced the current URL with the cache-busted activation
URL. The latest main JavaScript, CSS, and vendor asset names were not present
in the Firefox disk cache.

The route at that moment was the self-inspection record approval page. That
page opens a synchronous `window.prompt` during its first effect. A fresh
document has no deploy-status query data yet, so `KioskLayout` previously
mounted its `Outlet` before learning that the release was in maintenance.
The child prompt could then block the browser event loop before the parent
layout processed the verifying response or sent the ready claim.

The file rollback returned the canary to SHA
`c32287db7b0f044cec4691f4a791513d7073e52e`. NFC, barcode, and torque
containers were running, and their image, image reference, environment hash,
security hash, mounts, restart policy, running state, and Compose context all
matched the sealed manifest. Only `runtimeConfigSha256` differed for all three.
The recreated containers were produced by Compose 5.1.1 and contained generated
metadata such as `com.docker.compose.replace`, a new Compose image label, and
daemon-selected hostname/runtime defaults. The old digest hashed raw Docker
inspect configuration, so a faithful recreation was not reproducible across
the tool update.

A fresh read-only fleet observation on 2026-08-05 used the standard status
entrypoint and the production Pi5-to-Pi4 SSH route. All six Pi4 hosts were
powered and reachable, were still on
`c32287db7b0f044cec4691f4a791513d7073e52e`, had
`kiosk-browser.service` active and `status-agent.timer` active, and reached the
Pi5 API health endpoint with HTTP 200. The deploy-status API reported
maintenance only for `raspi4-kensaku-stonebase01`, with `phase=failed` and
owner run `20260804-185819-598324`; the other five hosts reported
`isMaintenance=false`. StoneBase's torque, barcode, and NFC containers were
also running. Thus the visible maintenance page is retained fail-closed
authority from the earlier canary failure, not evidence of a new deployment or
an unavailable host. No maintenance clear, restart, state edit, recovery, or
deployment was performed during this observation.

## Root causes

The ready timeout was caused by an unsafe initial render boundary: unknown
deploy status was treated like normal operation long enough to mount a route
that could synchronously block JavaScript.

The rollback false-negative was caused by conflating the terminal service
contract with Docker and Compose implementation metadata. The manifest already
sealed the image, environment, security, mounts, restart policy, and Compose
identity separately, but the additional broad hash included values that the
same Compose file cannot reproduce after an Engine or Compose update.

## Fix

`KioskLayout` now renders the maintenance screen while deploy status is
undefined as well as while maintenance is active. Routed business pages do not
mount until the initial deployment authority is known, so a synchronous child
dialog cannot preempt activation.

Runtime manifest schema 3 introduces reproducible runtime configuration
version 2. It hashes the intentional fields not already sealed separately,
including working directory, healthcheck, exposed ports, stop behavior, custom
non-Compose labels, logging, networking extensions, and explicit resource
controls. It normalizes Compose-owned labels and known daemon defaults. Schema
2 manifests remain readable only through a legacy compatibility path that
still requires exact equality of every separately sealed field; this permits
coordinator-owned recovery of the already-failed run without treating the old
unreproducible digest as current proof.

## Prevention and validation

- The Kiosk layout test starts with unknown deploy status and proves normal
  content does not mount until a non-maintenance response exists.
- Runtime manifest unit tests prove Compose label, hostname, and daemon-default
  changes are equivalent, functional healthcheck drift is not, and a sealed
  schema 2 manifest can be recovered through the bounded compatibility path.
- A real disposable Docker test captures one Compose service, force recreates
  it, proves no additional recreation is needed, injects healthcheck drift,
  restores it, and finishes with zero labelled container, network, or volume
  residue.
- The incident mutation corpus registers
  `kiosk-initial-deploy-status-gate` and
  `terminal-runtime-recreate-metadata`; removing either correction makes the
  audit fail.

## Open items

Production remains frozen. The complete local audit has passed from the
beginning and must now be reviewed and proven in hosted CI and exact-main ARM64
rehearsal.
Only after fresh read-only evidence may a separate, explicit recovery plan be
approved. The failed run must not be repaired manually or used as authority for
a new rollout.
