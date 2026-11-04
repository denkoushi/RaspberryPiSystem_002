# Runbook: Security hardening remediation (Batch C — operator actions)

## Metadata

| Field | Value |
|-------|-------|
| id | RB-security-hardening-remediation |
| status | active |
| scope | Operator-side remediation of audit findings that require secret rotation, config change, or Pi redeploy |
| date | 2026-07-02 |
| source_of_truth | this file |
| related_docs | [KB-393](../knowledge-base/KB-393-security-hardening-audit-2026-07.md), [KB-415](../knowledge-base/KB-415-ai-security-scan-2026-10.md), [KB-416](../knowledge-base/KB-416-outside-intrusion-resilience-2026-10.md), [KB-417](../knowledge-base/KB-417-security-audit-fixes-2026-10-10.md), [deployment.md](../guides/deployment.md), [api-key-policy.md](../guides/api-key-policy.md) |

## When to use

The code-level fixes in KB-393 (Batch A/B) are **deployed to production** (PR #948 → main `b1172baf`, 2026-07-02, real-device verify PASS 45/0/0). The items below are the remaining **Batch C** operator actions. They change secrets/config/runtime and **can break running kiosks if done carelessly**, so each is gated on explicit operator go-ahead and staged (change → verify → next). Do NOT run these automatically. Each item lists risk and a verification step.

> **状態（2026-11-04 時点）**: 各項目の Status 行を正とする。C-10〜C-12 は完了済み（記録は KB-393 へ移設）。C-1・C-5・C-6 はコード上対応済みで、本番反映日は運用者の確認待ち。

> Safety: take a DB/config backup before secret rotation. Do one item at a time and verify the kiosk borrow/return flow after each.

## C-1. Remove host SSH private key from API container (Critical)

- File: `infrastructure/docker/docker-compose.server.yml` (mount `~/.ssh:/root/.ssh:ro`).
- Action: remove the mount; if backup needs SSH, use a dedicated least-privilege deploy key on a narrow path, or move backup transport off SSH.
- Risk: backup/Ansible-from-container features break if they relied on the key. Verify backup job after change.
- Status (2026-11-04): code side done. `docker-compose.server.yml` no longer mounts the whole `~/.ssh`; it binds only the backup-only key `/run/secrets/backup-ssh/id_ed25519` (and its `known_hosts`) read-only. The production API runs as the blue/green `api-blue`/`api-green` services in `docker-compose.phase3.yml`, which bind the same backup-only key; `docker-compose.server.yml` is used in production only for `db` and volume definitions. Production rollout date: to be confirmed by the operator.

## C-2. PostgreSQL password (Critical)

- Repository preparation separates `raspi_app`, `raspi_migrator`, and the DB
  bootstrap credential. Runtime API receives only `raspi_app`; Prisma runs in
  an ephemeral migration container; known defaults fail closed.
- Operational order: verify a backup no older than 24 hours → separately
  approve and run `prepare-pi5-database-roles.yml` → standard release → verify
  API and kiosk operations → rotate the retained `postgres` rollback credential
  only after the release is stable.
- Never place migration or bootstrap authority in the ordinary API environment.
- Verify: API health, representative kiosk read/write, backup `pg_dump`, Prisma
  status, and rejection of DDL/migration-ledger writes by `raspi_app`.

## C-3. NFC agent reboot/poweroff + bind address (Critical)

- Status: code correction is on main (`REST_HOST` defaults to `127.0.0.1`; `main.py` has no flush/reboot/poweroff routes). Production rollout date: to be confirmed by the operator.
- Files: `clients/nfc-agent/nfc_agent/main.py`, `config.py`, `resend_worker.py`, `infrastructure/ansible/templates/nfc-agent.env.j2`.
- Correction: bind REST/WebSocket to `127.0.0.1`; remove unused flush, reboot, and poweroff routes; compile the kiosk Web bundle with the audited local-only NFC contract; delete queued events only after successful browser delivery.
- Remaining hardening: replacing the existing privileged container/device access is outside this change and still needs a separately staged design.
- Verify: status and WebSocket are loopback-only; removed routes return 404; browser readiness proves `readerConnected=true` and `queueSize=0` twice; a physical NFC scan drives the kiosk after separately approved rollout.
- Source of truth: [KB-403](../knowledge-base/KB-403-production-config-contract-and-nfc-health.md) and [ADR-20260729](../decisions/ADR-20260729-fail-closed-production-config-and-terminal-health.md).

## C-4. Predictable client keys / admin1234 (High)

- Files: `apps/api/prisma/seed.ts` (`admin`/`admin1234`, `client-*-key`), `apps/web/src/lib/client-key/config.ts` (fallback key), `infrastructure/ansible/inventory.yml` (plaintext keys), `scripts/register-clients.sh` (default admin pw), `docs/guides/api-key-policy.md` (real keys in docs).
- Action: per-device high-entropy `x-client-key` stored in vault and rotated; make `VITE_DEFAULT_CLIENT_KEY` required in production web build; production seed must not create `admin1234` (force first-run random + change); scrub real keys from docs.
- Risk: rotating a client key breaks that kiosk until its config/URL is updated. Rotate one device at a time.
- Status (2026-10-06): every production device row has a per-device random credential; evidence and remaining closeout items are in [security-client-key-rotation-phase-b.md](../plans/security-client-key-rotation-phase-b.md).
- Verify: old key returns 401; new key works on the target kiosk.

## C-5. Legacy due-management PIN `2520` (High)

- File: `apps/api/src/services/production-schedule/production-schedule-settings.service.ts` (`LEGACY_DUE_MANAGEMENT_PASSWORD`).
- Precondition: set a real hashed password via the settings upsert (`setDueManagementPassword`) for the `shared` location first.
- Action: after a password is configured, remove the `if (!config) return { success: password === '2520' }` fallback so no hardcoded PIN remains. Rate limiting is already applied (KB-393).
- Risk: removing the fallback before a password is configured locks operators out of due-management / self-inspection approval. Configure first, then remove.
- Verify: `2520` no longer succeeds; the configured PIN does.
- Status (2026-11-04): code side done. The `2520` fallback is gone from production code under `apps/api/src` (test helpers only); `verifyDueManagementAccessPassword` returns `{ success: false }` when no config exists. Production rollout date: to be confirmed by the operator.

## C-6. Container de-root & hardening (High)

- Files: `Dockerfile.api`, `Dockerfile.web`, `docker-compose.server.yml`, `docker-compose.phase3.yml` (production blue/green API/Web).
- Action: add non-root `USER`; `cap_drop: ALL` + minimal caps; `security_opt: [no-new-privileges:true]`; read-only rootfs with tmpfs/volumes for writable paths; slim the API image (remove Ansible/Playwright if not needed at runtime).
- Risk: file-permission/writable-path breakage. Test in staging compose before Pi.
- Status (2026-11-04): code side done. `Dockerfile.api` uses `USER node`, `Dockerfile.web` uses `USER caddy`, and the compose services set `read_only: true`, `cap_drop: [ALL]` and `no-new-privileges:true`. Production rollout date: to be confirmed by the operator.

## C-7. Admin IP allowlist on local TLS (High)

- Repository preparation complete: local/production Caddy use the same
  `@admin_protect`, Compose has no fallback, and standard preflight verifies the
  current management source before mutation.
- Blue/Green correction (2026-10-01): the gateway and slot templates never had
  `@admin_protect`, so production served `/admin` to every source reaching 443
  (confirmed on the live gateway Caddyfile). The gateway now denies `/admin*`
  outside the allowlist; see
  [phase9-10-specifications.md](../security/phase9-10-specifications.md) for the
  mechanism. Verified in production on 2026-10-01 (allowed source 200, Docker
  network source 403); the temporary legacy route fixture has been removed.
- Operational action still gated: run the separately approved
  `prepare-pi5-admin-network-policy.yml` once before deploying the new contract.
- Risk: wrong CIDR locks admins out of `/admin`; the preparer rejects a list that
  omits its live SSH source and restores the previous `.env` if Compose validation fails.

## C-8. TLS verify defaults (High/Medium)

- Files: `clients/haizen-agent/haizen_agent/config.py` (default `insecure`), `raspi-haizen-agent.conf.j2`, `inventory*.yml` (`status_agent_tls_skip_verify`), `scripts/register-clients.sh` (`CURL_INSECURE`).
- Action: distribute an internal CA (or pin), flip defaults to `system`/verify. Stage per site.
- Risk: verification failures if CA not yet distributed. Distribute CA before flipping.
- Repository preparation: CA trust distribution, Pi5 certificate staging, and
  verified read-only health are separate normal-factory-only approval gates.
  TLS exception removal remains intentionally blocked until all-host evidence exists.

## C-9. Query-string API keys / metrics / backup-health (Medium)

- Action: accept keys via header only (drop `?key=`/`?clientKey=` in signage/webrtc + kiosk URL); require auth (or localhost) on `/system/metrics` and internal backup health.
- Risk: signage/webrtc/kiosk bootstrapping may rely on the query param — migrate to header/localStorage first.

## C-10〜C-12（完了済み）

完了記録は [KB-393 の「Batch C 完了記録（runbook から移設）」](../knowledge-base/KB-393-security-hardening-audit-2026-07.md#batch-c-完了記録runbook-から移設) へ移した。

## C-13. Pi4 agent least-privilege mode (client_agents_hardened)

`client_agents_hardened` is a per-terminal inventory boolean, defaulting to `false` in both the `client` and `release_kiosk` roles.
The default uses the legacy privileged device/mount configuration and explicitly runs all three agents as `0:0`, even though the images
have a default user of `10001:10001`. The static client Compose is the legacy reference; the release template selects the mode.

When enabled, NFC, barcode and torque run as `10001:10001`, drop all capabilities and use `no-new-privileges:true`, with no added
capabilities. Host networking, service/profile selection, environment files, restart policies and health checks are unchanged.

- NFC adds numeric groups `46` (plugdev) and `104` (input), permits character majors 189 (USB) and 13 (input), and binds `/dev/bus/usb`
  and `/dev/input` read-only. It retains `/run/pcscd:ro` and mounts its named volume at both `/data` and `/app/nfc-agent/data` to preserve
  the relative queue-path default, including when using previous images.
- Barcode adds group `20` (dialout), permits majors 166 (ttyACM) and 188 (ttyUSB), and binds `/dev:ro`. Serial nodes live directly in
  `/dev`; the parent bind supports unplugged startup, replacement nodes and `/dev/serial` links without container recreation.
- Torque adds group `104` (input), permits major 13, and binds `/dev/input:ro`. Exact wrench udev rules add `GROUP="input", MODE="0660"`.
  The root host guard uses group `10001` and runtime directory `root:10001`, mode `0770`, for non-root intent writes.
- Device cgroup rules allow `rw` without `m`; read-only binds prevent directory changes while allowing permitted device I/O.

Prepare each terminal before enabling:

1. Check `getent group plugdev dialout input` against GIDs `46/20/104`. The repository does not provision these numeric IDs. If they
   differ, resolve the mismatch before enabling; do not assume group names alone grant access.
2. Check `stat -Lc '%a %u %g %n'` on the actual USB, input and serial nodes. USB must grant plugdev access, serial must grant dialout
   access, and torque/optional TS100 HID must grant input access. Do not use world-writable device permissions.
3. Verify the installed `/run/pcscd/pcscd.comm` socket mode and actual card access as the agent user. The existing polkit rule allows
   PC/SC access. A socket restricted to `0660` needs its actual numeric GID added to NFC's hardened `group_add` before enabling;
   retain restricted socket permissions.
4. Stop the affected agents and back up persistent queues. Identify the actual NFC/torque named volumes with `docker inspect`, without
   guessing project prefixes. Use a maintenance container to `chown -R 10001:10001 /data` on each existing volume, including SQLite
   sidecars. New volumes inherit image ownership and mode `0750`; image ownership does not change existing volumes. Preserve any NFC
   queue held at `./data` inside the old container and copy it into the named volume before recreation covers that path.
5. For torque, install the updated guard helper and render its unit and wrench udev rules with the terminal's hardened setting.
   Reload systemd, restart the guard, reload/retrigger udev and verify `/run/torque-bluetooth-guard` is `root:10001`, mode `0770`, and the
   exact wrench nodes are `input`, mode `0660`, before starting the hardened container. Controller identity selection remains unchanged.

Enable only the prepared terminal by setting `client_agents_hardened: true` in that terminal's inventory host vars. Follow the standard
release procedure in [deployment.md](../guides/deployment.md), inspect its plan and limit the release to that exact host:

```bash
scripts/update-all-clients.sh <release-branch> infrastructure/ansible/inventory.yml --print-plan --limit <terminal-host>
scripts/update-all-clients.sh <release-branch> infrastructure/ansible/inventory.yml --limit <terminal-host>
```

Verify on that Pi4:

1. Inspect each container: user `10001:10001`, privileged false, `CapDrop` includes `ALL`, no `CapAdd`, and `SecurityOpt` includes
   `no-new-privileges`. Check the exact supplementary groups, device cgroup rules and read-only binds; confirm queue writes as that user.
2. Read an NFC card through the host pcscd and confirm kiosk delivery and queue writes. If TS100 is enabled, check its configured
   `/dev/input/by-id/...` reader too.
3. Start barcode with the reader unplugged, plug in and scan, then unplug/re-plug and scan without recreating the container. Check the
   configured ttyACM/ttyUSB and `/dev/serial` paths.
4. Capture a torque value with exclusive evdev ownership. Verify lease intent updates and guard status, including disconnect and
   lease-expiry fail-closed behavior. Run `curl -fsS http://127.0.0.1:7073/health` and confirm `ok: true`.
5. Recreate/restart the agents and repeat hardware checks and queue persistence checks. Exercise release rollback: the release template
   also renders with previous images, which must work with the selected mode and existing volumes. Record the release run ID and results.

To roll back the mode, set `client_agents_hardened: false` for the same terminal and redeploy with the same exact host limit. Reapply
its guard/udev templates in legacy mode: the unit omits the group/mode overrides and the helper defaults the runtime directory to `0755`.
Legacy containers run as root and retain access to volumes owned by `10001:10001`; no reverse chown or volume deletion is needed.
Preserve queue backups, verify NFC, barcode, torque and health again, and record the rollback run ID and result.

## Verification checklist (per item)

1. Backup relevant secret/config/DB.
2. Apply one item.
3. Redeploy only the affected host with the standard route (`scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan --limit <host>`, then the same command without `--print-plan`).
4. Verify kiosk borrow/return + admin login + the item-specific check above.
5. Roll back if the flow breaks; record result in KB-393 Open Items.
