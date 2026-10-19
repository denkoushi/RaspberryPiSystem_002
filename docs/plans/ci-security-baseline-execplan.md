# Establish CI and security regression guardrails

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: ci-security-baseline-execplan
- status: complete
- scope: CI authentication coverage, torque-agent checks, coverage floors, dependency automation, exception metadata, and plaintext-secret structure contracts
- started: 2026-08-03
- branch: `hardening/ci-security-baseline`
- baseline_sha: `28eb3625a64b82e7a58390992d66a38520335e95`
- integration: pending; push, PR, merge, and deployment require separate approval

## Purpose / Big Picture

Later production hardening changes will alter credentials, runtime permissions, backup behavior, and authentication. This first phase strengthens the regression gates before those risky changes begin. A contributor will be able to see successful administrator login and MFA behavior exercised in CI, torque-agent code checked on every relevant change, coverage prevented from silently falling, dependency updates proposed automatically, and production configuration rejected when a new credential-shaped plaintext value is introduced.

This phase does not rotate a secret, connect to production, change a database schema, deploy a host, or change a public application contract. It only adds tests, CI policy, dependency automation, and redacted structural validation.

## Progress

- [x] (2026-08-03) Confirmed clean synchronized `main` at `28eb3625a64b82e7a58390992d66a38520335e95`, Node.js 20.20.2, and Docker counts of 0 containers, 17 volumes, and 3 networks.
- [x] (2026-08-03) Created local branch `hardening/ci-security-baseline`; no push was performed.
- [x] (2026-08-03) Recorded authentication E2E, torque-agent, API/Web coverage, CI classification, and exception-policy baselines using isolated resources.
- [x] (2026-08-03) Made successful login and MFA browser tests deterministic and mandatory in CI without production credentials; all six focused browser paths pass without skip.
- [x] (2026-08-03) Added torque-agent pytest and Ruff checks to the change-aware client CI path; the local isolated run passes 51 tests and Ruff.
- [x] (2026-08-03) Set API and Web coverage floors from the measured baseline and enforce them on pull requests.
- [x] (2026-08-03) Added weekly grouped Dependabot configuration for pnpm, GitHub Actions, Docker, and Poetry.
- [x] (2026-08-03) Added machine-checked owner, reason, and expiry metadata for vulnerability ignores and dependency overrides.
- [x] (2026-08-03) Added a redacted production-config structure contract that rejects new credential-shaped plaintext values.
- [x] (2026-08-03) Completed focused and aggregate validation, refreshed the documentation inventory, and removed the uniquely named test container, volume, and network; Docker returned to 0 containers, 17 volumes, and 3 networks.

## Surprises & Discoveries

- Observation: The workstation default Node.js is older than the repository requirement, while Homebrew Node.js 20.20.2 is available.
  Evidence: The baseline used `PATH=/opt/homebrew/opt/node@20/bin:$PATH` and reported `v20.20.2`.

- Observation: Current production host vault files exist locally but are ignored and are not Ansible Vault ciphertext.
  Evidence: Only their first line was classified; no value was displayed. Secret migration and rotation remain Phase 2 and are deliberately excluded from this branch.

- Observation: `test.skip(process.env.CI, title, callback)` caused the authentication spec to report three skipped tests in CI, rather than merely skipping the successful-login case as its comments claimed.
  Evidence: The isolated baseline reported three skipped tests. After replacing this registration with a normal test and external credentials, four authentication paths and two MFA paths execute and pass.

- Observation: The MFA smoke route glob `**/api/**` also intercepted Vite source modules below `src/api/`, leaving a blank page. The successful-login assertion also expected UI text that no longer exists.
  Evidence: The Playwright trace showed JavaScript modules served as JSON; the authenticated screenshot showed the current dashboard and external test username. The route is now origin-root `/api/` only and the assertion uses the authenticated username.

- Observation: The first API coverage retry failed broadly because the disposable database password used by the command did not match the disposable container; a later two-test storage failure was caused by mismatched test-only storage aliases.
  Evidence: A focused Prisma failure reported authentication failure, and a focused storage rerun passed after `FILE_STORAGE_ROOT`, `PDF_STORAGE_DIR`, and `PHOTO_STORAGE_DIR` were made identical. No production or existing database was involved.

- Observation: API coverage is statements 70.90%, branches 58.46%, functions 77.78%, and lines 72.00%; Web coverage is statements 62.91%, branches 59.67%, functions 56.00%, and lines 64.21% in the final thresholded run.
  Evidence: API completed 479 files and 2,515 tests with the existing 2-file/7-test skip set. Web completed 332 files and 1,671 tests. Initial floors are API 69/57/76/71 and Web 61/58/55/63.

- Observation: Reusing one test storage root across interrupted/full API runs can leave integrity-catalog state that makes six direct-file drawing tests return 503.
  Evidence: The six tests passed alone against a new unique storage root, and the subsequent complete thresholded run passed against another unique root. Final API coverage was statements 70.97%, branches 58.54%, functions 77.89%, and lines 72.07%. This branch does not change application storage behavior.

## Decision Log

- Decision: Implement regression guardrails before production credential and runtime changes.
  Rationale: The later phases are materially riskier; deterministic CI and fail-closed configuration checks reduce the chance that an operational change reaches production with an undetected regression.
  Date/Author: 2026-08-03 / Codex

- Decision: Keep all credentials in tests synthetic and supplied through explicit test-only environment variables.
  Rationale: CI must not rely on `admin1234`, repository inventory values, local vault files, or any production secret.
  Date/Author: 2026-08-03 / Codex

- Decision: Report only the path, variable name, and classification from secret structure checks.
  Rationale: A failing security test must not reproduce a secret in logs or artifacts.
  Date/Author: 2026-08-03 / Codex

- Decision: Generate a fresh synthetic E2E password inside each GitHub Actions job and pass it through `GITHUB_ENV` to both seed and Playwright.
  Rationale: The login happy path remains deterministic without committing a reusable password or relying on a production/default credential.
  Date/Author: 2026-08-03 / Codex

- Decision: Enforce API coverage thresholds on the complete pull-request run, but not independently on each one-third main-branch shard.
  Rationale: A shard cannot satisfy a meaningful repository-wide floor by itself. Pull requests run the complete suite and therefore provide the regression gate; main shards retain diagnostic coverage artifacts.
  Date/Author: 2026-08-03 / Codex

- Decision: Freeze existing credential-shaped plaintext by path, identifier, syntax, and occurrence count without storing value hashes.
  Rationale: This makes any new occurrence fail while avoiding weak-secret hash disclosure. Phase 2 will remove the baseline allowances as secrets are encrypted and rotated.
  Date/Author: 2026-08-03 / Codex

## Outcomes & Retrospective

Phase 1 implementation and local verification are complete on the local feature branch. Push, PR, merge, deployment, and every production mutation remain behind their separately approved gates. This phase adds mandatory browser coverage for successful authentication and MFA persistence, complete pull-request API coverage with measured floors, Web coverage floors, torque-agent pytest/Ruff, weekly grouped Dependabot updates, accountable dependency-exception metadata, and a redacted plaintext-secret regression contract.

The focused authentication/MFA run passed 6 tests with no skip. API passed 479 files and 2,515 tests with the unchanged 2-file/7-test skip set and enforced coverage floors. Web passed 332 files and 1,671 tests with enforced floors. Torque-agent passed 51 tests and Ruff. Repository policy passed 70 tests. Node 20 API/Web builds and workspace lint passed. The standard local deploy contract completed all checks, including isolated PostgreSQL cleanup.

No production host, existing database, schema, migration, public API, production inventory value, or local vault content was changed. The current plaintext findings are frozen by redacted structural identity and occurrence count; they remain Phase 2 debt and are not represented as fixed.

The documentation audit is current, `git diff --check` passes, and the standard deploy-contract suite passes without contacting a managed host. The disposable PostgreSQL container, volume, and network were deleted by exact name. Final Docker counts match the recorded baseline: 0 containers, 17 volumes, and 3 networks. Phase 2 must not begin from this branch; it starts only after this phase is reviewed and integrated into an updated clean `main`.

## Context and Orientation

The repository is a pnpm monorepo. Browser tests live under `e2e/` and use `playwright.config.ts`. GitHub Actions are defined in `.github/workflows/ci.yml`, where a change-classification job decides whether API, Web, client, deploy, and E2E jobs run. API coverage uses Vitest and V8 through `apps/api/vitest.config.ts`; Web tests use the Web package's Vitest configuration. The Python torque-wrench bridge is `clients/torque-agent`, managed by Poetry and tested with pytest.

Production Ansible data begins at `infrastructure/ansible/inventory.yml`. Host-specific secret examples already use `vault_*` names, but actual secret migration belongs to Phase 2. This phase adds a structural validator that recognizes secret-bearing fields and permits only encrypted vault files, explicit external-variable references, empty optional values, or documented non-secret test fixtures. It never prints the right-hand-side value.

## Plan of Work

First record the existing behavior. Run the authentication browser tests in the same isolated PostgreSQL environment used by CI and confirm that successful login and MFA cases are skipped. Run torque-agent pytest and Ruff directly. Run complete API and Web coverage against isolated resources and record the four V8 percentages. The initial floor for each metric is the integer floor of the measured percentage minus one point.

Then make browser authentication deterministic. Production seed defaults must not be changed in this phase, but the seed path will accept explicit E2E-only username and password variables. GitHub Actions will pass synthetic values to the seed and Playwright process. The successful login test will use those variables, wait on the login response and authenticated user bootstrap rather than timing alone, and contain no CI skip. MFA smoke tests already mock the API; remove their CI skips and use accessible password selectors that work in Chromium.

Add torque-agent installation, pytest, and Ruff to the existing client job, and update change classification so edits below `clients/torque-agent` select that job. Add API and Web coverage commands to pull-request CI and configure the measured floors in Vitest. Coverage artifacts remain diagnostic, while a floor violation fails the job.

Add `.github/dependabot.yml` with weekly grouped updates for the workspace, Actions, Dockerfiles, and the torque-agent Poetry project. Create a small machine-readable exception ledger for `.trivyignore` and pnpm overrides. Every current entry must have an owner, reason, and ISO expiry date; CI compares the ledger to the effective ignore/override set and fails for missing or expired metadata.

Finally add a Python standard-library structure test for production configuration. It scans tracked inventory, Ansible YAML/templates, production build configuration, seed defaults, and registration scripts. It allows known test fixtures and external references, but rejects a new credential-shaped scalar or forbidden production default. Failure output contains no matched value. Wire it into the existing repository-policy or deploy-contract path, run all focused checks and the relevant aggregate suites, refresh the document inventory, and clean only resources created by this phase.

## Concrete Steps

Run commands from `/Users/tsudatakashi/RaspberryPiSystem_002` with Node 20 first in `PATH`:

    export PATH=/opt/homebrew/opt/node@20/bin:$PATH
    node --version

Use uniquely named PostgreSQL 15/pgvector resources bound to loopback for API and E2E baselines. Never use an existing database URL. Run torque-agent commands from its directory with an isolated virtual environment or Poetry environment. At each milestone run the closest focused tests, `git diff --check`, and `git status --short`.

The final validation commands will include the authentication Playwright spec, Web and API coverage, torque-agent pytest and Ruff, the new policy tests, full API and Web suites, build, lint, deploy contracts where classification or deployment policy changed, and documentation audit. Exact commands and observed counts will be added as the implementation establishes them.

## Validation and Acceptance

Acceptance requires that valid administrator login, invalid login, unauthenticated redirect, and both MFA remember-me paths run in CI with no conditional skip. Test credentials must be synthetic and absent from production defaults. Torque-agent pytest and Ruff must run when its source, tests, lockfile, or CI configuration changes.

API and Web coverage must meet the recorded floors on pull requests. Dependabot must validate and cover all four selected ecosystems. Every effective Trivy ignore and pnpm override must have unexpired metadata. The plaintext-secret structure test must fail on an injected credential-like literal while redacting its value, and it must pass on vault references and synthetic fixtures.

No existing test may be deleted or newly skipped. No Prisma schema, migration, public HTTP contract, production inventory value, local vault content, host, service, or production data may change. Final Docker counts must equal 0 containers, 17 volumes, and 3 networks, with no phase-labelled residue.

## Idempotence and Recovery

All source work is confined to the local feature branch and is split into cohesive commits after focused tests pass. Isolated containers, volumes, and networks use a unique phase label and are removed by exact name. If the coverage baseline or E2E environment fails before implementation, stop and distinguish an environment defect from a repository defect. If a CI guard creates excessive unrelated scope, revert only that guard's commit rather than weakening other checks.

## Artifacts and Notes

Baseline repository evidence:

    main/head: 28eb3625a64b82e7a58390992d66a38520335e95
    Node.js: v20.20.2
    Docker: 0 containers, 17 volumes, 3 networks
    successful auth E2E: conditionally skipped in CI
    MFA remember-me E2E: conditionally skipped in CI
    torque-agent CI reference: absent
    Dependabot/Renovate: absent
    coverage thresholds: absent

Measured baseline and implemented floors:

    API tests: 479 files / 2515 tests passed; 2 files / 7 tests skipped
    API final coverage: statements 70.97, branches 58.54, functions 77.89, lines 72.07
    API floors: statements 69, branches 57, functions 76, lines 71
    Web tests: 332 files / 1671 tests passed
    Web coverage: statements 62.91, branches 59.67, functions 56.00, lines 64.21
    Web floors: statements 61, branches 58, functions 55, lines 63
    Authentication/MFA focused E2E: 6 passed, 0 skipped
    torque-agent: 51 passed; Ruff passed

## Interfaces and Dependencies

This phase may change test-only seed inputs, Playwright environment inputs, Vitest coverage configuration, CI jobs, Dependabot configuration, and repository-policy scripts. It must use the existing Node, pnpm, Vitest, Playwright, Poetry, pytest, Ruff, Python standard library, and GitHub Actions toolchain. It must not add an application runtime dependency or change any production API response, database model, route, or user-visible behavior.

Revision note (2026-08-03): Created from the clean synchronized baseline to implement Phase 1 of the approved long-term hardening roadmap. Updated after all focused and aggregate checks passed and disposable resources were removed. Local implementation is complete; main integration, production mutations, and later phases remain explicitly out of scope.
