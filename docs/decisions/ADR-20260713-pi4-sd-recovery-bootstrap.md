---
id: ADR-20260713-pi4-sd-recovery-bootstrap
title: Pi4 SD-card recovery through Pi5 bootstrap and local endpoint override
status: accepted
date: 2026-07-13
source_of_truth: true
scope: explicitly enabled standard-site Pi4 kiosk recovery after SD-card replacement
related_code:
  - scripts/deploy/recover-pi4.py
  - infrastructure/ansible/playbooks/recover-pi4.yml
  - infrastructure/ansible/playbooks/recover-pi4-verify.yml
related_docs:
  - ../runbooks/pi4-sd-recovery.md
  - ../plans/pi4-sd-recovery-bootstrap.md
  - ../guides/client-initial-setup.md
validation: unit tests, Ansible syntax checks, isolated Postgres regression, and a future blank-Pi4 acceptance drill
open_items:
  - Execute and record one blank-Pi4 acceptance drill after the feature is released to Pi5.
---

# ADR-20260713: Pi4 SD-card recovery through Pi5 bootstrap and local endpoint override

## Status

accepted

## Context

The normal rolling-release coordinator assumes that a terminal already has its
repository, Docker, browser, service user, and Tailscale endpoint. A corrupted
Pi4 SD card has none of those prerequisites. Existing client backup targets
retain selected files but do not provide a safe automatic restore path, and
restoring Tailscale state or SSH private keys would clone device identity.

The operator can write Raspberry Pi OS Desktop (64-bit), configure Wi-Fi, and
seed the existing terminal user with the Pi5 SSH public key and password-free
sudo through Raspberry Pi Imager. The Pi5 must perform every later step.

## Decision

Use a Pi5-only recovery coordinator that receives an existing Pi4 inventory
hostname and a temporary LAN IPv4 address. Its read-only `plan` command proves
the target's inventory contract and the immutable SHA currently active on Pi5.
Its confirmed `run` command refuses an online old endpoint, configures the
fresh Pi4 through a dedicated playbook, then verifies the new Tailscale address
and services.

Eligibility is explicit per host: the inventory must set
`pi4_recovery_enabled: true` and use the standard Tailscale recovery model.
Talkplaza's LAN/DNS recovery is outside this ADR and remains fail-closed until
a separate site-specific decision and implementation exist.

The coordinator reuses `common`, `client`, and `kiosk` Ansible roles after a
small bootstrap role installs operating-system prerequisites. This keeps NFC,
status-agent, barcode, and kiosk settings in their existing Inventory/Vault
sources of truth. It never invokes client registration, writes application DB
state, restores old Tailscale state, or restores user SSH private keys.

After structured Tailscale JSON identifies the new endpoint, the coordinator
writes an ignored JSON-as-YAML file at
`infrastructure/ansible/host_vars/<target>/recovery-runtime.yml` on Pi5. The
file overrides only `ansible_host`, retains the prior endpoint for retry safety,
and is atomically replaced with mode `0600`. It is intentionally not committed:
Pi5 is the controller for normal deployments, while source-controlled inventory
must not accumulate changing Tailscale addresses.

The release SHA is accepted only when the durable Pi5 marker, the active
Blue/Green slot, and both active API/Web image tags agree. Missing or ambiguous
state fails closed; recovery never substitutes `main`.

## Alternatives

- Keep a full SD-card clone and restore it — rejected as the primary path. It
  copies stale machine identity and turns security/configuration drift into a
  recovery dependency.
- Restore Tailscale and SSH state from backup — rejected because duplicate
  device identity can disrupt the live Tailnet and access controls.
- Edit tracked static Tailscale IPs after every recovery — rejected because it
  creates noisy commits and makes Pi5's live endpoint depend on manual edits.
- Extend the normal rolling-release coordinator — rejected because an offline
  bare-metal rebuild has different safety and maintenance semantics.

## Consequences

The Pi5 SSD must retain the deployed repository, Inventory/Vault access, the
Pi5 release marker, and the normal Blue/Green state. A newly imaged Pi4 needs
only the specified Imager seed and temporary Pi5-reachable LAN address. The
operator receives a deterministic recovery state log under `logs/recovery/`.

This is not Pi5 host redundancy. A second Pi5 remains the future solution for
Pi5 or power-domain failure.

## Validation

`scripts/deploy/tests/test_recover_pi4.py` covers immutable release validation,
Pi4 inventory eligibility, secret-free endpoint persistence, failed bootstrap
behavior, and final standard-Ansible verification. The Runbook defines the
required physical acceptance drill.
