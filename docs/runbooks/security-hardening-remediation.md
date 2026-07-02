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

After the code-level fixes in KB-393 (Batch A/B) are deployed. These steps change secrets/config/runtime and **can break running kiosks if done carelessly**, so each is gated on explicit operator go-ahead and staged (change → verify → next). Do NOT run these automatically. Each item lists risk and a verification step.

> Safety: take a DB/config backup before secret rotation. Do one item at a time and verify the kiosk borrow/return flow after each.

## C-1. Remove host SSH private key from API container (Critical)

- File: `infrastructure/docker/docker-compose.server.yml` (mount `~/.ssh:/root/.ssh:ro`).
- Action: remove the mount; if backup needs SSH, use a dedicated least-privilege deploy key on a narrow path, or move backup transport off SSH.
- Risk: backup/Ansible-from-container features break if they relied on the key. Verify backup job after change.

## C-2. PostgreSQL password (Critical)

- Files: `docker-compose.server.yml` (`POSTGRES_PASSWORD:-postgres`, `DATABASE_URL`), `infrastructure/ansible/inventory.yml`, `templates/api.env.j2`.
- Action: generate a strong password in Ansible vault; set `POSTGRES_PASSWORD`, `DATABASE_URL` from vault; drop the `:-postgres` default so an unset value fails startup rather than falling back.
- Rotation order: set new password on DB role → update API env → restart API → verify. (Changing `POSTGRES_PASSWORD` env alone does NOT change an existing volume's password; run `ALTER ROLE postgres WITH PASSWORD ...` on the running DB.)
- Verify: API `/api/system/health` DB check green; kiosk borrow works.

## C-3. NFC agent reboot/poweroff + bind address (Critical)

- Files: `clients/nfc-agent/nfc_agent/main.py` (reboot/poweroff routes), `config.py` (`REST_HOST` default `0.0.0.0`), `infrastructure/docker/docker-compose.client.yml` (`network_mode: host`, `privileged: true`), `nfc-agent.env.j2`.
- Action: bind REST/WS to `127.0.0.1` (kiosk browser is same host — confirm the web build's agent WS URL first); add a shared-secret/token to reboot/poweroff or remove those endpoints; replace `privileged: true` with specific `devices`/`cap_add`; block 7071 from LAN via UFW.
- Risk: if the kiosk browser reaches the agent via LAN IP (not localhost), binding to 127.0.0.1 breaks NFC input. Confirm `VITE_AGENT_WS_URL` / `websocket_agent_url` first (`group_vars/all.yml`).
- Verify: NFC scan still drives kiosk; reboot endpoint rejects unauthenticated calls.

## C-4. Predictable client keys / admin1234 (High)

- Files: `apps/api/prisma/seed.ts` (`admin`/`admin1234`, `client-*-key`), `apps/web/src/lib/client-key/config.ts` (fallback key), `infrastructure/ansible/inventory.yml` (plaintext keys), `scripts/register-clients.sh` (default admin pw), `docs/guides/api-key-policy.md` (real keys in docs).
- Action: per-device high-entropy `x-client-key` stored in vault and rotated; make `VITE_DEFAULT_CLIENT_KEY` required in production web build; production seed must not create `admin1234` (force first-run random + change); scrub real keys from docs.
- Risk: rotating a client key breaks that kiosk until its config/URL is updated. Rotate one device at a time.
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

- File: `infrastructure/docker/Caddyfile.local.template` (missing `@admin_protect` present in `Caddyfile.production`).
- Action: add `@admin_protect` + `ADMIN_ALLOW_NETS` (operator's LAN CIDR) to the local template.
- Risk: wrong CIDR locks admins out of `/admin`. Confirm the site LAN CIDR first.

## C-8. TLS verify defaults (High/Medium)

- Files: `clients/haizen-agent/haizen_agent/config.py` (default `insecure`), `raspi-haizen-agent.conf.j2`, `inventory*.yml` (`status_agent_tls_skip_verify`), `scripts/register-clients.sh` (`CURL_INSECURE`).
- Action: distribute an internal CA (or pin), flip defaults to `system`/verify. Stage per site.
- Risk: verification failures if CA not yet distributed. Distribute CA before flipping.

## C-9. Query-string API keys / metrics / backup-health (Medium)

- Action: accept keys via header only (drop `?key=`/`?clientKey=` in signage/webrtc + kiosk URL); require auth (or localhost) on `/system/metrics` and internal backup health.
- Risk: signage/webrtc/kiosk bootstrapping may rely on the query param — migrate to header/localStorage first.

## Verification checklist (per item)

1. Backup relevant secret/config/DB.
2. Apply one item.
3. Redeploy the affected layer only (`scripts/server/deploy.sh` or the client role).
4. Verify kiosk borrow/return + admin login + the item-specific check above.
5. Roll back if the flow breaks; record result in KB-393 Open Items.
