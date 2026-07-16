---
id: terminal-profile-registry
status: active
scope: rolling Linux/Pi terminal deployment
date: 2026-07-16
source_of_truth: docs/plans/terminal-profile-registry-execplan.md
related_code:
  - scripts/update-all-clients.sh
  - scripts/deploy/classify-deploy-impact.py
  - scripts/deploy/rolling-release.py
  - scripts/deploy/rolling_release/
  - infrastructure/ansible/
related_docs:
  - docs/guides/deployment.md
  - docs/plans/deployment-foundation-refactor-execplan.md
validation: local contracts, isolated fault injection, hosted CI, read-only fleet plans
open_items: PR 4 and PR 5 described below
supersedes: null
superseded_by: null
---

# Generalize terminal deployment with a profile registry and adapters

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. It is maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

The rolling-release system currently understands the fixed terminal names
`kiosk` and `signage`. Adding another Linux or Raspberry Pi terminal type would
therefore require edits to central planning, policy, state, and coordination
code. After this program, a terminal type whose behavior fits an existing
adapter can be added through one strict registry entry plus inventory. A type
with genuinely different behavior can be added through the registry and one
adapter, without adding its name to the core planner, policy, state, or
coordinator.

The operator-facing entry point remains `scripts/update-all-clients.sh`.
Read-only `--print-plan` output will expose affected profiles, and run status
will expose approval gates by profile while retaining the existing fields.
Existing Kiosk and Signage order, notice, health, acknowledgement, rollback,
cancel, and fleet-state behavior remain compatible. Android and microcontroller
deployment are not implemented by this plan; the adapter boundary merely leaves
room for them later.

This program is delivered as five ordered pull requests. Each pull request is
based on the latest merged `origin/main`, receives local and hosted validation,
and is merged only after its exact head passes the required validation. The
user has approved autonomous completion through PR 5; the no-production-change
safety boundary remains unchanged. The current work is PR 4 only.

## Progress

- [x] (2026-07-16 12:24Z) Fetched `origin/main`, resolved it to `398ad2409242268c3c7ea507fbd456d210cb4cc9`, and created the clean `agent/deploy-readonly-plan-classification` worktree from that exact commit.
- [x] (2026-07-16 12:24Z) Read `AGENTS.md`, `docs/AI_START_HERE.md`, `.agent/PLANS.md`, and the safety, architecture, test, debugging, Git, and documentation rules applicable to this change.
- [x] (2026-07-16 12:24Z) Reproduced PR 1's two defects: the checked-in `ansible.cfg` rejects inventory parsing when `.vault-pass` is absent, and the reported coordinator paths classify as `unknown`, expanding impact to the full fleet.
- [x] (2026-07-16 12:36Z) Implemented PR 1's per-command read-only Ansible inventory configuration, inherited Vault-source removal, JSON validation, and secret-safe actionable errors; the normal `ansible.cfg` still fails without `.vault-pass`.
- [x] (2026-07-16 12:36Z) Classified the full `rolling_release/` package, public/coordinator/recovery entry points, and read-only config as `deploy-control`; known terminal runtime and unknown fail-closed behavior remain covered.
- [x] (2026-07-16 12:42Z) Completed local validation: 577 Python tests, all CI deployment shell contracts, 20 CI tests, deploy safety contract, both inventories, 12 standard playbooks plus TalkPlaza staged playbook, isolated recovery check, 20 PostgreSQL deploy-status tests, and the exact-head second-factory public read-only plan. The plan at `332b5462` excluded all seven hosts with `targetHosts=[]`, `pi5Required=false`, and no warning.
- [x] (2026-07-16 12:53Z) Published draft PR #1031. Hosted CI run `29499381896` passed every selected job and `ci-required`; CodeQL run `29499381908` and gitleaks run `29499381893` passed. Stopped before merge and PR 2 for explicit user approval.
- [x] (2026-07-16 13:16Z) Received explicit user approval, marked PR #1031 ready, and merged its fixed head `0066fbc6544354ba03937241f1b8789eb495d691` through merge commit `381e022e2d4c35bf9027e8192704d6b70cabd514` after final-head CI `29500051947`, CodeQL `29500052047`, and gitleaks `29500051938` passed.
- [x] (2026-07-16 13:17Z) Fetched the merged `origin/main` and created the clean `agent/terminal-profile-registry` worktree from exact commit `381e022e2d4c35bf9027e8192704d6b70cabd514`; the PR 1 and earlier worktrees remain untouched.
- [x] (2026-07-16 13:29Z) Added the strict schema-versioned standard-library JSON registry, fixed Pi5 control plane, production Kiosk/Signage profiles, ordered path-to-component rules, component-to-profile mappings, and bounded adapter options. Unsafe IDs, duplicate JSON keys, unknown fields, command/shell/import fields, out-of-root playbooks, unsafe systemd units, and unsafe rollback paths fail validation.
- [x] (2026-07-16 13:29Z) Made deploy-impact classification registry-driven, added deterministic `affectedProfiles`, preserved every legacy field, and kept unknown paths successful but fail-closed across the server and every registered profile. Focused registry/classifier tests pass, a synthetic fourth profile plus unique adapter ID requires no classifier branch, and all 4,242 existing tracked paths have identical legacy results before and after the conversion.
- [x] (2026-07-16 13:38Z) Completed PR 2 local validation: 594 deploy Python tests, 20 CI classifier tests, all focused Pi5/terminal/deploy-safety shell contracts, 20 isolated PostgreSQL deploy-status tests, read-only parsing of both inventories, syntax checks for both staged playbooks, JSON/compile/diff checks, production runtime-option parity, and the 4,242-path legacy classifier comparison all pass.
- [x] (2026-07-16 13:40Z) Pushed code head `7f56595f5663cdf14270f1b5633d5e20eade3cdf` and ran the second-factory public read-only plan against that exact remote ref. All seven verified hosts were excluded, with `targetHosts=[]`, `pi5Required=false`, no terminal targets, no canary hold, and no warnings. The aggregate historical diff reports Signage impact, but the Pi3 host-specific verified baseline correctly requires no work.
- [x] (2026-07-16 13:46Z) Published draft PR #1032 at `2776a72cbe737d9011fa0fc4467631dbd9fbd751`. Hosted CI run `29503419077`, CodeQL run `29503418930`, and gitleaks run `29503418989` all passed. The user then authorized autonomous validation and merging through PR 5, with only fatal blockers requiring a stop and with every existing physical-deployment prohibition preserved.
- [x] (2026-07-16 13:53Z) Marked PR #1032 ready and merged its exact final head `d35e080c137a21f784ac5c175b93ce342e4650cb` as `658a259bafb1fb92359128d5320de50ff74771fc` after final CI `29503856934`, CodeQL `29503856945`, gitleaks `29503853754`, and a seven-host second-factory read-only no-op all passed.
- [x] (2026-07-16 13:54Z) Fetched merged `origin/main` and created the isolated `agent/generic-terminal-planner` worktree from exact commit `658a259bafb1fb92359128d5320de50ff74771fc`.
- [x] (2026-07-16 14:14Z) Implemented PR 3 generic profile ordering, per-profile canaries, strict clients membership and adapter preflight, registered profile roles in durable fleet state without changing its JSON fields, additive plan `affectedProfiles`, and TalkPlaza static canary topology. Local launch and print-plan reject invalid topology before SSH, remote submission, state, or checkout.
- [x] (2026-07-16 14:14Z) Completed PR 3 local validation: 601 deploy Python tests, 20 CI Python tests, every deploy shell contract including the isolated 20-test PostgreSQL integration, both registry-resolved inventories, both staged-playbook syntax checks, Python compilation, and diff checks pass. Synthetic fourth and fifth types prove profile/canary order, impact, and unchanged fleet JSON without adding a terminal-name branch.
- [x] (2026-07-16 14:27Z) Published draft PR #1033 at exact code head `ab79b443967785784116b911c30a94c30644a12b`. CI run `29506385437`, CodeQL `29506385515`, and gitleaks `29506385385` all passed; the final deploy Python suite is now 602 tests after adding the planner-level unregistered-profile rejection.
- [x] (2026-07-16 14:27Z) Ran the second-factory public read-only plan against exact remote branch head `ab79b443`. Inventory, profile membership, canaries, adapter availability, client IDs, and all seven verified evidence records resolved with no warnings. The historical per-host diffs contain a `global` inventory change, so fail-closed planning correctly lists all seven hosts; no release, approval, checkout, or state mutation was performed.
- [x] (2026-07-16 14:36Z) Finalized PR #1033 at exact head `2292fb00819015c97f596dde1f2c4c55a62f614e`; CI `29506739473`, CodeQL `29506735529`, and gitleaks `29506735367` passed, then merged it as `10de373be26fbe904720f9e05ee50a1f7f5a380f`.
- [x] (2026-07-16 14:37Z) Fetched merged `origin/main` and created the isolated `agent/terminal-adapter-coordinator` worktree from exact commit `10de373be26fbe904720f9e05ee50a1f7f5a380f`.
- [x] (2026-07-16 15:00Z) Implemented PR 4's executable `TerminalAdapter` boundary, `generic-systemd` and Signage compatibility adapters, registry-selected playbooks and ready authority, a serial generic terminal playbook, profile-generic coordinator/evidence/rollback handling, and sequential profile approval-gate history while preserving the legacy current/latest `canaryHold` view.
- [x] (2026-07-16 15:00Z) Completed PR 4 local validation: 611 deploy Python tests, 20 CI Python tests, all 19 deploy shell contracts including the isolated 20-test PostgreSQL integration, both inventory parses, syntax checks for the staged and generic terminal playbooks against both inventories, compilation, and diff checks pass. Synthetic `inspection-panel` forward, health, cancel, and exact rollback plus a registry-only unique adapter prove no terminal-name core change is needed.
- [ ] Publish PR 4, run its exact remote read-only plan, pass hosted CI/CodeQL/gitleaks, and merge it.
- [ ] Implement PR 5: registry-driven CI, architecture contracts, acceptance coverage, ADR, and concise new-type documentation.

## Surprises & Discoveries

- Observation: `--print-plan` and a mutating launch currently call the same
  `inventory_json()` facade.
  Evidence: `scripts/deploy/rolling-release.py` calls it from both
  `build_print_plan()` and `rolling_release.application.launch()`. The new
  read-only configuration must therefore be selected by an explicit read-only
  adapter function, not by changing process-global Ansible configuration.

- Observation: Ansible fails before parsing the selected inventory when the
  configured password file is absent, even though the committed inventories use
  safe `default(...)` expressions and do not need local secrets for topology.
  Evidence: with no `infrastructure/ansible/.vault-pass`, `ansible-inventory`
  exits 1 and reports that the configured vault password file is missing.

- Observation: the classifier already implements the required unknown-path
  safety behavior.
  Evidence: `_component_for()` returns `unknown` and `classify()` calls
  `_mark_all()`, producing `server=true`, `kiosk=true`, and `signage=true`
  without raising an error. PR 1 must preserve this behavior while widening the
  explicit `deploy-control` boundary.

- Observation: the local worktree initially lacked workspace dependencies, so
  the isolated PostgreSQL deploy-status contract stopped before tests when
  `tsc` was unavailable.
  Evidence: a lockfile-frozen `pnpm install` restored the exact dependencies;
  the single permitted rerun then passed all 20 API tests against an isolated
  PostgreSQL container.

- Observation: Ansible inventory JSON retains nested Jinja in `ansible_host`
  instead of rendering `{{ server_ip }}` to the selected network address.
  Evidence: deriving `RASPI_SERVER_HOST` from `_meta.hostvars` produced an
  invalid hostname, while using the committed standard Tailscale address from
  `group_vars/all.yml` let the public read-only plan complete. The deployment
  CLI already requires `RASPI_SERVER_HOST`; PR 1 does not change that contract.

- Observation: the complete pre-registry classifier behavior can be compared
  mechanically, not just through hand-picked examples.
  Evidence: classifying each of the 4,242 tracked repository paths once with
  the PR 1 implementation and once with the registry implementation produced
  zero differences in `server`, `kiosk`, `signage`, `migration`, or
  `components`; only the new additive `affectedProfiles` field is absent from
  the old result.

- Observation: the existing approval behavior maps cleanly to explicit profile
  policy without changing execution yet.
  Evidence: Kiosk has the existing sixty-second notice and human canary hold,
  while Signage has no separate human hold after its health proof. The
  production registry therefore declares Kiosk as `human` with 60 seconds and
  Signage as `health-only` with 0 seconds. PR 4 will consume those values.

- Observation: the production and TalkPlaza inventories both contain the
  registered `kiosk` and `signage` terminal groups, but only the production
  inventory currently declares `kiosk_canary` and `signage_canary` groups.
  Evidence: read-only `ansible-inventory --list` reports 5/1 terminal hosts and
  1/1 canaries for the production inventory, versus 1/1 terminal hosts and no
  canary groups for TalkPlaza. PR 3 must add and validate those static groups
  before it enables generic inventory consumption; no TalkPlaza SSH or deploy
  is permitted.

- Observation: a new worktree has no installed JavaScript workspace even when
  the lockfile is unchanged.
  Evidence: the first all-shell pass stopped at `tsc` before the deploy-status
  integration; `pnpm install --frozen-lockfile` installed the exact locked
  workspace, after which the complete shell suite passed from the beginning.

- Observation: ready evidence is not inherently tied to a terminal name.
  Evidence: the existing Kiosk renders the Pi5 control-plane Web SHA while
  Signage renders its own checked-out SHA. Encoding `readyAuthority` as a
  validated adapter option preserves both behaviors and lets a synthetic
  generic terminal choose terminal-owned readiness without a coordinator
  branch.

- Observation: the existing deploy facade is also a useful compatibility seam
  for injected test runtimes.
  Evidence: adapters use the new profile-aware facade operation when present
  and retain the old `playbook(inventory, host, sha, run_id)` shape for test
  runtimes. This kept the large transition suite intact while moving every
  terminal operation out of the coordinator.

## Decision Log

- Decision: Complete and publish only PR 1, then stop after hosted CI until the
  user explicitly approves its merge and PR 2 start.
  Rationale: the emergency corrections are independently reviewable and must
  not be hidden inside the registry refactor.
  Date/Author: 2026-07-16 / User and Codex

- Decision: Use a checked-in Ansible configuration only for local read-only
  inventory commands, selected through a per-command `ANSIBLE_CONFIG`
  environment. Keep `ansible.cfg` and every mutating command unchanged.
  Rationale: a global or shared configuration change could silently relax Vault
  requirements for real deployment; a per-command adapter makes the safety
  boundary executable and testable.
  Date/Author: 2026-07-16 / Codex

- Decision: Treat unknown paths as deployment scope, not as classifier errors.
  Rationale: false-positive work is safer than excluding a terminal whose impact
  is not understood. In the registry design, the same rule expands to every
  registered profile.
  Date/Author: 2026-07-16 / User

- Decision: The production registry will initially contain only Kiosk and
  Signage profiles. Generic behavior will be proven with synthetic test-only
  fourth and fifth types rather than an invented production device.
  Rationale: the future product type is unknown, and guessing Zero2W or another
  device would create an unsupported production contract.
  Date/Author: 2026-07-16 / User

- Decision: Registry data may select only validated identifiers, repository
  paths, adapter IDs, and bounded options. It may not contain commands, shell
  fragments, or Python import paths.
  Rationale: a data registry must not become an alternate code-execution or
  policy-injection mechanism.
  Date/Author: 2026-07-16 / User and Codex

- Decision: Use `generic-systemd` for the production Kiosk profile and a
  `signage-systemd` adapter ID for the production Signage profile.
  Rationale: Kiosk fits the common Git/status-agent/systemd/manifest contract,
  while Signage retains its special prestaging, maintenance image, endpoint
  proof, timer, and final-display lifecycle. The IDs are data-only references;
  PR 4 will provide and validate the corresponding adapter implementations.
  Date/Author: 2026-07-16 / Codex

- Decision: Keep path rule order explicit and reject a rule that is completely
  shadowed by an earlier prefix.
  Rationale: specific paths such as database migrations must remain ahead of
  broader paths such as `apps/api/`; accepting unreachable rules would make a
  syntactically valid registry silently misclassify impact.
  Date/Author: 2026-07-16 / Codex

- Decision: Continue autonomously through PR 5, merging each isolated PR after
  its exact head passes local and hosted validation, and stop only for a fatal
  blocker.
  Rationale: the user explicitly granted end-to-end approval for the overnight
  work after reviewing the architecture. This changes the approval cadence but
  does not authorize real deployment, mutating SSH, full-fleet rollout, or any
  TalkPlaza device operation.
  Date/Author: 2026-07-16 / User

- Decision: A terminal's release type is its validated registry profile ID,
  selected by membership in that profile's inventory group. Hostname,
  hardware `device_type`, and legacy `manage_*` variables are not type
  discriminators; the profile's adapter and playbook define runtime behavior.
  Rationale: names and hardware alone cannot describe structurally different
  terminals. This separates identity, topology, hardware facts, and executable
  behavior while keeping existing `role` and `terminalType` values compatible.
  Date/Author: 2026-07-16 / User and Codex

- Decision: An inventory may omit a registered profile that has no hosts. A
  non-empty profile group must be a direct `clients` child and must have
  exactly one explicit canary; unknown, empty child, direct-client, overlapping,
  unsafe-ID, duplicate-client-ID, or unavailable-adapter topology fails closed.
  Rationale: one global registry can serve inventories with different installed
  product sets without allowing an unregistered terminal to enter planning.
  Date/Author: 2026-07-16 / Codex

- Decision: Declare each profile's rendered release authority explicitly as
  `control-plane` or `terminal`, and validate it as a closed registry enum.
  Rationale: structurally different terminals can share the systemd adapter
  while proving different immutable artifacts; deriving this from the profile
  name would recreate the coupling the registry is intended to remove.
  Date/Author: 2026-07-16 / Codex

- Decision: Append each human approval to `approvalGates` and make the legacy
  `canaryHold` field reference the current or latest gate. Only the first
  targeted host of a human-approved profile may open a gate, and health-only
  profiles never do.
  Rationale: this permits multiple sequential profile gates without changing
  `--approve RUN_ID`, lock ownership, or existing status readers.
  Date/Author: 2026-07-16 / Codex

## Outcomes & Retrospective

PR 1 is merged as `381e022e`. With no `.vault-pass`, both production
inventories resolve through the read-only adapter, while the normal Ansible
configuration still exits before parsing. Its final-head CI `29500051947`,
CodeQL `29500052047`, and gitleaks `29500051938` passed before merge.

PR 2 is merged as `658a259b`. Its exact final head passed CI `29503856934`,
CodeQL `29503856945`, gitleaks `29503853754`, and the second-factory no-op plan.

PR 3 is merged as `10de373b`. It removes the fixed terminal-role set from inventory planning and fleet
state. Registered profile groups and canaries produce deterministic order;
unknown groups, overlapping membership, duplicate identity, and missing
adapters fail before external work. Synthetic fourth and fifth terminal types
use the unchanged planner and fleet JSON shape. Its final exact head passed CI
`29506739473`, CodeQL `29506735529`, and gitleaks `29506735367` before merge.

PR 4 now routes manifest, notice, maintenance, application, health, ready proof,
rollback, cleanup, and final display evidence through validated adapters. The
coordinator, planner, policy, and fleet state contain no production terminal
type names. Multiple human gates are sequential and status-compatible. All 611
deploy Python tests, 20 CI tests, 19 deploy shell contracts, both inventories,
and both staged and generic terminal playbook syntax checks pass locally. No
physical host has been contacted for mutation; TalkPlaza validation remains
static only.

## Context and Orientation

`scripts/update-all-clients.sh` is the public command. It executes
`scripts/deploy/rolling-release.py`, a compatibility facade over modules in
`scripts/deploy/rolling_release/`. The facade resolves the target Git SHA,
parses the selected Ansible inventory, verifies the inventory's fixed Pi5
control-plane identity, reads fleet evidence, classifies changes from each
host's current SHA, and builds a plan. A mutating run is submitted to the Pi5 as
one systemd transient unit and is then coordinated serially.

`scripts/deploy/classify-deploy-impact.py` maps changed repository paths to
runtime components and legacy booleans named `server`, `kiosk`, and `signage`.
The classifier deliberately treats an unknown path as affecting all scopes.
Coordinator-only code is different: it changes how deployment is controlled but
is not installed as API, Web, Kiosk, or Signage runtime, so it belongs to the
`deploy-control` component. Terminal runtime helpers such as
`scripts/deploy/signage-runtime-proof.py` remain terminal impact.

`infrastructure/ansible/ansible.cfg` is the mutating configuration. Its
`vault_password_file = .vault-pass` requirement is intentional. The local
operator may not have that ignored secret file, yet topology-only planning needs
the committed inventory structure and non-secret client IDs. PR 1 introduces a
second configuration without a Vault password source and selects it only for
the inventory commands used by `--print-plan`. This configuration performs no
playbook, SSH, checkout, service, database, status, or fleet-state mutation.

The existing fleet-state JSON shape remains authoritative and is not migrated.
The terminal profile is a deployment concept and must never be confused with a
hardware `device_type`. Each inventory continues to have exactly one Pi5
control-plane host.

## Plan of Work

### Milestone 1: Repair safe read-only planning and deploy-control classification

Add a dedicated configuration below `infrastructure/ansible/` that is sufficient
for inventory parsing but has no Vault password file. In
`scripts/deploy/rolling_release/backends/ansible.py`, add explicit read-only
inventory and host-selection functions. They set `ANSIBLE_CONFIG` for only that
subprocess, remove inherited Vault password-source overrides, parse JSON, and
translate failures to stable messages that explain whether Ansible is missing,
the configuration is missing, or inventory syntax/group data is invalid. They
must never repeat command stdout or stderr because inventory plugins and future
variables could contain secrets.

Wire only `build_print_plan()` in `scripts/deploy/rolling-release.py` to those
functions. Keep `inventory_json()` used by `rolling_release.application.launch()`
and all remote execution on the normal `ansible.cfg`. Add tests proving the
read-only command succeeds with an absent `.vault-pass`, the normal command
still fails without it, failure text omits a sentinel secret, and remote fleet
state is not read after inventory failure.

Replace the classifier's incomplete file allow-list with an explicit prefix for
all of `scripts/deploy/rolling_release/` plus explicit known entry-point files.
Keep runtime files outside that boundary in their existing components. Extend
tests for documentation, deploy control, known terminal runtime, unknown paths,
and delete/rename handling. An unknown path must still return a successful JSON
classification that targets every legacy scope.

Acceptance for this milestone is focused tests passing; both production
inventories parsing without `.vault-pass` through the read-only adapter; the
normal adapter retaining the Vault requirement; and classifier output matching
the expected boundary.

### Milestone 2: Introduce the strict terminal profile registry

Add a versioned JSON file loaded only with Python's standard `json` module and a
strict validator. It contains one fixed Pi5 control-plane definition, terminal
profiles, path-to-component mappings, and component-to-profile mappings. Each
profile has a safe identifier and inventory group, deterministic rollout order,
impact component, adapter ID and playbook, notice duration, canary group,
approval policy (`human` or `health-only`), and bounded adapter options.

Reject unknown keys, duplicate JSON keys, unsafe IDs, shell or command content,
import paths, playbooks outside the Ansible root, unsafe systemd units, and
unsafe rollback paths before any SSH, state, or checkout operation. Preserve all
legacy classifier fields and add `affectedProfiles`. The production file has
only Kiosk and Signage.

### Milestone 3: Make planning, inventory, and fleet evidence profile-generic

Replace fixed terminal-role membership checks with registered profile IDs while
reserving `server`. Every client host must belong to exactly one registered
terminal inventory group. Reject unregistered groups, multiple membership,
missing adapters, and duplicate client IDs before any external or mutable work.
Sort profiles by registry order, canaries within each profile, then remaining
hosts by inventory order; terminals remain serial one. Classification uses each
host's own verified current SHA.

Use synthetic test-only profiles to prove that new profile names do not require
core edits. Preserve the existing fleet-state JSON fields and semantics.

### Milestone 4: Move terminal behavior behind adapters

Define a `TerminalAdapter` boundary responsible for manifest capture, notice and
maintenance state, Ansible application, health checks, ready-SHA evidence, exact
rollback, maintenance release, and final evidence. Preserve Kiosk and Signage
behavior. Add a generic systemd/Git/status-agent adapter and one test-only unique
adapter, selected only by validated registry adapter IDs.

Remove terminal-name branches from core coordination. Process multiple human
gates sequentially; `--approve RUN_ID` approves only the currently waiting
profile gate. Preserve `canaryHold` as the current/latest compatibility view and
add profile-specific `approvalGates` history. Preserve cancel, lock, exact
rollback, sixty-second production terminal notice, five-minute Pi5 stabilization,
serial terminal execution, and the prohibition on database down migration.

### Milestone 5: Make CI and operator guidance registry-driven

Make CI read the registry and validate every adapter, inventory group, playbook,
`serial: 1` contract, orchestration guard, and rollback owner without adding a
workflow job per profile. Add a static contract that core modules do not contain
production terminal type names. Cover forward execution, health, rollback,
cancel, multiple human gates, health-only gates, timeout, rollback failure, and
unknown evidence with isolated fault injection.

Record the final architecture decision in an ADR and add a short operator guide
for adding a type. TalkPlaza receives static validation only because no real Pi5
exists. Production proof is intentionally deferred until a later real product
change follows the normal approved canary process.

## Concrete Steps

Run commands from the repository root unless a command says otherwise.

For PR 1, run focused Python tests first:

    python3 -m unittest \
      scripts.deploy.tests.test_classify_deploy_impact \
      scripts.deploy.tests.test_ansible_adapter \
      scripts.deploy.tests.test_rolling_release.PrintPlanShadowTest

Run the entire deploy Python contract and shell safety contracts:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    bash scripts/deploy/tests/test-single-deploy-entrypoint.sh

Parse both committed inventories with the dedicated read-only adapter and
validate every deployment playbook with the repository's CI-equivalent Ansible
commands. No command in this step may contact a host.

Run the second-factory public command only in `--print-plan` mode at the exact
checked-out SHA and with the configured read-only SSH identity probe. Expect
`targetHosts` to be empty when all fleet records are verified at that SHA. This
command may read non-secret status evidence from Pi5 but must not run SSH
commands that alter state. For TalkPlaza, perform only local static inventory and
playbook validation.

Before publication, run:

    git diff --check
    git status --short
    git diff --stat origin/main...HEAD

Stage only files named in the PR 1 diff, commit with a terse Conventional Commit
message, push the feature branch, and open a draft pull request against `main`.
Wait for `ci-required`, CodeQL, and gitleaks/Secret scan. Do not merge.

## Validation and Acceptance

PR 1 is accepted when all of the following are observable:

1. With no local `.vault-pass`, the public `--print-plan` reaches inventory
   validation and planning instead of failing on the mutating config's password
   file. The same-SHA verified second-factory plan is a no-op.
2. A normal mutating launch continues to use `ansible.cfg`; removing its Vault
   password file still makes Ansible fail before systemd submission or remote
   checkout.
3. Malformed inventory produces a short actionable error that does not include
   subprocess output or a sentinel secret.
4. Documentation is neutral; every file under `rolling_release/` and the known
   coordinator/recovery entry points are `deploy-control`; known terminal runtime
   assets retain their terminal impact; unknown paths target all scopes without
   raising; deleted and renamed runtime paths cannot disappear from impact.
5. Both inventories and every affected playbook pass static validation. No
   production mutation and no TalkPlaza connection occurs.
6. Hosted `ci-required`, CodeQL, and gitleaks/Secret scan pass for the exact PR
   head.

Later pull requests add acceptance for strict registry rejection before external
work; deterministic profile and canary order; synthetic generic and unique
adapters; multiple approval policies; isolated forward, rollback, timeout,
cancel, and rollback-failure scenarios; and static prohibition of type names in
core code.

## Idempotence and Recovery

All PR 1 validation commands are read-only or create only ignored temporary test
files. They are safe to repeat. The feature worktree is separate from the clean
`refactor/deploy-migration-cleanup` worktree. If implementation fails, leave the
existing worktree untouched and remove only the new worktree after preserving
any useful diff. Never reset, rebase, force-push, edit fleet state, delete locks,
or kill a release process.

If the read-only inventory command fails, inspect only redacted diagnostic
categories and reproduce with a synthetic inventory. Do not add a real Vault
password to CI or to the repository. If hosted CI fails, reproduce the same
contract locally before changing behavior. If the second-factory read-only plan
is not a no-op, report the host evidence and stop; do not use `--full-fleet` and
do not start a release.

## Artifacts and Notes

PR 1 starting evidence:

    origin/main = 398ad2409242268c3c7ea507fbd456d210cb4cc9
    infrastructure/ansible/.vault-pass = absent
    default ansible-inventory exit = 1 (configured password file missing)
    reported coordinator paths = component unknown, all legacy scopes true

The latest known verified second-factory evidence at handoff was Pi5 and five
Pi4 Kiosks at `06fb53ed5cf56ac29a8c2023c69e3e1e47d1714d`, and the Pi3 Signage at
`79ab05f8be0c208665e6384501c54a70205001c5`, all with `evidence=verified`.
Re-read live evidence during the authorized read-only plan; do not assume these
values remain current.

## Interfaces and Dependencies

PR 1 adds no third-party Python dependency. The Ansible backend exposes explicit
read-only functions alongside the existing mutating functions:

    read_only_inventory_json(path: str, *, runtime: Runtime) -> dict[str, Any]
    read_only_selected_hosts(path: str, limit: str, *, runtime: Runtime) -> list[str] | None

They use the checked-in read-only config by absolute path and pass it only in the
child environment. They raise `RuntimeError` with stable, non-secret guidance.
The existing functions remain the mutating contract and continue to use normal
Ansible configuration:

    inventory_json(path: str, *, runtime: Runtime) -> dict[str, Any]
    selected_hosts(path: str, limit: str, *, runtime: Runtime) -> list[str] | None

The later registry loader accepts one repository-owned JSON file, rejects
duplicate and unknown keys, and returns immutable validated profile records.
Core policy consumes validated profile IDs and adapter objects only; it never
imports arbitrary paths or executes registry-provided text.

Revision note (2026-07-16 15:00Z): Recorded PR #1033's final merge and PR 4's
adapter implementation plus complete local evidence. PR 4 still requires an
exact remote read-only plan and hosted checks before merge.
