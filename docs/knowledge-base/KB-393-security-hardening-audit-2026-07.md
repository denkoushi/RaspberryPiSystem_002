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

## Public signage schedule DTO — local correction (2026-10-03)

- Base: `ee424d21412614baae39b405364ed1eb65524316` (PR準備時の最新 `origin/main`、Pi5配備済み版と一致)。開始時の基点 `38aac71fba22f9c27e00b58fcd27d187f7952b16` からfast-forwardで取り込み、専用 branch `fix/signage-public-schedule-dto-20261003` を維持した。
- 匿名 `GET /api/signage/schedules` は表示に使うフィールドだけを明示的に返す公開DTOへ変更した。`targetClientKeys` と、将来追加される認証用フィールドは公開レスポンスへ自動的に混入しない。
- 内部の取得・端末照合・ローテーション、および認証済み `/schedules/management` の割当情報は維持した。端末ID移行、認証キー交換、他APIの認証変更は対象外。
- 回帰再現: 修正前は新しい匿名レスポンス検査だけが失敗し、残り4件は成功。修正後の公開DTO・管理権限・空一覧の回帰テストは5件成功。
- ローカル検証: 既存schema 17件、ローテーション・管理・画像配信6件、専用DBの一覧・作成・端末別content/JPEG統合11件が成功（計39件）。統合テストの他16件は `-t` の対象外。変更ファイルのESLint、API TypeScript build、`git diff --check` も成功。テスト専用 `LOG_LEVEL=silent` が許可値外で初回起動に失敗したため、`error` に訂正して失敗対象を1回再実行した。
- DBはローカルDockerのloopbackに限定した専用コンテナ、合成データ、tmpfsを使用。既存DB/volumeは変更せず、検証後に専用コンテナを停止・自動削除した。保存先も今回専用の一時ディレクトリとした。
- この節のテスト結果はローカル検証の証拠であり、本番反映の証拠ではない。配備の成否は後続の標準release runのsystemd/Ansible結果と非破壊post-checkで確認する。過去に露出した認証キーの失効・交換は本修正に含めず、本修正だけでは過去の露出を解消しない。

## Kiosk signage preview and loan response DTOs — local correction (2026-10-04)

- 専用 branch `fix/kiosk-preview-and-loan-secret-dto-20261004`、基点 `b515dd18632a5feb2cf047742c0d3c4b5a9c1aff` でローカル修正・検証を実施。開始時の未コミット変更はなく、他作業のbranch/worktreeは変更していない。
- Kiosk previewの候補・選択・レスポンスは端末IDと表示用フィールドのみ。画像は利用中端末自身の `x-client-key` で新しい `/api/kiosk/signage-preview/image` を呼び、サーバー側で自端末または登録済みsignage候補への参照を認可する。他端末のキーをブラウザへ返さず、画像ルートには標準rate limitを適用し、配信実績は更新しない。
- 既存String列 `signagePreviewTargetApiKey` は互換アダプター内で旧キー値と新ID値を解決する。GETはDBを書き換えず、新しい選択保存はIDを格納する。schema/migration変更なし。元の画像配信・管理画面および公開schedule DTOは維持した。
- APIとWebは同じ修正を含むreleaseで配備し、キャッシュ済みの旧Webを再読み込みする必要がある。旧Webのキー指定PUTは受理するが、レスポンスにキーは返さない。旧APIへのrollbackは新ID参照を解釈できずキー露出も再開するため、通常の互換rollbackとは扱えない。
- 後続の承認済みキー交換では、旧キーが有効な間に残存するpreview参照をIDへ移行し、schedule割当のキー参照も整合させる必要がある。候補判定は従来のサーバー側キーに `signage` を含む規約を継続するため、交換でもその規約を維持するか、役割情報を別途設計する。
- 共通の明示的allowlist DTOをtoolsのactive・borrow・photo-borrow・return・cancel・assign-client、履歴内Loan、measuring-instrumentsとriggingの借用・返却へ適用。表示・操作用フィールドを維持し、ClientDeviceの認証キー、Userのpassword/MFA/backup codes、NFC認証識別子、内部idempotencyフィールドを返さない。User表示はID/usernameに限定する。
- 最終検証は61件成功（API unit 26、Web関連14、専用DB統合21）。統合の他39件は指定した対象外。API/Web ESLint・TypeScriptを含むbuild、`git diff --check` は成功。認可、旧参照互換、保存、表示消費側、共通DTO適用箇所を手動レビューした。
- 初回の古い生成Prisma/shared-types、コピー済み依存の欠けたfont asset、vector拡張のないテストDBは、専用worktree内の再生成・lockfile固定offline依存準備・標準pgvectorテストDBへの切替で解決した。業務sourceや既存DBの環境依存問題を追加修正したものではない。
- DBはloopback限定・tmpfs・専用ラベル付きコンテナと合成fixtureのみを使用し、検証後にID/ラベルを照合して今回の2コンテナだけを停止・削除した。実在のキーや業務データをテストへ持ち込まず、本番DB・設定・運用状態は変更していない。
- commit/push/PR/CI/main統合/release/deployとキー発行・交換・失効は未実施。全体E2E・全suite・本番動作検証は今回の完了証拠に含めない。既に露出したキーは後続の失効・交換が必要であり、ローカル修正の成功を本番の安全性の証明として扱わない。

## Open Items

Operator-side (require secret rotation and/or Pi redeploy; not executed here per safety policy): see [security-hardening-remediation Runbook](../runbooks/security-hardening-remediation.md). Design-level items (per-resource storage ACL, JWT revocation, cookie-based session, query-string key removal, metrics/backup-health auth) tracked as future work.

## References

- Runbook: [security-hardening-remediation.md](../runbooks/security-hardening-remediation.md)
- [api-key-policy.md](../guides/api-key-policy.md), [pr-review-bots.md](../security/pr-review-bots.md)
