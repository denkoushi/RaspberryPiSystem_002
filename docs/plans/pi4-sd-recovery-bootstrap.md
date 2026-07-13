# Pi4 SD-card recovery bootstrap

This ExecPlan is a living document and follows `.agent/PLANS.md`. It records
the implementation of a Pi5-operated recovery path for an inventory-managed
Pi4 whose SD card has been replaced. A successful operator can run a read-only
plan, image the replacement SD with the specified initial account and Wi-Fi,
and then complete all remaining configuration from Pi5.

## Purpose / Big Picture

Normal rolling deployment expects a healthy terminal. This feature instead
rebuilds one known Pi4 from Pi5's confirmed active release without cloning old
Tailscale or SSH identity. It demonstrates success when the recovery CLI writes
one local Tailscale endpoint override and its final verification proves the
kiosk, status-agent, NFC, and optional barcode functions.

## Progress

- [x] 2026-07-13: Created `feat/pi4-sd-recovery-bootstrap` from current `origin/main`.
- [x] 2026-07-13: Added a fail-closed Pi5 recovery coordinator and unit tests.
- [x] 2026-07-13: Added Ansible bootstrap and post-recovery verification playbooks.
- [x] 2026-07-13: Added ADR, Runbook, initial-setup guide link, and ignored local endpoint override.
- [x] 2026-07-13: Ran 92 Python regression tests, both recovery playbook syntax checks, and a synthetic-host Ansible check run.
- [x] 2026-07-13: Ran the isolated Postgres integration: 144 migrations, SQL `EXPLAIN (ANALYZE, BUFFERS)`, and 8 deploy-status API tests passed; no labelled temporary Docker resources remained.
- [ ] Future: Release the feature to Pi5 through the canonical rolling release and execute one blank-Pi4 acceptance drill.

## Surprises & Discoveries

- Observation: the existing `common` role configures Tailscale and obtains the
  requested immutable repository revision, but it assumes Git is already
  installed.
  Evidence: `infrastructure/ansible/roles/common/tasks/main.yml` clones the
  repository and then imports `tailscale.yml` without installing Git or Docker.
- Observation: current kiosk templates run as `ansible_user` and copy labwc
  configuration from the Desktop image.
  Evidence: `infrastructure/ansible/templates/kiosk-browser.service.j2` and
  `roles/kiosk/tasks/main.yml` reference that user and `/etc/xdg/labwc/rc.xml`.

## Decision Log

- Decision: create a dedicated recovery CLI instead of extending Rolling V2.
  Rationale: an offline bare-metal rebuild has no application to place in
  maintenance, while normal releases must retain the canonical coordinator.
  Date/Author: 2026-07-13 / Codex.
- Decision: persist only a Pi5-local JSON-as-YAML host_vars override.
  Rationale: Ansible loads it as host variables, it overrides `ansible_host`,
  and changing Tailscale addresses do not enter tracked inventory.
  Date/Author: 2026-07-13 / Codex.
- Decision: require the durable marker plus consistent Blue/Green active-image
  match before rebuilding Pi4.
  Rationale: this proves a deployed SHA rather than silently using moving main.
  Date/Author: 2026-07-13 / Codex.

## Outcomes & Retrospective

Repository implementation and local validation are complete; the physical
blank-Pi4 drill remains. The feature does not alter normal release ordering,
client registration, application DB schema, tracked static IPs, or Tailnet
policy. A future result must record the Pi5 release SHA and measured physical
recovery duration here or in the relevant operations record.

## Context and Orientation

`scripts/deploy/recover-pi4.py` is the controller. It reads an Ansible
inventory, validates a Pi4 kiosk contract, reads Pi5's release marker, calls
the read-only Blue/Green status command, and invokes Ansible only after explicit
`--confirm-recovery`. A runtime override is a local file in
`infrastructure/ansible/host_vars/<target>/` that replaces only the connection
address for regular Pi5 Ansible commands.

`infrastructure/ansible/playbooks/recover-pi4.yml` prepares the fresh OS and
then imports the existing shared roles. It writes a non-secret result JSON on
the controller after Tailscale reports its new address. The coordinator validates
that result and runs `recover-pi4-verify.yml` over the newly saved endpoint.

## Plan of Work

The Python coordinator has separate methods for Inventory reading, immutable
release validation, Pi5 hardware validation, local endpoint persistence, and
command execution. This isolates filesystem, subprocess, network, and parsing
details from recovery orchestration and makes each decision unit-testable.

The Ansible bootstrap role owns package and desktop prerequisites only. The
existing `common`, `client`, and `kiosk` roles remain the configuration source
for Tailscale, service credentials, NFC, barcode, and the kiosk browser.

## Concrete Steps

From the repository root, run:

    python3 -m unittest scripts/deploy/tests/test_recover_pi4.py -v
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/recover-pi4.yml --syntax-check
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/recover-pi4-verify.yml --syntax-check
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i scripts/deploy/tests/fixtures/recovery-check-inventory.yml infrastructure/ansible/playbooks/recover-pi4-verify.yml --check -e recovery_authorized=true
    python3 -m unittest scripts/deploy/tests/test_rolling_release.py -v
    scripts/deploy/tests/test-deploy-status-postgres.sh

The Postgres script creates a uniquely named, labelled temporary container,
volume, and network; it applies migrations and runs `EXPLAIN (ANALYZE, BUFFERS)`
only against that database and cleans all three resources through its shell trap.

## Validation and Acceptance

The unit tests must prove that a non-Pi4 target, mismatched active image, and
failed bootstrap cannot create an endpoint override. A successful mocked run
must save `100.64.0.0/10` endpoint data without secrets and invoke standard
Ansible ping plus service verification.

The physical acceptance is the Runbook drill. Its observable result is a
`completed` recovery state followed by a regular Ansible ping through the new
Tailscale endpoint and the expected kiosk/device functions.

Local evidence on 2026-07-13: 92 Python tests passed; both playbooks passed
syntax checks; the verification playbook passed check mode against the synthetic
local host; and `test-deploy-status-postgres.sh` completed 144 migrations, a
temporary-DB `EXPLAIN (ANALYZE, BUFFERS)`, and eight API tests. Its labelled
temporary Docker container, volume, and network were absent after completion.

## Idempotence and Recovery

`plan` is read-only. `run` writes a unique recovery state; it rejects a reused
run ID. The endpoint override is atomic and stores the original endpoint, so a
retry can still reject a live old device. A failed run never deletes a new
Tailscale node or erases diagnostics. The operator must correct the reported
condition and start a new confirmed run.

## Interfaces and Dependencies

The public CLI is:

    python3 scripts/deploy/recover-pi4.py plan --target <inventory-host> --bootstrap-host <LAN-IPv4>
    python3 scripts/deploy/recover-pi4.py run --target <inventory-host> --bootstrap-host <LAN-IPv4> --reason <text> --confirm-recovery

`plan` returns JSON containing non-secret target information, the immutable SHA,
and the Imager checklist. `run` requires Pi5 hardware, calls the two playbooks,
and returns a secret-free state JSON. No HTTP API, Prisma schema, or application
database interface changes are introduced.
