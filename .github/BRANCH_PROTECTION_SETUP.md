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

Pull requests use the shared classifier to select source validation. Exact
`main` pushes use it only to select publication artifacts; successful PR
tests, CodeQL analysis, and Gitleaks scanning are not repeated. The three fixed
check names remain present on both events, while exact published artifacts are
built and scanned on `main`. See
[`ADR-20260728`](../docs/decisions/ADR-20260728-change-aware-main-ci-and-server-web-ownership.md).

The repository has no `develop` branch. Do not create a duplicate protection
rule for it.

## Verification

Read the repository ruleset back through the GitHub settings UI or REST API.
Confirm the exact required-check names and that strict/up-to-date status checks
are disabled. The current implementation evidence is recorded only in
[`docs/plans/deployment-foundation-refactor-execplan.md`](../docs/plans/deployment-foundation-refactor-execplan.md).
