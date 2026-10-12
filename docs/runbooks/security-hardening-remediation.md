# Runbook: Security hardening remediation (Batch C — operator actions)

## Metadata

| Field | Value |
|-------|-------|
| id | RB-security-hardening-remediation |
| status | active |
| scope | Operator-side remediation of audit findings that require secret rotation, config change, or Pi redeploy |
| date | 2026-07-02 |
| source_of_truth | this file |
| related_docs | [KB-393](../knowledge-base/KB-393-security-hardening-audit-2026-07.md), [deployment.md](../guides/deployment.md), [api-key-policy.md](../guides/api-key-policy.md) |

## When to use

The code-level fixes in KB-393 (Batch A/B) are **deployed to production** (PR #948 → main `b1172baf`, 2026-07-02, real-device verify PASS 45/0/0). The items below are the remaining **Batch C** operator actions. They change secrets/config/runtime and **can break running kiosks if done carelessly**, so each is gated on explicit operator go-ahead and staged (change → verify → next). Do NOT run these automatically. Each item lists risk and a verification step. All items C-1..C-9 are **not yet started**.

> Safety: take a DB/config backup before secret rotation. Do one item at a time and verify the kiosk borrow/return flow after each.

## C-1. Remove host SSH private key from API container (Critical)

- File: `infrastructure/docker/docker-compose.server.yml` (mount `~/.ssh:/root/.ssh:ro`).
- Action: remove the mount; if backup needs SSH, use a dedicated least-privilege deploy key on a narrow path, or move backup transport off SSH.
- Risk: backup/Ansible-from-container features break if they relied on the key. Verify backup job after change.

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

- Status: code correction implemented locally; hosted CI, merge, and production rollout remain.
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

## C-6. Container de-root & hardening (High)

- Files: `Dockerfile.api`, `Dockerfile.web`, `docker-compose.server.yml`.
- Action: add non-root `USER`; `cap_drop: ALL` + minimal caps; `security_opt: [no-new-privileges:true]`; read-only rootfs with tmpfs/volumes for writable paths; slim the API image (remove Ansible/Playwright if not needed at runtime).
- Risk: file-permission/writable-path breakage. Test in staging compose before Pi.

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

## C-10. TalkPlaza vault files tracked in plaintext (Critical)

- Finding (2026-10-12 security audit; the full report is kept in the private DGXSparkControlPlane repository under `docs/security/`): `infrastructure/ansible/host_vars/talkplaza-{pi5,pi4,signage01}/vault.yml` were committed **unencrypted** to the public repository from `0fd82a2f` (2026-01-14). They hold the TalkPlaza API JWT access/refresh secrets and the per-device `x-client-key` for `talkplaza-pi5-server`, `talkplaza-pi4-kiosk01` (shared by status-agent and NFC agent) and `talkplaza-signage01` (shared by status-agent and signage). Slack/Dropbox entries were empty. All seven values are **leaked**; they stay readable in git history even after this fix, so rotation is the remedy, not history rewriting.
- Repository fix (branch `fix/talkplaza-vault-encrypt-rotate`): regenerate every value and encrypt the three files with `ansible-vault` via `scripts/security/rotate-talkplaza-vault.sh`; add `vault.yml.example` placeholders; remove the seven TalkPlaza `allowedPlaintext` entries from `security/production-secret-baseline.json` so CI fails closed if a plaintext vault reappears.
- Status (2026-10-12): repository fix merged to main as #1935 (`7e289e51`); the audit report itself lives in the private DGXSparkControlPlane repository. **Host rollout is not applicable yet**: no TalkPlaza hardware exists (see [quick-start-deployment.md](../guides/quick-start-deployment.md); `inventory-talkplaza.yml` uses `ansible_connection: local` and placeholder `*.talkplaza.local` names that do not resolve), so the leaked values were never installed on any device or registered in the production database. When the site is built, provision it from the encrypted vault only and never register the leaked values from history; the steps below then apply as written, except that step 1 becomes first-time device registration instead of a rotation.
- Host rollout (one device at a time, after the branch is merged):
  1. On talkplaza-pi5, back up the DB, then rotate the three `ClientDevice` rows with `scripts/security/rotate-client-key.sh <ClientDevice UUID>` (`OLD_CLIENT_KEY` = the leaked value from git history, `NEW_CLIENT_KEY` = `ansible-vault view` of the new file). Order: pi5 server row, signage row, kiosk row.
  2. Standard release to talkplaza-pi5 with `-i infrastructure/ansible/inventory-talkplaza.yml`. The API picks up the new JWT secrets; every signed-in session is invalidated and users must log in again.
  3. Standard release to talkplaza-signage01, then talkplaza-pi4 (kiosk URL embeds the client key, so the kiosk browser restarts).
- Risk: between the DB rotation and each terminal's release, that terminal's status-agent/NFC/signage calls return 401. Keep the window short and do it outside production hours.
- Verify: old client keys return 401 on `/api/clients/status`; new keys succeed; kiosk borrow/return flow and signage display work; admin login works with a fresh session; `python3 scripts/ci/validate_production_secret_structure.py` passes on main.

## C-11. MFA re-enrollment with only an access token / pre-MFA refresh tokens (High)

- Finding (2026-10-12 security audit, private report): `POST /api/auth/mfa/activate` replaced the TOTP secret and backup codes with nothing but a valid access token, so a stolen access token could take over MFA on an admin account. `POST /api/auth/refresh` also upgraded refresh tokens minted before MFA was enabled into MFA-passed sessions without ever presenting a code.
- Repository fix: #1938 (merged main `39465206`). `activateMfa` now requires the login password and, when MFA is already enabled, a current TOTP code or backup code (error code `MFA_REAUTH_REQUIRED`). `refresh()` rejects a refresh token whose payload lacks `mfaEnabled` once the user has MFA enabled. The admin Security page collects the extra fields. No migration.
- Status (2026-10-12): **deployed to Pi5** with the standard release of main `e86016dc` (run `20261012-031115-d47fd4`, systemd active/exited/success, recap failed=0 rescued=0, health 200). Rollback reference: previous Pi5 SHA `9f7aa316`.
- Operator-visible changes: the MFA setup form asks for the password (and the current code on re-enrollment); admins who set up MFA before this release and still hold an old refresh token must log in again once. Access tokens issued before activation stay valid until they expire (15 min), which is accepted.
- Verify: `pnpm --filter @raspi-system/api exec vitest run src/routes/__tests__/admin-mfa-enforcement.test.ts`; on the device, re-enrollment without the current code returns 401 `MFA_REAUTH_REQUIRED`.

## C-12. Gmail HTML attachments rendered to PDF with JavaScript and network enabled (High)

- Finding (2026-10-12 security audit, private report): the kiosk-documents Playwright adapter rendered untrusted mail HTML with scripts enabled and no request interception, so anyone who can mail the ingestion mailbox could make the API container fetch arbitrary URLs (SSRF toward the Docker network, the Pi, Tailscale peers).
- Repository fix: #1937 (merged main `02aa9bb0`). The browser context is created with `javaScriptEnabled: false` and every request is aborted via `context.route('**/*', ...)` before `setContent`; inline content and `data:` URLs still render. The shared Chromium launch flags (`--no-sandbox`) are tracked separately under C-6.
- Status (2026-10-12): **deployed to Pi5** in the same release as C-11 (main `e86016dc`, run `20261012-031115-d47fd4`).
- Operator-visible changes: remote images, external CSS/fonts and scripts in mail HTML no longer appear in the generated PDF.
- Verify: `pnpm --filter @raspi-system/api exec vitest run src/services/kiosk-documents` (the real-Chromium integration test runs in CI).

## C-13. Pi4 agents ran privileged as root (High)

- Finding (2026-10-12 security audit): NFC, barcode and torque containers ran as root with `privileged: true`, exposing every Pi4 device and
  capability to a compromised agent.
- Repository fix: the static client Compose and `release_kiosk` template remove `privileged`, drop all capabilities and set
  `no-new-privileges:true`. Each image runs as dedicated UID/GID `10001:10001`. No capabilities are added: PC/SC/libusb (including USB
  ioctls), serial I/O and evdev exclusive grabs do not need `SYS_RAWIO` or other capabilities. Host networking, profiles, health checks and
  release selection stay unchanged.
- Status: repository fix pending merge; not yet deployed.
- Required groups/devices: NFC adds numeric `plugdev=46` and `input=104`, exposes `/dev/bus/usb` (char major 189) and `/dev/input` (major
  13) read-only, and keeps `/run/pcscd:ro`. Barcode adds `dialout=20`, permits majors 166 (ttyACM) and 188 (ttyUSB), and binds `/dev:ro`:
  serial nodes live directly in `/dev`, so a narrower static node bind would fail when unplugged or miss replacement nodes. This also
  exposes `/dev/serial` links when present. Torque adds `input=104`, binds `/dev/input:ro` and permits major 13. Cgroup rules grant `rw`,
  without `m`; read-only bind mounts prevent directory changes while allowing device I/O. Torque udev rules now set `GROUP="input",
  MODE="0660"` for the exact configured wrench identities; controller selection is unchanged.
- GID assumptions: the repository does not provision/fix these numeric IDs. Before rollout, check `getent group plugdev dialout input` on
  each Pi4 against 46/20/104 and `stat -Lc '%a %u %g %n'` on the USB/input/serial nodes. USB must grant plugdev and serial must grant
  dialout access; optional TS100 HID must grant input access. If IDs differ, correct both Compose definitions before deployment. Do not use
  world-writable device permissions.
- PC/SC socket: the existing host polkit rule permits PC/SC access; no extra socket group is assumed because the upstream [pcscd socket
  unit](https://github.com/LudovicRousseau/PCSC/blob/master/etc/pcscd.socket.in) uses mode `0666`. Verify the installed
  `/run/pcscd/pcscd.comm` mode and actual card access. If the host restricts it to `0660`, add its actual numeric socket GID to NFC's
  `group_add` in both definitions rather than broadening socket permissions.
- Storage/guard preparation: new `/data` volumes inherit image ownership `10001:10001`, mode `0750`. Compose also pins UID/GID
  `10001:10001`, so previous images run with the same queue owner during `release_kiosk` rollback. NFC mounts the same named volume at
  `/data` and `/app/nfc-agent/data`, keeping the existing relative queue-path default writable even with previous images. Before the first
  rollout, stop the affected agents, back up queues, identify the actual NFC/torque named volumes with `docker inspect` (do not guess
  project prefixes), then use a maintenance container to `chown -R 10001:10001 /data` on each existing volume, including SQLite sidecars.
  Image ownership does not change an existing volume. Verify the deployed NFC queue path: preserve/back up any queue held at `./data` inside
  the old container and copy it into the named volume before recreation, since the new mount covers that directory. The root host guard now
  runs with group 10001 and creates `/run/torque-bluetooth-guard` as `root:10001`, mode `0770`, allowing non-root torque intent writes
  without world write access. Install/restart the updated host guard unit/helper and reload/retrigger the updated wrench udev rules before
  starting the hardened torque image.
- Pi4 verification checklist (hardware required):
  1. Confirm each new container's user is `10001:10001`, privileged is false, `CapDrop` contains `ALL`, `CapAdd` is empty and `SecurityOpt`
  contains `no-new-privileges`. Check supplementary groups, device cgroup rules and queue directory/file access as that user.
  2. Read an NFC card through the Sony RC-S300/host pcscd and confirm normal kiosk delivery and queue writes. If TS100 is enabled, verify
  its configured `/dev/input/by-id/...` reader too.
  3. Start barcode with the reader unplugged; plug it in and scan, then unplug/re-plug and scan again without recreating the container.
  Verify ttyACM/ttyUSB and `/dev/serial` paths as configured.
  4. Capture a torque wrench value with exclusive evdev ownership; verify lease intent updates and Bluetooth guard status, including
  disconnect/lease-expiry fail-closed behavior. Run `curl -fsS http://127.0.0.1:7073/health` and confirm `ok: true`.
  5. Recreate/restart the agents and confirm persistent queues and repeat hardware checks. Exercise release rollback on a Pi4:
  `release_kiosk` renders the current template with previous images, so older images and existing volume permissions must also work
  together.
- Rollback: redeploy the previous release using the standard rolling-update procedure in [deployment.md](../guides/deployment.md), restoring
  its Compose, image and host guard/udev configuration together. The restored previous Compose may run images as root again; full-release
  rollback restores its original capability settings and retains access to migrated volumes. Do not
  delete data volumes. Verify NFC, barcode, torque and health again; record the run ID and result before declaring rollout complete.

## Verification checklist (per item)

1. Backup relevant secret/config/DB.
2. Apply one item.
3. Redeploy the affected layer only (`scripts/server/deploy.sh` or the client role).
4. Verify kiosk borrow/return + admin login + the item-specific check above.
5. Roll back if the flow breaks; record result in KB-393 Open Items.
