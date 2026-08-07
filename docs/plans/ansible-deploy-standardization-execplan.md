---
id: ansible-deploy-standardization
title: Standardize Pi release execution around Ansible
status: in_progress
scope: additive foundation route; the current canonical wrapper remains unchanged
date: 2026-08-07
source_of_truth: docs/plans/ansible-deploy-standardization-execplan.md
validation: local static, unit, Ansible, Docker, and disposable PostgreSQL tests only
open_items:
  - merge and hosted CI for the foundation route
  - separately approved canonical cutover after the foundation merge
  - separately approved hardware canary before legacy removal
---

# Standardize Pi release execution around Ansible

This ExecPlan is a living document and must be maintained in accordance with
`.agent/PLANS.md`. The required `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` sections describe the actual
state of the work.

## Purpose / Big Picture

The repository already uses Ansible successfully, but normal deployment is
wrapped in a large Python coordinator that treats prior run records, typed
claims, and several independent digests as deployment permissions. This change
adds a smaller route in which GitHub Actions builds immutable artifacts and one
Ansible playbook prepares each target while its normal display remains active,
then performs only switch, health verification, and rollback in the critical
window. The current production entry point remains unchanged in this
foundation milestone.

A reviewer can see the new behavior without contacting hardware by listing the
hosts and tasks in `infrastructure/ansible/playbooks/deploy-release-standard.yml`,
running its syntax checks with the redacted inventories, and running the new
contract tests. No command in this plan is authorized to contact a Pi.

## Progress

- [x] (2026-08-07 00:00Z) Audited inventory, active deployment documentation,
  Ansible roles and playbooks, CI, Blue/Green scripts, and custom coordinator
  boundaries.
- [x] (2026-08-07 00:00Z) Preserved the dirty original worktree and created
  `refactor/ansible-deploy-standardization-foundation` from `origin/main` in a
  separate worktree.
- [x] (2026-08-07 00:00Z) Add profile-specific Pi5, Pi4, and Pi3 Ansible release roles and one
  explicit top-level playbook.
- [x] (2026-08-07 00:00Z) Add CI contracts for Pi4 multi-platform agent images while retaining the
  current canonical route.
- [x] (2026-08-07 11:50Z) Added and ran local static, unit, Ansible, Docker,
  and disposable PostgreSQL validation. The complete runner passed 1,123
  Python tests with one skip, both inventory contracts, migration/API/role
  checks, and reported zero remaining run-scoped Docker resources.
- [x] (2026-08-07 11:50Z) Updated deployment architecture and operator
  documentation with the additive route, dependency direction, module
  responsibilities, and test boundaries.
- [x] (2026-08-07 11:50Z) Hardened Pi3 candidate publication: validate the tar,
  extract to a same-filesystem run-scoped directory, validate the extracted
  fixed allowlist without rehashing payloads, remove write permission, and
  atomically rename to the digest path. Cleanup removes only the temporary
  directory.
- [ ] Merge and hosted CI remain integration-pending. Canonical cutover and
  hardware work are outside this foundation branch.

## Surprises & Discoveries

- Observation: the current inventory contains one server host, six kiosk hosts,
  and one signage host.
  Evidence: parsing `infrastructure/ansible/inventory.yml` yields Pi5=1,
  Pi4-role=6, and Pi3-role=1; historical five-Pi4 wording is stale.

- Observation: Pi4 release-only convergence still performs `git fetch` and may
  execute `docker compose ... --build` after the coordinator enters
  maintenance.
  Evidence: `infrastructure/ansible/roles/common/tasks/main.yml` performs the
  fetch/reset, and the three agent lifecycle task files select `--build` when
  image inputs changed.

- Observation: the useful Pi5 Blue/Green implementation is already split into
  shell modules, while Python owns its surrounding admission and recovery
  policy.
  Evidence: `scripts/deploy/pi5-blue-green.sh` sources nine focused modules;
  `scripts/deploy/rolling_release/backends/pi5.py` adds run-scoped evidence and
  coordinator recovery around them.

- Observation: rendering host values into the digest-named Pi3 release tree
  would make the tar SHA-256 cease to identify the bytes that actually run.
  Evidence: the canonical runtime templates now read
  `/etc/raspisystem-signage/runtime.env`, and Ansible owns that file plus
  systemd drop-ins outside the release tree.

- Observation: extracting directly into `releases/<digest>` makes an
  interrupted extraction indistinguishable from a complete candidate on the
  next run. Evidence: the role now extracts into a run-scoped directory on the
  same filesystem and publishes it with one rename only after validation and
  read-only conversion have completed.

## Decision Log

- Decision: implement only the additive foundation milestone on this branch.
  Rationale: canonical cutover requires this branch to merge first, and legacy
  removal requires separately approved hardware evidence. Pretending to finish
  all three milestones in one branch would defeat the staged safety boundary.
  Date/Author: 2026-08-07 / Codex and user.

- Decision: keep GHCR as transport, but make the final Pi3 tar SHA-256 the only
  artifact identity checked by the new Pi3 runtime path.
  Rationale: this retains standard package distribution while removing OCI,
  manifest, payload, and claim digests from runtime admission.
  Date/Author: 2026-08-07 / Codex and user.

- Decision: publish Pi4 agent images for both `linux/arm64` and
  `linux/arm/v7`.
  Rationale: inventory defines roles and hosts but does not prove each installed
  OS architecture. A standard multi-platform OCI manifest avoids inventing a
  fleet fact.
  Date/Author: 2026-08-07 / Codex and user.

- Decision: duplicate the small prepare/switch/health/rollback/cleanup skeleton
  in each profile role instead of adding a dynamic profile adapter.
  Rationale: explicit Ansible roles preserve one-way dependencies and prevent a
  replacement generic deployment framework.
  Date/Author: 2026-08-07 / Codex and user.

- Decision: extend the one existing deterministic Pi3 builder and its fixed
  allowlist instead of adding a derived builder.
  Rationale: host-neutrality belongs in the runtime templates. This removes
  private-function imports and literal byte replacement while preserving one
  artifact producer and one validation contract.
  Date/Author: 2026-08-07 / Codex and user.

- Decision: make sealed Pi5 evidence optional only at the existing
  Blue/Green shell boundary and omit it from the new Ansible route.
  Rationale: Ansible can directly inspect current resources and the live
  migration ledger. Blue/Green retains only slot preparation, switch, health,
  rollback, and compatibility with the still-canonical route.
  Date/Author: 2026-08-07 / Codex and user.

- Decision: use the existing Pi3 builder's fixed allowlist both before and
  after extraction, but retain the tar SHA-256 as the only runtime digest.
  Rationale: pre-extraction validation rejects unsafe tar members; post-
  extraction validation checks only paths, regular-file type, mode, and size.
  This proves the temporary tree is safe without creating per-file runtime
  identities or a new artifact manager.
  Date/Author: 2026-08-07 / Codex and user.

## Outcomes & Retrospective

The local foundation implementation is complete: one non-canonical Ansible
playbook owns explicit Pi5, Pi4, and Pi3 prepare/switch/health/rollback flows;
CI definitions build the three Pi4 agents; Pi3 uses one host-neutral immutable
artifact; and Pi5's new route does not consume sealed evidence. The current
operator wrapper is unchanged, so production behavior remains on the existing
route until the later cutover milestone.

The complete local contract runner passed. It applied all 157 Prisma
migrations to a uniquely named disposable PostgreSQL instance, verified
migration status and ledger state, ran the deploy-status/API-key EXPLAIN and 20
API tests, checked runtime/migration role separation, and removed its temporary
container, volume, and network. The deployment suite passed 1,123 tests with
one skip; Ansible parsed 112 templates and syntax-checked the normal and
redacted inventory paths. Focused Pi4 Buildx tests built NFC, barcode, and
torque images and removed their unique local tags.

Hosted CI, merge, canonical launcher cutover, real-host health/timing, and
legacy removal remain pending by design. No commit or push has been made while
the requested pre-commit review is open.

## Context and Orientation

`scripts/update-all-clients.sh` is the current operator entry point and must not
change in this milestone. It invokes the existing Python rolling-release
application. The new additive entry point is
`infrastructure/ansible/playbooks/deploy-release-standard.yml`, run directly
from the Ansible directory after an exact release SHA and immutable artifact
references have been selected.

The playbook contains three ordered plays. `release_pi5` runs only for the
`server` group and invokes the existing Blue/Green scripts. `release_kiosk`
runs only for `kiosk`, always with `serial: 1`, pulls CI images while the kiosk
is live, and uses Compose `--no-build` during switch and rollback.
`release_signage` runs only for `signage`, copies a complete CI tar from the
controller, verifies one SHA-256 on the Pi3, prepares a release directory while
the display is live, and changes the `current` symbolic link only inside the
switch block.

Each role owns its artifact and service rules. The only shared behavior is
Ansible's ordinary play ordering, exact host limit, and block/rescue/always
control flow. There is no shared Python state machine and no prior run record is
read before a deployment.

## Plan of Work

Create `deploy-release-standard.yml` and the three `release_*` roles. Split each
role into `prepare.yml`, `switch.yml`, `health.yml`, `rollback.yml`, and
`cleanup.yml`; keep `main.yml` as the explicit control-flow skeleton. Add role
defaults only for stable paths, time budgets, and GHCR repository names.

For Pi5, pull the supplied API and Web image references, inspect their image
IDs, check current memory/disk/load, and validate the live migration ledger
directly from Ansible. Then use the existing Blue/Green executor only to
prepare the inactive slot, switch, monitor, roll back, and clean up. The new
route creates no resource evidence, sealed migration plan, TTL, or run-scoped
authority file.

For Pi4, create a small Compose override that contains immutable image
references and no `build` keys. Pull enabled agents during prepare. Capture the
currently running image IDs as temporary rollback tags. Render release-owned
configuration into a run-scoped staging directory, install it immediately
before Compose `up -d --no-build`, and verify display and enabled agent health.
The rescue path restores the captured images and backed-up files, then repeats
health verification.

For Pi3, obtain the already built `signage-release.tar` on the controller and
copy it to the selected Pi3 before stopping anything. Verify its one expected
SHA-256 and the existing builder's fixed allowlist, expand it into a run-scoped
directory on the release filesystem, make it read-only, and atomically rename
it to `/opt/raspisystem-signage/releases/<digest>`. Host settings live outside
that immutable tree in `/etc/raspisystem-signage/runtime.env` and systemd
drop-ins. The switch stops only signage/display units, atomically replaces
`current`, reloads systemd, and starts health checks. The rescue path
atomically restores `previous` and checks the normal display.

Extend CI with a three-service Pi4 matrix. Pull requests build one native
contract image per service and run security checks. Main publication uses
Buildx to publish a multi-platform manifest tagged with the full Git SHA.
Existing Pi3 publication remains until canonical cutover so the current route
cannot regress.

## Concrete Steps

All commands run in
`/Users/tsudatakashi/RaspberryPiSystem_002-deploy-standardization-foundation`.
Do not run `scripts/update-all-clients.sh`, production preflight, SSH, cleanup,
or rollback commands.

After editing, run focused unit and contract tests, then:

    cd infrastructure/ansible
    ansible-playbook -i inventory.yml playbooks/deploy-release-standard.yml --syntax-check
    ansible-playbook -i inventory-talkplaza.yml playbooks/deploy-release-standard.yml --syntax-check

Run the complete local contract entry point:

    scripts/ci/run-deploy-contracts-local.sh --install-collections

This script owns uniquely named disposable PostgreSQL resources and must report
that its container, volume, and network were removed. Record Docker resource
names before and after without stopping or modifying existing resources.

## Validation and Acceptance

The foundation is accepted when both inventories pass syntax checks, a
single-host kiosk `--list-hosts` selects no other kiosk or profile, and tests
prove that the Pi4 switch contains `--no-build` but no `--build`. Pi3 contract
tests must prove there is one explicit SHA-256 comparison, no Git or external
HTTP command on the target, and atomic `current`/`previous` links. Failure
scenarios must enter each role's rollback once and must fail if rollback health
does not recover. Pi3 tests also reject path traversal, links, oversized files,
and missing fixed payloads, and prove that no task rewrites the candidate after
the representative hash check. Pi5 tests prove that the additive role does not
reference the sealed evidence helper, resource evidence, or migration plans.

The full local contract suite must apply Prisma migrations to its disposable
PostgreSQL instance, inspect `_prisma_migrations`, execute the existing
`EXPLAIN (ANALYZE, BUFFERS)` query, run role-boundary tests, and remove all
resources it created. Existing containers and databases must be unchanged.

No hardware timing claim can be accepted on this branch. The retained design
budgets are Pi5 at no more than 30 seconds and Pi4/Pi3 at no more than 60
seconds per selected host, to be measured only after separate approval.

## Idempotence and Recovery

The new playbook is additive and is not called by the current wrapper. Repeated
local syntax and unit tests are safe. Docker tests use unique names and traps.
If a local test is interrupted, remove only resources bearing that test's exact
unique name or label; never prune Docker globally.

The original worktree contains uncommitted user work. Never run stash, reset,
clean, checkout, or worktree prune there. All implementation changes belong to
the separate foundation worktree.

## Artifacts and Notes

At the end of the milestone, record focused test counts, the full contract
result, Docker cleanup proof, and `git diff --stat` here. Hosted CI, merge, and
real hardware evidence remain explicitly pending.

Local evidence on 2026-08-07: 42 focused Python tests plus Signage maintenance
and deploy safety contracts passed before the full run; the full runner then
passed all checks described above. Name-filtered Docker inspection found no
remaining `rolling-deploy-status-*`, `postgres-role-contract-*`, or
`runtime-audit-*` container, volume, or network. The current diff, including
untracked files, is 2,591 additions and 122 deletions. The rejected 169-line
derived builder is absent; `signage-distribution-artifact.py` is the sole builder.

## Interfaces and Dependencies

The playbook requires `release_sha`, a safe `release_run_id`, and profile image
references. Image tags must contain the exact 40-character release SHA. The
Pi3 role additionally requires `release_signage_artifact_sha256`, exactly 64
lowercase hexadecimal characters. The Pi3 artifact path is controller-local;
the Pi3 never contacts GHCR or Git.

The dependency direction is operator or future launcher to Ansible playbook,
Ansible playbook to one profile role, and profile role to existing profile
executor or standard system tools. No role imports the rolling-release Python
application, fleet state, readiness policy, claims, or route preflight.

Revision note (2026-08-07): created for the additive foundation branch after
the repository and deployment history audit.
