---
id: production-secrets-and-runtime-execplan
title: Remove production credential fallbacks and minimize the Pi5 runtime
status: in_progress
date: 2026-08-04
source_of_truth: true
scope: normal-factory Ansible secrets, production bootstrap credentials, PostgreSQL roles, backup SSH access, Pi5 containers, and local TLS policy
related_docs:
  - ./ci-security-baseline-execplan.md
  - ./fail-closed-production-config-and-terminal-health-execplan.md
  - ../guides/deployment.md
  - ../guides/backup-and-restore.md
related_code:
  - infrastructure/ansible/inventory.yml
  - infrastructure/ansible/host_vars/raspberrypi3/vault.yml
  - infrastructure/ansible/host_vars/raspberrypi4/vault.yml
  - infrastructure/ansible/host_vars/raspberrypi5/vault.yml
  - infrastructure/ansible/templates/api.env.j2
  - infrastructure/docker/docker-compose.server.yml
  - infrastructure/docker/Dockerfile.api
  - apps/api/prisma/seed.ts
  - apps/web/src/lib/client-key/config.ts
  - scripts/register-clients.sh
  - scripts/ci/validate_production_secret_structure.py
validation:
  - redacted secret-structure and Ansible Vault contracts
  - production fail-closed configuration tests
  - API and Web unit/integration tests
  - Docker Compose and non-root runtime contracts
  - complete local deployment contracts without managed-host connections
open_items:
  - remaining production fail-closed and runtime implementation
  - Draft PR and hosted CI
  - credential rotation, database role migration, CA rollout, merge, and production deployment require separate evidence and approval gates
---

# Remove production credential fallbacks and minimize the Pi5 runtime

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date while work proceeds. Maintain this document in accordance with
`.agent/PLANS.md`.

## Purpose / Big Picture

The normal factory currently has several different ways to obtain production
credentials. Some terminal keys are literal values in the tracked inventory,
the three normal-factory Vault files are ignored plaintext files on one Mac,
and multiple production paths still accept development defaults. The Pi5 API
also receives the host user's complete SSH directory and runs as root. A
single mistaken deployment can therefore reuse a known credential or expose
more host authority than the application requires.

After this work, tracked production configuration contains only encrypted
normal-factory Vault ciphertext or references to it, and a production process
stops before serving traffic when required credentials are absent or known
weak defaults are supplied. Database migration authority is separate from the
ordinary API role. The API can access only the dedicated backup identity and
pinned host records it needs. API and Web containers run without root or
ambient Linux capabilities and with explicit writable locations. Local TLS
verification and the administrative network allowlist are required production
inputs rather than permissive fallbacks.

This plan prepares and tests those boundaries locally. It does not connect to
managed hosts, rotate a credential, change a production database, delete
data, merge, or deploy. Those operations remain separate approval gates even
when the repository implementation is ready.

## Progress

- [x] (2026-08-04 06:47Z) Confirmed a clean synchronized `main` at
  `ee04e8aba045fd18325f29d2099c27e4a2621d1d`, with the Phase 1 CI baseline and
  CVE-2026-69152 correction integrated and green.
- [x] (2026-08-04 06:50Z) Created branch
  `hardening/production-secrets-and-runtime` from that exact main SHA; no host
  connection, production mutation, push, or deployment occurred.
- [x] (2026-08-04 06:55Z) Classified the three normal-factory Vault files as
  ignored plaintext, the three TalkPlaza Vault files as tracked plaintext, and
  ten normal-factory inventory credential literals as existing frozen debt.
  Only identifiers and classifications were emitted; values were not printed.
- [x] (2026-08-04 07:57+09:00) Encrypted and staged the eight normal-factory
  host Vault files without changing their values, replaced all 19 relevant
  inventory assignments with required Vault references, and added redacted
  structure contracts. TalkPlaza files were not modified.
- [x] (2026-08-04 07:57+09:00) Added a reusable redacted Ansible context for
  CI so inventory and release contracts exclude production Vault ciphertext
  and password material while still validating every required variable name.
- [x] (2026-08-04 07:57+09:00) Passed 74 CI unit tests, the secret validator,
  documentation audit, `git diff --check`, and the complete Node 20 deployment
  contract suite, including the isolated PostgreSQL 15 migration checks. The
  run-owned Docker resource count returned to zero.
- [ ] Remove production bootstrap fallbacks for administrator, browser client
  identity, registration credentials, due-management access, database
  credentials, and administrative network policy while preserving explicit
  development/test fixtures.
- [x] (2026-08-04 08:06+09:00) Completed the first bootstrap subset: production
  seed now requires explicit strong administrator credentials and omits
  synthetic clients; production Web builds no longer synthesize a terminal
  key; client registration requires explicit authentication, verifies TLS by
  default, and resolves encrypted inventory through `ansible-inventory`.
- [x] (2026-08-04 08:15+09:00) Removed the fixed due-management comparison and
  made an absent shared hash deny access. Added a read-only standard deployment
  preflight that blocks before fetch, checkout, release-unit creation, or
  migration when the shared hash is missing or cannot be verified.
- [x] (2026-08-04 08:15+09:00) Passed 208 affected API integration tests in a
  disposable PostgreSQL 15/pgvector instance and 67 deployment-preflight
  contract tests. The run-owned container, volume, and network were removed.
- [ ] Prepare distinct PostgreSQL application and migration roles and prove
  least-privilege behavior in an isolated PostgreSQL 15 instance.
- [x] (2026-08-04 08:20+09:00) Added the value-free PostgreSQL role bootstrap
  and isolated contract. All 157 migrations were transferred to a non-superuser
  migration owner; the API role could perform business CRUD but could not run
  DDL, create roles, or modify `_prisma_migrations`. Disposable resources were
  removed.
- [x] (2026-08-04 08:20+09:00) Added API startup rejection for production URLs
  using the `postgres` role, a missing password, or the known database password.
  Wiring generated credentials into Vault/Compose and activating roles in the
  production database remain separate approved operational steps.
- [x] (2026-08-04 08:34+09:00) Replaced the API host SSH-directory mount with
  one dedicated read-only backup key and pinned `known_hosts`, and excluded
  terminal private keys from backup catalogs. Missing host files now stop
  Compose before creating a directory, Ansible uses one explicit identity with
  strict host-key checking, and `.ssh` targets are rejected by the API boundary.
- [x] (2026-08-04 08:34+09:00) Passed seven focused API tests, API build and
  lint, 80 CI contract tests, both production Compose renders, the production
  configuration audit, and `git diff --check`. No host connection, key
  generation, backup execution, or production setting change occurred.
- [x] (2026-08-04 08:36+09:00) Re-ran the complete Node 20 local deployment
  contract suite after the SSH boundary change: all shell lifecycle contracts,
  969 Python deployment tests, 43 Ansible contracts, and both isolated
  PostgreSQL contracts passed. Run-owned Docker resources returned to zero.
- [ ] Make API/Web containers non-root with dropped capabilities,
  `no-new-privileges`, read-only root filesystems, and enumerated writable
  mounts; prove Chromium, storage, backup, health, and Caddy behavior.
- [ ] Require local CA verification and an explicit `ADMIN_ALLOW_NETS` value,
  with preflight rejection before any production mutation.
- [ ] Run focused and aggregate tests, audit the entire diff, update this plan,
  and prepare a Draft PR. Merge and operational rollout remain unapproved.

## Surprises & Discoveries

- Observation: Phase 1 freezes known plaintext but intentionally does not make
  the current baseline safe.
  Evidence: `security/production-secret-baseline.json` allows ten credential
  literals in `infrastructure/ansible/inventory.yml`, the fixed seed password,
  the Web client-key fallback, and database defaults with Phase 2 reasons.

- Observation: the normal-factory Vault files already contain the main shared
  variable names, but only as ignored plaintext files with mode `0644`.
  Evidence: identifier-only inspection found `vault_status_agent_client_key`,
  `vault_nfc_agent_client_secret`, both JWT secrets, backup-provider secrets,
  and related Pi5 values. No value was displayed.

- Observation: the five newer Pi4 inventory hosts do not inherit
  `host_vars/raspberrypi4/vault.yml`.
  Evidence: Ansible host variables are keyed by exact inventory hostname, and
  the newer hosts are `raspi4-robodrill01`, `raspi4-fjv60-80`,
  `raspi4-kensaku-stonebase01`, `raspi4-sessaku-01`, and
  `raspi4-assembly-01`. Their currently literal credentials therefore need
  five exact-host Vault files rather than additions to the original Pi4 file.

- Observation: TalkPlaza Vault files are tracked plaintext and are therefore a
  separate security concern, but this repository's approved boundary permits
  only local analysis for TalkPlaza.
  Evidence: Git classification reports the three `talkplaza-*` Vault paths as
  tracked and their content as non-Vault YAML.

- Observation: production JWT secrets already fail closed, while database
  credentials do not.
  Evidence: `apps/api/src/config/env.ts` rejects weak production JWT secrets,
  but `coreEnvShape.DATABASE_URL`, Docker Compose, the API Dockerfile, and the
  Ansible API template still contain postgres development defaults.

- Observation: the fixed due-management credential is a database fallback,
  not an environment variable.
  Evidence: `verifyDueManagementAccessPassword` compares directly with `2520`
  only when `ProductionScheduleAccessPasswordConfig` has no row. Deployment
  must therefore prove the shared hashed row exists before code that removes
  the fallback can be activated.

- Observation: after Vault migration, `scripts/register-clients.sh` could no
  longer read terminal keys correctly because it parsed raw YAML and therefore
  saw unresolved Jinja references.
  Evidence: the migrated inventory contains only `vault_*` references. The
  corrected script consumes `ansible-inventory --list` in memory and stops if
  decryption or resolution fails; it does not fall back to example devices.

- Observation: removing the fixed due-management comparison is repository-safe
  only when every production release is gated on the existing shared hash.
  Evidence: the new migration preflight queries only existence and non-empty
  hash state, emits no hash, and returns `blocked` for missing state and
  `incomplete` for an unavailable database. Unit contracts prove both outcomes
  occur before checkout, fetch, release submission, or migration.

- Observation: PostgreSQL role separation requires ownership migration, not
  only two connection strings.
  Evidence: Prisma migration status succeeds as `raspi_migrator` only after
  public schema tables, sequences, enums, and repository-owned functions are
  transferred. The isolated contract then proves `raspi_app` retains business
  CRUD while DDL, role creation, and migration-ledger mutation fail.

- Observation: the API's complete host SSH directory serves two unrelated
  purposes: Ansible-based terminal backups and configuration backup coverage.
  Evidence: Compose mounts `/home/denkon5sd02/.ssh` at `/root/.ssh`, while the
  backup catalog also explicitly proposes terminal `.ssh` directories as
  backup sources. Least privilege requires both the mount and catalog to
  change together.

- Observation: changing only the recommended catalog would leave manually
  configured `.ssh` targets executable and changing only Compose would still
  permit an inventory host to disable host-key checking.
  Evidence: both client backup target constructors accept arbitrary remote
  paths, and Ansible inventory variables can provide SSH options. The new API
  boundary rejects every normalized `.ssh` path and passes strict SSH options
  as highest-precedence extra variables.

## Decision Log

- Decision: split repository preparation into independently testable
  milestones even though they remain on the approved Phase 2 branch.
  Rationale: Vault migration, DB roles, SSH authority, container UID changes,
  and CA rollout have different rollback boundaries. Combining their runtime
  activation would make failure diagnosis and recovery unsafe.
  Date/Author: 2026-08-04 / Codex.

- Decision: preserve existing secret values while encrypting the normal-factory
  Vault files; do not rotate them during repository preparation.
  Rationale: encryption-at-rest can be verified by checksum without changing
  any consumer identity. Rotation changes both DB and devices and therefore
  remains a later per-device operational gate.
  Date/Author: 2026-08-04 / Codex.

- Decision: create one encrypted Vault file for each exact inventory hostname,
  resulting in eight tracked normal-factory Vault files.
  Rationale: this follows Ansible's actual variable-resolution semantics and
  keeps each terminal's credential authority isolated. A shared Pi4 Vault
  would be invisible to the five newer Pi4 hostnames unless loaded through a
  broader group, unnecessarily widening access.
  Date/Author: 2026-08-04 / Codex.

- Decision: keep backup SSH credentials outside Git and outside the general
  Ansible tree, mounting only one private-key file and one pinned known_hosts
  file with `create_host_path: false`.
  Rationale: repository preparation can enforce the runtime boundary without
  generating or distributing a production identity. Operational provisioning,
  authorized-key registration, and removal of existing `.ssh` backup targets
  remain separately approved changes.
  Date/Author: 2026-08-04 / Codex.

- Decision: exclude TalkPlaza files from all edits in this plan.
  Rationale: the approved repository boundary permits TalkPlaza local analysis
  only, and those files have independent hosts, credentials, and rollout
  ownership.
  Date/Author: 2026-08-04 / Codex.

- Decision: keep explicit development and test fixtures, but make every
  production path fail closed based on `NODE_ENV=production` or the production
  Compose/Ansible contract.
  Rationale: tests and local onboarding need deterministic fixtures. A
  development value becomes a production vulnerability only when production
  accepts it implicitly.
  Date/Author: 2026-08-04 / Codex.

- Decision: GitHub CI must validate a redacted copy of the Ansible tree rather
  than receive the production Vault password.
  Rationale: tracked ciphertext changes Ansible inventory parsing, but CI does
  not need and must not gain decryption authority. The redacted context removes
  every `host_vars/*/vault.yml` and injects obvious non-secret placeholders
  only for syntax and contract evaluation; the real deployment entrypoint
  continues to load the original encrypted files.
  Date/Author: 2026-08-04 / Codex.

- Decision: require a preflight proof for the shared due-management hash
  before removing the legacy comparison from a deployable release.
  Rationale: merging code is reversible, but deploying it without the row
  would lock operators out of assembly, self-inspection, and due-management
  functions that share this credential.
  Date/Author: 2026-08-04 / Codex.

- Decision: keep deterministic administrator and client fixtures only when
  the seed policy is non-production; production seed accepts neither missing
  credentials nor the E2E credential channel.
  Rationale: CI remains reproducible, while setting `NODE_ENV=production`
  cannot create the known administrator or synthetic client identities.
  Date/Author: 2026-08-04 / Codex.

- Decision: make due-management readiness an unconditional part of the
  production-ledger preflight after this change, rather than an operator-only
  checklist item.
  Rationale: a manual reminder cannot prevent a later release from reintroducing
  lockout. The query is read-only, secret-free, bounded to 20 seconds, and runs
  while the fleet lock is held before any release mutation.
  Date/Author: 2026-08-04 / Codex.

- Decision: keep PostgreSQL password values out of the role-bootstrap SQL and
  this repository-preparation commit.
  Rationale: the SQL accepts psql variables, the contract uses disposable test
  values, and real credential generation plus production ownership transfer is
  an operational mutation requiring its own approval and rollback evidence.
  Date/Author: 2026-08-04 / Codex.

## Outcomes & Retrospective

The first repository milestone is complete locally. All eight normal-factory
Vaults are encrypted and intended for tracking, the normal-factory inventory
contains only mandatory Vault references for the migrated credentials, and CI
can validate the inventory without receiving production decryption material.
Value-preserving round trips and actual local inventory parsing succeeded; no
secret value was printed or changed. Full deployment contracts passed with
Node 20 and left no run-owned Docker resources.

This is not operational rotation: the currently deployed credentials remain
unchanged and therefore must still be treated as previously exposed until the
separately approved per-device rotation is completed. Production bootstrap,
database roles, SSH authority, container privileges, and CA policy remain open
milestones. No host was contacted and no running service or database changed.

## Context and Orientation

Ansible inventory is the tracked description of factory hosts. A Vault file is
ordinary YAML encrypted by `ansible-vault`; its ciphertext begins with an
`$ANSIBLE_VAULT` header and can safely be tracked, while its password remains
outside Git. The normal factory uses
`infrastructure/ansible/inventory.yml` and host variables under
`infrastructure/ansible/host_vars/raspberrypi{3,4,5}`. TalkPlaza uses separate
hosts and is not modified here.

The Pi5 production stack is defined by
`infrastructure/docker/docker-compose.server.yml`. Ansible renders its
environment through `infrastructure/ansible/templates/docker.env.j2` and
`api.env.j2`. The API image comes from
`infrastructure/docker/Dockerfile.api`. Prisma migration commands currently
use the same database URL as the application, so role separation must update
the migration helpers and release contracts as well as Compose.

The browser client key is terminal identity, not a public application default.
`apps/web/src/lib/client-key/config.ts` currently supplies a fixed fallback;
URL configuration and local storage are the intended per-terminal sources.
The seed and registration script create or register matching `ClientDevice`
records. Production must not silently recreate these known identifiers.

The API's backup subsystem can copy server configuration and selected terminal
files. The current container gets the whole host SSH directory. The corrected
design gives it one dedicated identity file, one pinned `known_hosts` file,
and an explicit configuration path. Terminal private keys are regenerated
during recovery instead of being copied into archives.

## Plan of Work

First convert the three existing normal-factory plaintext Vault files and
create five exact-host encrypted Vault files without exposing
their contents. Produce ciphertext in a private temporary directory, verify
that decrypting it yields the same SHA-256 checksum as the original, replace
the local file atomically, set mode `0600`, and add narrow `.gitignore`
exceptions for only those eight ciphertext paths. Keep `.vault-pass` ignored.
Add host-specific identifiers for every currently literal terminal credential,
replace the inventory literals and known-key fallbacks with mandatory
`vault_*` references, and update example files with placeholders. Extend the
production secret validator so normal-factory `vault.yml` files must be
tracked ciphertext, the Vault password must remain untracked, and inventory
credential values must be references. Tests must report only paths and
identifiers, never values.

Next isolate seed and browser behavior. Introduce pure credential-resolution
helpers with tests. In production, seeding an administrator requires explicit
credentials; synthetic client devices are not created unless an explicit
test/development mode requests them. In non-production, current fixtures stay
available. Remove the production browser's fixed fallback while keeping
test-only keys injectable. Make `scripts/register-clients.sh` require an
explicit password or pre-issued token and default to TLS verification. Add a
preflight check proving the shared due-management password hash exists, then
remove the direct `2520` comparison and update the settings UI to report
`unconfigured` rather than `default active`.

Then add database role preparation. Production inputs become
`POSTGRES_SUPERUSER_PASSWORD`, `APP_DATABASE_URL`, and
`MIGRATION_DATABASE_URL`, all mandatory and without literal defaults.
Migration helpers use only the migration URL; the running API receives only
the application URL. A disposable PostgreSQL test creates roles and proves
the API role can execute ordinary application queries but cannot create roles,
create databases, or alter migration metadata outside its granted boundary.
No existing database is changed by this test.

Next add a dedicated backup SSH contract. Compose mounts only a private key and
`known_hosts` at explicit non-root paths. Backup targets use those paths and
strict host-key checking. Remove `.ssh` directories from recommended archive
targets and add tests that reject any private-key source or whole-directory
SSH mount.

Then make the images and Compose services least privilege. Create fixed
unprivileged users in the API and Web images, assign ownership only to required
paths, and set `user`, `cap_drop: [ALL]`, `security_opt:
[no-new-privileges:true]`, and `read_only: true`. Add explicit `tmpfs` and
volumes for Node, Chromium, Caddy, rendered files, alerts, backups, and
application storage. Run production images locally and exercise health,
Chromium-backed rendering, file upload/read, and backup discovery before
accepting this milestone.

Finally remove TLS bypass defaults and require `ADMIN_ALLOW_NETS`. Add
preflight validation that the allowlist is non-empty, contains loopback, and
contains the explicitly supplied current management network. Distribute the
CA and activate verification only in a later approved device rollout; the
repository tests use an isolated generated CA and loopback endpoints.

## Concrete Steps

Work from:

    cd /Users/tsudatakashi/RaspberryPiSystem_002

The exact starting branch and SHA are:

    git switch main
    git pull --ff-only origin main
    git switch -c hardening/production-secrets-and-runtime
    git rev-parse HEAD
    # ee04e8aba045fd18325f29d2099c27e4a2621d1d

Run focused tests after each milestone. The final local validation will include:

    python3 scripts/ci/validate_production_secret_structure.py
    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    pnpm --filter @raspi-system/api test
    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/web build
    bash scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check

Any Docker exercise records the container, volume, and network baseline first,
uses a unique label and names, and removes only resources bearing that label.
It never uses an existing database, container, volume, or network.

## Validation and Acceptance

The secret milestone is accepted when Git contains exactly eight encrypted
normal-factory Vault files, contains no Vault password, and the validator finds
zero normal-factory plaintext credential assignments. Decrypted ciphertext
checksums must match the pre-encryption files without printing either side.

The bootstrap milestone is accepted when production tests prove missing or
known-default administrator, client, due-management, database, JWT, and
allowlist inputs fail before traffic or mutation, while explicit test fixtures
continue to pass. No existing HTTP route or successful-response shape changes
except the documented due-management `unconfigured` state.

The database milestone is accepted when isolated tests prove application and
migration authority are distinct and the ordinary API role has no superuser,
role-creation, database-creation, or schema-owner privileges.

The SSH milestone is accepted when rendered Compose has no host `.ssh`
directory mount, strict host-key checking is mandatory, and backup catalogs
contain no terminal private-key target.

The runtime milestone is accepted when production API and Web images start as
non-root with all capabilities dropped, `no-new-privileges`, and read-only root
filesystems while health, storage, Chromium, backup, and Caddy tests succeed.

Repository preparation is not operational completion. Credential rotation,
database role activation, CA activation, and full production rollout need
their own approved run records. The ExecPlan remains in progress until the
effective change is merged to `origin/main` and any requested production
evidence records `mainIntegration.completionEligible=true`.

## Idempotence and Recovery

Vault conversion is checksum-verified before replacement and can be repeated
only when the input is plaintext. If verification fails, leave the original
file untouched and remove the run-owned temporary directory. Never invoke
`ansible-vault rekey` during this work.

All code changes are additive or replace explicit fallbacks with validated
inputs. They are split into focused commits so a failed milestone can be
reverted independently. Database tests use only disposable resources. No
production role, key, password, certificate, or row is changed.

## Artifacts and Notes

Record only classifications such as `encrypted`, `plaintext`, `reference`,
`missing`, `weak`, or `strong`. Do not place a secret value, password hash,
complete database URL, token, or private key in this plan, terminal logs, PR
text, test snapshots, or CI artifacts.

## Interfaces and Dependencies

Use the repository's installed `ansible-vault` command and the existing local
Vault password file only as an input file. Do not add a new secret manager or
runtime dependency. Use Node 20 or newer, pnpm, Vitest, Python unittest, Docker
Compose, PostgreSQL 15/pgvector, and the existing deployment-contract runner.

New validators must expose only deterministic path/identifier findings. New
production environment variables are parsed through the existing API env
boundary and rendered through the existing Ansible/Docker production config
contract. Internal helpers may be added, but public HTTP paths and database
business schema remain unchanged in this phase.

Revision note 2026-08-04: Created from the clean synchronized Phase 1 baseline
after identifier-only investigation. It fixes the normal-factory/TalkPlaza
boundary and separates repository preparation from every production mutation.

Revision note 2026-08-04: Completed and locally validated the value-preserving
normal-factory Vault migration and redacted CI Ansible context. Operational
secret rotation remains outside this repository-only milestone.
