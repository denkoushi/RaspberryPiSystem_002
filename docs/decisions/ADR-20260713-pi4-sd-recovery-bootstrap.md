---
id: ADR-20260713-pi4-sd-recovery-bootstrap
title: Pi4 SD-card recovery through Pi5 bootstrap and local endpoint override
status: accepted
date: 2026-07-13
source_of_truth: true
scope: explicitly enabled standard-site Pi4 kiosk recovery after SD-card replacement
related_code:
  - scripts/deploy/recover-pi4.py
  - infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml
  - infrastructure/ansible/playbooks/recover-pi4.yml
  - infrastructure/ansible/playbooks/recover-pi4-verify.yml
related_docs:
  - ../runbooks/pi4-sd-recovery.md
  - ../plans/pi4-sd-recovery-bootstrap.md
  - ../guides/client-initial-setup.md
validation: resolver and OAuth contract tests, Ansible syntax checks, isolated Postgres regression, and a future blank-Pi4 acceptance drill
open_items:
  - Create the restricted OAuth client and configure the encrypted Pi5 Vault after approval.
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

The coordinator does not parse raw `_meta.hostvars` from
`ansible-inventory --list`. Production endpoints are Jinja expressions and
that listing can retain an expression instead of its IPv4 value. A
connection-free resolver play asks Ansible to evaluate Inventory, Vault, and
Pi5-local runtime host variables, then returns a strict JSON contract with only
the endpoint, non-secret identifiers, feature flags, and credential-readiness
booleans. `plan` fails if the result is ambiguous or credentials are absent.

Fresh Pi4 recovery uses a dedicated Tailscale OAuth client held only in Pi5's
encrypted Vault. The client is restricted to auth-key creation and
`tag:kiosk`. When the new Pi4 is disconnected, Pi5 creates a non-reusable,
non-ephemeral, preauthorized auth key with a 600-second unused lifetime and
sends only that one-use key to the recovery task. OAuth and auth-key material
is suppressed from Ansible output and never written to recovery artifacts.
The recovery play explicitly disables Tailscale SSH because verification and
normal Pi5 Ansible access use the Pi5 public key with standard OpenSSH. Normal
deployments retain their existing authentication path and arguments.

## Alternatives

- Keep a full SD-card clone and restore it — rejected as the primary path. It
  copies stale machine identity and turns security/configuration drift into a
  recovery dependency.
- Restore Tailscale and SSH state from backup — rejected because duplicate
  device identity can disrupt the live Tailnet and access controls.
- Edit tracked static Tailscale IPs after every recovery — rejected because it
  creates noisy commits and makes Pi5's live endpoint depend on manual edits.
- Keep a reusable recovery preauth key in Vault — rejected because an auth key
  expires within 90 days and can leave emergency recovery silently unusable.
- Pass the long-lived OAuth client secret to Pi4 — rejected because Pi5 can
  mint a one-use key without expanding long-lived secret exposure.
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

`scripts/deploy/tests/test_recover_pi4.py` covers evaluated templated inventory,
immutable release validation, Pi4 eligibility, OAuth readiness, secret-free
endpoint persistence, failed bootstrap behavior, and final standard-Ansible
verification. `scripts/deploy/tests/test_recovery_oauth.py` uses an isolated
local HTTP service to prove the one-use key capabilities, bounded transient
retry, immediate authentication rejection, malformed-response rejection, and
secret-free output. The Runbook defines the physical acceptance drill.
