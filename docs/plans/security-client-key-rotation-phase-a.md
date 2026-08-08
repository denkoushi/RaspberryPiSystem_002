---
id: security-client-key-rotation-phase-a
status: in_progress
scope: Remove current Pi3 signage credential coupling and make the scheduled secret audit actionable without adding a rotation framework.
date: 2026-08-09
source_of_truth: this plan
related_code:
  - apps/api/src/services/signage/signage.renderer.ts
  - scripts/deploy/verify-phase12-real.sh
  - scripts/test/verify-signage-display.sh
  - scripts/test/verify-signage-layout-config.sh
related_docs:
  - docs/runbooks/security-hardening-remediation.md
  - docs/guides/api-key-policy.md
validation: focused API/Web/script tests, docs audit, diff check, branch-range Gitleaks, and redacted full-history Gitleaks
open_items: Phase B production rotation and Phase C historical fingerprint suppression require separate approval.
supersedes: none
superseded_by: none
---

# Phase A: Externalize client credentials and remove signage renderer coupling

This is a living ExecPlan and must remain current while the work is in progress. It follows `.agent/PLANS.md`, while current repository safety rules in `AGENTS.md` take precedence where historical plan wording differs.

## Purpose / Big Picture

The scheduled Secret scan currently reports five classified historical findings, including one still-active Pi3 signage credential. After this phase, the API signage renderer will identify the Pi3 through the existing stable `ClientStatus.clientId` instead of searching `ClientDevice` by a credential. Only the affected Pi3 signage verification inputs will be externalized; unrelated client-key definitions remain unchanged. Four confirmed false-positive or non-production historical findings will be handled narrowly so the scan remains useful. No new secret manager, rotation API, registry, adapter, or deployment framework will be introduced.

The user-visible proof is that the focused renderer test passes without an API key lookup, all current checkout occurrences of the production Pi3 key are absent except the two protected WIP files, scripts fail before network access when a required credential variable is missing, and redacted full-history Gitleaks reports only the intentionally retained active finding until Phase B rotation.

## Progress

- [x] (2026-08-09) Confirmed the clean worktree, exact `origin/main` `61c3d7f550182dad30120b7a06d81f61c2f5430e`, branch `security/externalize-client-keys`, repository instructions, and the untouched original-repository WIP boundary.
- [x] (2026-08-09) Confirmed the renderer currently looks up `ClientDevice` by a hard-coded credential, while inventory already supplies stable `status_agent_client_id` values and the API stores matching `ClientStatus.clientId` values.
- [x] (2026-08-09) Compared the local redacted Docker audit with the official scheduled Secret scan `31270755886`; the official event-native full-history scan reported exactly the five supplied fingerprints. The two extra NFC fixture results came from the local command/configuration difference and are not changed.
- [x] (2026-08-09) Created this living plan and applied the minimal renderer, focused-test, Pi3-only script, active-document, and archive-redaction edits. At that point no allowlist file had been added yet; the later allowlist remains limited to the four exact approved fingerprints.
- [x] (2026-08-09) Restored unrelated Pi4 client-key definitions and restored the NFC fixture after the official scheduled run reproduced only the supplied five findings.
- [x] (2026-08-09) Added exactly the four supplied false-positive fingerprints to `.gitleaksignore`; the active Pi3 fingerprint is absent.
- [x] (2026-08-09) Read-only rotation audit confirmed the three in-scope fields, confirmed the existing admin client PUT does not accept `apiKey`, and compared the two Pi3 Vault variables as `same` without exposing values.
- [x] (2026-08-09) Focused renderer test passed after generating existing Prisma/workspace clients; the two Web tests, three shell syntax checks, three missing-environment fail-closed checks, docs audit, and diff check passed.
- [x] (2026-08-09) Completed the read-only Vault, database-reference, and existing-operator-path rotation preparation. The audit is limited to the three handoff fields; no credential was generated, edited, revoked, or deployed in Phase A.
- [x] (2026-08-09) Completed the focused API/Web/script checks, docs audit, whitespace check, redacted current-tree scan, and the workflow-pinned v8.24.3 full-history Gitleaks scan. The official scheduled baseline contains the five supplied findings; after the four exact suppressions, the active Pi3 fingerprint remains unsuppressed. The pinned full-history scan reports three findings: the active Pi3 fingerprint plus two command/configuration-specific NFC fixture findings; they remain unchanged per scope.
- [ ] Self-review, split into two or three reviewable commits, push, create a Draft PR, and monitor hosted CI, CodeQL, and Gitleaks to terminal. Do not merge.

## Surprises & Discoveries

- Observation: `SignageRenderer.getClientSystemMetricsText()` uses a hard-coded Pi3 `apiKey` lookup before reading `statusClientId`.
  Evidence: `apps/api/src/services/signage/signage.renderer.ts` lines 1451-1469.
- Observation: the stable Pi3 identity already exists in Ansible inventory as `status_agent_client_id`, and the existing schema documents the `ClientStatus.clientId` relationship.
  Evidence: `infrastructure/ansible/inventory.yml`, `infrastructure/ansible/templates/status-agent.conf.j2`, and `apps/api/prisma/schema.prisma`.
- Observation: an isolated local Docker invocation reported two extra NFC `generic-api-key` results, but the official scheduled Secret scan did not report them.
  Evidence: official run `31270755886` used the event-native Gitleaks action and reported exactly the five supplied fingerprints; the NFC fixture is therefore restored and remains out of scope.
- Observation: Docker Gitleaks cannot use the linked-worktree `.git` pointer directly inside the container.
  Evidence: it resolved the worktree gitdir to a host path unavailable in `/repo`; the successful audit therefore uses a temporary full clone of the repository and never writes to the source worktrees.

## Decision Log

- Decision: use the existing stable Pi3 status identity directly in the renderer and remove the `ClientDevice.apiKey` lookup.
  Rationale: inventory, status-agent configuration, and `ClientStatus.clientId` already provide the identity; adding configuration or a new lookup abstraction would expand scope.
  Date/Author: 2026-08-09 / Codex.
- Decision: require environment variables in executable verification scripts before any network probe.
  Rationale: the scripts are operational callers and must fail closed without embedding credentials; the shell guard prints only variable names and never values.
  Date/Author: 2026-08-09 / Codex.
- Decision: allowlist only the four supplied false-positive fingerprints in Phase A, and do not allowlist the active Pi3 credential fingerprint.
  Rationale: the active key must remain visible until Phase B rotation and Phase C old-key 401 confirmation. The official scheduled scan is the authority for the five-item baseline; unrelated local-command findings are not broadened into this phase.
  Date/Author: 2026-08-09 / Codex.
- Decision: preserve `statusClientId` and existing Ansible Vault/signage role contracts unchanged.
  Rationale: stable identity is non-secret and already part of the standard deployment boundary; Phase A removes credential coupling rather than redesigning deployment.
  Date/Author: 2026-08-09 / Codex.
- Decision: treat Phase B rotation as a separate approval gate.
  Rationale: secret generation, Vault mutation, database mutation, SSH, and production deployment are explicitly outside this implementation phase.
  Date/Author: 2026-08-09 / Codex.

## Outcomes & Retrospective

This section remains open until the branch-range/full-history scan and final self-review finish. At completion it will record the exact commits, final redacted findings, test results, and the separate Phase B handoff.

## Context and Orientation

The repository is `/Users/tsudatakashi/Documents/Codex/2026-08-09/client-key-rotation`, on branch `security/externalize-client-keys`, based exactly on `origin/main` `61c3d7f550182dad30120b7a06d81f61c2f5430e`. The original repository `/Users/tsudatakashi/RaspberryPiSystem_002` is read-only and contains two pre-existing protected WIP files: `scripts/deploy/rolling_release/route_preflight.py` and `scripts/deploy/tests/test_route_preflight.py`. Neither this branch nor the original repository may modify those files.

The API signage renderer creates display images and adds Pi3 system metrics to some signage layouts. Its current metrics method first identifies the Pi3 by an API credential and then reads the matching `ClientStatus`. The existing Ansible inventory gives the Pi3 status agent the stable identity `raspberrypi3-signage1`; that identity is not a secret. The corrected method reads `ClientStatus` directly by that identity and retains the existing server-metrics fallback.

The active verification scripts call the API with client credentials. They must receive those values through explicitly named environment variables and must terminate before any ping, SSH, or curl operation when a required value is absent. This phase does not execute those scripts against hosts.

The scheduled Gitleaks workflow uses the repository's event-native Gitleaks action. The repository's pinned v8.24.3 image is used for manual branch-range validation. Phase A will add only the exact fingerprints for the supplied false positives: the public Discord numeric identifier, the local LLM model identifier, the provider string comparison, and the historical development/demo fixture. The active Pi3 credential fingerprint is deliberately not added.

## Plan of Work

First create the living plan and record the audit boundary. Then change `signage.renderer.ts` so `getClientSystemMetricsText()` performs one direct `ClientStatus.findUnique` call using the existing stable Pi3 status identity. Keep the existing null, missing-status, and exception fallbacks. Add a focused Vitest test that mocks the existing Prisma client and proves the method queries `ClientStatus` directly and never calls `ClientDevice.findUnique`; do not repeat any credential string in the test.

Next change only the affected Pi3 signage verification inputs to require `PI3_SIGNAGE_CLIENT_KEY` from the environment before any network reachability check. Restore and retain all unrelated Pi4 and other client-key definitions in the Phase 12 script. The two dedicated signage verification scripts use the same input name. No new secret storage or transport mechanism is added.

Replace the active documentation occurrences of the Pi3 credential with Vault-managed wording or an environment-variable placeholder appropriate to the command. Preserve stable client identifiers where they are explicitly non-secret. Redact the same credential from historical KB/archive material without rewriting the historical narrative. Keep the existing test fixture values unless the official scan reproduces them. Add only the four exact supplied false-positive fingerprints to `.gitleaksignore`, if the existing repository configuration requires that file; never add the active-key fingerprint or a broad path/regex rule.

Finally perform a read-only rotation-preparation audit. Compare only whether the two relevant Vault variables are the same or different, without printing values. Enumerate every schema, migration, query, JSON field, and service that references `ClientDevice.apiKey` or the associated client identity, and determine whether existing API/operator procedures can rotate the value in one transaction. Do not create a secret, edit Vault, alter a database, use SSH, or run a production deployment.

## Phase B rotation handoff (not executed in Phase A)

The existing database contract has exactly three rotation-relevant fields for this handoff: `ClientDevice.apiKey`, the nullable `ClientDevice.signagePreviewTargetApiKey`, and the `SignageSchedule.targetClientKeys` text array. The existing administrator `PUT /clients/:id` route updates device metadata but does not accept `apiKey`; the existing kiosk signage-preview PUT updates only `signagePreviewTargetApiKey`. Therefore Phase B must not add an API or rotation helper.

After a separate Phase B approval, an operator should generate the replacement credential in the secure operator environment, update the two existing Pi3 Vault variables together when the read-only comparison shows they are the same, and use the existing standard signage role to render the runtime configuration. In one existing database transaction, conditionally identify the Pi3 `ClientDevice` row by its current credential, replace that row's `apiKey`, replace matching `signagePreviewTargetApiKey` values, and replace exact matching entries in `SignageSchedule.targetClientKeys`. The transaction must verify that no old-key references remain and that the new key is present only in the intended three-field relationship. No schema, API, helper, registry, adapter, or compatibility layer is needed.

After the standard signage release, the operator must confirm the new credential authenticates the existing signage/status paths and the old credential receives HTTP 401. Only after that evidence may Phase C add the final historical fingerprint suppression for the old credential. Phase B and C are separate approvals; neither is executed by this plan.

## Concrete Steps

Work from `/Users/tsudatakashi/Documents/Codex/2026-08-09/client-key-rotation`.

    git status --short --branch
    git rev-parse HEAD
    git rev-parse origin/main
    git diff --name-only

Before every commit, confirm that only the intended files are changed and that the protected WIP paths are absent from the diff. Do not print files containing credentials without a redacting filter. Searches for the production key must output only filenames, counts, or redacted placeholders.

Run focused API tests with the repository toolchain, for example:

    cd apps/api
    pnpm vitest run src/services/signage/__tests__/signage-renderer-client-status.test.ts

Run the relevant Web fixture tests and shell syntax tests without host access:

    pnpm --dir apps/web vitest run src/lib/signageTargetClientDevices.test.ts src/pages/admin/SignagePreviewPage.test.tsx
    bash -n scripts/deploy/verify-phase12-real.sh scripts/test/verify-signage-display.sh scripts/test/verify-signage-layout-config.sh

Run the repository docs audit and whitespace check:

    node scripts/docs/audit-docs.mjs --write
    node scripts/docs/audit-docs.mjs --check
    git diff --check

Run the branch-range Gitleaks command through the pinned Docker image after the commits exist. Use a temporary clone or a mounted Git metadata path as needed, and retain only redacted rule/file/line summaries. A nonzero result is expected only when the active Pi3 fingerprint remains in the range; any unclassified additional finding is a stop condition.

Run the official event-native full-history Gitleaks scan or an exactly equivalent redacted invocation. Record only the finding count, rule IDs, file paths, line numbers, and fingerprints. The expected Phase A result is the active Pi3 credential finding plus no other findings. The four approved false-positive fingerprints must be suppressed exactly.

Run the standard relevant API, Web, Python, and shell contracts identified by the repository package scripts and CI workflow. Do not run `scripts/update-all-clients.sh`, any Ansible mutation, SSH, database mutation, Vault command, or production verification script against a host.

Split commits by intent, preferably as follows: (1) production credential dependency removal and focused tests; (2) the Pi3-only script guard, active documentation, historical redaction, and exact Gitleaks suppression; and (3) plan or strictly generated documentation inventory changes if the repository audit requires a separate generated update. Keep the net change deletion/minimal substitution oriented and add no new helper framework.

## Validation and Acceptance

Acceptance requires all of the following:

- `SignageRenderer` no longer contains a credential lookup for Pi3 metrics and its focused test proves the direct stable `ClientStatus` lookup plus existing fallback behavior.
- All executable scripts that send the affected client credential require explicit environment variables before network access and do not contain credential literals.
- The current checkout contains no real production Pi3 key outside the two protected WIP files; stable `statusClientId` values are allowed because they are not secrets.
- `.gitleaksignore`, if added, contains exactly the four supplied false-positive fingerprints and no active Pi3 credential fingerprint, path-wide exception, or regex-wide exception.
- The full-history redacted scan has no unexpected findings. The active Pi3 credential is still reported until Phase B; the four supplied false positives are suppressed exactly.
- Focused API/Web/script tests, relevant contracts, docs audit, and `git diff --check` pass. No test or command contacts managed hosts.
- The final worktree is clean and the local branch equals `origin/security/externalize-client-keys`. A Draft PR exists with hosted CI, CodeQL, and Gitleaks at terminal success or the repository’s allowed skip/neutral state. This Phase A PR is not merged.
- The final report records the exact commits, changed-file boundary, redacted scan summary, read-only Vault/DB findings, and a short Phase B rotation handoff. It explicitly states that no secret generation, Vault edit, DB mutation, SSH, or production deployment occurred.

## Idempotence and Recovery

All source edits are ordinary tracked-file changes and can be reapplied only after checking `git status`. If a test or scan fails, preserve the failing evidence in redacted form and fix only the corresponding scoped file. Do not reset, clean, rebase, force-push, or overwrite the original repository. Because no Vault, database, host, or production mutation occurs in this plan, recovery is limited to reverting the feature-branch commits before review if an implementation defect is found.

## Artifacts and Notes

The authoritative artifacts are this plan, the focused test, the two or three commits, the Draft PR, and the hosted check runs. Reports must contain only redacted values and rule/file/line metadata. Never place a credential in chat, a commit message, a PR title/body, a test output, a shell trace, or this plan.

## Interfaces and Dependencies

The production interface remains the existing Prisma client. `SignageRenderer.getClientSystemMetricsText()` continues to return `Promise<string | null>` and continues to fall back to server metrics when the stable Pi3 status is absent or unreadable. It must call the existing `prisma.clientStatus.findUnique({ where: { clientId: 'raspberrypi3-signage1' } })` relationship and must not add a new exported helper, schema field, registry, adapter, or secret-management dependency.

The script interface remains the existing shell commands and curl calls. The only new precondition is that each script receives its existing credential through an explicitly named environment variable; an unset variable exits before network access and prints only the variable name.

## Plan revision note

2026-08-09: Updated after comparing the local Docker scan with official scheduled run `31270755886`. The official event-native scan reproduced only the five supplied findings, so the NFC fixture remains unchanged and no extra allowlist or test cleanup was added. The Phase 12 script keeps all existing non-Pi3 client-key definitions; only `PI3_SIGNAGE_CLIENT_KEY` is newly required. The read-only rotation handoff is limited to the three existing database fields and one transaction; no API or helper is planned.
