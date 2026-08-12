---
id: ADR-20260728-change-aware-main-ci-and-server-web-ownership
title: Change-aware main CI and Pi5-owned Web build configuration
status: accepted
date: 2026-07-28
source_of_truth: true
scope: GitHub Actions change selection and deployment ownership for Pi5 Web build inputs
related_code:
  - .github/workflows/ci.yml
  - .github/workflows/codeql.yml
  - .github/workflows/gitleaks.yml
  - scripts/ci/classify_event_changes.py
  - scripts/ci/classify_changes.py
  - scripts/deploy/terminal-profile-registry.json
  - infrastructure/ansible/group_vars/server/web-build.yml
related_docs:
  - ../plans/deploy-workflow-safe-shortening-execplan.md
  - ../guides/ci-branch-protection.md
  - ../guides/deployment.md
validation: pure event and path fixtures, typed deployment-plan fixtures, complete deployment contracts, and required hosted CI
open_items:
  - production timing validation requires separate deployment approval
---

# ADR-20260728: Change-aware main CI and Pi5-owned Web build configuration

## Status

Accepted for implementation. Production deployment and device access are not
part of this decision.

## Context

The staged CI classifier already minimized pull-request jobs, but every push
to `main` forced the full suite. A documentation-only evidence commit
therefore repeated API, database, browser, Docker, and CodeQL work even though
the merge commit has an exact GitHub `before` and `head` boundary.

Pi5 Web build flags were also stored in the general inventory. A flag-only
change was consequently classified as fleet-wide, and unregistered Pi5
environment templates widened it further to `unknown`. The release planner
already supports a narrower typed result: mutate Pi5, activate and verify
Kiosk browsers, do not mutate Kiosk hosts, and exclude Signage.

## Decision

Pull-request CI uses the merge base. A push to `main` uses GitHub's exact
`before -> head` range only when both commits exist and `before` is an
ancestor of `head`. Merge-queue, manual, and scheduled runs remain full.
Missing or zero SHAs, non-ancestor history, rename, copy, delete, unknown
paths, workflow changes, and classifier errors remain fail-closed to the full
suite.

The 2026-08-13 amendment assigns source validation to pull requests and merge
queues. An exact `push main` uses the classification only to choose immutable
artifacts to build, scan, rehearse, sign, and publish. It does not repeat the
component tests, CodeQL analysis, or Gitleaks range that passed before merge.
The fixed checks still exist on main so release gates and ruleset names remain
stable.

CI and CodeQL use one event-classification module. The fixed required checks
remain `ci-required`, `codeql`, and `gitleaks`. A proven docs-only change keeps
those checks successful while omitting CodeQL analysis and unselected
component jobs. API and Web Docker image scans are selected independently.

Pi5 Web build values move to
`infrastructure/ansible/group_vars/server/web-build.yml`. That file, the two
Pi5 Web environment templates, and the server role receive ordered
`server-app` ownership in the existing registry. General inventory, common
roles, broad or unknown paths, and `.dockerignore` retain their wider
fail-closed meaning.

Release artifact identity, serial terminal processing, rollback, immutable
API/Web candidate pairing, and same-SHA proof remain intact. Runtime sampling
is bounded separately by the artifact-promotion decision and deployment guide.

## Consequences

Main pushes avoid repeating review jobs and spend time only on selected
production artifacts. A Web build-setting deployment plans Pi5 mutation plus
Kiosk activation and independent verification, without Pi4 Ansible mutation
or Pi3 work.

Path ownership and event handling are safety-critical registries. New or
ambiguous paths widen work until tests and an explicit ownership decision are
added. This favors a small false-positive cost over a false-negative release.

## Alternatives Considered

Keeping all main pushes full and repeating successful PR tests was rejected
because protected-main publication consumes reviewed content and needs proof
of the exact artifacts, not a second copy of the same source checks. Matching individual feature-flag names was
rejected because it would couple release planning to products instead of
ownership. Parallel terminal rollout, runtime flags, and promoting CI-built
images were deferred because each changes rollback or evidence boundaries.
