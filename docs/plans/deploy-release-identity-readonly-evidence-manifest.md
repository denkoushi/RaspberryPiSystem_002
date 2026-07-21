---
id: deploy-release-identity-readonly-evidence
title: Pi5 and StoneBase read-only release identity evidence manifest
status: completed-readonly
scope: named deployment runs on Pi5 and StoneBase only
date: 2026-07-21
source_of_truth: docs/plans/deploy-release-identity-readonly-evidence-manifest.md
related_docs:
  - docs/knowledge-base/KB-401-deploy-release-identity-runtime-audit.md
  - docs/decisions/ADR-20260721-deploy-release-identity-and-activation.md
  - docs/plans/deploy-release-identity-architecture-execplan.md
validation: executed with explicit approval; normalized evidence sha256:f591a727363aeb972ecdd4b388f2ea7aa5b4881ca94445aac57c42da3238d7b8
open_items:
  - require new approval for any additional hardware observation
---

# Pi5 and StoneBase read-only release identity evidence manifest

## Approval boundary

The user explicitly approved this bounded collection, and it completed on
2026-07-21 without a deployment or state mutation. This completed manifest is
an audit record, not continuing authorization for another hardware action.

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

    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh --status 20260720-232311-d2e8c8
    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh --status 20260721-021000-1ede52
    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh --status 20260721-023908-68527a
    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh --status 20260721-024809-e2a35e
    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh --status 20260721-032006-9a9b50
    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh --status 20260721-032457-3fce3c

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

    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --limit raspberrypi5:raspi4-kensaku-stonebase01 --stonebase-local-ansible-poc --print-plan
    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml --limit raspberrypi5:raspi4-kensaku-stonebase01 --stonebase-local-ansible-poc --preflight-only

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

Completion of this manifest does not authorize a retry. The audit separately
opened offline architecture implementation after accepting the ADR. A
subsequent preflight or canary still requires its own exact target and hardware
approval.

## Execution result

The first drafted status form combined a positional release branch with
`--status`; the CLI rejected it before connection. The canonical runbook form
accepts only `--status RUN_ID` and requires the approved Pi5 through
`RASPI_SERVER_HOST`. The corrected commands above are the ones that ran. This
was a narrower syntax correction, not a scope expansion.

The submitted runs were terminal. The two preflight-only IDs returned
`not-found`, consistent with `releaseSubmitted=false`; no active or
unreconciled run was found. The final run showed successful SSH apply, exact
forward-ready timeout, sealed rollback, rollback ready at the still-forward Pi5
Web SHA, verified rollback evidence, cleanup, and maintenance clear.

StoneBase journal contained no browser lifecycle event during forward apply.
Its only lifecycle events in the approved window were stop at
`2026-07-21T03:46:02Z` and start at `03:46:03Z`, during rollback. Current HEAD
is `651d056dbf5a6eea71cda210601dc618d7894415`; the browser and status-agent
service/timer results are healthy.

Preflight `20260721-043630-dd9ed9` passed with selected hosts exactly Pi5 and
StoneBase and `releaseSubmitted=false`. It resolved the requested Local
executor to SSH fallback `candidate-requires-ssh-configuration`; runtime stayed
null. FJV was printed only as outside the explicit PoC scope and was never
contacted.

The Ansible read-only shell/command probes displayed `CHANGED` because those
ad-hoc modules default their result flag to changed. Their commands were only
`journalctl`, `git rev-parse`, and `systemctl show`; no host state changed.

Raw output and the normalized temporary file were deleted after digest
verification and are not recoverable from this worktree. Nothing was committed
except the allowlisted derived facts and receipt digest. The normalized receipt,
which contained twelve source digests and derived fields, is:

    sha256:f591a727363aeb972ecdd4b388f2ea7aa5b4881ca94445aac57c42da3238d7b8
