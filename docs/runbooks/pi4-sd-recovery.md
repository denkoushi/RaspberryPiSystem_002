---
title: Pi4 SD-card recovery through Pi5 over the managed LAN
status: accepted
scope: explicitly enabled standard Pi4 kiosk whose SD card was replaced after corruption or failure
date: 2026-08-01
source_of_truth: docs/runbooks/pi4-sd-recovery.md
related_code:
  - scripts/deploy/recover-pi4.py
  - infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml
  - infrastructure/ansible/playbooks/recover-pi4.yml
  - infrastructure/ansible/playbooks/recover-pi4-verify.yml
related_docs:
  - ../decisions/ADR-20260713-pi4-sd-recovery-bootstrap.md
  - ../guides/client-initial-setup.md
  - ../plans/pi4-sd-recovery-lan-provider-execplan.md
validation: LAN resolver and recovery CLI tests, Ansible checks, isolated regression tests; blank-Pi4 acceptance drill pending
open_items:
  - Prove Pi5 routing and DHCP reservations for every enabled terminal LAN.
  - Record the first physical recovery drill and measured elapsed time.
---

# Pi4 SD-card recovery through Pi5 over the managed LAN

## Purpose and safety boundary

Use this runbook only when an existing, inventory-managed Pi4 kiosk has a failed
or corrupted SD card. It rebuilds the Pi4 from the immutable release proven to
be running on Pi5. It does not register a new `ClientDevice`, restore an old
Tailscale identity, restore an SSH private key, or use a Tailscale account.

Only the five standard Pi4 hosts with `pi4_recovery_enabled: true` are eligible.
Assembly, Talkplaza, Pi3, Pi5, and replacement of the Pi4 board itself require
separate acceptance. Run the command on Pi5 only. Use the normal release command
for a healthy terminal.

## One-time LAN preparation

Each eligible host declares `pi4_recovery_lan_endpoint` in
`infrastructure/ansible/inventory.yml`. That address is the recovery SSH address
and the address saved for later Ansible runs. It must be stable; an arbitrary
temporary DHCP lease is not acceptable.

For the normal SD-only failure, the Pi4 board and its network-interface MAC
address do not change. Preserve or create a DHCP reservation that maps that MAC
address to the declared endpoint. If the Pi4 board is replaced, update the
reservation and the reviewed Inventory value before recovery. Do not guess a
free address.

Pi5 must have an L3 route to the declared Pi4 address, and Pi4 must be able to
reach the declared Pi5 LAN service address. `No route to host` is a hard stop;
this procedure does not create inter-site routing. The current recorded
addresses are:

| Inventory host | Pi4 LAN endpoint | Pi5 LAN service endpoint |
| --- | --- | --- |
| `raspberrypi4` | `192.168.10.224` | `192.168.10.230` |
| `raspi4-robodrill01` | `192.168.10.236` | `192.168.10.230` |
| `raspi4-fjv60-80` | `192.168.10.12` | `192.168.10.230` |
| `raspi4-kensaku-stonebase01` | `192.168.10.238` | `192.168.10.230` |
| `raspi4-sessaku-01` | `192.168.128.187` | `192.168.10.230` |

The Sessaku entry crosses two private subnets and therefore needs an explicit
router path. A successful read-only plan proves configuration, not live routing.

## Read-only preparation

Run `plan` on Pi5 with the target's declared LAN endpoint:

    cd /opt/RaspberryPiSystem_002
    python3 scripts/deploy/recover-pi4.py plan \
      --target <existing-pi4-hostname> \
      --bootstrap-host <declared-lan-endpoint>

The result must show the exact existing user, a literal previous endpoint, an
immutable 40-character release SHA, `"inventoryResolved": true`, and:

    "recoveryNetwork": {
      "mode": "lan",
      "configured": true,
      "targetEndpoint": "<declared-lan-endpoint>",
      "serverEndpoint": "<pi5-lan-endpoint>"
    }

If the supplied address differs from Inventory, the LAN contract is absent, or
Pi5 release evidence is inconsistent, stop. `plan` does not contact Pi4 and
does not change Fleet State, runtime overrides, or recovery logs.

Before removing the failed SD, record the Pi4 board's wired or Wi-Fi MAC address
from the router reservation. Isolate the old terminal from the network and keep
its SD unmodified as a rollback artifact.

## Replacement SD preparation

Write Raspberry Pi OS Desktop (64-bit) with Raspberry Pi Imager. Configure the
exact user printed by `plan`, the production Wi-Fi, SSH public-key access using
Pi5's public key, and password-free sudo. Imager does not establish the router
reservation; verify separately that the same Pi4 MAC receives the declared LAN
address after boot.

Do not manually install Git, Docker, Tailscale, NFC configuration, status-agent
configuration, browser configuration, or application credentials. Recovery
recreates the application from the current Inventory/Vault and generates a
fresh OS/SSH identity.

From Pi5, verify the route, expected host identity, and Pi4-to-Pi5 service path:

    ping -c 3 <declared-lan-endpoint>
    ssh -o BatchMode=yes <existing-user>@<declared-lan-endpoint> id -un
    ssh <existing-user>@<declared-lan-endpoint> \
      curl -kfsS https://<pi5-lan-endpoint>/api/system/health

Stop if the address is assigned to a different device, SSH returns a different
user, or the Pi5 service is unreachable.

## Recovery execution

Run the confirmed command on Pi5:

    cd /opt/RaspberryPiSystem_002
    python3 scripts/deploy/recover-pi4.py run \
      --target <existing-pi4-hostname> \
      --bootstrap-host <declared-lan-endpoint> \
      --reason 'SD-card failure ticket or date' \
      --confirm-recovery

The coordinator acquires the shared Fleet Lock and resolves Inventory again. It
refuses a reachable old production endpoint, confirms the bootstrap user,
installs prerequisites, applies the shared/client/kiosk roles with
`network_mode=local` and `tailscale_enabled=false`, observes the declared IPv4
on Pi4, and only then saves the Pi5-local runtime override. The override keeps
ordinary OpenSSH, Ansible, kiosk, status, and agent traffic on LAN for this host.

Success is JSON with `"phase": "completed"`. The secret-free recovery record is
under `logs/recovery/`; the ignored mode-0600 override is under
`infrastructure/ansible/host_vars/<target>/recovery-runtime.yml` and must contain
the LAN address, `network_mode: local`, and `tailscale_enabled: false`.

## Failure handling

- `previous production endpoint still accepts TCP/22`: stop or isolate the old
  terminal. Do not operate two devices as one inventory identity.
- `bootstrap host must equal ... LAN recovery endpoint`: repair the DHCP
  reservation or submit a reviewed Inventory change; do not bypass the check.
- `bootstrap host does not authenticate as the target inventory user`: correct
  the Imager user and Pi5 public key.
- `No route to host`, timeout, or Pi5 health failure: repair the LAN/VLAN/router
  path. This procedure has no external overlay fallback.
- `does not own its ... LAN recovery address`: the rebuilt Pi4 did not receive
  the declared address. Fix DHCP/static assignment and start a new run.
- Pi5 release evidence failure: repair Pi5 through the normal release runbook;
  never replace the immutable SHA with `main`.
- Failure after `runtime-endpoint-saved`: inspect the named recovery JSON,
  correct the fault, and use a new run ID. Do not delete the override until the
  authoritative endpoint is known.

A failed run does not restore Tailscale state, SSH private keys, or old machine
identity. It closes the recovery Fleet run as failed and keeps the target
evidence unknown.

## Physical acceptance drill

First drill `raspberrypi4` with the original SD preserved and a blank or
disposable replacement. Start timing after Imager, Wi-Fi, DHCP reservation, and
Pi5 route checks are ready. Require `phase: completed` within 60 minutes.

Then verify normal OpenSSH, Ansible ping, `kiosk-browser.service`,
`status-agent.timer`, the kiosk page through the Pi5 LAN endpoint, one real NFC
read, and barcode only when enabled. Confirm that the runtime override contains
only non-secret LAN/recovery metadata and that command/recovery output contains
no status/NFC/client secrets. Record the deployed Pi5 SHA, Fleet run ID, elapsed
time, route evidence, and functional results in the living ExecPlan.
