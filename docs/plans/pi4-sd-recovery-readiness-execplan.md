# Restore production readiness for Pi4 SD-card recovery

> Historical OAuth readiness plan, superseded on 2026-08-01 by
> `pi4-sd-recovery-dynamic-bootstrap-execplan.md` after the intermediate LAN
> provider and before any production OAuth client, Vault change, or physical
> recovery drill. Its implementation
> history remains evidence, but its production instructions are no longer active.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

The Pi5 recovery command must be usable before a Pi4 fails, not merely pass mocked tests. After this work, an operator can run the existing read-only `plan` command for each explicitly enabled Pi4 and receive a resolved IPv4 endpoint, the immutable active Pi5 release, and a positive recovery OAuth readiness result. During a confirmed recovery, Pi5 obtains a short-lived, one-use, `tag:kiosk` Tailscale auth key without sending the long-lived OAuth secret to Pi4 or retaining either secret in recovery artifacts. Completion still requires a later approved blank-SD physical drill; this branch does not authorize production Vault changes, deployment, endpoint changes, or hardware operations.

## Progress

- [x] (2026-08-01 JST) Confirmed the starting worktree was clean and local `main` matched `origin/main` at `8aeceec38153a719722e89629a209f6303d9be79`.
- [x] (2026-08-01 JST) Created `feat/pi4-sd-recovery-readiness` from the synchronized `main` branch.
- [x] (2026-08-01 JST) Added a production-shaped templated inventory contract test that resolves `100.90.80.70` and exports no sentinel secrets.
- [x] (2026-08-01 JST) Added the secret-free Ansible resolver and Python resolver adapter, then migrated recovery orchestration to it.
- [x] (2026-08-01 JST) Added the recovery-only OAuth auth-key provider and isolated success, retry, rejection, malformed-response, and secret-leak tests.
- [x] (2026-08-01 JST) Updated the Vault example, ADR, Runbook, initial setup guide, historical bootstrap plan link, and AI navigation entry.
- [x] (2026-08-01 JST) Ran focused Python discovery, resolver/recovery/verify syntax checks, synthetic verify check mode, 102-template parsing, and `git diff --check` successfully.
- [x] (2026-08-01 JST) Ran the canonical deploy-contract suite with Node 22.23.1 and pnpm 9.15.9: 955 Python tests, 157 isolated migrations, SQL/index `EXPLAIN (ANALYZE, BUFFERS)`, 20 deploy-status API tests, and all Ansible contracts passed.
- [x] (2026-08-01 JST) Verified the test-created PostgreSQL container, volume, and network were removed (`cleanup verified: run resources=0`), no temporary-resource delta remained, and the complete pre-existing Docker resource snapshots were unchanged.
- [x] (2026-08-01 JST) Opened draft PR #1147, fixed the CI-only Vault password-file dependency in the new Ansible tests, and verified every required GitHub check including `deploy-contract` and `ci-required` passed at `f1e1df91`.
- [x] (2026-08-01 JST) Recorded the remaining production-only work: OAuth credential creation, encrypted Vault update, canonical deployment, Assembly backup configuration, and the blank-SD physical drill.
- [x] (2026-08-01 JST) User selected managed-LAN recovery; cancelled all OAuth/Vault production work and moved implementation to `feat/pi4-sd-recovery-lan-provider`.

## Surprises & Discoveries

- Observation: `ansible-inventory --list` preserves production `ansible_host` expressions such as `{{ kiosk_ip }}` and `{{ current_network... }}`, while an Ansible play evaluates them.
  Evidence: all five enabled live Pi4 `plan` calls rejected the endpoint as non-literal although ordinary Ansible operations resolve the same hosts.
- Observation: the live Pi5 currently resolves no non-empty `tailscale_auth_key` for the five recovery targets.
  Evidence: a read-only Ansible inspection returned `authKeyConfigured=false`; the shared Tailscale task fails when the fresh node is disconnected and no key exists.
- Observation: the existing recovery unit tests use a fake concrete endpoint and intercept `ansible-inventory`, so they cannot reproduce the production failure.
  Evidence: the focused suite passed before the fix despite every live `plan` failing.
- Observation: the new resolver evaluates all five enabled production inventory hosts to their expected `100.x` endpoints, while OAuth readiness remains false until the separately authorized production Vault setup.
  Evidence: controller-only resolver runs returned `100.74.144.79`, `100.123.1.113`, `100.100.229.95`, `100.101.113.95`, and `100.115.109.18`, with `recoveryEnabled=true`, `oauthConfigured=false`, and `tag:kiosk` for each.
- Observation: the OAuth provider can distinguish transient failures from credential rejection without leaking test sentinels.
  Evidence: 31 focused tests passed; the fake service required three token attempts for 429 then 503 then success, while a 401 stopped after one attempt and malformed key capabilities failed closed.
- Observation: prepending Homebrew's general binary directory selected a Python without Jinja2 even though the repository's pyenv Python had it.
  Evidence: the first deploy-contract attempt stopped before tests with `ModuleNotFoundError: jinja2`; preserving the existing pyenv Python fixed the missing dependency, and the final required run used an ephemeral npm-provided Node 22.23.1 with pnpm 9.15.9. No Docker test resource was created by the failed attempt.
- Observation: the first PR `deploy-contract` run exposed that the new Ansible-backed tests inherited the repository's local `.vault-pass` path, which is intentionally absent in CI.
  Evidence: PR #1147 failed four OAuth tests and one resolver test before executing their assertions; both harnesses now supply a non-secret per-test temporary Vault password file, 36 focused tests passed locally, and the complete required CI suite passed on rerun.
- Observation: the repository currently contains 157 Prisma migrations, and the deploy-status identity query uses the intended unique API-key index.
  Evidence: isolated `prisma migrate deploy/status` succeeded with zero anomalies; `EXPLAIN (ANALYZE, BUFFERS)` reported `Index Scan using "ClientDevice_apiKey_key"` and the API suite passed 20 tests.
- Observation: the shared inventory default enables Tailscale SSH, while the recovery Runbook and final verification require Pi5-key standard OpenSSH.
  Evidence: `group_vars/all.yml` sets `tailscale_extra_args: "--ssh"`, but `client-initial-setup.md` explicitly requires Tailscale SSH off for Pi5 Ansible. The recovery play now overrides only its own run with `--ssh=false`; normal deployment behavior is unchanged.

## Decision Log

- Decision: resolve the recovery contract through a connection-free Ansible play instead of parsing ad-hoc stdout, using Ansible's internal Python API, or reimplementing Jinja in Python.
  Rationale: Ansible remains the only owner of inventory precedence, Vault, runtime host vars, and Jinja evaluation. The adapter exposes a small secret-free JSON contract to the coordinator.
  Date/Author: 2026-08-01 / Codex.
- Decision: use a Pi5-held OAuth client limited to auth-key creation and `tag:kiosk`, then mint a non-reusable, non-ephemeral, preauthorized key with a 600-second unused lifetime only when a target is disconnected.
  Rationale: a fixed auth key expires within 90 days and can make emergency recovery fail silently. A one-use key limits exposure, and the long-lived secret never leaves Pi5.
  Date/Author: 2026-08-01 / User and Codex.
- Decision: keep the public CLI compatible and add only non-secret readiness fields to `plan` output.
  Rationale: existing operator commands and recovery automation must continue to work while readiness becomes observable before a failure.
  Date/Author: 2026-08-01 / Codex.
- Decision: disable Tailscale SSH only in the bare-metal recovery play.
  Rationale: the rebuilt host must remain reachable through the Imager-seeded Pi5 public key and standard OpenSSH; changing the shared default would broaden this repair into unrelated normal deployment behavior.
  Date/Author: 2026-08-01 / Codex.
- Decision: leave `raspi4-assembly-01`, Pi3, Talkplaza, and Pi5 recovery out of this capability.
  Rationale: Assembly requires torque-hardware acceptance and the other systems have different recovery models. This branch records but does not perform the separately authorized Assembly backup preparation.
  Date/Author: 2026-08-01 / User and Codex.

## Outcomes & Retrospective

Feature-branch implementation and local validation are complete. The resolver now proves all five enabled inventory endpoints as literal IPv4 addresses, and the recovery path has a tested one-use OAuth provider without changing normal deployment authentication. Production OAuth creation, encrypted Vault editing, canonical deployment, Assembly backup configuration, and the blank-SD drill remain intentionally open because they require separate authorization or hardware. Repository completion, production deployment, and physical acceptance remain distinct; `.agent/PLANS.md` prevents full completion until effective changes are in `origin/main` and production SHA evidence is recorded.

## Context and Orientation

`scripts/deploy/recover-pi4.py` is a Pi5-only coordinator. Its `plan` subcommand validates inventory and the Pi5's verified active Blue/Green release without changing authoritative state. Its confirmed `run` subcommand acquires the shared Fleet Lock, refuses a reachable old endpoint, configures a fresh Raspberry Pi OS host through `infrastructure/ansible/playbooks/recover-pi4.yml`, saves a Pi5-local runtime endpoint override, verifies the rebuilt terminal, and updates Fleet State.

The defect is in the coordinator's inventory boundary. It shells out to `ansible-inventory --list`, takes `_meta.hostvars[target].ansible_host`, and requires it to be a literal IPv4 address. Production inventory deliberately defines those endpoints with Jinja expressions, which the inventory listing retains. A connection-free play can evaluate the same variables without attempting SSH.

The shared role `infrastructure/ansible/roles/common/tasks/tailscale.yml` installs Tailscale, checks whether it is connected, and currently accepts only `tailscale_auth_key`. Recovery needs a provider that runs only for a disconnected fresh host, exchanges Pi5 Vault OAuth credentials for an access token on the controller, creates a one-use tagged auth key, and supplies only that key to the existing `tailscale up` step. Normal deployments retain their existing behavior.

## Plan of Work

First add a fixture whose endpoints and required fields are Jinja expressions. Add a resolver playbook that has no remote connection, validates the selected host and exactly one inventory server, and writes a strict secret-free JSON result to a caller-supplied controller path. Add a Python `RecoveryInventoryResolver` port and an Ansible-backed adapter that invokes the play in a temporary directory, validates the result, and deletes the directory on every exit. Inject the resolver into `RecoveryCoordinator` so unit tests use a fake adapter rather than fake command routing. Re-resolve inside the Fleet Lock during `run` as the existing `execute` path already rebuilds its plan there.

Next split recovery credential supply from Tailscale installation/status handling. When the play explicitly selects `recovery-oauth` and the node is disconnected, use controller-delegated, `no_log` Ansible tasks to request an OAuth access token and create an auth key with `reusable=false`, `ephemeral=false`, `preauthorized=true`, `tags=[tag:kiosk]`, and `expirySeconds=600`. Retry transient request failures at most three times. Reject missing credentials and malformed responses before calling `tailscale up`. Do not serialize the access token or key. Keep the static-key path unchanged outside recovery.

Update the recovery result contract so `plan` reports `inventoryResolved=true` and a secret-free `tailscaleAuth` object. Absence of both OAuth fields is an actionable `plan` failure. Update the Vault example and operator documentation. Do not edit a real Vault or the live `backup.json` in this branch.

Finally run focused tests and the shared deploy-contract runner. The latter owns the isolated Docker PostgreSQL integration: it creates uniquely named labelled resources, applies every migration, runs SQL and `EXPLAIN (ANALYZE, BUFFERS)`, executes deploy-status API tests, and removes only its own resources through a trap.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002` on `feat/pi4-sd-recovery-readiness`. Use `apply_patch` for tracked edits. Run focused checks while implementing:

    python3 -m unittest scripts/deploy/tests/test_recover_pi4.py -v
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/resolve-pi4-recovery-contract.yml --syntax-check
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/recover-pi4.yml --syntax-check
    ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/recover-pi4-verify.yml --syntax-check

For final local validation select Node 22 and pnpm 9.15.9, then run:

    scripts/ci/run-deploy-contracts-local.sh

Before that Docker run, record existing container, volume, and network IDs. Afterward require no resource carrying `com.raspi-system.temporary=true` from the test run and verify the pre-existing IDs are unchanged. The test script may pull `pgvector/pgvector:pg15`; it must never attach to or mutate an existing database.

## Validation and Acceptance

The templated fixture test must fail against the old implementation and pass through the new Ansible adapter with a literal IPv4 result. Tests must prove enabled Pi4 acceptance, Assembly/Talkplaza rejection, missing OAuth rejection, one-server enforcement, runtime override behavior, lock-time re-resolution, and no mutation by `plan`.

OAuth tests must use a local fake HTTP service or an equivalent isolated adapter and prove the exact key capabilities. Tests must cover authentication rejection, transient failure exhaustion, malformed responses, and a sentinel secret absent from command output, persisted recovery state, runtime overrides, and resolver result files.

The deploy-contract runner must finish successfully. Its isolated PostgreSQL stage must report successful migrations, zero incomplete or rolled-back migrations, SQL `EXPLAIN (ANALYZE, BUFFERS)`, deploy-status API test success, and `cleanup verified: run resources=0`.

Physical acceptance remains a production-only gate. After later explicit approvals for credential creation, Vault editing, canonical deployment, endpoint isolation, and hardware work, run read-only plans for all five enabled Pi4s and recover `raspberrypi4` from a known-empty SD within 60 minutes. Verify Ansible ping, OpenSSH, kiosk, status timer, an NFC read, optional barcode, the `tag:kiosk` identity, and secret-free artifacts. Record the immutable deployed SHA, Fleet run ID, elapsed time, and evidence here.

## Idempotence and Recovery

The resolver is read-only except for its private temporary output, which is always deleted. A failed OAuth request or unused one-use auth key cannot save a runtime endpoint. A failed confirmed recovery retains its secret-free diagnostic state and follows the existing new-run retry procedure. Do not delete old Tailscale nodes automatically and do not restore old Tailscale state or SSH private keys.

Feature-branch edits can be reverted by their purpose-specific commits. No implementation step may edit production Vault, live `backup.json`, existing Docker resources, Fleet State, or hardware. If a focused test fails, retain the working tree and record the failure here before changing design.

## Interfaces and Dependencies

The public CLI remains:

    python3 scripts/deploy/recover-pi4.py plan --target <inventory-host> --bootstrap-host <LAN-IPv4>
    python3 scripts/deploy/recover-pi4.py run --target <inventory-host> --bootstrap-host <LAN-IPv4> --reason <text> --confirm-recovery

The plan JSON gains:

    "inventoryResolved": true,
    "tailscaleAuth": {"mode": "oauth", "configured": true, "tag": "tag:kiosk"}

The Python boundary consists of a `RecoveryInventoryResolver` protocol and an immutable resolved-contract data object. The Ansible boundary accepts only the selected host and a controller output path and emits no secrets. Recovery Vault inputs are `vault_tailscale_recovery_oauth_client_id` and `vault_tailscale_recovery_oauth_client_secret`; the non-secret tag is fixed to `tag:kiosk`. No application HTTP API, Prisma schema, migration, or database interface changes.
