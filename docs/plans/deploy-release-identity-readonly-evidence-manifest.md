---
id: deploy-release-identity-readonly-evidence
title: Pi5 and StoneBase read-only release identity evidence manifest
status: approval-required-not-executed
scope: named deployment runs on Pi5 and StoneBase only
date: 2026-07-21
source_of_truth: docs/plans/deploy-release-identity-readonly-evidence-manifest.md
related_docs:
  - docs/knowledge-base/KB-401-deploy-release-identity-runtime-audit.md
  - docs/decisions/ADR-20260721-deploy-release-identity-and-activation.md
  - docs/plans/deploy-release-identity-architecture-execplan.md
validation: command review only; no command in this manifest has been executed
open_items:
  - obtain explicit user approval for this exact read-only scope
  - execute in order and stop on any target, command, or output mismatch
---

# Pi5 and StoneBase read-only release identity evidence manifest

## Approval boundary

This is a command manifest, not authorization. No command below has been run.
Execute it only after the user explicitly approves this read-only evidence
collection as a new hardware action.

Allowed devices are Pi5 `denkon5sd02@100.106.158.2` and StoneBase
`raspi4-kensaku-stonebase01`. `raspi4-fjv60-80` and every other terminal are
excluded from connection, inventory selection, status probe, preflight, and
deployment. The session performs no deployment, bootstrap, Local execution,
reverify, Git mutation, service mutation, state edit, maintenance change, or
manifest cleanup.

## Evidence purpose

The collection answers only these bounded questions:

1. What durable terminal phase, timestamps, executor fields, ready failure,
   rollback result, cleanup result, and maintenance-clear state were recorded
   for the six named runs?
2. Did `kiosk-browser.service` stop or start during the forward StoneBase apply,
   and did it stop or start during sealed rollback?
3. What are the current public terminal Git SHA, relevant systemd states, and
   secret-free Local runner/runtime eligibility fields?

The expected incident pattern is not assumed. If timestamps contradict it, the
hypothesis in KB-401 becomes REJECTED. If the allowed output cannot establish
the process timeline, it stays INCONCLUSIVE and the No-Go gate remains closed.

## Output allowlist and redaction

Save only run IDs, phase/stage names, ISO timestamps, bounded duration values,
executor identifiers, fallback reasons, Git SHA/digest values, verification
IDs, host/profile/status-client IDs, systemd unit names, `ActiveState`,
`SubState`, `Result`, and explicit success/failure booleans. Journal output is
filtered to known task/result/service lifecycle phrases before it leaves the
device.

Do not request or retain inventory variables, Vault data, `.env`, tokens,
passwords, private/public key bodies, API credentials, environment blocks,
Ansible variable dumps, raw play recap variables, HTTP headers, or unrestricted
journal lines. If unexpected secret-like output appears, stop, do not paste it
into repository files, and redact it from any local evidence copy. KB-401 stores
derived facts and evidence digests only.

## Commands, in execution order

Run from the immutable Local comparison worktree only after approval:

    cd /Users/tsudatakashi/Documents/Codex/2026-07-21/deploy-phase-b-local-execution/work/RaspberryPiSystem_002-local-ansible
    test "$(git rev-parse HEAD)" = "93d8bef4a31d52d0adcb18abfc1731f0e78d335c"
    git status --short

The exact ref assertion must succeed. Stop if the checkout is dirty in a way
that could change `scripts/update-all-clients.sh` or `scripts/deploy/`.

First use the canonical status interface for each named run. These calls read
durable state through Pi5 and do not submit a release:

    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --status 20260720-232311-d2e8c8
    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --status 20260721-021000-1ede52
    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --status 20260721-023908-68527a
    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --status 20260721-024809-e2a35e
    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --status 20260721-032006-9a9b50
    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --status 20260721-032457-3fce3c

Next read only the final Pi5 unit's known task/result/timing lines. Keep the
remote filter inside the quoted command so unfiltered journal output is not
returned:

    ssh -o BatchMode=yes -o ConnectTimeout=15 denkon5sd02@100.106.158.2 \
      "sudo -n journalctl -u raspi-release-20260721-032457-3fce3c.service --since '2026-07-21 03:24:00 UTC' --until '2026-07-21 03:47:30 UTC' --no-pager -o short-iso | grep -E 'terminal-(ansible-apply|ready-ack|evidence|rollback|runtime-restore|maintenance|cleanup)|TASK \[|failed=|Result=|timed out|rollback'"

Then use Pi5 as the existing controller to read only StoneBase service
lifecycle timestamps. Inventory selection is the exact StoneBase hostname:

    ssh -o BatchMode=yes -o ConnectTimeout=15 denkon5sd02@100.106.158.2 \
      "cd /opt/RaspberryPiSystem_002 && ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ansible raspi4-kensaku-stonebase01 -i infrastructure/ansible/inventory.yml -b -m ansible.builtin.shell -a \"journalctl -u kiosk-browser.service --since '2026-07-21 03:24:00 UTC' --until '2026-07-21 03:47:30 UTC' --no-pager -o short-iso | grep -E 'Starting|Started|Stopping|Stopped|Main process exited|Failed with result'\" --one-line"

Read the current terminal Git SHA and bounded service properties. These are
observations only:

    ssh -o BatchMode=yes -o ConnectTimeout=15 denkon5sd02@100.106.158.2 \
      "cd /opt/RaspberryPiSystem_002 && ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ansible raspi4-kensaku-stonebase01 -i infrastructure/ansible/inventory.yml -b -m ansible.builtin.command -a 'git -C /opt/RaspberryPiSystem_002 rev-parse HEAD' --one-line"

    ssh -o BatchMode=yes -o ConnectTimeout=15 denkon5sd02@100.106.158.2 \
      "cd /opt/RaspberryPiSystem_002 && ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ansible raspi4-kensaku-stonebase01 -i infrastructure/ansible/inventory.yml -b -m ansible.builtin.command -a 'systemctl show kiosk-browser.service status-agent.service status-agent.timer --property=Id --property=ActiveState --property=SubState --property=Result --property=ExecMainStartTimestamp --no-pager' --one-line"

Finally run only the feature branch's canonical non-mutating plan and aggregate
preflight for Pi5 plus StoneBase. These commands must print the explicit target
set, FJV exclusion, effective executor, runtime version/digest or bounded
fallback reason, and zero release submission:

    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --limit raspberrypi5:raspi4-kensaku-stonebase01 --stonebase-local-ansible-poc --print-plan
    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --limit raspberrypi5:raspi4-kensaku-stonebase01 --stonebase-local-ansible-poc --preflight-only

Do not append `--reverify-selected`, `--foreground`, `--detach`, or any other
execution option. Do not replace the explicit limit with a group or wildcard.

## Stop conditions

Stop immediately and preserve the current No-Go decision if any command:

- resolves a candidate other than the fixed comparison ref;
- selects or attempts to contact any host except Pi5 and StoneBase;
- asks to create maintenance, submit a run, bootstrap a runtime, or mutate a
  service/repository;
- emits unfiltered environment, inventory, Vault, token, credential, or Ansible
  variable data;
- reports an active or unreconciled run;
- cannot establish deterministic unit/service state within the allowed query.

Do not improvise a broader command after a stop. Record the blocked evidence as
INCONCLUSIVE and return for a new explicit approval if more access is necessary.

## Evidence handling and completion

Normalize allowed output into a local temporary file outside the repository,
remove duplicate/noise lines, and compute a SHA-256 digest. Add only the digest,
command identifier, observation timestamp, and derived CONFIRMED/REJECTED/
INCONCLUSIVE facts to KB-401. Do not commit the raw output.

Completion of this manifest does not authorize implementation or a retry. It
only permits the audit to reconsider the ADR Go gate. A subsequent canary still
requires its own exact target and mutation approval.
