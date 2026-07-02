# KB-393: Security hardening audit (2026-07) — API authz, path traversal, secrets, infra

## Metadata

| Field | Value |
|-------|-------|
| id | KB-393 |
| status | active |
| scope | apps/api authz & storage, apps/web token/session, clients/* python agents, infrastructure/docker & ansible, secrets/deps |
| date | 2026-07-02 |
| source_of_truth | this file (findings + applied code fixes). Operator-side remediation procedure: [runbooks/security-hardening-remediation.md](../runbooks/security-hardening-remediation.md) |
| related_code | `apps/api/src/lib/photo-storage.ts`, `apps/api/src/routes/storage/pdf-pages.ts`, `apps/api/src/plugins/error-handler.ts`, `apps/api/src/routes/webrtc/signaling.ts`, `apps/web/src/features/webrtc/hooks/useWebRTC.ts`, `apps/api/src/routes/tools/loans/{delete,return,cancel,active}.ts`, `apps/api/src/routes/tools/loans/require-loan-auth.ts`, `apps/api/src/routes/kiosk/production-schedule/due-management-auth.ts` |
| related_docs | [pr-review-bots.md](../security/pr-review-bots.md), [api-key-policy.md](../guides/api-key-policy.md), [deployment.md](../guides/deployment.md) |
| validation | tsc (tsconfig.build.json) clean, eslint clean, vitest 186 tests passed on ephemeral pgvector Postgres; CI green (PR #948); deployed to prod (main `b1172baf`) + real-device verify PASS 45/WARN 0/FAIL 0 on 2026-07-02 |
| open_items | Batch C operator actions (secret rotation, SSH-key mount removal, container de-root, client bind hardening, admin IP allowlist, TLS verify) — see Runbook |

## Context

External + internal security review of the RaspberryPiSystem_002 monorepo (Pi5 server + Pi4 kiosk clients, Fastify+Prisma API, React web, Python agents, Docker/Ansible). Audit was static/read-only; fixes were applied in small backward-compatible batches and verified against an ephemeral Postgres container (existing DB/containers untouched).

Auth model recap (evidence-based): the web frontend attaches `x-client-key` on **every** request via an axios interceptor; kiosk pages run **without** JWT (client-key only); admin pages add a JWT. Python agents authenticate to the API with `x-client-key` only (no mTLS). No caller sends `performedByUserId`.

## Findings (by severity)

### Critical
1. **Path traversal in photo/PDF storage** — `PhotoStorage.readPhoto`/`readThumbnailBuffer` and `pdf-pages` built file paths from URL input with no `..` containment. **FIXED** (Batch A).
2. **Unauthenticated loan delete** — `DELETE /api/tools/loans/:id` executed with no JWT/role check. **FIXED** (Batch B).
3. **Unauthenticated reboot/poweroff on NFC agent** — `POST /api/agent/reboot|poweroff` on `0.0.0.0:7071`, no auth. **OPEN** (Batch C, client-side, needs deploy).
4. **Host SSH private key mounted into API container** — `docker-compose.server.yml` mounts `~/.ssh` into a root container with Ansible. **OPEN** (Batch C).
5. **PostgreSQL default password `postgres`** in production compose/inventory. **OPEN** (Batch C).

### High
6. **client-key gives blanket access to all photos/PDFs** (no per-resource ACL / IDOR). **OPEN** (needs signed-URL or ownership model; design change).
7. **`clientId` / `performedByUserId` spoofing** on return/cancel — audit actor could be forged. **FIXED** (Batch B: `performedByUserId` now taken only from `request.user`).
8. **`?clientId=` bypassed auth on `GET /loans/active`**. **FIXED** (Batch B).
9. **Predictable client keys / `admin1234`** in seed, inventory, web fallback. **OPEN** (Batch C, rotation + deploy).
10. **Kiosk PIN `2520` hardcoded fallback + no rate limit**. **PARTIALLY FIXED**: rate limit added (Batch A/C); legacy `2520` fallback removal is an operator action (needs a configured password first) — see Runbook.

### Medium (selected)
- JWT not re-checked against DB status/role within token lifetime (revocation lag). OPEN (design).
- Admin tokens in `localStorage` (XSS → token theft). OPEN (move refresh to HttpOnly cookie; design).
- **Prisma error `meta`/`code` returned to client** (schema disclosure). **FIXED** (Batch A: generic message in production, detail server-side only).
- API keys accepted via query string (signage/webrtc) → log/Referer leakage. OPEN.
- `/system/metrics`, internal backup health trust `172.*` / no auth. OPEN.
- Haizen/status agents default TLS verify `insecure`. OPEN (Batch C).
- **Weak `Math.random` for WebRTC callId**. **FIXED** (Batch A: `crypto.randomUUID`).

Full per-file evidence is preserved in the audit transcripts referenced from the chat that produced this KB.

## Fixes applied in this change (Batch A + B + PIN rate limit)

- **photo-storage.ts**: added `resolvePathWithinBase()` (URL-decode → reject `\0` and `..` segments → `path.resolve` + base-dir containment). Applied to `readPhoto` and `readThumbnailBuffer`.
- **routes/storage/pdf-pages.ts**: decode + `..` segment reject + resolved-path base containment.
- **plugins/error-handler.ts**: `buildPrismaClientResponse()` returns generic message + requestId in production (no `errorCode`/`meta`); unchanged in non-production; server logs unchanged.
- **routes/webrtc/signaling.ts** + **web useWebRTC.ts**: `crypto.randomUUID()` for callId.
- **routes/tools/loans/require-loan-auth.ts** (new): `requireLoanClientOrJwt()` — valid `x-client-key` OR JWT roles, else 401.
- **delete/return/cancel/active.ts**: enforce the helper; `performedByUserId` from `request.user` only; removed `?clientId=` auth bypass.
- **kiosk/production-schedule/due-management-auth.ts**: PIN verify now rate-limited `{ max: 10, timeWindow: '1 minute' }` (parity with record-approval route).

Design goal: legitimate kiosk (client-key) and admin (JWT) flows keep working; only fully-unauthenticated calls and traversal/forgery inputs are rejected.

## Validation

- `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit` → clean.
- `eslint` on all changed files → clean.
- `vitest` on ephemeral `pgvector/pgvector:pg16` Postgres (127.0.0.1:55432, isolated; removed after): loans/photo-storage/kiosk/kiosk-production-schedule/client-device-resolution/contracts.loans/loan.service/transaction.service/auth = **186 tests passed**, including "401 without client key" and the `2520` verify path (still 200 under the new rate limit).
- Ephemeral container + anonymous volumes removed; no existing DB/container/volume modified.
- **CI (PR #948)**: `lint-build-unit` / `api-db-and-infra` / `security-docker` / `e2e-smoke` / `e2e-tests` / CodeQL / gitleaks all green. CodeQL flagged 3 new `js/missing-rate-limiting` alerts on loan `return`/`cancel`/`delete` (introduced because the added authz is now visible to CodeQL); these routes are deliberately rate-limit-exempt for uninterrupted kiosk operation (`plugins/rate-limit.ts` skipPrefixes) and were dismissed as **won't fix** (alerts #44/#45/#46), consistent with the pre-existing accepted `/loans/active` alert.
- **Production deploy (2026-07-02)**: `./scripts/update-all-clients.sh main ... --detach --follow`, Run ID `20260702-205710-10848`. PLAY RECAP `failed=0 / unreachable=0` on all 7 hosts (Pi5 + Pi4×5 + Pi3); summary success true; Pi5 repo → `b1172baf`; `docker-api-1` healthy.
- **Real-device verify**: `scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**. Targeted checks against prod API: unauthenticated `return`/`cancel`/`delete`/`active?clientId=` → **401**; valid client-key `active` → **200**; storage path-traversal (raw `%2e%2e` / `..%2f`, both with valid key) → **500 with no `/etc/passwd` leak** (containment error, file access blocked). Kiosk/admin flows unaffected.

## Open Items

Operator-side (require secret rotation and/or Pi redeploy; not executed here per safety policy): see [security-hardening-remediation Runbook](../runbooks/security-hardening-remediation.md). Design-level items (per-resource storage ACL, JWT revocation, cookie-based session, query-string key removal, metrics/backup-health auth) tracked as future work.

## References

- Runbook: [security-hardening-remediation.md](../runbooks/security-hardening-remediation.md)
- [api-key-policy.md](../guides/api-key-policy.md), [pr-review-bots.md](../security/pr-review-bots.md)
