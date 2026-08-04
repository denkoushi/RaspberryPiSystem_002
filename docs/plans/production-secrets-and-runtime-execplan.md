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
  - merge the backup-SSH-authority preflight hotfix, pass exact-main CI, and rerun the full-fleet read-only preflight
  - obtain a separate approval before retrying the standard production rollout, then verify its run status and a no-op print-plan
  - credential rotation, database role migration, CA rollout, and production deployment require separate evidence and approval gates
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
- [x] (2026-08-04 08:53+09:00) Made API/Web containers non-root with dropped capabilities,
  `no-new-privileges`, read-only root filesystems, and enumerated writable
  mounts. Runtime UID/GID follows the Pi5 operator account, and standard host
  convergence stops before runtime replacement if existing writable trees are
  incompatible.
- [x] (2026-08-04 08:53+09:00) Added an explicit one-time permission migration
  Playbook. Recursive ownership changes require a dedicated boolean approval;
  they are not performed by the standard release. Existing `backup.json` is
  converged to owner-only access for the non-root API.
- [x] (2026-08-04 08:53+09:00) Built the Web image and proved ordinary Caddy
  and the Blue/Green slot template run as non-root on a read-only rootfs with
  all capabilities dropped. An existing bounded API image passed Chromium
  rendering, Ansible, `pg_dump`, NDL OCR, and RapidOCR probes under the same
  constraints. All run-owned containers and the temporary Web image were
  removed.
- [x] (2026-08-04 08:53+09:00) Replaced the API's general Ansible-tree mount
  with a root-managed, credential-free client inventory and only two backup
  Playbooks. This preserves backup operation after Vault encryption without
  granting the API a Vault password or application credentials.
- [x] (2026-08-04 09:10+09:00) Re-ran the complete Node 20 deployment contract
  suite for the container milestone. All lifecycle and safety contracts, 969
  Python deployment tests, 43 Ansible contracts, redacted Ansible syntax
  checks (including the gated permission migration), and both isolated
  PostgreSQL contracts passed. Run-owned Docker resources returned to zero.
- [x] (2026-08-04 09:18+09:00) Removed the Caddy administrator-network
  fallback from production, local, and Blue/Green runtime definitions. Added
  a separately approved one-time policy preparer and a remote read-only
  preflight that rejects missing, malformed, overbroad, or management-source-
  excluding CIDRs before fetch, checkout, or service mutation.
- [x] (2026-08-04 09:20+09:00) Added normal-factory-only, separately approved
  stages for CA trust distribution and CA-signed Pi5 certificate placement,
  plus a read-only client probe that retains hostname and certificate
  verification. The stages checksum inputs and restore prior files on failure;
  none were run against a managed host.
- [x] (2026-08-04 09:34+09:00) Passed 93 CI structure tests, 971 deployment
  Python tests, all shell and Blue/Green safety contracts, 43 Ansible
  contracts, syntax checks for all gated policy/CA Playbooks, and both
  isolated PostgreSQL contracts. Disposable Docker resources returned to zero.
- [ ] Require local CA verification and an explicit `ADMIN_ALLOW_NETS` value,
  with preflight rejection before any production mutation. Repository controls
  are prepared; this remains open until CA distribution, Pi5 certificate
  activation, all-client verification, and the evidence-gated removal of the
  current normal-factory TLS exceptions are separately approved and completed.
- [x] (2026-08-04 09:35+09:00) Ran focused and aggregate tests, audited the
  complete local diff, updated this plan, and left the worktree free of
  run-owned Docker resources.
- [ ] Push or prepare a Draft PR. Push, PR creation, merge, and operational
  rollout remain unapproved.
- [x] (2026-08-04 09:45+09:00) Opened Draft PR #1170. Its first `db-infra`
  run exposed a CI-only mismatch: the production-mode API probe still used
  `postgres/postgres`, so the new fail-closed validation correctly rejected
  startup. Updated that job to bootstrap the existing least-privilege roles,
  generate masked per-run credentials, and start the API as `raspi_app`.
- [x] (2026-08-04 09:46+09:00) Passed all 94 CI structure tests, 13 API
  environment contracts, and the isolated PostgreSQL application/migration
  role boundary after the workflow correction. Disposable resources returned
  to zero.
- [x] (2026-08-04 09:57+09:00) PR #1170 passed all hosted checks and merged to
  `origin/main` as `dbe4542346d8cc63b1690f8c2bb48ff466ba3270`. The synchronized
  local main was clean before operational read-only planning began.
- [x] (2026-08-04 10:02+09:00) The first merged-main `--print-plan` stopped
  locally before any host connection because the dedicated read-only Ansible
  config still discovered encrypted `host_vars/*/vault.yml` files without a
  Vault password. Added a failing real-Ansible regression test, then changed
  the planner to use the existing redacted context boundary in an automatically
  removed temporary directory.
- [x] (2026-08-04 10:25+09:00) Made the shared redacted-context helper
  independent of the caller's working directory after the aggregate contract
  reproduced the issue. The complete deployment contract then passed: 103
  Ansible templates, shell and Blue/Green safety contracts, Web production
  build, 972 deployment Python tests, 43 Ansible contracts, and both isolated
  PostgreSQL contracts. Temporary labelled Docker resources returned to zero.
- [x] (2026-08-04 11:20+09:00) Merged the read-only planning correction as PR
  #1171 at `ff72a753d9f6f91866b89f3d140bef5675e48ecd`; hosted CI and CodeQL
  passed. Synchronized main and reran `--print-plan` before the approved
  production preflight.
- [x] (2026-08-04 11:45+09:00) With separate approval, bootstrapped the Pi5
  `ADMIN_ALLOW_NETS` value through the rollback-safe one-time Playbook. The
  live management source was inside the explicit list and Compose validation
  passed without restarting a service or submitting a release.
- [x] (2026-08-04 11:55+09:00) Confirmed the operator-configured shared
  due-management password by presence of its production hash only. Migration,
  Pi5 route, candidate-object, resource, and external dependency preflights
  then passed; no credential value was read or emitted.
- [x] (2026-08-04 12:20+09:00) Read-only terminal diagnosis proved the
  StoneBase barcode container and status API healthy while the intentionally
  detached `/dev/ttyACM0` device remained absent. Pi3 Tailscale, TCP/22, SSH,
  sudo, and Python probes passed. With separate approval, renewed only the
  StoneBase barcode maintenance lease through 2026-08-11 02:15Z; ordinary
  fail-closed device health resumes automatically at expiry.
- [x] (2026-08-04 12:30+09:00) Validated the bounded lease with 118 focused
  maintenance, terminal-preflight, adapter, and template tests, real encrypted
  inventory expansion, docs audit, and the complete Node 20 deployment
  contract. The aggregate suite passed 972 deployment Python tests, 43 Ansible
  contracts, Web production build, Blue/Green safety, and both isolated
  PostgreSQL contracts; run-owned Docker resources returned to zero.
- [x] Merge the read-only planning correction, synchronize main, rerun
  `--print-plan`, and present its exact host scope before any approved
  `--preflight-only` connection.
- [x] (2026-08-04 11:55+09:00) Merged the bounded StoneBase maintenance lease
  as PR #1172 at `913edf973ea08ff99beaf48fd20c61e1cffcb678`. Exact-main CI,
  CodeQL, secret scanning, and the approved production `--preflight-only` run
  passed for Pi5 and all seven terminals without submitting a release.
- [x] (2026-08-04 12:07+09:00) Started the separately approved standard
  release. It failed closed during host configuration because existing Pi5
  storage, config, and backup trees were not recursively writable by the new
  non-root runtime. No candidate image, migration, slot, gateway, or terminal
  mutation occurred; the active blue API and database remained healthy.
- [x] (2026-08-04 12:16+09:00) With separate approval, ran the one-time
  `prepare-pi5-runtime-permissions.yml` gate. All six enumerated writable roots
  passed the post-change non-root read/write/execute probe, with no symlinks in
  the three previously blocked trees.
- [x] (2026-08-04 12:33+09:00) Retried the standard release. Signed ARM64 API
  and Web artifacts passed attestation, pull, provenance, and immutable
  promotion, then candidate preparation failed closed before inactive-slot
  startup because generic `envsubst` converted Caddy's
  `{$ADMIN_ALLOW_NETS}` placeholder into invalid `{}`. Runtime health samples
  recorded zero API errors, traffic never switched, terminals stayed pending,
  and no run-labelled container, volume, or network remained.
- [x] (2026-08-04 12:36+09:00) Created
  `hotfix/pi5-caddy-admin-allowlist-validation` from the exact clean main SHA,
  removed generic substitution from local-TLS Caddy startup, passed only the
  Compose-resolved Web allowlist to candidate validation, and added regression
  coverage. Focused lifecycle, non-root boundary, and real Caddy parser tests
  pass locally.
- [x] (2026-08-04 12:47+09:00) Passed the complete Node 20 deployment
  contract: 103 Ansible templates, Web production build and real Caddy parser,
  Blue/Green and rollback safety, 972 Python deployment tests, 43 Ansible
  contracts, and both isolated PostgreSQL contracts. All run-owned PostgreSQL
  and Web-test Docker resources were removed.
- [x] (2026-08-04 13:02+09:00) Merged the Caddy allowlist correction as PR
  #1173 at `537d93e8de9889012f8595e95ffc980238b76243`. Exact-main CI,
  CodeQL, secret scanning, ARM64 release images, and release-set generation all
  passed; local main was synchronized and clean.
- [x] (2026-08-04 13:20+09:00) The approved full-fleet read-only preflight
  passed Pi5 authority, all 157 migration checksums, every external dependency,
  and all six Pi4 terminals, but failed closed three times on the Pi3 terminal
  SSH transport. No release unit or production mutation was created.
- [x] (2026-08-04 13:28+09:00) Bounded read-only diagnosis showed that short
  Pi5-to-Pi3 SSH commands succeed while uncompressed inputs at 512 KiB fail on
  both Tailscale and LAN paths. The exact 208,116-byte candidate helper set
  transferred successfully with SSH compression. Added the minimal
  `Compression=yes` transport option and a focused regression contract on
  branch `hotfix/pi3-terminal-preflight-ssh-compression`.
- [x] (2026-08-04 13:36+09:00) The complete local deployment contract passed
  with the SSH-compression regression included. The run covered Blue/Green,
  rollback, migration, fleet, Ansible, Caddy, and isolated PostgreSQL
  contracts; every run-owned Docker resource reported cleanup to zero.
- [x] (2026-08-04 13:52+09:00) Merged the Pi3 compression correction as PR
  #1174 at `c51b6c7e35c500f7fb8d31e67a4caff37d8270ef`. Exact-main CI,
  CodeQL, secret scanning, ARM64 API/Web images, and the signed release set
  passed. The approved full-fleet read-only preflight then passed Pi5, all 157
  migrations, all external dependencies, all six Pi4 terminals, and Pi3.
- [x] (2026-08-04 14:07+09:00) Started the separately approved standard
  release as run `20260804-045746-0230ae`. It failed closed during Pi5
  candidate creation because the new dedicated backup SSH private-key bind
  source did not exist. No candidate slot, migration, gateway switch, or
  terminal mutation occurred; the active blue API/Web remained healthy.
- [x] (2026-08-04 14:20+09:00) Created branch
  `hotfix/backup-ssh-authority-preflight` from the exact clean main SHA. Added
  owner/type/mode/content-shape checks for the dedicated key and pinned host
  file to the Pi5 route preflight, plus exact readiness issue codes and a Git
  ignore boundary for the runtime-only authority.
- [x] (2026-08-04 14:24+09:00) Passed 25 focused boundary tests and the
  complete local deployment contract: Web production build, Blue/Green and
  rollback safety, 974 deployment Python tests, 43 Ansible contracts, and both
  isolated PostgreSQL contracts. Run-owned Docker resources returned to zero.
- [x] (2026-08-04 14:29+09:00) With separate approval, generated one dedicated
  Ed25519 backup identity on Pi5, pinned only host records independently
  matched through the existing authenticated route, added its public key to
  the six configured backup targets one at a time, and proved dedicated-key
  read-only SSH to every target. The old identity and active containers were
  retained, no service was restarted, and the production Git worktree stayed
  clean.
- [ ] Push and open a Draft PR for the backup-authority preflight correction.
  Push, PR creation, merge, exact-main CI, read-only production preflight, and
  the production retry remain separate gates.

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

- Observation: read-only tmpfs mounts default to root ownership even when the
  container process is non-root.
  Evidence: the first isolated Caddy run correctly failed to open its log on a
  root-owned tmpfs. Explicit UID/GID mount options fixed the boundary, after
  which both normal and slot Caddy startup succeeded without capabilities.

- Observation: encrypting normal-factory host Vault files makes the general
  inventory unsuitable for an API process that does not possess the Vault
  password.
  Evidence: client backup needs only host aliases, resolved addresses, and SSH
  users. A generated inventory containing exactly those fields avoids both a
  backup regression and expansion of API secret authority.

- Observation: the local Caddy template had no `/admin*` network matcher while
  production Caddy and Compose silently supplied a broad default.
  Evidence: local runtime would expose the administrator SPA to every source
  reaching port 443, and a missing Compose variable was indistinguishable from
  an intentional allowlist. All runtimes now consume one required value.

- Observation: flipping agent TLS flags in the repository before CA trust and
  a SAN-bearing Pi5 certificate exist would turn a security fix into a fleet
  outage.
  Evidence: normal-factory status and torque agents still contain explicit
  transitional exceptions. The repository deliberately leaves them unchanged
  until the new read-only verification Playbook succeeds on every target.

- Observation: the read-only Ansible configuration removed Vault password
  discovery but did not prevent Ansible from loading encrypted host Vaults.
  Evidence: merged-main `--print-plan` exited before host access, and a bounded
  diagnostic classified Ansible's exit as `vault_secret_missing`. A real
  encrypted-host-vars regression test reproduced the same failure without
  emitting the encrypted value or password.

- Observation: a helper imported through the repository namespace can pass
  unit tests from the repository root yet fail when the contract runner starts
  it from another working directory.
  Evidence: the first aggregate run reached the rollback contracts and failed
  with `ModuleNotFoundError: No module named 'scripts'`; a subprocess test now
  runs the CLI from a temporary outside-repository directory, and the helper
  establishes its repository root before importing the shared primitive.

- Observation: generic POSIX `envsubst` and Caddy's `{$NAME}` environment
  placeholder syntax are not composable.
  Evidence: the approved release reached candidate Caddy validation with the
  required allowlist stored, but `envsubst` consumed `$ADMIN_ALLOW_NETS` first
  and left literal `{}` at line 33. The same generic substitution existed in
  the local-TLS runtime command, so bypassing candidate validation would have
  produced the same startup failure.

- Observation: the Pi5 lifecycle fixture did not contain the now-mandatory
  administrator allowlist.
  Evidence: the focused baseline test stopped in Compose interpolation before
  exercising candidate validation. Adding an explicit non-secret fixture value
  makes the test exercise the production-shaped contract instead of depending
  on an ambient environment variable.

- Observation: the resource-constrained Pi3 can accept short SSH commands but
  intermittently drops the larger candidate-owned preflight envelope.
  Evidence: three standard read-only preflights failed only the Pi3 transport;
  64 KiB transferred, 512 KiB failed through both Tailscale and LAN, and the
  exact 208,116-byte candidate helper set passed when SSH compression was
  enabled. Pi3 load was below 1, SSH was active, and Pi5-to-Pi3 Tailscale and
  TCP/22 reachability were present.

- Observation: candidate Compose bind-source validation occurred after the
  release unit had already started, while the Pi5 route preflight did not
  inspect the dedicated backup SSH authority.
  Evidence: run `20260804-045746-0230ae` passed the full read-only preflight and
  artifact promotion, then failed before candidate creation on the absent
  private-key bind source. Traffic, migrations, and terminals were unchanged.

- Observation: the default backup authority path is inside the production Git
  checkout but was not ignored.
  Evidence: `git check-ignore` initially returned no rule for either mounted
  file. Creating the approved runtime identity without a narrow ignore rule
  would have made the production checkout dirty and blocked later releases.

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

- Decision: fail the standard release on incompatible writable-tree ownership
  and keep recursive ownership migration behind a separate explicit gate.
  Rationale: silently running recursive `chown` during release preparation can
  add unbounded delay and mixes data mutation with container activation. A
  separately approved idempotent migration is observable and reversible by
  applying the prior owner if needed.
  Date/Author: 2026-08-04 / Codex.

- Decision: bootstrap `ADMIN_ALLOW_NETS` through one explicit rollback-safe
  Playbook, then make every ordinary release prove the stored allowlist still
  contains its live SSH management source.
  Rationale: the candidate release cannot safely create the prerequisite after
  its own preflight, and a static list cannot prove that the current operator
  will retain access.
  Date/Author: 2026-08-04 / Codex.

- Decision: keep CA trust, server-certificate placement, runtime restart, and
  client verification as distinct operational gates; remove TLS exceptions
  only in a later evidence-backed repository change.
  Rationale: every intermediate stage preserves the current connection path
  and has a narrow rollback boundary. TalkPlaza remains outside the workflow.
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

- Decision: make production read-only inventory planning consume the same
  redacted Ansible-tree primitive as CI instead of decrypting Vaults.
  Rationale: host selection needs addresses, groups, and non-secret release
  metadata, not credential values. Excluding `host_vars/*/vault.yml` and
  `.vault-pass` in an automatically deleted temporary copy preserves the
  no-secret planning boundary and avoids granting `--print-plan` decryption
  authority.
  Date/Author: 2026-08-04 / Codex.

- Decision: let Caddy expand `{$ADMIN_ALLOW_NETS}` itself and remove generic
  substitution only from the local-TLS branch. Candidate validation resolves
  the Web service's effective allowlist through `docker compose config` and
  passes that one non-secret value to the isolated Web container.
  Rationale: this preserves Caddy's native multi-CIDR token expansion, avoids
  exposing the API's database and authentication environment to a Web
  validation container, and leaves slot upstream substitution unchanged.
  Date/Author: 2026-08-04 / Codex.

- Decision: enable OpenSSH compression only on the candidate-owned terminal
  preflight transport.
  Rationale: the envelope is source text and compresses well, while the target
  command, input limit, timeout, authentication, privilege boundary, probe
  content, and result marker remain unchanged. This avoids a Pi3 service or
  network configuration mutation and does not weaken any readiness gate.
  Date/Author: 2026-08-04 / Codex.

- Decision: make the Pi5 route preflight require the exact dedicated backup
  SSH directory, private key, and pinned host file before a release unit can be
  submitted, and ignore only `/secrets/backup-ssh/` at the repository root.
  Rationale: Compose must never discover a missing bind source after artifact
  promotion. Exact ownership and modes prevent a permissive or linked file
  from satisfying the gate, while the narrow ignore rule keeps runtime secret
  material out of Git without hiding unrelated files.
  Date/Author: 2026-08-04 / Codex.

- Decision: retain the legacy Pi5 SSH identity while introducing the dedicated
  backup identity additively, and do not restart the API until exact-main
  preflight passes.
  Rationale: each target can be verified independently with the new key while
  the currently running API keeps its existing recovery path. Removal of the
  broad legacy mount belongs only after a successful standard deployment and
  backup verification.
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

The repository implementation, bounded maintenance lease, and Caddy correction
are now merged, but the first production rollout is not complete. The approved
one-time ownership migration resolved the first fail-closed gate and the Caddy
correction resolved the second. The subsequent exact-main full-fleet preflight
correctly withheld release submission because the Pi3 could not reliably
receive the candidate-owned probe envelope without SSH compression. The
existing blue slot remained healthy throughout and no database migration or
terminal activation occurred.

The Pi3 transport correction is now integrated and its full-fleet preflight
passed. The subsequent standard rollout exposed one additional fail-closed
gap: backup SSH bind sources were not part of the early route gate. The new
preflight correction passes all local contracts, and the separately approved
dedicated identity is staged and verified on all six configured backup targets
without removing legacy authority or restarting a service. Operational rollout
is still incomplete until this correction is integrated, exact-main preflight
passes, and a separately approved standard release succeeds.

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

Revision note 2026-08-04: Recorded the merged-main read-only planning failure
and the minimal redacted-context correction required before production
preflight. No managed host was contacted and no production state changed.

Revision note 2026-08-04: Recorded the cwd-independent helper correction and
the successful complete local deployment contract. All run-owned Docker
resources were removed; main integration and production preflight remain open.

Revision note 2026-08-04: Recorded the merged-main preflight, the approved
one-time Pi5 ownership migration, the fail-closed Caddy candidate incident,
and the minimal local hotfix. Full local contracts now pass; main integration
and production retry remain open.
