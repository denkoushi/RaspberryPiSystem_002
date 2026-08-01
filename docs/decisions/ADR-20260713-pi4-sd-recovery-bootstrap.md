---
id: ADR-20260713-pi4-sd-recovery-bootstrap
title: Pi4 SD-card recovery through Pi5 and a managed LAN endpoint
status: accepted
date: 2026-08-01
source_of_truth: true
scope: explicitly enabled standard Pi4 kiosk recovery after SD-card replacement
related_code:
  - scripts/deploy/recover-pi4.py
  - scripts/deploy/recovery/inventory.py
  - scripts/deploy/recovery/network.py
  - infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml
  - infrastructure/ansible/playbooks/recover-pi4.yml
  - infrastructure/ansible/playbooks/recover-pi4-verify.yml
related_docs:
  - ../runbooks/pi4-sd-recovery.md
  - ../plans/pi4-sd-recovery-lan-provider-execplan.md
  - ../guides/client-initial-setup.md
validation: resolver and LAN recovery contract tests, Ansible checks, isolated regression, and a future blank-Pi4 acceptance drill
open_items:
  - Prove Pi5 routing and DHCP reservations for all enabled terminal LANs.
  - Execute and record one blank-Pi4 acceptance drill after release to Pi5.
---

# ADR-20260713: Pi4 SD-card recovery through Pi5 and a managed LAN endpoint

## Status

Accepted. This 2026-08-01 revision supersedes the un-deployed recovery-specific
Tailscale OAuth design. Existing Tailscale use outside SD recovery is unchanged.

## Context

The normal rolling-release coordinator assumes that a terminal already has its
repository, Docker, browser, services, and a reachable management endpoint. A
corrupted Pi4 SD card has none of those software prerequisites. Restoring old
Tailscale state or SSH private keys would clone machine identity and is unsafe.

The previous recovery design minted a one-use Tailscale key from a Pi5-held
OAuth client. The system is expected to be used commercially and cannot depend
on a personal-account allowance or a new recurring service payment. Recovery
must therefore work without a Tailscale account or recovery credential.

The repository already declares a private LAN address for every enabled Pi4,
but NetworkManager deliberately does not rewrite connection profiles. SSH is
only half of the network contract: kiosk and device-agent URLs also derive from
`network_mode`, so a LAN recovery must switch both management and application
traffic for the recovered host.

## Decision

Keep the Pi5-only recovery coordinator and its Ansible-evaluated, secret-free
inventory resolver. Replace the recovery authentication object with a
`recoveryNetwork` contract containing mode `lan`, one target IPv4, and one Pi5
LAN service IPv4. Five explicitly enabled hosts declare
`pi4_recovery_lan_endpoint`; Assembly and other device classes do not.

The supplied `--bootstrap-host` must be a literal RFC1918 address and exactly
match the declared target endpoint. This turns a stable DHCP reservation or an
approved static assignment into a precondition and prevents an arbitrary lease
from becoming a persistent management address. Same-board SD replacement keeps
the interface MAC, so an existing DHCP reservation remains applicable. Board
replacement requires an explicit reservation and Inventory update.

During confirmed recovery, extra variables force `network_mode=local` and
`tailscale_enabled=false`. The shared, client, and kiosk roles remain the single
configuration source, but the shared role skips Tailscale and all derived Pi5
URLs use the LAN service address. After provisioning, the play reads global
IPv4 addresses from the rebuilt Pi4 and requires the declared address to be
present. Only then may the coordinator write an ignored, mode-0600 Pi5 host-var
override containing `ansible_host`, `network_mode: local`,
`tailscale_enabled: false`, the immutable SHA, run ID, and original endpoint.

`plan` remains read-only. `run` still re-resolves inside the shared Fleet Lock,
rejects a live old endpoint, validates the immutable Pi5 Blue/Green release,
uses standard OpenSSH, verifies the rebuilt SHA and services, and closes Fleet
State as verified or unknown/failed. It never edits the application database,
registers a client, restores an old machine identity, or invents routing.

Python exposes a small `RecoveryNetworkProvider` protocol. The LAN provider
owns address policy, result validation, and runtime network host variables;
the coordinator owns orchestration, files, commands, and Fleet State. This
separation permits a future self-hosted provider without coupling it to release
evidence or recovery state logic.

## Alternatives

- Keep recovery-specific Tailscale OAuth — rejected because it introduces an
  external commercial-account and credential-rotation dependency.
- Keep a reusable Tailscale key — rejected because it expires, expands secret
  exposure, and can fail when recovery is needed most.
- Save any temporary DHCP address — rejected because later Ansible operations
  would silently depend on an unstable lease.
- Configure static Wi-Fi details automatically — rejected for this change
  because the repository intentionally supports different site networks and
  lacks a reviewed per-site gateway/DNS/prefix contract. Router DHCP reservation
  is narrower and preserves the existing NetworkManager policy.
- Change global `network_mode` to local — rejected because it would modify every
  server and terminal at once. The ignored host override scopes the transition
  to a successfully recovered Pi4.
- Restore a full SD image or old Tailscale/SSH state — rejected because it
  restores stale configuration and duplicate identity.
- Install Headscale or raw WireGuard now — deferred. Both add controller,
  routing, key distribution, monitoring, and disaster-recovery responsibilities
  that are unnecessary when a routed managed LAN is available.

## Consequences

Pi5-to-Pi4 and Pi4-to-Pi5 LAN routing is now a hard operational dependency.
Configuration readiness does not prove a live route; the physical runbook must
test it before a drill. In particular, the recorded Sessaku and Pi5 addresses
are in different private subnets and need an explicit routed path.

Recovery-specific OAuth code and Vault fields are removed. Normal Tailscale
configuration for existing non-recovered hosts remains in the shared role. A
successfully recovered host uses LAN until its ignored runtime override is
deliberately changed through a separate approved operation.

This remains Pi4 SD recovery, not Pi5 redundancy or site-network disaster
recovery. A missing router path, failed Pi5, power-domain failure, Assembly
hardware acceptance, and replacement Pi4 board are separate procedures.

## Validation

`scripts/deploy/tests/test_recover_pi4.py` covers templated contract resolution,
RFC1918 policy, bootstrap mismatch, disabled hosts, immutable release evidence,
read-only planning, lock-time resolution, observed-address mismatch, atomic LAN
override persistence, standard Ansible verification, and failed-state closure.
Ansible syntax and synthetic checks cover resolver, recovery, and verification
plays. The repository deploy-contract suite runs all related tests plus an
isolated temporary PostgreSQL migration/API/index regression. Final acceptance
is a blank-SD physical drill completed within 60 minutes with recorded SHA,
route, SSH, kiosk, status, NFC, and optional barcode evidence.
