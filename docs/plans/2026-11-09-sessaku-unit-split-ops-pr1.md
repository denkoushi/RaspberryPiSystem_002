# Sessaku 021/022 unit split and operations — PR1

This living ExecPlan follows `.agent/PLANS.md`. Its scope is local DB/API implementation only; web, commit, push, branch changes, PR, merge and deployment are not authorized.

## Purpose / Big Picture

Prepare the 製番ボード API to split eligible cutting lots into single units for resources 021/022, register per-part operations, and complete a piece when all its operations finish. Existing clients retain the meaning of requiredMinutes. New clients can consume separate unit and setup minutes and completed operation numbers.

## Progress

- [x] 2026-11-09: Read required rules and inspect clean working tree and existing contracts.
- [x] 2026-11-09: Add nullable resource setting, two child tables and durable logical-key history in one additive migration.
- [x] 2026-11-09: Implement settings, bounded automatic splitting, operation completion and optional projection fields.
- [x] 2026-11-09: Add focused service/route tests and run related suites: 486 passed, 155 DB integration cases skipped. API/web type checks and both lint checks passed.
- [ ] Run DB integration tests and apply migration in an isolated DB (blocked by sandbox shared-memory and Docker socket permissions).
- [x] 2026-11-09: Both independent final reviews report zero high/medium issues; record evidence and database limitation.

- [x] 2026-11-09 review corrections: global auto runner try-lock, 5-lot cap and cheap early exits (retry/error policy superseded by second-review decisions below).
- [x] 2026-11-09 review corrections: bidirectional operation/piece completion, locked definition reconciliation (completion policy superseded below), and operation-evidence protection for split/merge.
- [x] 2026-11-09 review corrections: scalar piece reads and distinct supplement fixture keys; related unit tests and API/web lint/type checks passed.
- [ ] Execute the updated DB integration file on the user's isolated Docker PostgreSQL.
- [x] 2026-11-09 third review: shared TS process comparison, raw part identity, generation-invalidated SQL exclusions, untouched-first SQL, 5-lot cap, continue policy, quiet no-ops, distinct audits, missing-piece conflict and all-site override reconciliation. Local unit/lint/type checks passed; DB execution remains pending.

## Context and Orientation

`apps/api/prisma/schema.prisma` defines resource capacity, resource-part minutes, PieceSet (a logical CSV row identity) and Piece (a quantity within a lot). `sessaku-pieces/sessaku-pieces.service.ts` serializes edits with advisory transaction locks and validates optimistic versions/revisions. Its operate function reconciles parent progress after each write. `grinding-planning-board/read.ts` loads source rows and settings; `grinding-planning-board-projection.ts` constructs response items. Shared contracts live in `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts`.

## Milestones / Plan of Work

First add unitSplitEnabled Boolean? to ResourceCapacity, operation definitions under ResourcePartMinutes, completion records under Piece, and durable logical-key history under CsvDashboard. Add FK cascade, unique parent/operation pairs and SQL range constraints. No existing data is rewritten. Then extend the settings APIs and keep default-valued capacity rows removable. Null means the code default: 021/022 true, others false.

Next introduce POST pieces/auto-unit-split.

Read the authenticated site's registered lots; filter existing PieceSets or history markers, invalid quantities, completed/later rows and disabled effective resources.

A global pg_try_advisory_xact_lock admits one automatic runner; a busy runner returns { splitCount: 0, skippedCount: 0, hasMore: true } immediately.

Read candidates once with LIMIT 6 before loading projection sources (enabled effective resource, quantity 2–50, incomplete and earliest part process). After zero candidates, reuse that result for 5 seconds per site without fingerprint/candidate SQL; on expiry, skip the CTE if the refreshed input fingerprint is unchanged.

Initial PieceSet/history reads select logical keys only.

Attempt at most 5 eligible lots through separate split transactions, checking PieceSet/history before heavy locks and again inside them.

Mark the existing permanent structural 409s in History and continue. All per-lot ApiErrors below 500 are skipped with a warning and do not set retryNeeded; P2034 retains its retry flag. Cache only AUTO_UNIT_SPLIT_STRUCTURALLY_INELIGIBLE by the SQL winner-key input generation without adding History. Temporary AUTO_UNIT_SPLIT_INELIGIBLE (resource OFF, quantity outside 2–50, or missing projected item) is never structurally cached. Only BUSY and the deadline stop the loop.

Propagate connection failures and unexpected errors.

skippedCount counts only SQL-selected lots actually skipped in this request due to existing keys/history, recoverable conflicts or P2034. Already touched siblings loaded for projection do not contribute.

Capped or time-budgeted candidates set hasMore.

The normal work budget is 3 seconds; if discovery exhausts it, allow the first split up to 1 additional second, capped at the runner deadline. Later attempts use the original deadline. The outer runner timeout is 10 seconds (3-second budget + 1-second grace + 6-second headroom). Reserve the final runner second for transaction acquisition/commit; start no new split at or after this safe deadline. Check this deadline after each preprocessing stage and return hasMore:true immediately on expiry. Execute the fingerprint, candidate and projection-source queries on the runner connection, refreshing its transaction-local statement_timeout to the remaining safe budget before each database stage.

Finally implement PUT pieces/:pieceId/ops/:opNo/completion using operate and a shared piece-completion writer so the operation record, piece completion and parent aggregation commit together. Add optional projection unitRequiredMinutes/setupMinutes/ops/completedOpNos using maps. Preserve requiredMinutes and existing API inputs.

## Decision Log

- Decision: Add a small logical-key history table and write it in split/merge transactions and before later-process set deletion. Rationale: an empty origin PieceSet can be adopted by a new earlier process and later deleted; its existence alone cannot preserve manual history. The deletion path also protects pre-feature manual sets without a data backfill.
- Decision: Use existing completion intent complete/incomplete. Rationale: match the established piece completion API.
- Decision: Omitted ops preserves existing definitions; an explicit empty array removes them. With supplied definitions the server derives perUnitMinutes from their sum. Older callers omitting ops must send a numeric perUnitMinutes within absolute tolerance 1e-6 of the saved sum, otherwise return 400 OPERATION_MINUTES_MISMATCH; null retains the explicit delete behavior.
- Decision: Keep separate time fields consistent with requiredMinutesSource: own time excludes its setup; original time has setupMinutes zero because no original setup breakdown exists. Operations are looked up by effective resource and FHINCD regardless of selected time source.

## Surprises & Discoveries

- Independent review found a legacy manual tombstone can be adopted and removed through later-process propagation. Durable history prevents automatic splitting even after that set is gone.
- Reviews also corrected preservation of the existing resource-code contract and default lookup for unset dictionary keys.
- PostgreSQL is installed but isolated initdb failed because sandbox shared-memory creation is prohibited; Docker socket access is also denied. No database migration or DB integration test was run.

- dotenv config is called unconditionally by API config imports. Tests ran from a fresh temporary working directory with an explicit Vitest root; a temporary setup also mocked config/env/load-dotenv.ts so no .env file is loaded.

## Concrete Steps / Validation and Acceptance

From the repository, generate Prisma with `pnpm --filter @raspi-system/api prisma:generate` and build shared types with `pnpm --filter @raspi-system/shared-types build`. Run focused Vitest files under sessaku-pieces and matching resource-minutes, resource-capacity, projection and route test paths; invoke Vitest with an explicit root from an empty temporary directory. Dedicated database integration tests require an explicitly isolated test database; do not connect to operational databases or load secret files. Run `pnpm --filter @raspi-system/api lint`, `pnpm --filter @raspi-system/web lint`, API `tsc -p tsconfig.build.json --noEmit` and web `tsc -b`. Expect valid definitions to replace atomically, all operations to complete the piece/parent, an incomplete operation to reopen it, two automatic calls to split only once, and all old projection minutes to remain unchanged.

## Idempotence and Recovery

No migration is applied to production. The migration adds only nullable columns and empty child tables. Automatic splitting is idempotent through existing PieceSet presence and logical locks. Local edits remain uncommitted; inspect git diff for review or recovery. Do not reset or delete user work.

## Interfaces and Dependencies

Use existing Prisma, Zod, Fastify and Vitest; no new dependency. Resource capacity response adds optional unitSplitEnabledByResource. Resource minutes values and requests add optional ops with opNo 1..20 and minutes >0 up to 100000; at most 20 distinct operations and total at most 100000. Resource codes use the existing 20-character capacity, validated as a trimmed nonempty string as before, with no new character restriction.

## Outcomes & Retrospective

Local DB/API implementation and the A/B review corrections are implemented; database execution remains pending. Focused tests pass, while persistence and real PostgreSQL concurrency remain unverified because the environment cannot provision an isolated database. No repository integration or deployment is part of this task. Web source files are unchanged. The initial implementation began from a clean tree. This second-review task began with existing uncommitted PR1 changes, including the user’s test correction; those changes remain preserved.

## Artifacts and Notes

Plan created after source investigation; update completion evidence after focused validation.

Plan revised after independent review: preserve logical-key history across adopted-set deletion, retain existing resource-code acceptance, and record database sandbox limits.

## Final API Contracts

All paths below are relative to `/kiosk/production-schedule/grinding-planning-board`. Device authentication and site resolution follow the existing piece APIs; request siteKey cannot select another site.

`GET /resource-capacity` adds optional unitSplitEnabledByResource. The map includes 021/022 and stored resources, with effective booleans; absent other resources mean false. `PUT /resource-capacity` adds optional unitSplitEnabled boolean or null (reset to code default), preserving other partial-update fields and deleting only fully default rows.

`POST /pieces/auto-unit-split` accepts an empty or absent body and returns `{ splitCount, skippedCount, hasMore }`. splitCount counts successful lots. skippedCount counts only structurally eligible cutting lots skipped due to existing keys/history, recoverable conflicts or P2034; capped-out candidates are represented by hasMore. A busy global runner lock returns { splitCount: 0, skippedCount: 0, hasMore: true }. No eligible untouched winner returns zero counts and hasMore false without projection. No client-provided limit is accepted. At most 5 lots are attempted, each in a separate existing split transaction. When SESSAKU_PIECES_CREATE_ENABLED is disabled, return zero counts/hasMore false without starting an audit. Candidate-zero exploration also emits no audit.

`GET /resource-minutes` adds optional ops to each part value. `PUT /resource-minutes/value` accepts the existing resourceCd/fhincd/perUnitMinutes/setupMinutes plus optional ops. A supplied array replaces operations, [] removes them, and an omitted field preserves definitions. Supplied nonempty definitions derive perUnitMinutes from their sum. With ops omitted and saved operations present, a numeric perUnitMinutes must match the saved sum or return 400 OPERATION_MINUTES_MISMATCH. Null continues to delete the part definition. Each opNo is an integer 1..20, minutes is finite >0 and <=100000, there are at most 20 unique operations and the total is <=100000.

`PUT /pieces/:pieceId/ops/:opNo/completion` accepts `{ intent: "complete" | "incomplete", expectedPieceSetVersion, itemRevision }` and returns the existing SessakuPiecesMutationResponse. Complete preserves an already completed piece and completes an unfinished piece once all configured operations are recorded. Incomplete reopens the piece. Whole-piece complete creates all configured operation records; whole-piece incomplete deletes all operation records, including when no definition remains. The parent-row API shares this synchronizer. The same transaction updates piece state, set version, parent aggregation and existing downstream quantity reconciliation. Missing definitions/operation return 400; stale data returns 409. Audit snapshots include operation number and before/after completedOpNos.

Enabled-resource pieces add optional unitRequiredMinutes, setupMinutes, ops and completedOpNos. FHINCD remains the existing part identifier. requiredMinutes and its source remain unchanged. Separate unit/setup values reflect the selected time source; original minutes have no setup breakdown and therefore setupMinutes is zero.

## Validation Evidence (Initial Implementation)

Executed package commands from the repository (2026-11-09):

- `pnpm --filter @raspi-system/api prisma:generate`: passed, approximately 2 seconds; regenerated after schema changes.
- `pnpm --filter @raspi-system/shared-types build`: passed, approximately 3 seconds.
- `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit`: passed, approximately 1 minute. Initial failures from the new optional relation type were fixed by preserving the explicit create fields.
- `pnpm --filter @raspi-system/web exec tsc -b`: passed, approximately 1 minute; final incremental confirmation passed.
- `pnpm --filter @raspi-system/web lint`: passed, approximately 2 minutes.
- `pnpm --filter @raspi-system/api lint`: passed on the final code/tests, approximately 2 minutes.
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sessaku_pr1_disabled pnpm --filter @raspi-system/api exec prisma validate`: passed, approximately 1 second; no database connection/migration.
- `git diff --check`: passed; `git diff --name-only -- apps/web`: empty.

The final related Vitest run used the existing API config plus temporary setup that disables dotenv loading. It ran from `/private/tmp/sessaku-pr1-tests.xlqhj8`, explicitly unset TEST_DATABASE_URL and set a nonoperational local DATABASE_URL. The command was equivalent to the following, with taskRepo denoting this repository root:

    env -u TEST_DATABASE_URL \
      DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sessaku_pr1_disabled \
      node "$taskRepo/apps/api/node_modules/vitest/vitest.mjs" run \
      --root "$taskRepo/apps/api" \
      --config /private/tmp/sessaku-pr1-tests.xlqhj8/vitest.config.mjs \
      src/services/production-schedule/sessaku-pieces \
      src/services/production-schedule/__tests__/grinding-planning-board-required-minutes.test.ts \
      src/services/production-schedule/__tests__/grinding-planning-board-resource-minutes.service.unit.test.ts \
      src/services/production-schedule/__tests__/grinding-planning-board-resource-capacity.service.unit.test.ts \
      src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts \
      src/services/production-schedule/__tests__/grinding-planning-board.service.unit.test.ts \
      src/routes/kiosk/production-schedule/__tests__/sessaku-pieces.route.test.ts \
      src/routes/kiosk/production-schedule/__tests__/grinding-planning-board.route.test.ts

Result: 15 files passed, 1 DB integration file skipped; 486 passed and 155 skipped, 7.16 seconds. The skipped integration file includes new tests for real simultaneous auto splitting, successive same-lane lots, manual-history retention after adopted-set deletion, operation-to-piece-to-parent completion/undo and operation definition replacement. Those tests are added but not claimed as executed.

Intermediate test failures were caused by updated transaction mocks lacking new tables/exports and an empty TEST_DATABASE_URL being parsed as a URL. They were corrected without weakening assertions; the final suite passes. Temporary test-setup CLI/import configuration errors were corrected before the final run.

Database availability checks: `pg_isready -h localhost -p 5432` returned no response; `docker info` could not access the Docker socket. An isolated `initdb -D /private/tmp/sessaku-pr1-postgres.UcV9fv/data -U postgres -A trust --no-locale` failed at shmget with Operation not permitted. No PostgreSQL server was started and no database migration was applied. Migration execution, FK/cascade behavior and real lock concurrency therefore remain unverified here.

Both final independent reviews reported zero high/medium issues. No commit, push, branch changes, PR, merge, release or deployment was performed. No .env or secret files were read.

## Changed Files

- `apps/api/prisma/migrations/20261109130000_sessaku_unit_split_ops/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/routes/kiosk/production-schedule/__tests__/grinding-planning-board.route.test.ts`
- `apps/api/src/routes/kiosk/production-schedule/__tests__/sessaku-pieces.route.test.ts`
- `apps/api/src/routes/kiosk/production-schedule/grinding-planning-board.ts`
- `apps/api/src/routes/kiosk/production-schedule/sessaku-pieces.ts`
- `apps/api/src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts`
- `apps/api/src/services/production-schedule/__tests__/grinding-planning-board-resource-capacity.service.unit.test.ts`
- `apps/api/src/services/production-schedule/__tests__/grinding-planning-board-resource-minutes.service.unit.test.ts`
- `apps/api/src/services/production-schedule/__tests__/grinding-planning-board.service.unit.test.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board-projection.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board-resource-capacity.service.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board-resource-minutes.service.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board/read.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board/state.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/auto-unit-split.service.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-lane-scope.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-op-completion.service.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/auto-unit-split.service.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-key.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/sessaku-pieces.service.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/unit-split-policy.ts`
- `docs/AI_START_HERE.md`
- `docs/plans/2026-11-09-sessaku-unit-split-ops-pr1.md`
- `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts`

Final evidence updated: API lint exited 0. The 26-file list includes all tracked modifications and new files; the final git status contains only this task’s changes. DB validation remains explicitly pending.

## Review Corrections — 2026-11-09

### Decided behavior

- The automatic runner uses a global try advisory transaction lock, separate from each existing split transaction. Only one automatic runner executes across sites. A loser returns immediately with zero counts and hasMore true. Up to 5 lots are attempted per request; web repetition is PR2 scope.
- An EXISTS probe checks cutting logical keys without PieceSet/History before winners/details/projection reads. Initial existing-set/history reads select only logical keys. Each automatic lot checks presence before heavy locks and rechecks under locks. Permanent structural 409s are remembered in History and the loop continues. P2034 and quantity-change 400/409 count as skipped and continue; BUSY or budget exhaustion stop with hasMore true without a marker; connection and unexpected errors propagate. Already committed lots remain committed.
- Operation complete never reopens an already completed piece; operation incomplete reopens it. Whole-piece complete inserts all configured operation records, and incomplete removes all records when configured operations exist.
- Definition replacement/deletion locks critical -> related logical keys -> board -> parent rows -> setting. In the same transaction, it targets FHINCD and any relevant site's effective resource (own piece override, otherwise parent override, otherwise original resource). Removed operation numbers lose their completion records. Definition saves always preserve isCompleted; completed pieces receive missing configured operation records. Quantity/progress reconciliation, assignment release and learning events are never invoked by definition saves. Targets must belong to at least one site board; all sites' overrides determine effective resources. Externally completed pieces and their records remain untouched.
- Split/merge rejects with 409 PIECE_OPERATION_COMPLETED when any target or affected downstream piece has an operation record, including winnerless linked pieces. This prevents cascade deletion of recorded work.

### Reported DB failures

1. C1, caused by PR1: readSessakuPieceSet included opCompletions in ordinary scalar reads; quantity planning spreads those objects into returned piece rows. Removed that relation from single-set reads; board projection's readSessakuPieceSets still loads the required operation numbers. Added scalar-read regression coverage.
2. C2, caused by the new test: the successive-lot fixture reused the supplement unique source key (dashboard, source dashboard, ProductNo, resource, process). Set both the extra CSV row and supplement ProductNo to 124, distinct from the original 123.
3. C3, pre-existing: load-summary integration fixture uses map's zero-based index as piece.position. The same code is present in HEAD; the existing 20261106000000 migration requires position > 0. PR1 piece creates still explicitly provide positive positions. No unrelated fixture change was made. Minimal separate correction: position: index + 1.
4. C4, pre-existing: the integration test compares snapshotIds from two independent first-page requests. HEAD read.ts issues a fresh UUID on every such request to give a full cursor lifetime, as existing service unit tests assert. Legacy split records are excluded from generation SQL. payloadFormat/capacity additions do not make legacy changes affect generation. No production ID behavior was changed. The appropriate separate test correction is generation-token equality and continued validity of the prior cursor.

### Validation of corrections

- API `pnpm exec tsc -p tsconfig.build.json --noEmit`: passed. API `pnpm exec eslint .`: passed; the later scalar-read/P2034 tests and whitespace-only policy cleanup also passed focused ESLint.
- Web `pnpm exec tsc -p tsconfig.json --noEmit --incremental false`: passed; `pnpm exec eslint src`: passed. No web files were changed. An initial attempt used a nonexistent tsconfig.app.json; it was corrected to this repository's actual tsconfig.json.
- Related Vitest suite: 16 files passed, 504 tests passed, 163 DB integration tests skipped, about 6 seconds. Uses the same temporary no-dotenv config documented above and an explicitly nonoperational DATABASE_URL, with TEST_DATABASE_URL unset.
- Additional scalar-read/P2034 and generation SQL/token tests: 3 files, 26 passed, about 0.6 seconds (12 piece-key cases overlap the earlier run). This includes the existing legacy-generation exclusion contract.
- Added integration cases cover candidate-zero source-read avoidance, whole-piece operation synchronization, monotonic operation complete/undo, definition add/remove/empty behavior, effective override targeting, external preservation, and split/merge rejection for partial target/downstream operation records. Execution is intentionally left to the user's isolated PostgreSQL.
- Read-only independent Codex review found no additional high/medium issues in the corrected A/B implementation. No claim of a separate-model PR review is made.
- `git diff --check`: passed. Existing uncommitted PR1 work remains present. No commit, push, branch operation, migration, or deploy was performed; no .env/secret files were read, and docs/AI_START_HERE.md remains unchanged.

### Files changed for these corrections

- apps/api/src/services/production-schedule/sessaku-pieces/auto-unit-split.service.ts
- apps/api/src/services/production-schedule/sessaku-pieces/piece-key.ts
- apps/api/src/services/production-schedule/sessaku-pieces/sessaku-pieces.service.ts
- apps/api/src/services/production-schedule/sessaku-pieces/piece-operation-definitions.ts (new)
- apps/api/src/services/production-schedule/sessaku-pieces/unit-split-policy.ts (trailing blank-line cleanup only)
- apps/api/src/services/production-schedule/grinding-planning-board-resource-minutes.service.ts
- apps/api/src/services/production-schedule/sessaku-pieces/__tests__/auto-unit-split.service.test.ts
- apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-op-completion.service.test.ts
- apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-operation-definitions.test.ts (new)
- apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-key.test.ts
- apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-lane-scope.test.ts
- apps/api/src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts
- apps/api/src/services/production-schedule/__tests__/grinding-planning-board-resource-minutes.service.unit.test.ts

The earlier sandbox-only patch limitation is resolved in this second-review revision: this source plan is now updated directly.


## Second Review Corrections — 2026-11-09

### Decided behavior and implementation

- 定義保存で片を再オープンしない。完了片は新しい全 opNo の不足記録だけ補完し、未完了片は工程を減らしても未完了を維持する。削除した opNo の記録だけを消し、Progress 集約・引当解放・学習イベントを呼ばない。完了日時も変更しない。
- 親行の完了/取消と片 API は `syncWholePieceOperationCompletions` を共用する。片自身の override、親 override、元資源の順に実効資源を決め、完了は全工程の記録を補い、取消は全記録を消す。外部完了の保護は維持する。
- 数量補正は工程記録がある未完了片も保護する。記録のない未完了片から削減し、保護数量を下回る場合は元の片を保持して既存の `COMPLETED_QUANTITY_EXCEEDS_PLAN` にする。後工程の記録とその参照元も保護する。削除直前にも `isCompleted: false` と `opCompletions: none` を確認する。
- EXISTS は実際の winner、サイトの実効資源と `unitSplitEnabled`（null/未設定は021/022のみON）、数量2〜50、手動/外部未完了、同じ製番・品番の最早工程、PieceSet/History 未接触を条件にする。候補 ID は最大6件だけ読み、その製番だけを projection 用に読み込む。分割試行は最大5件。
- `LATER_PROCESS_PIECE_COMPLETED` / `LATER_PROCESS_PIECE_LOCKED` / `PIECE_OPERATION_COMPLETED` は History を付けて次回から除外する。先頭5件がこの409でも、次回は6件目へ進める。History はサイト非依存であり、この永続除外も全サイトに適用する。
- P2034、STALE、ALREADY_TOUCHED、INELIGIBLE、数量変化の400/409は skippedCount に加算して次のロットへ進む。BUSYと時間切れだけが全体を打ち切り、`hasMore: true` を返す。これらに永続印は付けない。DB 接続断などの予期しない失敗は従来どおり投げる。完了済みの別ロットの tx は取り消さない。
- 壁時計の予算は3000ms。各ロット開始前にも確認し、内側 tx の timeout を残り時間、lock wait を最大250msへ制限する。外側 tx は930秒から10秒、接続取得待ちは1秒へ短縮した。進行中の source read の終了待ちはあるため、3秒は処理開始/継続の予算でありレスポンス時間の厳密な上限ではない。
- 自動分割の品番・製番は、後工程探索/ロックと同じ生の論理キーの完全一致で比較する。trim/NFKCで同一視しない。表示上同じ品番でも生の値が異なる行（前後空白・全半角など）が同じ製番に混在する場合、伝播不能な組み合わせを自動分割しない。工程定義の品番trimと手動分割は従来どおり。
- 最終の工程順比較は候補選別・ロック内再検証・後工程探索とも `isLaterProcessOrder` を使用する。SQLは64文字以内の10進数表記（指数部は2桁以内）の数値比較だけで事前除外し、非数値やその他のNumber表記はTSへ渡す（候補の上位集合）。localeCompareをSQLのコードポイント順で代用しない。
- 定義保存は全対象 PieceSet、winner/detail、override をまとめて読み、opCompletions は pieceId IN の1回、記録削除は deleteMany 1回、補完は必要な createMany 1回。片の状態 update は行わず、対象 set の revision を updateMany で進める。
- 定義保存の対象は「いずれかの現場ボードに属し、winnerがあり、いずれかの現場の実効資源が保存対象資源と一致し、外部完了ではない片」。全現場のoverrideを一括取得し、各現場で片自身→親→元資源の順に評価する。依頼元だけのoverrideや1サイト運用を前提にしない。工程完了記録は現場横断で共有されるため、他現場だけに属する対象も同期する。

### Rollout notes / PR2 handoff

- 反映後、最初に画面を開いて auto-unit-split API が呼ばれた時から、既存の021/022の未接触ロットも遡って対象になる。数量2〜50かつ最早工程を、1要求あたり最大5ロットずつ分割する（予算や競合で5未満になる場合がある）。新規取込分だけに限定しない。
- `SESSAKU_PIECES_CREATE_ENABLED` が `true` でなければ自動分割は起きず、API は `{splitCount:0, skippedCount:0, hasMore:false}` を監査なしで返す。ここでは環境値を読み取って確認していない。
- 研削などが先にある製番では、切削は後工程なので自動分割しない。これは要件どおり。
- PR2 の web は `hasMore` を受けても即時連続呼出しせず、間隔と回数上限を設けること。目安は3秒以上・1回の画面表示につき最大10回とし、画面離脱で停止、通信失敗には待機を置く。最終値はPR2で決定する。PR1ではwebコードを変更しない。
- 自動 runner は外側 tx でDB接続を1本保持したまま、内側 split tx と通常の設定/監査照会を別接続で行う。接続1本では進まない。実用上の最小プールは3本（runner・split・別接続の設定照会）を確保し、通常リクエストや並列照会の余裕も別途必要。接続待ちとtimeoutをMac統合テストと反映時に確認すること。
- 永続除外されたロットの自動再試行はしない。構造を後で修正した場合は、手動分割で扱う。History の直接削除を通常の運用手順にはしない。

### Pre-deploy candidate count SQL

以下は **PR1 migration 適用前** に021/022既定ONで増える候補の上限を確認する読み取り専用SQL。`target-site` を対象のsiteKeyに置換する。追加予定の `unitSplitEnabled` 列や History テーブルに依存しない。既存PieceSet（空の手動操作済みsetを含む）は除外する。後工程完了など、実際のsplitで409になる構造までは除外しないため、成功ロット数の保証ではない。既存のサイト資源カテゴリ設定で021/022を切削から除外している場合は対象から除くこと。標準的な数字以外の工程順の数も併記し、0でなければ反映前に個別確認する。

```sql
WITH params AS (
  SELECT 'target-site'::text AS site,
    '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'::text AS dashboard,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF' AS ws
), ranked AS (
  SELECT r.*, p.site, p.ws,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(r."rowData"->>'FSEIBAN', ''), COALESCE(r."rowData"->>'FHINCD', ''),
        COALESCE(r."rowData"->>'FSIGENCD', ''), COALESCE(r."rowData"->>'FKOJUN', '')
      ORDER BY CASE WHEN r."rowData"->>'ProductNo' ~ '^[0-9]+$'
        THEN (r."rowData"->>'ProductNo')::bigint ELSE -1 END DESC, r."createdAt" DESC, r."id" DESC
    ) AS rn
  FROM "CsvDashboardRow" r CROSS JOIN params p
  JOIN "ProductionScheduleGrindingPlanningBoardState" b
    ON b."csvDashboardId" = p.dashboard AND b."siteKey" = p.site
  WHERE r."csvDashboardId" = p.dashboard
    AND r."rowData"->>'FSEIBAN' IN (SELECT jsonb_array_elements_text(b."seibanOrder"::jsonb))
), winners AS (
  SELECT r.*, BTRIM(r."rowData"->>'FSEIBAN', r.ws) AS seiban,
    COALESCE(r."rowData"->>'FHINCD', '') AS part,
    BTRIM(NORMALIZE(r."rowData"->>'FKOJUN', NFKC), r.ws) AS process,
    BTRIM(r."rowData"->>'FSIGENCD', r.ws) AS resource,
    'row:' || RTRIM(TRANSLATE(REPLACE(ENCODE(CONVERT_TO(
      '[' || to_json(COALESCE(r."rowData"->>'FSEIBAN', ''))::text || ',' ||
      to_json(COALESCE(r."rowData"->>'FHINCD', ''))::text || ',' ||
      to_json(COALESCE(r."rowData"->>'FSIGENCD', ''))::text || ',' ||
      to_json(COALESCE(r."rowData"->>'FKOJUN', ''))::text || ']', 'UTF8'), 'base64'),
      E'\n', ''), '+/', '-_'), '=') AS parent_id
  FROM ranked r WHERE rn = 1
), candidates AS (
  SELECT w.*, BTRIM(COALESCE(o."overrideResourceCd", w.resource), w.ws) AS effective_resource
  FROM winners w
  JOIN "ProductionScheduleOrderSupplement" q ON q."csvDashboardRowId" = w."id" AND q."csvDashboardId" = w."csvDashboardId"
  LEFT JOIN "ProductionScheduleGrindingPlanningBoardOverride" o ON o."csvDashboardId" = w."csvDashboardId"
    AND o."siteKey" = w.site AND o."itemKey" = w.parent_id
  WHERE w.seiban NOT IN ('', '********') AND BTRIM(w.part, w.ws) <> '' AND w.process <> '' AND w.resource <> ''
    AND w.resource NOT IN ('305', '581', '582', '583', '584', '585', '586', '587', '588', '589', '10', 'MSZ')
    AND q."plannedQuantity" BETWEEN 2 AND 50
    AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleProgress" x WHERE x."csvDashboardRowId" = w."id" AND x."isCompleted")
    AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleExternalCompletion" x WHERE x."csvDashboardRowId" = w."id" AND x."isExternallyCompleted")
    AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPieceSet" x WHERE x."csvDashboardId" = w."csvDashboardId"
      AND x."fseiban" = COALESCE(w."rowData"->>'FSEIBAN', '') AND x."fhincd" = COALESCE(w."rowData"->>'FHINCD', '')
      AND x."fsigencd" = COALESCE(w."rowData"->>'FSIGENCD', '') AND x."fkojun" = COALESCE(w."rowData"->>'FKOJUN', ''))
    AND NOT EXISTS (SELECT 1 FROM winners e WHERE e.seiban = w.seiban AND e.part = w.part
      AND e.process <> '' AND e.resource <> '' AND CASE
        WHEN LENGTH(w.process) <= 64 AND LENGTH(e.process) <= 64
          AND w.process ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]{1,2})?$'
          AND e.process ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]{1,2})?$'
        THEN w.process::double precision > e.process::double precision
        ELSE false END)
)
SELECT effective_resource, COUNT(*) AS candidate_lots,
  COUNT(*) FILTER (WHERE process !~ '^[0-9]+$') AS nonstandard_process_lots
FROM candidates WHERE effective_resource IN ('021', '022') GROUP BY effective_resource;
```

migration 適用後の候補上位集合SQLは `auto-unit-split-candidates.ts` の `autoUnitSplitCandidateSql` が正本。候補ID読取（LIMIT 6）と、SQLがTS候補を漏らさないこと・通常条件の同値を調べる統合テストで同じSQLを用いる。上の反映前SQLもDBでは未実行であり、ユーザーのMac/Dockerで確認する。

### Validation / evidence for second review

- 関連unit: 18ファイル・542件成功、約7秒。最後の候補SQL条件調整後も該当10件を再実行して成功。SQLの21件上限で省略されたロットをskippedCountに混ぜない修正と追加1件は、自動分割unitの39件で再確認した（既存542件と重複あり）。`.integration.test.ts` は実行対象から除外し、TEST_DATABASE_URL はunset、非稼働URLとdotenv無効の一時設定を使用した。
- API `tsc -p tsconfig.build.json --noEmit`: 成功。API全lint・web全lint・web `tsc -p tsconfig.json --noEmit --incremental false` も成功。API lintが指摘した今回のimport重複warningは整理し、対象lintも再確認した。`git diff --check` は成功。検証時間はunit約7秒、型チェックとlintは各数十秒〜約3分。
- 最初のfocused runで2件の新規assertionが失敗した。SQLパラメータ配列の非対称matcherをarrayContainingへ、後工程の位置期待値を既存の詰め直し仕様へ修正し、上記unitで確認済み。
- DB統合テストはユーザーのMac/Dockerで実行する。親API同期、定義追加/減少/空、サイト範囲と空白正規化、工程記録付き切削/後工程/参照元の数量保護、SQL/TS候補一致ケースを追加・改訂した。PostgreSQLでの実行結果・同時実行時の応答時間は未確認。
- この回の開始時から存在したPR1差分を保持し、ユーザーの `sessaku-pieces.integration.test.ts` の片override用 `updateMany` も保持した。commit/push/branch操作、migration、deployは未実施。`.env`や秘密ファイルは読んでいない。

### Files changed in second review

Production: `production-schedule-command.service.ts`, `grinding-planning-board/shared.ts`, `grinding-planning-board/source.ts`, `sessaku-pieces/auto-unit-split-candidates.ts` (new), `auto-unit-split.service.ts`, `piece-operation-definitions.ts`, `piece-quantity.ts`, `sessaku-pieces.service.ts`.

Tests: `__tests__/production-schedule-command.service.test.ts`, `sessaku-pieces/__tests__/auto-unit-split-candidates.test.ts` (new), `auto-unit-split.service.test.ts`, `piece-operation-definitions.test.ts`, `piece-quantity.test.ts`, `sessaku-pieces.integration.test.ts`.

Docs: this plan and `docs/INDEX.md` (one-line navigation link).

## Third Review Corrections — 2026-11-09

### Decided behavior

- 1回5ロットまで、候補SQLは決定的な製番・生のparent ID・row ID順で最大6件。続きはhasMoreで処理する。初回投影は候補選別に一度だけ使い、各ロットの投影は独立txのロック下で読み直す。前の分割が同じレーンの順位やrevisionを書き換えるため、安全のためロット間で使い回さない。
- EXISTS/候補取得は共通の `untouched AS MATERIALIZED` で、先にPieceSet/Historyのない切削行へ絞る。その後でwinner・設定・数量・完了・前工程条件を掛ける。既存キー/Historyも候補製番に限定して取得する。
- 資源コードはprojectionと同じtrimのみ（カテゴリ照合時のみ大文字化）。NFKCで資源を同一視しない。親候補のquantityWarningはPieceSet由来なので、警告の有無や空setに関係なくPieceSet存在時点でSQL/TSとも除外する。
- SQLだけが返す工程順の不適格候補は、site+生のparent IDにCSV入力fingerprintを付けたプロセス内除外に保存する。fingerprintは同製番の生の論理キー集合（parent ID）の重複除去・ソート後の集約。前工程判定はこの集合だけに依存し、数量やoverrideはキャッシュしない。工程順・品番・元資源などキーが変われば失効する。SQLと投影読込の間にCSVが更新される場合に備え、投影元のキー集合がSQLのfingerprintと一致する場合だけ保存する。次回のSQLのEXISTS/候補取得から除外し、重い投影を繰り返さない。Historyは付けず、再起動後は一度再評価する。ボードから外れた製番はキャッシュから捨てる。
- 機能フラグ無効時はDB/監査へ入らずゼロ応答。候補0件・TS選別後0件も監査なし。実際の試行時だけ外側 `auto_unit_split`、内側 `auto_unit_split_lot` を記録する。
- 手で分けてからまとめたロットは、二度と自動分割しない。生の論理キーのHistoryを維持し、CSV再取込でもそのキーに対する手動操作歴は消さない。
- 保存済み片が投影から見つからない場合は `STALE_SESSAKU_PIECES` の409にし、非null assertionを使わない。

### Validation

- 直接変更した5ファイルのunitテスト: 107件成功、約3秒。DB統合ケースは実行していない。
- 最終関連unit: 16ファイル・431件成功、約5秒。最終の入力キー一致ガード追加後は、影響する3ファイル・80件（新規1件、前の実行との重複を含む）も成功、約2秒。sessaku-pieces全unit、resource-minutes/capacity、projection、親完了command、関連routeを実行した。DB統合ファイルはexcludeし、TEST_DATABASE_URLをunset、非稼働DATABASE_URLとdotenvをmockする一時設定を使用した。
- `pnpm --filter @raspi-system/api lint` / `pnpm --filter @raspi-system/web lint`: 成功（各約2分以内）。最終編集後、今回変更したAPI/テスト11ファイルのfocused ESLintも成功。
- `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit` / `pnpm --filter @raspi-system/web exec tsc -b`: 成功（各約1分以内）。最終編集後のAPI型チェックも成功。
- `git diff --check`: 成功。EXPLAIN SQL生成時の末尾空白だけを除去して再確認した。DB接続・migration・EXPLAIN・commit/push/branch操作は実施していない。`.env`や秘密ファイルは読んでいない。
- 開始時差分と最終差分をファイル単位で比較し、既存37ファイルの差分がすべて残り、今回対象外の25ファイルは差分そのものが一致することを確認した。今回の修正は既存差分中の12ファイルに限る。
- DB統合ケースにはSQL/TSの資源・警告同値、非数値の上位集合とCSV変更による除外失効、生品番の不一致、現場横断overrideを追加した。実行とEXPLAINはユーザーのMac/Dockerで行う。

### EXPLAIN SQL (after PR1 migration, not executed here)

以下は本番関数 `autoUnitSplitCandidateSql` が生成するSQLのbind値を、説明用の1行CTE `explain_params` に置き換えたもの。`site` と `seiban_order` を対象現場の値に変更し、資源カテゴリの除外リストも実設定に合わせる。まず全切削キーがPieceSet/History済みの定常状態、次に未接触候補がある状態で比較する。`untouched` が0行ならwinner/前工程/入力世代の計算が未実行または0回になることを確認する。キャッシュ再現時は `excluded_inputs` に初回候補のparentId/inputKeyを入れる（CSV変更後は再び候補になる）。資源/警告の同値とlocaleCompareの最終判定は統合テストで確認し、SQLの件数を最終分割件数として扱わない。

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH explain_params AS (
  '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'::text AS dashboard,
  ARRAY['target-seiban']::text[] AS seiban_order,
  U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'::text AS ws,
  ARRAY['305','581','582','583','584','585','586','587','588','589','10','MSZ']::text[] AS excluded_resources,
  'target-site'::text AS site,
  '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]{1,2})?$'::text AS decimal_pattern,
  '[]'::jsonb AS excluded_inputs
), untouched AS MATERIALIZED (SELECT r.*
    FROM "CsvDashboardRow" r
    WHERE r."csvDashboardId" = (SELECT dashboard
    FROM explain_params)
      AND r."rowData"->>'FSEIBAN' = ANY((SELECT seiban_order
    FROM explain_params)::text[])

      AND BTRIM(COALESCE(r."rowData"->>'FSIGENCD', ''), (SELECT ws
    FROM explain_params)) <> ''
      AND UPPER(BTRIM(COALESCE(r."rowData"->>'FSIGENCD', ''), (SELECT ws
    FROM explain_params))) <> ALL((SELECT excluded_resources
    FROM explain_params)::text[])

      AND NOT EXISTS (SELECT 1
    FROM "ProductionScheduleSessakuPieceSet" s WHERE s."csvDashboardId" = r."csvDashboardId"

      AND s."fseiban" = COALESCE(r."rowData"->>'FSEIBAN', '')
      AND s."fhincd" = COALESCE(r."rowData"->>'FHINCD', '')

      AND s."fsigencd" = COALESCE(r."rowData"->>'FSIGENCD', '')
      AND s."fkojun" = COALESCE(r."rowData"->>'FKOJUN', ''))

      AND NOT EXISTS (SELECT 1
    FROM "ProductionScheduleSessakuPieceHistory" h WHERE h."csvDashboardId" = r."csvDashboardId"

      AND h."fseiban" = COALESCE(r."rowData"->>'FSEIBAN', '')
      AND h."fhincd" = COALESCE(r."rowData"->>'FHINCD', '')

      AND h."fsigencd" = COALESCE(r."rowData"->>'FSIGENCD', '')
      AND h."fkojun" = COALESCE(r."rowData"->>'FKOJUN', ''))), eligible AS MATERIALIZED (
    SELECT r."id", r."csvDashboardId", r."rowData", r."rowData"->>'FSEIBAN' AS "fseiban", 'row:' || RTRIM(TRANSLATE(REPLACE(ENCODE(CONVERT_TO(
    '[' || to_json(COALESCE(r."rowData"->>'FSEIBAN', ''))::text || ',' || to_json(COALESCE(r."rowData"->>'FHINCD', ''))::text || ',' ||
    to_json(COALESCE(r."rowData"->>'FSIGENCD', ''))::text || ',' || to_json(COALESCE(r."rowData"->>'FKOJUN', ''))::text || ']', 'UTF8'), 'base64'), E'
', ''), '+/', '-_'), '=') AS "parentId"
    FROM untouched r
    LEFT JOIN "ProductionScheduleGrindingPlanningBoardOverride" o ON o."csvDashboardId" = r."csvDashboardId"
      AND o."siteKey" = (SELECT site
    FROM explain_params)
      AND o."itemKey" = ('row:' || RTRIM(TRANSLATE(REPLACE(ENCODE(CONVERT_TO(
    '[' || to_json(COALESCE(r."rowData"->>'FSEIBAN', ''))::text || ',' || to_json(COALESCE(r."rowData"->>'FHINCD', ''))::text || ',' ||
    to_json(COALESCE(r."rowData"->>'FSIGENCD', ''))::text || ',' || to_json(COALESCE(r."rowData"->>'FKOJUN', ''))::text || ']', 'UTF8'), 'base64'), E'
', ''), '+/', '-_'), '='))
    LEFT JOIN "ProductionScheduleGrindingPlanningBoardResourceCapacity" c ON c."csvDashboardId" = r."csvDashboardId"
      AND c."siteKey" = (SELECT site
    FROM explain_params)
      AND c."resourceCd" = BTRIM(COALESCE(COALESCE(o."overrideResourceCd", r."rowData"->>'FSIGENCD'), ''), (SELECT ws
    FROM explain_params))
    JOIN "ProductionScheduleOrderSupplement" q ON q."csvDashboardRowId" = r."id"
      AND q."csvDashboardId" = r."csvDashboardId"
    WHERE r."csvDashboardId" = (SELECT dashboard
    FROM explain_params)
      AND r."rowData"->>'FSEIBAN' = ANY((SELECT seiban_order
    FROM explain_params)::text[])

      AND BTRIM(COALESCE(r."rowData"->>'FSEIBAN', ''), (SELECT ws
    FROM explain_params)) NOT IN ('', '********')
      AND BTRIM(COALESCE(r."rowData"->>'FHINCD', ''), (SELECT ws
    FROM explain_params)) <> ''
      AND BTRIM(COALESCE(NORMALIZE(r."rowData"->>'FKOJUN', NFKC), ''), (SELECT ws
    FROM explain_params)) <> ''

      AND BTRIM(COALESCE(r."rowData"->>'FSIGENCD', ''), (SELECT ws
    FROM explain_params)) <> ''
      AND UPPER(BTRIM(COALESCE(r."rowData"->>'FSIGENCD', ''), (SELECT ws
    FROM explain_params))) <> ALL((SELECT excluded_resources
    FROM explain_params)::text[])

      AND COALESCE(c."unitSplitEnabled", BTRIM(COALESCE(COALESCE(o."overrideResourceCd", r."rowData"->>'FSIGENCD'), ''), (SELECT ws
    FROM explain_params)) IN ('021', '022'))
      AND q."plannedQuantity" BETWEEN 2
      AND 50

      AND NOT EXISTS (SELECT 1
    FROM "ProductionScheduleProgress" p WHERE p."csvDashboardRowId" = r."id"
      AND p."isCompleted")

      AND NOT EXISTS (SELECT 1
    FROM "ProductionScheduleExternalCompletion" x WHERE x."csvDashboardRowId" = r."id"
      AND x."isExternallyCompleted")

      AND
    "r"."id" = (
      SELECT "r2"."id"

    FROM "CsvDashboardRow" AS "r2"
      WHERE "r2"."csvDashboardId" = "r"."csvDashboardId"

      AND COALESCE("r2"."rowData"->>'FSEIBAN', '') = COALESCE("r"."rowData"->>'FSEIBAN', '')

      AND COALESCE("r2"."rowData"->>'FHINCD', '') = COALESCE("r"."rowData"->>'FHINCD', '')

      AND COALESCE("r2"."rowData"->>'FSIGENCD', '') = COALESCE("r"."rowData"->>'FSIGENCD', '')

      AND COALESCE("r2"."rowData"->>'FKOJUN', '') = COALESCE("r"."rowData"->>'FKOJUN', '')

      AND (BTRIM(COALESCE("r"."rowData"->>'FSEIBAN', '')) <> '********' OR BTRIM(COALESCE("r2"."rowData"->>'ProductNo', '')) = BTRIM(COALESCE("r"."rowData"->>'ProductNo', '')))
      ORDER BY
        CASE
      WHEN ("r2"."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN (("r2"."rowData"->>'ProductNo'))::bigint
      ELSE -1
    END DESC,
    "r2"."createdAt" DESC,
    "r2"."id" DESC
      LIMIT 1
    )


      AND NOT EXISTS (SELECT 1
    FROM "CsvDashboardRow" e WHERE e."csvDashboardId" = r."csvDashboardId"

      AND e."rowData"->>'FSEIBAN' = ANY((SELECT seiban_order
    FROM explain_params)::text[])

      AND e."rowData"->>'FSEIBAN' = r."rowData"->>'FSEIBAN'

      AND e."rowData"->>'FHINCD' = r."rowData"->>'FHINCD'
      AND BTRIM(COALESCE(NORMALIZE(e."rowData"->>'FKOJUN', NFKC), ''), (SELECT ws
    FROM explain_params)) <> ''
      AND BTRIM(COALESCE(e."rowData"->>'FSIGENCD', ''), (SELECT ws
    FROM explain_params)) <> ''

      AND CASE WHEN LENGTH(BTRIM(COALESCE(NORMALIZE(r."rowData"->>'FKOJUN', NFKC), ''), (SELECT ws
    FROM explain_params))) <= 64
      AND LENGTH(BTRIM(COALESCE(NORMALIZE(e."rowData"->>'FKOJUN', NFKC), ''), (SELECT ws
    FROM explain_params))) <= 64

      AND BTRIM(COALESCE(NORMALIZE(r."rowData"->>'FKOJUN', NFKC), ''), (SELECT ws
    FROM explain_params)) ~ (SELECT decimal_pattern
    FROM explain_params)
      AND BTRIM(COALESCE(NORMALIZE(e."rowData"->>'FKOJUN', NFKC), ''), (SELECT ws
    FROM explain_params)) ~ (SELECT decimal_pattern
    FROM explain_params)
    THEN (BTRIM(COALESCE(NORMALIZE(r."rowData"->>'FKOJUN', NFKC), ''), (SELECT ws
    FROM explain_params)))::double precision > (BTRIM(COALESCE(NORMALIZE(e."rowData"->>'FKOJUN', NFKC), ''), (SELECT ws
    FROM explain_params)))::double precision
    ELSE false END
      AND
    "e"."id" = (
      SELECT "r2"."id"

    FROM "CsvDashboardRow" AS "r2"
      WHERE "r2"."csvDashboardId" = "e"."csvDashboardId"

      AND COALESCE("r2"."rowData"->>'FSEIBAN', '') = COALESCE("e"."rowData"->>'FSEIBAN', '')

      AND COALESCE("r2"."rowData"->>'FHINCD', '') = COALESCE("e"."rowData"->>'FHINCD', '')

      AND COALESCE("r2"."rowData"->>'FSIGENCD', '') = COALESCE("e"."rowData"->>'FSIGENCD', '')

      AND COALESCE("r2"."rowData"->>'FKOJUN', '') = COALESCE("e"."rowData"->>'FKOJUN', '')

      AND (BTRIM(COALESCE("e"."rowData"->>'FSEIBAN', '')) <> '********' OR BTRIM(COALESCE("r2"."rowData"->>'ProductNo', '')) = BTRIM(COALESCE("e"."rowData"->>'ProductNo', '')))
      ORDER BY
        CASE
      WHEN ("r2"."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN (("r2"."rowData"->>'ProductNo'))::bigint
      ELSE -1
    END DESC,
    "r2"."createdAt" DESC,
    "r2"."id" DESC
      LIMIT 1
    )
  )
      -- Similar-looking but different raw part keys cannot share downstream pieces.

      AND NOT EXISTS (SELECT 1
    FROM "CsvDashboardRow" e WHERE e."csvDashboardId" = r."csvDashboardId"

      AND e."rowData"->>'FSEIBAN' = r."rowData"->>'FSEIBAN'

      AND e."rowData"->>'FHINCD' <> r."rowData"->>'FHINCD'

      AND BTRIM(COALESCE(e."rowData"->>'FSIGENCD', ''), (SELECT ws
    FROM explain_params)) <> ''
      AND BTRIM(COALESCE(NORMALIZE(e."rowData"->>'FKOJUN', NFKC), ''), (SELECT ws
    FROM explain_params)) <> ''

      AND BTRIM(COALESCE(NORMALIZE(e."rowData"->>'FHINCD', NFKC), ''), (SELECT ws
    FROM explain_params)) = BTRIM(COALESCE(NORMALIZE(r."rowData"->>'FHINCD', NFKC), ''), (SELECT ws
    FROM explain_params))

      AND
    "e"."id" = (
      SELECT "r2"."id"

    FROM "CsvDashboardRow" AS "r2"
      WHERE "r2"."csvDashboardId" = "e"."csvDashboardId"

      AND COALESCE("r2"."rowData"->>'FSEIBAN', '') = COALESCE("e"."rowData"->>'FSEIBAN', '')

      AND COALESCE("r2"."rowData"->>'FHINCD', '') = COALESCE("e"."rowData"->>'FHINCD', '')

      AND COALESCE("r2"."rowData"->>'FSIGENCD', '') = COALESCE("e"."rowData"->>'FSIGENCD', '')

      AND COALESCE("r2"."rowData"->>'FKOJUN', '') = COALESCE("e"."rowData"->>'FKOJUN', '')

      AND (BTRIM(COALESCE("e"."rowData"->>'FSEIBAN', '')) <> '********' OR BTRIM(COALESCE("r2"."rowData"->>'ProductNo', '')) = BTRIM(COALESCE("e"."rowData"->>'ProductNo', '')))
      ORDER BY
        CASE
      WHEN ("r2"."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN (("r2"."rowData"->>'ProductNo'))::bigint
      ELSE -1
    END DESC,
    "r2"."createdAt" DESC,
    "r2"."id" DESC
      LIMIT 1
    )
  )
    ), input_keys AS (
      SELECT DISTINCT r."rowData"->>'FSEIBAN' AS "fseiban", 'row:' || RTRIM(TRANSLATE(REPLACE(ENCODE(CONVERT_TO(
    '[' || to_json(COALESCE(r."rowData"->>'FSEIBAN', ''))::text || ',' || to_json(COALESCE(r."rowData"->>'FHINCD', ''))::text || ',' ||
    to_json(COALESCE(r."rowData"->>'FSIGENCD', ''))::text || ',' || to_json(COALESCE(r."rowData"->>'FKOJUN', ''))::text || ']', 'UTF8'), 'base64'), E'
', ''), '+/', '-_'), '=') AS "parentId"

    FROM "CsvDashboardRow" r WHERE r."csvDashboardId" = (SELECT dashboard
    FROM explain_params)

      AND r."rowData"->>'FSEIBAN' = ANY(ARRAY(SELECT DISTINCT "fseiban"
    FROM eligible))
      AND r."id" = (SELECT r2."id" FROM "CsvDashboardRow" r2
        WHERE r2."csvDashboardId" = r."csvDashboardId"
          AND COALESCE(r2."rowData"->>'FSEIBAN', '') = COALESCE(r."rowData"->>'FSEIBAN', '')
          AND COALESCE(r2."rowData"->>'FHINCD', '') = COALESCE(r."rowData"->>'FHINCD', '')
          AND COALESCE(r2."rowData"->>'FSIGENCD', '') = COALESCE(r."rowData"->>'FSIGENCD', '')
          AND COALESCE(r2."rowData"->>'FKOJUN', '') = COALESCE(r."rowData"->>'FKOJUN', '')
          AND (BTRIM(COALESCE(r."rowData"->>'FSEIBAN', '')) <> '********'
            OR BTRIM(COALESCE(r2."rowData"->>'ProductNo', '')) = BTRIM(COALESCE(r."rowData"->>'ProductNo', '')))
        ORDER BY CASE WHEN r2."rowData"->>'ProductNo' ~ '^[0-9]+$'
          THEN (r2."rowData"->>'ProductNo')::bigint ELSE -1 END DESC,
          r2."createdAt" DESC, r2."id" DESC LIMIT 1)
    ), input_generations AS MATERIALIZED (
      SELECT "fseiban", MD5(STRING_AGG("parentId", ',' ORDER BY "parentId" COLLATE "C")) AS "inputKey"

    FROM input_keys GROUP BY "fseiban"
    ), inputs AS (
      SELECT r."id", r."fseiban", r."parentId", g."inputKey"
    FROM eligible r
        JOIN input_generations g ON g."fseiban" = r."fseiban"
    ) SELECT "id", "fseiban", "parentId", "inputKey"
    FROM inputs r
      WHERE NOT EXISTS (SELECT 1
    FROM JSONB_TO_RECORDSET((SELECT excluded_inputs
    FROM explain_params)::jsonb)
        AS excluded("parentId" text, "inputKey" text)
        WHERE excluded."parentId" = r."parentId"
      AND excluded."inputKey" = r."inputKey")
      ORDER BY "fseiban" COLLATE "C", "parentId" COLLATE "C", "id"
LIMIT 6;
```

第4回修正で独立したEXISTS経路は廃止した。上のLIMIT 6の取得を1回だけ行い、入力指紋が前回の候補0件時と同じならCTE全体を省略する。

### Changed files (third review only)

Production:

- `apps/api/src/routes/kiosk/production-schedule/sessaku-pieces.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/auto-unit-split-candidates.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/auto-unit-split.service.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-operation-definitions.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/sessaku-pieces.service.ts`

Tests:

- `apps/api/src/routes/kiosk/production-schedule/__tests__/sessaku-pieces.route.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/auto-unit-split-candidates.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/auto-unit-split.service.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-op-completion.service.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-operation-definitions.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts`

Docs: this plan (`docs/plans/2026-11-09-sessaku-unit-split-ops-pr1.md`).


## Fourth Review Corrections — 2026-11-09

候補0件キャッシュ・比較許容差は第5回修正、対象外キャッシュ・エラー継続・前処理期限は第6回修正の現行仕様を優先する。

### Decided behavior

- SQLSTATEはPrismaの`meta.code`とPG adapterの`meta.driverAdapterError.cause.originalCode`の両方を読む。55P03/57014とP2028/P2024は自動分割のBUSYとして`hasMore: true`を返す。Historyは付けず、外側runnerの終了時timeoutでも既に成功したロット数を保持する。
- 親行の完了は、片ごとの実効資源（片override優先、なければ親、nullは元資源）とtrim品番の組を重複除去し、定義行をFOR SHAREで一括読込、工程番号も一括読込する。未登録の組も片ごとには問い合わせない。記録作成は1回のcreateMany(skipDuplicates)、取消は1回のdeleteMany。どの工程記録を作成・削除するかは従来どおり。
- 候補取得はLIMIT 6の1回に統合。候補0件だった入力は、同じ指紋なら次回CTEを実行しない。指紋は対象dashboardのCSV行・数量補完・手動/外部完了・PieceSet・History、および保存拠点のoverride・資源容量設定の行数とMVCC行バージョン（ctid/xmin）のハッシュ集約に、ボードのstateOrder・カテゴリ設定・既存の構造除外入力を加えたもの。追加・更新・削除で失効し、CSVや設定を変えれば再評価する。
- 指紋読込はwinner/前工程の結合やrowData投影をせず、軽量な列だけを走査する。dashboard全体の変更で安全側に失効するため、無関係な製番の変更でも再探索する。キャッシュはプロセス内のみでAPI再起動時に消え、再起動後の初回はCTEを再実行する。Historyによる恒久除外を新たに増やす用途には使わない。実DBでの指紋・CTEの実行時間/EXPLAINは未確認。
- 探索だけで3秒の予算を使い切っても候補があれば、最初の1件はその時点から最大1秒のtx/statement予算で分割を試す。2件目以降は元の3秒deadlineで打ち切り、未試行分はhasMoreで返す。外側runnerは10秒・maxWait 1秒のまま。レスポンス時間の厳密な上限ではない。
- 工程定義保存で補う完了記録は、保存した拠点のボードに表示され、同拠点の実効資源が保存対象と一致する完了片に、その保存定義のopNoだけを補う。削除するのは、その片の実効資源に合うどの拠点の定義にも存在しないopNoだけ。他拠点にしかない未記録opNoを追加せず、他拠点で必要な既存opNoは保持する（保持判定はその拠点の表示状態に依存しない）。
- 工程定義は拠点別、工程完了記録は拠点共通。`setSessakuPieceOpCompletion`で全工程完了から片完了を判定する際は、呼び出し拠点の工程定義だけを使う。別拠点の全工程が未完了でも、呼び出し拠点の全工程が完了すれば片は完了する。工程定義の保存自体は片/親の完了状態を変えない。
- 定義保存のlogical/board/親行ロックは、reconcileと同じ全拠点のstateOrderの和集合に属する製番のsetだけに限定する。表示外setをロックしない。critical→logical→board→親行→設定行の順は維持する。
- ops省略の旧クライアントは、保存工程がある品番への数値更新が工程合計と違えば400 `OPERATION_MINUTES_MISMATCH`でtx全体をrollbackする。合計と同じならsetupを含め受け付ける。工程未登録の品番は従来どおり。perUnitMinutes=nullの明示削除も従来どおり。資源既定のコメントは未設定021/022=true、それ以外=falseに修正。

### Operational limits / separate work

- Historyに通常の削除経路・保存期限は無く、生の論理キー単位で増え続ける。目安は操作対象/伝播対象となった新規の論理キーごとに最大1行（同一キーの再操作では増えない）。例: 新規キー1,000件/日なら年間約36.5万行、10,000件/日なら約365万行。実件数や保存サイズの測定は未実施。FKのdashboard削除cascadeはあるが、通常の掃除には使わない。
- Historyの掃除/保持期限/運用監視は別作業。手動操作済みロットを再び自動分割しない契約に影響するため、この修正では削除ジョブを導入しない。
- PR1のDB統合テストは`TEST_DATABASE_URL`が無い場合skipする。現行CIは`DATABASE_URL`だけを設定しており、このDB統合ファイルを実行していない。CIでの有効化は別件とし、今回CIは変更しない。

### Validation

- 関連unit: 17ファイル・456件成功、約12秒。dotenvをmockし、一時ディレクトリから非稼働DATABASE_URLで実行。DB統合ファイルはexclude、TEST_DATABASE_URLはunsetした。
- DB統合ケースは指紋のCSV/数量/設定/進捗変更による失効、拠点間の工程記録保持・限定補完、旧クライアントの合計不一致拒否を追加・改訂。実行はユーザーのMac/Dockerで行う。
- API/webの全lint、およびAPI `tsc -p tsconfig.build.json --noEmit` / web `tsc -p tsconfig.json --noEmit --incremental false` はすべて成功（静的検査は数分）。`git diff --check`も成功。DB接続・統合テスト・migration・commit/push/branch操作は実施せず、`.env`や秘密ファイルを読まずに検証した。

### Changed files (fourth review only)

- Production: `sessaku-pieces/{auto-unit-split-candidates.ts,auto-unit-split.service.ts,piece-db-error.ts (new),piece-operation-definitions.ts,sessaku-pieces.service.ts}`、`production-schedule-command.service.ts`、`grinding-planning-board-resource-minutes.service.ts`。
- Shared contract comment: `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts`。
- Tests: `sessaku-pieces/__tests__/{auto-unit-split.service.test.ts,piece-db-error.test.ts (new),piece-op-completion.service.test.ts,piece-operation-definitions.test.ts,sessaku-pieces.integration.test.ts}`、`__tests__/production-schedule-command.service.test.ts`、`__tests__/grinding-planning-board-resource-minutes.service.unit.test.ts`。
- Documentation: this plan only. 開始時からあった他ファイルのWIPは編集せず保持した。

## Fifth Review Corrections — 2026-11-09

### Decided behavior

- 工程表保存の削除は、保持するopNo集合をソートして同じ集合の片をまとめ、各集合を最大300片ずつdeleteManyする。工程番号は最大20種類なので1文のbindは最大320個。全削除は保存元の同じtxで行い、他拠点の保持判定・保存拠点への補完・version更新は維持する。
- 親行のadvisory lockは従来と同じSHA-256の64bitキー・idのlocaleCompare順を配列1文で取得する。その後、行ロックを`WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`の1文で取得する。logical/board lockの後、設定行の前という順序を保つ。
- 通常予算3秒、探索後の最初の1件の猶予は最大1秒。runner timeoutは10秒（3+1+6秒）、maxWaitは1秒。runner callback開始から9秒を安全なdeadlineとし、全分割のdeadlineをこの値以下に制限する。到達後は新規分割txを始めず、未試行候補を`hasMore:true`で返す。遅い探索からの初回も例外にしない。
- 対象外キャッシュとロット単位のエラー継続は、第6回修正の区別・仕様へ更新した。SQL/TSのinputKeyは同製番のwinner行の生parent ID集合を使い、キー集合が変われば構造的な除外が外れる。Historyは増やさない。
- 候補SQLが0件だった拠点は、応答時から5秒のTTL中、指紋SQL・候補SQLの両方を省略し、ゼロ件・`hasMore:false`を返す。別拠点へ流用しない。TTL内のCSV/設定/進捗変更の検知は最大5秒遅れる。TTL終了時に指紋を再取得し、同一なら候補CTEを省略してTTLを更新、変更時は候補を再探索する。候補ありの結果にTTLを付けない。プロセス再起動で消える。
- ボードから外れた製番の除外キャッシュ整理はSetで照合する。skippedCountは今回SQLが提示した候補のうち実際に飛ばしたロットだけを数え、投影に同居する既処理の兄弟を毎回加算しない。
- ops省略時の工程合計比較は絶対誤差`1e-6`以下を受け付ける。受け付け後のperUnitMinutesは保存工程の合計に揃え、許容差を超えれば従来の400/rollbackとする。

### Validation

- 対象unitは5ファイル・142件成功、約2秒。4,000片×20工程、保持集合別の削除・最大300片の分割、親行一括ロック、runner期限超過と初回猶予の上限、非再試行コード、入力変更による除外失効、拠点別5秒TTL、兄弟の非加算、時間の誤差許容/超過を確認した。
- `.env`を読み込むmoduleをmockし、空の一時ディレクトリをcwd/envDirとして非稼働DATABASE_URLで実行。TEST_DATABASE_URLをunsetし、DB統合ファイルはexcludeした。DB統合テストはユーザーが実行する。
- API/webの`pnpm --filter @raspi-system/{api,web} lint`、API `tsc -p tsconfig.build.json --noEmit --incremental false`、web `tsc -p tsconfig.json --noEmit --incremental false`は全て成功（静的検査は並列で約2分）。`git diff --check`も成功した。DB接続・migration・commit/push/branch操作は未実施。

### Changed files (fifth review only)

- Production: `sessaku-pieces/{piece-operation-definitions.ts,auto-unit-split.service.ts,auto-unit-split-candidates.ts}`、`order-assignment/production-schedule-parent-row-lock.service.ts`、`grinding-planning-board-resource-minutes.service.ts`。
- Tests: `sessaku-pieces/__tests__/{piece-operation-definitions.test.ts,auto-unit-split.service.test.ts,auto-unit-split-candidates.test.ts}`、`order-assignment/__tests__/production-schedule-parent-row-lock.service.test.ts`（新規）、`__tests__/grinding-planning-board-resource-minutes.service.unit.test.ts`。
- Documentation: this plan only. 既存の未コミット差分を保持し、commit/push/branch操作は行わない。


## Sixth Review Corrections — 2026-11-09

### Decided behavior

- ロック内の前工程/生キー構造による不適格だけを`AUTO_UNIT_SPLIT_STRUCTURALLY_INELIGIBLE`に分離し、候補SQLのparentId/inputKeyで拠点内除外キャッシュへ保存する。資源OFF・数量範囲外・投影item欠落は従来の`AUTO_UNIT_SPLIT_INELIGIBLE`とし、除外キャッシュにもHistoryにも保存しない。同一要求内でそのロットは再試行せず、次の要求で再評価する。OFF→ONや数量2→1→2は再起動なしで復帰する。候補SQLが0件の既存5秒TTLによる検知遅延は維持する。
- ロット単位の`ApiError.statusCode < 500`はコードによらずskippedCountへ加算し、status/code/拠点/親IDだけの警告を残す。retryNeededは立てず、通常は次ロットへ進む。BUSY/BUDGETは従来どおりそこで打ち切り`hasMore:true`、生のP2034は継続しretryNeededを立てる。未知の例外と5xxは再throwする。既存3種の構造的409に対するHistoryは維持する。
- runnerロック取得後、state初期化・state読込・カテゴリ設定読込・指紋SQL・候補SQL・winner読込・詳細等のPromise.all・投影の各段階後とロット処理前にsafe deadlineを確認する。期限切れなら後続段階を開始せず`hasMore:true`で返し、空結果キャッシュも作らない。3秒予算後の初回猶予もrunnerのsafe deadlineは延長しない。
- state読込・指紋SQL・候補SQL・winner読込・詳細/既存キー/override/rank/容量/History読込をrunner接続へ移し、各DB段階の前に残りsafe budget以内のtransaction-local `statement_timeout`を設定する。同一接続のPromise.allはDB上で直列化される。state初期化とカテゴリ設定は既存の別接続のまま段階後に期限判定する。レスポンス時間の厳密な上限や実DBでの所要時間は未検証。
- 工程定義保存の完了記録findManyは最大300片ずつ、PieceSetのversion更新updateManyは重複除去した最大300 setずつに分ける。削除と同じ呼出元txを使い、保持・補完・各setの1回だけのversion増分を維持する。

### Validation

- 関連unitは5ファイル・150件成功、約1.4秒。OFF→ON、数量2→1→2、ロック内理由の分類、想定外400/401/403/404/409/422/429の継続、前処理9段階の期限超過と次要求での復帰、statement_timeout/57014、4,000片の記録読込、601 setの更新分割を確認した。
- 一時ディレクトリをcwd/envDirとし、env/prisma/loggerモジュールをmock、非稼働DATABASE_URL・TEST_DATABASE_URL未設定で実行した。DB統合テストは実行せず、ユーザーが実施する。
- API/webの`pnpm --filter @raspi-system/{api,web} lint`、API `tsc -p tsconfig.build.json --noEmit --incremental false`、web `tsc -p tsconfig.json --noEmit --incremental false`は全て成功（静的検査は並列で数分）。`git diff --check`も成功。開始時からのWIPは保持し、今回対象の7ファイル以外の34ファイルは内容ハッシュが一致することを確認した。

### Changed files (sixth review only)

- Production: `sessaku-pieces/{auto-unit-split.service.ts,sessaku-pieces.service.ts,piece-operation-definitions.ts}`。
- Tests: `sessaku-pieces/__tests__/{auto-unit-split.service.test.ts,piece-op-completion.service.test.ts,piece-operation-definitions.test.ts}`。
- Documentation: this plan only. 既存WIPを保持し、commit/push/branch操作、DB接続・migration、`.env`や秘密ファイルの読込は実施しない。
