# KB-415: AI security scan of the whole repository (2026-10) and the access-control fixes it led to

- Status: `active`
- Scope: API access control (`apps/api/src/routes/tools/loans`, `routes/backup/oauth.ts`, `routes/gmail/oauth.ts`, `routes/tools/employees`, `services/auth`, `routes/kiosk/production-schedule`), kiosk web due management, device credentials

## Context

On 2026-10-06 the whole repository was scanned at `c2e81fd7` with the Codex Security plugin (`codex-security` 0.1.31, Standard mode, read-only sandbox, model `gpt-6.1-sol`, reasoning effort `high`). The existing gates (Dependabot, pnpm audit, Gitleaks, GitHub secret scanning, CodeQL) look for known patterns; this scan was aimed at application-specific access-control and business-logic flaws that those gates do not see. Dependabot alerts and security updates were also enabled for the repository on the same day.

The scan inventoried 6,120 tracked files and reviewed 154 of them in full plus selective traces, so coverage is partial. It reported seven findings (six medium, one low) and seven unvalidated candidates. Each finding was re-read in the source by the coordinating agent before any work started. No exploit was executed.

This repository is public. Items that are not fixed yet are described here only by area.

## Symptoms Or Trigger

There was no incident. The trigger was a decision to add an AI review of the whole codebase in addition to the pattern-based gates.

## Investigation

The seven findings, by area:

1. Loan routes resolved the calling device without always verifying its device credential.
2. The backup and mail OAuth callbacks did not check the `state` value issued by the authorize step.
3. Employee list and detail responses included the tag id for the read-only role, and that id is accepted elsewhere as proof of identity.
4. The due-management password was checked only in the browser; the update routes did not check it.
5. Role changes trusted the role inside the access token and did not re-read the acting user.
6. Attribution of device telemetry (not fixed yet; details withheld).
7. File permissions on one provisioning path (not fixed yet; details withheld).

While reviewing finding 1 a larger issue surfaced: several fixes rely on the device credential being secret, and runbook item C-4 (`docs/runbooks/security-hardening-remediation.md`) was still open in production. That became the Phase B plan.

Findings 4, 6 and 7 were first stopped before implementation because the worker found legitimate callers that the obvious fix would break: the leader board updates two due-date routes without the password, kiosk pages and existing readers depend on the current behaviour. This is why each worker prompt required a caller survey before any edit.

## Root Cause

Access checks had been added route by route over time. Some routes checked that a credential existed without checking whose it was, one browser-side gate had no server-side counterpart, and one administrative action trusted a token claim that can be stale.

## Fix

| # | Change | PR | Commit on `main` |
| --- | --- | --- | --- |
| 1 | Loan routes always verify the device credential; a specified client id must belong to that device unless the device may act for others. The active-loan list keeps its signed-in path. | #1728 | `1d4222da` |
| 2 | OAuth callbacks accept only a server-issued, unexpired, single-use `state` for the same provider; authorize and callback routes are rate limited. | #1729 | `25d2b0d1` |
| 3 | Employee list and detail return no tag id to the read-only role. | #1730 | `01759b68` |
| 4 | The password check issues a 12-hour token bound to the operating device; eight due-management update routes require it. The two leader-board due-date routes are unchanged by decision of the system owner. | #1733 | `eaee54f3` |
| 5 | Role changes re-read the acting user inside the update transaction and proceed only for a current admin. | #1731 | `4f0d690a` |

Not fixed yet: finding 6 (needs an administrator way to change a device's telemetry binding first), finding 7 (must be paired with privilege for the client backup that reads the file), and device credential rotation (`docs/plans/security-client-key-rotation-phase-b.md`).

## Prevention

- Run the same whole-repository scan after large access-control changes and at least once a quarter; run a security review of the diff on pull requests that add or change routes.
- When a fix tightens authentication, the worker must first list every legitimate caller (kiosk web, agents, admin screens, verification scripts) and stop if one would break.
- CodeQL reports `js/missing-rate-limiting` when a newly added check makes a route's authorization visible to it. Give the route an explicit `config.rateLimit` rather than dismissing the alert (precedent `3e8e3129`, used again in #1729).
- A browser-side gate is not an access control. A password or role check that matters needs a server-side check on the routes it protects.

## Validation

- Target tests run locally before each PR: #1728 94, #1729 33, #1730 15, #1731 13, #1733 13 API and 21 web; type check and lint passed for each. PR CI and `main` CI for `eaee54f3` (CI, CodeQL, Secret scan, Torque Release Composition) succeeded.
- Production: standard release to `raspberrypi5` only, run `20261006-010315-3280d6`, `ActiveState=active`, `SubState=exited`, `Result=success`, `ExecMainStatus=0`, recap `ok=268 changed=31 unreachable=0 failed=0 skipped=47 rescued=0 ignored=0`; `GET /api/system/health` returned 200.
- On devices, confirmed by the system owner on 2026-10-06: tag loan and return on a kiosk; due management asks for the password and saves afterwards; the leader board changes a due date without the password; the admin loan list is shown.

## Open Items

- Findings 6 and 7, and the Phase B device credential rotation.
- Other responses that carry tag ids have not been reviewed in the same way; whether approval should require a physical scan at a kiosk is a design decision.
- `scripts/deploy/verify-phase12-real.sh` calls one of the routes gated by #1733 without a token.
- The seven unvalidated candidates from the scan have not been triaged.
- The scan artifacts are kept outside the repository in the Codex state directory of the machine that ran it (scan id `54dc7810-7da2-4823-9c72-a189bd180058`).

## References

- PRs #1728, #1729, #1730, #1731, #1733, #1734
- `docs/plans/security-client-key-rotation-phase-b.md`
- `docs/runbooks/security-hardening-remediation.md`
- [KB-393](./KB-393-security-hardening-audit-2026-07.md)
