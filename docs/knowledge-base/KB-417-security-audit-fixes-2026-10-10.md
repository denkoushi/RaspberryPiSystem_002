# KB-417: Security audit fixes of 2026-10-10 (log redaction, backup path, PIN counter, dependency updates)

- Status: `active`
- Scope: API (request logging, health output, local backup storage, kiosk operation password, business Hermes MCP key check), Web dependencies, Pi4 barcode agent default bind address, status-agent configuration file mode

## Context

A security audit of this repository ran on 2026-10-10 and found no critical item. The items that were small and clearly bounded were fixed in one pull request, [#1914](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1914), merged to `main` as `46ccddf6` on 2026-10-10 14:14 JST and released to the Pi5 the same day.

This repository is public. This record names what was changed and where it was released, and leaves out anything that would help an attacker with an item that is still open.

## Symptoms Or Trigger

No incident. The audit was a planned review.

## Investigation

The audit read the code and configuration only. It did not change any device.

Two CI failures on the pull request are worth recording because both came from repository rules, not from the code under test:

- `change-classification` failed with `PR body must contain exactly one Deploy impact table`. Every other job was skipped as a result, so the pull request looked as if nothing had been tested.
- After the table was added, `repo-policy` failed with `pnpm override dompurify@3.4.11: metadata is missing`. A new pnpm override needs a matching entry in `security/dependency-exceptions.json`.

Adding that entry changed a path under `security/`, which made the classifier infer the `auth` surface. The Deploy impact table had to declare `auth` as well, or the first check would have failed again.

## Root Cause

Not applicable to the audit items as a group. For the CI failures: the pull request was opened without the Deploy impact table and without the dependency exception metadata.

## Fix

Changes in [#1914](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1914):

- Dependencies moved to fixed releases (`react-router-dom` and several pnpm overrides).
- The local backup storage provider keeps its destination inside the backup directory.
- Failed attempts at the kiosk operation password are counted with one counter per terminal.
- Header values used for authentication are replaced with `[REDACTED]` before a request is logged, and the matching settings are left out of the health output.
- The business Hermes MCP key is compared in constant time.
- The barcode agent listens on `127.0.0.1` by default instead of `0.0.0.0`.
- `/etc/raspi-status-agent.conf` is written with mode `0600` instead of `0644` by the `client` and `server` roles. The status agent runs as root, so it can still read the file.

## Prevention

- Fill in the Deploy impact table from `.github/pull_request_template.md` when opening a pull request, and validate it before pushing with `scripts/ci/validate_deploy_impact.py` against the output of `scripts/ci/classify_event_changes.py`.
- When adding a pnpm override, add its entry to `security/dependency-exceptions.json` in the same commit and run `python3 scripts/ci/validate_dependency_exceptions.py`.
- A change under `security/` adds the `auth` surface to the classification. Re-run the Deploy impact validation after any late change to the file list.

## Validation

- CI on the pull request head `614ebc86`: 34 jobs passed, none failed.
- Release to the Pi5 only (standard release, run ID `20261010-054710-83e6fa`, 14:47 to 14:56 JST): reported as success with no failed task, and `/`, `/admin`, `/kiosk` and `/api/system/health` answered 200.
- Log redaction on the Pi5 after the release: about 36,800 lines of API container log since 14:56 JST were read. No line held an unredacted value for any of the nine authentication headers, no line held a bearer token or a JWT, and 2,919 lines carried `[REDACTED]`. Only counts were read; no value was printed.

## Open Items

- The kiosk operation password counter was not exercised on a real terminal, because failed attempts would lock that terminal for a while.
- The barcode agent change reaches a kiosk only when that kiosk is released. One kiosk has the barcode agent enabled (`barcode_agent_enabled: true` in `infrastructure/ansible/inventory.yml`). No host sets `barcode_agent_rest_host`, and the production Web build connects through `localhost` (`group_vars/server/web-build.yml`), so no production path depends on the old bind address. After that release, check `http://127.0.0.1:7072/api/agent/status` and one barcode read.
- The `0600` mode on the Pi5 is not applied by the standard release: `roles/server/tasks/status-agent.yml` runs only when `server_release_mode` is `full`, and the standard release uses `host-config-only`. It needs a separate apply.
- The `0600` mode on the Pi4 kiosks and the Pi3 reaches each device at its next release.
- The audit items that were not small enough for this pull request are tracked outside this public repository.

## References

- Pull request: [#1914](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1914), merge commit `46ccddf6`
- Related: [KB-415](./KB-415-ai-security-scan-2026-10.md), [KB-416](./KB-416-outside-intrusion-resilience-2026-10.md)
- Code: `apps/api/src/lib/log-headers.ts`, `apps/api/src/lib/kiosk-settings-pin.ts`, `apps/api/src/services/backup/storage/local-storage.provider.ts`, `clients/barcode-agent/barcode_agent/config.py`
- CI contracts: `scripts/ci/deploy_impact_contract.py`, `scripts/ci/validate_dependency_exceptions.py`
