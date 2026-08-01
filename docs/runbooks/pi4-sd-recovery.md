---
title: Pi4 SD-card recovery through Pi5
status: accepted
scope: explicitly enabled standard-site Pi4 kiosk whose SD card was replaced after corruption or failure
date: 2026-07-13
source_of_truth: docs/runbooks/pi4-sd-recovery.md
related_code:
  - scripts/deploy/recover-pi4.py
  - infrastructure/ansible/playbooks/recover-pi4.yml
  - infrastructure/ansible/playbooks/recover-pi4-verify.yml
related_docs:
  - ../decisions/ADR-20260713-pi4-sd-recovery-bootstrap.md
  - ../guides/client-initial-setup.md
validation: resolver, OAuth, recovery CLI, and isolated regression tests; blank-Pi4 acceptance drill pending
open_items:
  - Create the recovery-scoped Tailscale OAuth client and store it in the encrypted Pi5 Vault.
  - Record the first physical recovery drill and measured elapsed time.
---

# Pi4 SD-card recovery through Pi5

## Purpose and safety boundary

Use this runbook only when an existing, inventory-managed Pi4 kiosk has a
failed or corrupted SD card. It rebuilds the Pi4 from the Pi5's active immutable
release and existing Inventory/Vault values. It is not a new-client setup and
does not register a new `ClientDevice`.

The current recovery path is limited to standard-site hosts with
`pi4_recovery_enabled: true` and Tailscale enabled. Talkplaza LAN/DNS recovery
is not supported by this runbook and requires a separate ADR and procedure.

Run the recovery command on the Pi5 only. Normal application releases still use
`scripts/update-all-clients.sh`; do not use this command for a healthy terminal
or a normal version update.

## One-time controller credential setup

Before relying on this Runbook, create one Tailscale OAuth client for Pi4 SD
recovery. Grant only Auth Keys creation and `tag:kiosk`; do not grant device,
policy, DNS, or general administrative scopes. Store its values as
`vault_tailscale_recovery_oauth_client_id` and
`vault_tailscale_recovery_oauth_client_secret` in Pi5's encrypted
`host_vars/raspberrypi5/vault.yml`. Never put either value in Inventory, shell
history, tickets, recovery logs, or a Pi4 file. Revoke and replace the client
if the Pi5 Vault or controller is suspected to be compromised.

Recovery does not use `vault_tailscale_auth_key`. For each disconnected fresh
Pi4, Pi5 requests a one-use, non-ephemeral, preauthorized `tag:kiosk` key whose
unused lifetime is 600 seconds. The long-lived OAuth secret remains on Pi5.
The recovery play sets Tailscale SSH off so the Pi5 public key continues to use
standard OpenSSH, as required by the verification steps below.

## Operator preparation

First run the read-only plan command on Pi5. Replace the placeholders with the
existing inventory hostname and a temporary LAN IPv4 address reachable from
Pi5.

    cd /opt/RaspberryPiSystem_002
    python3 scripts/deploy/recover-pi4.py plan \
      --target <existing-pi4-hostname> \
      --bootstrap-host <temporary-lan-ip>

The command must show the existing terminal user, a literal previous IPv4
endpoint, an immutable 40-character release SHA, `"inventoryResolved": true`,
and `"tailscaleAuth": {"mode": "oauth", "configured": true,
"tag": "tag:kiosk"}`. If it reports missing OAuth credentials, an unresolved
endpoint, an unavailable release marker, or inconsistent Blue/Green state,
stop. Do not replace the SHA with `main`.

Write **Raspberry Pi OS Desktop (64-bit)** to the replacement SD card in
Raspberry Pi Imager. In the same Imager customisation step, set all of the
following:

1. The exact existing terminal user shown by `plan`.
2. The correct Wi-Fi and a temporary LAN address that Pi5 can reach.
3. SSH public-key authentication using the Pi5 controller public key.
4. No password requirement for `sudo`.

The Pi5 public key is normally available as `~/.ssh/id_ed25519.pub` on Pi5.
Do not manually install Git, Docker, Tailscale, NFC configuration, status-agent
configuration, browser configuration, or application credentials on Pi4.

Raspberry Pi Imager supports credentials, Wi-Fi, and remote access during OS
customisation; Raspberry Pi OS also supports disabling the sudo password
requirement during installation. See the [official getting-started guide](https://www.raspberrypi.com/documentation/computers/getting-started.html) and [official configuration guide](https://www.raspberrypi.com/documentation/computers/configuration.html).

## Recovery execution

After the replacement Pi4 has booted and the specified temporary LAN address is
reachable from Pi5, run:

    cd /opt/RaspberryPiSystem_002
    python3 scripts/deploy/recover-pi4.py run \
      --target <existing-pi4-hostname> \
      --bootstrap-host <temporary-lan-ip> \
      --reason 'SD-card failure ticket or date' \
      --confirm-recovery

The command first proves that the old production endpoint is not accepting SSH.
It then confirms the supplied initial user, installs OS prerequisites, joins
the new Pi4 to Tailscale, recreates configuration through existing Ansible
roles, stores the new endpoint only on Pi5, and verifies standard SSH, Ansible,
kiosk-browser, status-agent, NFC, optional barcode, and the kiosk URL.

Success is JSON with `"phase": "completed"`. The matching recovery record is
under `logs/recovery/` on Pi5. The temporary LAN address is not retained as the
normal endpoint; the Pi5-local runtime override contains the verified Tailscale
address instead.

## Failure handling

- `previous production endpoint still accepts TCP/22`: stop or isolate the old
  Pi4 before retrying. This prevents two devices from sharing one identity.
- `bootstrap host does not authenticate as the target inventory user`: rebuild
  the SD settings with the user printed by `plan` and the Pi5 SSH public key.
- Pi5 marker or Blue/Green validation failure: repair the Pi5 through its
  standard release/runbook path first. Do not use a branch name as a substitute.
- `Pi5 recovery OAuth credential is not configured`: create or rotate the
  restricted OAuth client and update only the encrypted Pi5 Vault; do not fall
  back to a reusable recovery key.
- OAuth HTTP 401/403 or an unexpected key contract: stop and inspect the OAuth
  scope and permitted tag. Transient connection, 429, and 5xx failures are
  attempted at most three times; start a new confirmed run after correcting the
  cause.
- A failure after `runtime-endpoint-saved`: do not delete the new Tailscale node
  automatically. Inspect the named recovery state JSON, correct the reported
  issue, and repeat the confirmed command. The retained original endpoint makes
  the duplicate-device check safe on retry.

No recovery command deletes old Tailscale nodes, restores Tailscale state, or
restores user SSH private keys. Those actions require a separate operator
decision because they can affect live identity and access control.

## Physical acceptance drill

Before relying on this in production, perform one drill with a disposable or
known-empty Pi4 SD card. Start timing after OS/Wi-Fi/Imager configuration and
the temporary LAN address are ready. Confirm that the command completes within
60 minutes, then confirm the kiosk screen, one NFC read, barcode operation when
enabled, and a normal Pi5 `ansible -i infrastructure/ansible/inventory.yml
<target> -m ping`. Record the time and outcome in the next relevant incident or
operations record; do not add narrative logs to `docs/INDEX.md`.

Also confirm that the new Tailscale node has `tag:kiosk`, and search the command
output, recovery JSON, and runtime endpoint override for OAuth/auth-key
material. None may be present. Preserve the old SD instead of erasing it, but
do not restore its Tailscale state or SSH private keys to the replacement.
