# `main` ruleset contract

`main` is protected with one repository ruleset. The ruleset is applied only
after a representative pull request reports all three fixed checks below.

## Required settings

- Target: the repository default branch (`main`)
- Enforcement: active
- Pull request required: yes
- Required approving reviews: `0`
- Required status checks: `ci-required`, `codeql`, `gitleaks`
- Require branch to be up to date: no
- Force pushes: prohibited
- Branch deletion: prohibited

Conditional CI jobs such as `api`, `web`, and `deploy-contract` must not be
added as required checks. They can be intentionally skipped. `ci-required`
validates that every selected job succeeded and every non-selected job was
skipped.

The repository has no `develop` branch. Do not create a duplicate protection
rule for it.

## Verification

Read the repository ruleset back through the GitHub settings UI or REST API.
Confirm the exact required-check names and that strict/up-to-date status checks
are disabled. The current implementation evidence is recorded only in
[`docs/plans/deployment-foundation-refactor-execplan.md`](../docs/plans/deployment-foundation-refactor-execplan.md).
