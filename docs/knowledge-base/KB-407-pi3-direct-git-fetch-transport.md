---
id: KB-407
title: Pi3 direct Git fetch exposed an external transport dependency during maintenance
status: active
scope: standard low-resource Pi3 release source transport
date: 2026-08-05
source_of_truth: true
related_code:
  - scripts/deploy/terminal-source-bundle.py
  - scripts/deploy/rolling_release/backends/ansible.py
  - scripts/deploy/rolling_release/coordinator.py
  - infrastructure/ansible/roles/common/tasks/main.yml
related_docs:
  - ../plans/pi3-staged-source-transfer-execplan.md
  - ../plans/standard-release-production-path-audit-execplan.md
  - ../guides/deployment.md
validation: isolated exact-SHA bundle import, corruption and idempotency mutations, constrained network-disabled runtime, coordinator fault rehearsals, and deployment contracts
open_items:
  - pass review and required hosted CI
  - merge and pass the separately gated exact-main verification
  - obtain separate explicit approval before any production retry
---

# KB-407: Pi3 direct Git fetch exposed an external transport dependency during maintenance

## Context and evidence

Standard run `20260805-025206-87ff4c` completed Pi5 and all six Pi4 targets, then failed while applying the low-resource Pi3. The common Ansible role ran `git fetch --no-tags origin <exact SHA>` directly on the Pi3. Three attempts ended before reset with Git HTTPS HTTP/2 cancellation, a short body, unexpected disconnect, early EOF, and invalid `index-pack`.

The coordinator used its already sealed file and runtime manifests to restore the Pi3 to `c32287db7b0f044cec4691f4a791513d7073e52e`, verify its release claim and required display/agent services, and clear maintenance. No manual Git command, service operation, state edit, or retry was used.

## Classification

The HTTP/2 cancellation was a transient external transport trigger. The release design nevertheless had a structural weakness: after entering maintenance, the low-resource Pi3 depended on GitHub and its outbound network to obtain candidate source bytes. Existing SSH compression applied to the Pi5-to-terminal preflight transport, not to this terminal-to-GitHub fetch. Increasing retries or forcing an HTTP version would not correct that authority mismatch.

## Fix contract

The existing coordinator, signage profile, remote Ansible executor, immutable SHA claims, and sealed rollback manifest remain the only authorities. Pi5 creates an incremental Git bundle from its exact candidate checkout against the observed Pi3 previous SHA. The bundle is capped at 64 MiB, hashed, verified, and bound to schema, run, inventory host, previous SHA, candidate SHA, size, digest, and one deterministic final path.

After the strict read-only Pi3 baseline and rollback manifest capture, but before notice or maintenance, Pi5 checks capacity and sends the bundle through the existing SSH Ansible route with `Compression=yes`. Transfer uses a run-scoped temporary file, owner-only mode, digest and Git prerequisite validation, then atomic rename. A failure cleans only those manifest-owned paths and stops before display, service, repository, notice, or maintenance mutation.

After maintenance begins, the Pi3 helper accepts only the verified local bundle. Git is configured with all protocols denied except the local file protocol, the bundle must expose exactly the candidate as `HEAD`, and the repository must still equal the clean sealed previous SHA. The helper imports the local object, resets to the exact candidate, re-verifies the clean HEAD, and removes the bundle. The signage playbook fails before the legacy fetch task if staged source is missing. Pi4 keeps its existing path; this change does not generalize transport across all terminals.

## Validation and prevention

- An exact bundle from `c32287db...` to `18d23c3d...` was 3,430,416 bytes and declared only the previous SHA as prerequisite.
- A checkout created before the candidate object existed imported and reset successfully while its configured origin pointed to an unreachable local endpoint.
- Pi3-side validation used about 24 MiB maximum RSS; import/reset used about 33.5 MiB and added about 5.3 MiB of Git objects in the isolated measurement.
- A one-CPU, 120-MiB, network-disabled Linux container completed without OOM and left zero source residue. This is an isolation contract, not physical Pi3 production approval.
- Digest, size, candidate, previous SHA, host, run, file type, and capacity mutations fail closed. Corrupt staging preserved repository HEAD/status/index plus service/display sentinels, and cleanup succeeded twice.
- The route ledger now owns a Pi3 source-stage boundary between manifest capture and notice. Before/during/after fault tests prove no maintenance or playbook begins on staging failure and that a cancellation after successful stage cleans the bundle before runtime authority cleanup.

Production retry remains frozen. Main integration, exact-main verification, and any new standard run are separate approval gates.
