---
id: ADR-20260713-pi4-sd-recovery-bootstrap
title: Pi4 SD recovery through a verified dynamic LAN bootstrap endpoint
status: accepted
date: 2026-08-01
source_of_truth: true
scope: explicitly enabled standard Pi4 kiosk recovery after SD-card replacement
related_code:
  - scripts/deploy/recover-pi4.py
  - scripts/deploy/recovery/bootstrap.py
  - scripts/deploy/recovery/inventory.py
  - scripts/deploy/recovery/network.py
  - infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml
  - infrastructure/ansible/playbooks/recover-pi4.yml
related_docs:
  - ../runbooks/pi4-sd-recovery.md
  - ../plans/pi4-sd-recovery-dynamic-bootstrap-execplan.md
  - ../guides/client-initial-setup.md
validation: dynamic endpoint, SSH identity, resolver, Fleet State, Ansible, and isolated regression tests; physical blank-SD drill pending
open_items:
  - Deploy the exact merged SHA to Pi5 after approval.
  - Execute and record one blank-Pi4 acceptance drill.
---

# ADR-20260713: Pi4 SD recovery through a verified dynamic LAN bootstrap endpoint

## Status

Accepted. This revision supersedes both the un-deployed recovery OAuth design
and the fixed target-LAN endpoint decision. Normal Tailscale behavior outside
SD recovery is unchanged.

## Context

The operator workflow is fixed by the physical failure: buy a new SD, install
Raspberry Pi OS, join Wi-Fi, then report the old logical terminal, the new OS
hostname, and its current IP. DHCP may not reuse the former address.

Live factory evidence confirmed that Inventory is not authoritative for current
LAN assignment. `raspberrypi4` was healthy at `192.168.10.223` while its declared
address was `.224`; Sessaku was healthy at `192.168.10.104` while its declared
address was on `192.168.128.187`. A fixed-address recovery precondition would
therefore reject healthy, correctly reachable replacements.

Accepting an arbitrary IP without identity verification would be unsafe. The
repository's global Ansible configuration also disables host-key checking, so
merely running SSH as the expected user would not prove that every later
Ansible connection reached the same OS.

## Decision

Keep the Pi5-only coordinator, Ansible-evaluated secret-free Inventory contract,
immutable Pi5 release proof, Fleet Lock, and local-mode provisioning. Replace
the target fixed endpoint with a dynamic bootstrap contract:

- `--bootstrap-host` is the current literal RFC1918 IPv4 supplied for this run.
- `--bootstrap-hostname` is the short hostname configured on the new OS.
- Inventory supplies the expected SSH username and logical terminal identity.
- `plan` reads exactly one ED25519 public host key, pins it in a temporary
  mode-0600 known-hosts file, and verifies the username and hostname read-only.
- `plan` returns the public `SHA256:` fingerprint; `run` requires it through
  `--bootstrap-host-key` and repeats all checks inside the Fleet Lock.
- Recovery and final verification use strict host-key checking with the same
  temporary known-hosts entry, regardless of the global Ansible default.

The resolver's schema-v3 `recoveryNetwork` contains only mode, configured state,
and the Pi5 LAN service endpoint. `pi4_recovery_lan_endpoint` is removed from
the five hosts. Eligibility remains the explicit `pi4_recovery_enabled: true`
capability; Assembly and other device classes remain excluded.

Runtime metadata distinguishes `original_ansible_host` (the earliest endpoint)
from `previous_ansible_host` (the immediately previous active endpoint) and
also stores the reported hostname and public SSH fingerprint. A different live
previous endpoint blocks recovery. A previously recorded SSH identity blocks
recovery even if it appears at another IP. The same DHCP IP may be reused only
when the new OS has a different host key and all user/hostname checks pass.

Ansible still forces `network_mode=local` and `tailscale_enabled=false`, derives
terminal service URLs from Pi5's LAN endpoint, and does not restore an old SSH
private key or Tailscale state. Before endpoint persistence, the play proves the
supplied IPv4 remains assigned to the rebuilt Pi4.

## Alternatives

- Fixed DHCP reservation or static target address: rejected as a mandatory
  recovery identity because actual terminal addresses drift and the operator
  already knows the current address. Sites may still reserve addresses for
  convenience.
- Search the LAN by hostname or MAC: rejected because discovery can select the
  wrong machine and broadens network access beyond the supplied endpoint.
- Trust only username and hostname: rejected because both can be duplicated;
  the SSH host key binds every later connection to the OS reviewed in `plan`.
- Auto-accept a changed host key: rejected because DHCP reassignment between
  plan and run must fail closed.
- Recovery-specific Tailscale OAuth or reusable key: rejected because recovery
  must not depend on an external commercial account, expiring secret, or old
  overlay identity.
- Restore a complete SD image: rejected because it restores stale software and
  duplicate machine identity.

## Consequences

The operator must report one additional simple value, the new OS hostname, and
copy the fingerprint from plan into run. In return, recovery works with a new
DHCP address and prevents silent connection to a different LAN device.

Pi5-to-Pi4 and Pi4-to-Pi5 routing remain hard dependencies. A fresh Pi4 at home
is not reachable from a factory Pi5 through this LAN-only design unless an
explicit route exists. The feature does not solve Pi5 failure, router failure,
site-wide outage, Pi4 board replacement, or Assembly hardware acceptance.

`plan` now performs read-only network I/O but no state mutation. Host keys and
fingerprints are public data, not credentials. Temporary known-hosts files are
deleted on success and exceptions; runtime and recovery state contain no SSH
private key or application secret.

## Validation

Focused tests cover dynamic RFC1918 addresses, exact five-host eligibility,
hostname and username mismatch, missing/multiple host keys, fingerprint drift,
temporary-file cleanup, plan immutability, lock-time revalidation, same-IP/new-
key acceptance, moved-old-OS rejection, endpoint history, pinned Ansible/SSH,
observed-address drift, atomic mode-0600 persistence, Fleet failure closure, and
service/SHA verification. Ansible syntax and production-shaped resolver checks
cover schema-v3 evaluation. The complete deploy-contract suite must also apply
all migrations to an isolated temporary PostgreSQL database, run SQL/EXPLAIN
and related API tests, and remove only its UUID-labelled Docker resources.
