# KB-431: Alerts inbox silent JSON skips and retention

- Status: deployed 2026-10-30 (#2423); logrotate delivery fixed in a follow-up
- Scope: Pi5 API alerts inbox and kiosk security alert retention
- Date: 2026-10-30

## Context / Symptoms Or Trigger

Production investigation found approximately 10,000 undelivered alerts from December 2025 through October 2026. Most were csv-import failures, rkhunter warnings, Trivy detections, and ports-unexpected alerts. They never reached the Alert table or downstream Slack, admin dashboard, and kiosk chat delivery.

## Investigation / Root Cause

Writers produced invalid JSON until 2026-10-29. The ingestor used strict JSON parsing but logged read/parse skips only at debug, hiding the backlog during normal operation. Writers were fixed separately in PR #2378 (commit `f12e258e`).

The shared security logrotate template also treated the inbox as logs. Weekly rotation renamed JSON files to `.json.1`, and global `create` produced empty `.json` replacements: approximately 10,000 files of each kind accumulated. `.pi5-scheduler-leader` is operational state and must remain untouched.

## Fix / Prevention

- Warn with the file path on non-empty read/parse failures; retain strict JSON parsing and report an unparseable count in the ingest summary.
- With `ALERTS_DB_INGEST_ENABLED=true`, the API performs cleanup on the first ingest tick and at most once every 24 hours per process. Only direct regular files matching `^alert-.*\.json(\.1)?$` qualify. Delete empty files older than one day. Delete non-empty files older than 30 days only when strict JSON contains an id confirmed in the Alert table. `ALERTS_INBOX_RETENTION_DAYS` overrides the positive retention period; invalid values use 30 days. DB lookups are bounded to 100 ids; failed lookups keep the batch. Unparseable and un-ingested files remain.
- Remove alerts from the shared server/kiosk logrotate configuration.
- Kiosk root cron runs daily at 04:25 in `/opt/RaspberryPiSystem_002/alerts`, selecting direct regular `alert-*.json*` files. Delete empty files older than one day or files older than 30 days. Pi5 normally copies kiosk alerts within one day using a filename watermark.

Old undelivered files are archived on Pi5, not re-sent to Slack. This code change does not replay or archive production files.

## Validation

- `pnpm --filter @raspi-system/api exec vitest run src/services/alerts`: 7 files, 38 tests passed. A validation preload blocks sensitive-file reads, including dotenv loading.
- ESLint on the ingestor, cleanup helper, and their two test files: passed (exit 0).
- `ANSIBLE_LOCAL_TEMP=/tmp/alerts-ansible-local ANSIBLE_REMOTE_TEMP=/tmp/alerts-ansible-remote python3 -m pytest -q scripts/deploy/tests/test_security_logrotate_contract.py scripts/ci/tests`: 253 passed, 1 skipped (local logrotate unavailable). The first run failed two Ansible tests because the sandbox disallowed the default temporary directory; the temporary-directory override resolved both.
- `pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json`: blocked by unrelated assembly/shared-types declarations missing from reused local dependencies; no diagnostics in the changed alert files. Full API typecheck remains incomplete.

API tests cover strict parsing warnings, age boundaries, filename and file-type exclusions, DB membership, rotated files, batching, errors, and daily gating. Python contracts pin logrotate exclusions and kiosk cron path, pattern, depth, and ages.

## Production Result (2026-10-30)

- First cleanup on Pi5: deleted 10,163 empty files and 2,246 ingested files; kept 6,870 unparseable and 1,018 not-in-DB files. All eight kiosks have the cleanup cron and no alerts stanza.
- The 7,920 remaining pre-fix files (written before 2026-10-29 12:30 JST) were archived to `~denkon5sd02/alerts-undelivered-20261030.tar.gz` on Pi5 with a file list beside it, then removed from the inbox. They were not re-sent.
- The standard release runs the server role in `host-config-only` mode and skips `security.yml`, so Pi5's `/etc/logrotate.d/raspisys-security` kept the alerts stanza. The task moved to `malware.yml`; apply it with `playbooks/prepare-pi5-security-scans.yml`.
- A broken file stays in the newest-N ingest window for weeks, so the warning is now logged once per file per process.

## Open Items

The cleanup does not delete Alert database rows.

## References

- [Writer fix #2378](https://github.com/denkoushi/RaspberryPiSystem_002/pull/2378)
- [API cleanup](../../apps/api/src/services/alerts/alerts-inbox-cleanup.ts)
- [Ingestor](../../apps/api/src/services/alerts/alerts-ingestor.ts)
- [Kiosk schedule](../../infrastructure/ansible/roles/kiosk/tasks/package-integrity.yml)
