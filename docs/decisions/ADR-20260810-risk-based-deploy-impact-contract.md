---
id: ADR-20260810-risk-based-deploy-impact-contract
title: Risk-based Deploy impact declaration as a lightweight PR contract
status: accepted
date: 2026-08-10
source_of_truth: true
scope: pull-request Deploy impact declaration and change-aware CI validation
related_code:
  - scripts/ci/classify_event_changes.py
  - scripts/ci/deploy_impact_contract.py
  - scripts/ci/validate_deploy_impact.py
  - scripts/deploy/terminal_profile_registry.py
  - .github/workflows/ci.yml
related_docs:
  - ../plans/risk-based-four-stage-quality-gates-execplan.md
  - ../guides/ci-branch-protection.md
validation: pure contract fixtures, current schemaVersion 6 event fixtures, and existing deployment contracts
open_items: []
---

# ADR-20260810: Risk-based Deploy impact declaration as a lightweight PR contract

## Context

The repository already classifies changed paths, selects CI jobs, checks Deploy
readiness, builds exact artifacts, and runs runtime/rollback/cleanup contracts.
The missing evidence is a short record of the developer's intended Deploy
impact. A declaration must catch omissions without becoming a second CI
classifier or a new deployment framework.

## Decision

- The existing `classify_event_changes.py` output, schemaVersion 6, remains the
  only authority for selecting CI jobs. The PR table can never reduce those
  jobs.
- A single marker-bounded Markdown table in the PR body records risk, target
  machines, changed surfaces, artifacts, database, secrets/config delivery,
  success evidence, rollback/cleanup, and production verification.
- The validator rejects missing or duplicate rows, placeholders, unjustified
  `N/A`/`none`/`no`, risk or target under-declaration, and database `no` when a
  database surface is inferred. Safer over-declaration is accepted.
- Surface inference treats only explicit documentation paths (`docs/`,
  README/Markdown, `.cursor/`, `.agent/`, and PR templates) as `docs`. An
  otherwise empty surface, package metadata/lockfile, or non-documentation
  full-suite reason becomes `unknown` rather than silently becoming docs. The
  `.cursor/`, `.agent/`, and PR-template paths retain surface `docs`, but an
  actual classifier `unknown path` fail-closed reason raises their minimum
  risk to `unknown`.
- Unknown, delete, rename, copy, and unsupported status changes fail closed to
  `unknown`. Target inference reuses only the static
  `terminal_profile_registry`; no public CLI or retired terminal coordinator
  is restored.
- Validation runs only for `pull_request` events, including `edited`, while
  pushes, merge groups, schedules, and manual runs retain their existing
  automatic classification behavior.

## Consequences

Every PR carries concise, reviewable Deploy intent. A typo or omission blocks
the classification job before expensive conditional jobs start, while
over-reporting preserves all automatic checks. The table is documentation plus
a pure contract; it does not add a ruleset, production mutation, secret value,
database migration, or bespoke Deploy control plane.

## Completion evidence

- PR #1232 passed with head `d2e73a67a7860b89c377ab1048c24c68c6be6011` and
  merged into main as `eeb27ca0db6d3908936d1f33518901167e30cc32`.
- PR CI `31343451376`, main CI `31344178115`, CodeQL `31344178134`, and
  Secret scan `31344178120` passed. Release/runtime/security gates also
  passed, including release-set subject digest
  `sha256:f6693b24a28edcbda1c2c93b8046f914aebc1446828daadb913241e3bd956835`.
- No ruleset mutation, production Deploy, SSH, DB/Vault operation, or real
  device operation was performed. Production verification is `N/A` because
  this contract has no production runtime target.

## Alternatives considered

Restoring the retired `classify-deploy-impact.py` and terminal coordinator was
rejected because the current main branch intentionally removed that execution
closure and has no caller. Duplicating CI classification in YAML or a new
Deploy service was rejected because two authorities would drift. Introducing
OPA, TUF, RAUC, Molecule, or a custom deployment framework was rejected as
unrelated to the observed omission and unnecessarily heavy.
