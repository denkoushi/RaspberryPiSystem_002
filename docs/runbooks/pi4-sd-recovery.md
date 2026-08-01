---
title: Pi4 SD-card recovery through Pi5 over the managed LAN
status: accepted
scope: explicitly enabled standard Pi4 kiosk whose SD card was replaced after corruption or failure
date: 2026-08-01
source_of_truth: docs/runbooks/pi4-sd-recovery.md
related_code:
  - scripts/deploy/recover-pi4.py
  - scripts/deploy/recovery/bootstrap.py
  - infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml
  - infrastructure/ansible/playbooks/recover-pi4.yml
  - infrastructure/ansible/playbooks/recover-pi4-verify.yml
related_docs:
  - ../decisions/ADR-20260713-pi4-sd-recovery-bootstrap.md
  - ../guides/client-initial-setup.md
  - ../plans/pi4-sd-recovery-dynamic-bootstrap-execplan.md
validation: dynamic-LAN resolver, SSH identity, recovery CLI, and Ansible tests; blank-Pi4 acceptance drill pending
open_items:
  - Run read-only plans for the enabled terminals from Pi5 at their actual site.
  - Record the first physical recovery drill and measured elapsed time.
---

# Pi4 SD-card recovery through Pi5 over the managed LAN

## What the operator does

Use this only after an existing, inventory-managed Pi4 has lost its SD card.
The operator does five things:

1. Keep the failed SD unchanged, and disconnect the old OS from the network.
2. Install Raspberry Pi OS Desktop (64-bit) on a new SD with Raspberry Pi Imager.
3. Configure the inventory terminal's existing Linux username, a short hostname,
   production Wi-Fi, Pi5 public-key SSH access, and password-free sudo.
4. Read the new OS's current private-LAN IPv4 address. It does not need to equal
   the old address.
5. Report the old inventory terminal name, new OS hostname, and current IPv4.

From that point, Pi5 performs the rebuild. Do not copy the old SSH private key,
Tailscale state, `/var/lib/tailscale`, or old machine identity.

Only the five standard hosts with `pi4_recovery_enabled: true` are eligible.
Assembly, Talkplaza, Pi3, Pi5, and Pi4-board replacement need separate
acceptance. A healthy terminal uses the normal release command, not recovery.

## Network condition

`--bootstrap-host` is the replacement OS's current connection address for this
run. It must be a literal RFC1918 address, such as `192.168.x.x`. The address may
change again later; it is never used as machine identity.

Pi5 must be able to reach that address, and the Pi4 must reach Pi5's configured
LAN service address. The ordinary setup is: Codex connects to the factory Pi5,
then Pi5 connects to the fresh Pi4 over the factory LAN. A fresh Pi4 at home
cannot be rebuilt by the factory Pi5 through this LAN-only path unless an
explicit private route exists. Do not scan for or guess a Pi4 address.

## Read-only plan

On Pi5, run:

    cd /opt/RaspberryPiSystem_002
    python3 scripts/deploy/recover-pi4.py plan \
      --target <old-inventory-host> \
      --bootstrap-host <new-os-current-ipv4> \
      --bootstrap-hostname <new-os-short-hostname>

`plan` contacts the reported Pi4 only to read its ED25519 SSH public host key,
SSH username, and short hostname. It writes no Fleet State, recovery log,
runtime override, repository data, or Pi4 data.

A successful result contains:

    "inventoryResolved": true,
    "bootstrapHost": "<new-os-current-ipv4>",
    "bootstrapIdentity": {
      "hostname": "<new-os-short-hostname>",
      "user": "<inventory-user>",
      "sshHostKeyFingerprint": "SHA256:<fingerprint>"
    },
    "recoveryNetwork": {
      "mode": "lan",
      "configured": true,
      "serverEndpoint": "<pi5-lan-endpoint>"
    }

Review the target, IPv4, hostname, user, immutable 40-character release SHA, and
fingerprint. Keep the fingerprint for `run`. If any value is unexpected, stop.

## Confirmed recovery

Use exactly the same three inputs and the fingerprint returned by `plan`:

    cd /opt/RaspberryPiSystem_002
    python3 scripts/deploy/recover-pi4.py run \
      --target <old-inventory-host> \
      --bootstrap-host <new-os-current-ipv4> \
      --bootstrap-hostname <new-os-short-hostname> \
      --bootstrap-host-key 'SHA256:<fingerprint-from-plan>' \
      --reason 'SD-card failure ticket or date' \
      --confirm-recovery

`run` obtains the shared Fleet Lock and rechecks Inventory, IPv4, hostname,
username, and SSH key. If DHCP assigned the address to another device after
`plan`, the key check fails before a recovery run begins. Every SSH and Ansible
connection then pins that same key with strict host-key checking.

The coordinator rejects a reachable different previous endpoint and rejects a
previously recorded OS key at any reported address. Reusing the same IP is safe
when the new SD has a different SSH key and all other identity checks pass.

Ansible installs the approved immutable Pi5 release with `network_mode=local`
and `tailscale_enabled=false`. It proves the supplied IPv4 is still assigned
before saving it. Success returns `"phase": "completed"`.

The ignored mode-0600 runtime override is
`infrastructure/ansible/host_vars/<target>/recovery-runtime.yml`. It records the
new endpoint, earliest original endpoint, immediately previous endpoint,
reported hostname, public SSH fingerprint, run ID, time, and release SHA. It
contains no SSH private key or application secret.

## Failure handling

- `SSH host key changed after plan`: verify the current DHCP address and run a
  new `plan`; never auto-accept the new key.
- `unexpected user` or `different hostname`: correct the Imager settings or the
  reported value. Do not bypass the identity check.
- `previously managed OS`: the reported address belongs to the known old OS.
  Disconnect it and confirm the new SD's actual address.
- `previous production endpoint still accepts TCP/22`: isolate the old endpoint
  before trying again.
- `does not own the supplied bootstrap address`: DHCP changed during the run.
  Find the current address, run a new plan, and use a new run ID.
- route, timeout, or Pi5 health failure: repair the LAN/VLAN/router path. There
  is no external-overlay fallback in this recovery path.
- Pi5 release evidence failure: repair Pi5 through the normal release runbook;
  never substitute moving `main` for the verified SHA.

A failed run never restores an old Tailscale or SSH identity. Once a Fleet run
has begun, it closes the target as unknown/failed. Do not manually edit or
delete the runtime override until the authoritative endpoint is known.

## Physical acceptance drill

First use `raspberrypi4`, preserve its original SD, and use a blank or disposable
replacement. Start timing after Imager, Wi-Fi, hostname, current-IP, and Pi5
route preparation. Require `phase: completed` within 60 minutes.

Then verify OpenSSH, Ansible ping, `kiosk-browser.service`,
`status-agent.timer`, the kiosk screen, one real NFC read, and barcode only when
enabled. Confirm the public SSH key stayed pinned, the supplied IP is saved, no
secret appears in output or recovery artifacts, and Pi5 ran the exact merged
SHA. Record the Fleet run ID, elapsed time, SHA, endpoint, fingerprint, and
functional results in the living ExecPlan.
