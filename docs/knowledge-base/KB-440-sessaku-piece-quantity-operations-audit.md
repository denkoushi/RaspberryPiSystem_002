# KB-440: Sessaku piece quantity, operation completion and parent audit

- Status: active
- Date: 2026-11-09
- Scope: API sessaku pieces and parent completion commands; local implementation only

## Symptoms And Root Cause

Quantity growth used the final unfinished piece even for unit-split lots. Operation
replacement removed obsolete evidence without aggregating remaining operations.
Parent completion updated pieces without passing through the piece audit writer.

## Fix

- For existing all-one pieces on an enabled effective resource, append units up to
  50 pieces. Put overflow on the final unprotected unfinished piece. Keep the
  existing decrease and non-unit policies. Import callers resolve effective
  resources and stored flags from boards displaying the lot inside the transaction.
- When all 50 pieces are protected, preserve evidence and report
  `INVALID_PLANNED_QUANTITY` rather than create piece 51 or change recorded work.
- Enforce this cap regardless of unit splitting or piece quantities; growth uses each site's parent resource override (or the set resource), ignoring piece overrides.
- Complete unfinished pieces with a nonempty retained operation set whose evidence
  is complete. Use existing quantity/progress synchronization to publish parent
  completion and downstream arrival. Later pieces retain independent completion.
  Empty definitions preserve completion; added operations fill completed pieces.
- Audit parent completion/cancellation after commit with before/after piece and
  operation snapshots and versions. Reuse the existing best-effort audit writer.

## Automatic Unit Split Runs In The Background (2026-11-11)

- Symptom: after PR #2682 the automatic unit split never split a production lot.
  Each lot rewrites ranks for every lane and site (estimated ~5.6 s on Pi5, not
  measured), but the per-lot budget was 3 s, and the split only ran while a
  planning board page polled `POST .../pieces/auto-unit-split`.
- The split is a first-time-only process. It now runs as the post-listen scheduler
  `sessaku-auto-unit-split` (leader only, gated by `SESSAKU_PIECES_CREATE_ENABLED=true`).
  It starts 30 s after start-up, repeats every 1 s while `hasMore`, and every 60 s when idle or after an error.
  A round that reports `hasMore` but splits nothing waits 2 s, then twice as long each time, up to
  60 s. This covers fast lot failures (P2034, SOURCE_ITEM_MISSING, PIECE_REFERENCED), a budget hit
  before any lot is chosen, and lots that keep exceeding the budget. One split returns it to 1 s.
  Wakes from old pages do not shorten this delay.
- Pacing (2026-11-11, after the Pi5 deploy): each lot rewrote 12k-19k rows and the 1 s interval kept
  docker-db-1 busy (lock held 141 s in 6 min, CPU up to 228%). A round that split a lot and still has
  more now waits 3 times its own duration (up to 5 min), so the job holds the DB at most about a quarter
  of the time. Wakes are ignored during this wait. Log event: `sessaku_piece.auto_unit_split_background_pacing`.
  The existing xact advisory lock still prevents a double run, and progress is
  re-derived from the DB after a restart or blue/green switch.
- The background job splits one lot per transaction, so every lot gets the full
  budget and a flush or commit failure is attributed to that lot. Per-lot budget
  is 20 s (runner timeout 27 s); the #2733 extended retry was removed. Retry delays are kept in memory only:
  - A lot that yields to a human save is deferred for 30 s, doubling up to 5 min.
  - A lot that exceeds the budget or fails is deferred for 3 min.
  - The lots behind a deferred lot keep progressing.
- `mergeSessakuPieces` sets `ProductionScheduleSessakuPieceSet.autoUnitSplitHeldAt`
  for both partial and full merges. Candidate SQL, the TS predicate and the
  automatic path of `splitSessakuPieces` skip held sets, so human merges are never
  split again automatically. Manual split is unchanged and keeps the marker.
  `ProductionScheduleSessakuPieceHistory` is not used as the marker: #2727 removed
  that gate on purpose, and the table also holds keys from manual sets made before the feature existed.
- The POST route now only wakes the scheduler and returns `hasMore: false`, so
  pages that are already open stop polling after one response. The board shows
  background splits on its next refetch (up to 5 min) or on reload.
- Log events to watch: `sessaku_piece.auto_unit_split_background`,
  `sessaku_piece.auto_unit_split_background_error`, `sessaku_piece.auto_unit_split_deferred`,
  `sessaku_piece.auto_unit_split_background_backoff` (`retryAfterMs`),
  `sessaku_piece.auto_unit_split_background_pacing` (`retryAfterMs`),
  and `sessaku_piece.auto_unit_split_call` (`totalMs`, `lockHeldMs`, `yieldReason`, `errorCode`).

## Planning Board Override Lost Updates (2026-11-11)

- Cause: lane rewrites (automatic/manual split, merge, quantity removal) run at
  ReadCommitted, read every override in the resource lane, and later upsert the
  whole lane with those read values. Piece-free item saves and due-scope saves did
  not take the site's board state lock, so a save committed in between was
  overwritten (due date, pin, special due, resource reverted).
- Fix: item/rank saves and due-scope writes always take `lockState` for their site
  before reading overrides (order: logical → state → parent row). Due-scope writes
  ensure the state row exists before the transaction. Arrival writers keep their
  conditional lock because they write separate tables.
- `lockState` converts a raw `40001` (P2010) to 409 `STALE_PLANNING_BOARD`. A
  RepeatableRead/Serializable save that waited behind a committed lane rewrite
  otherwise returned 500. Users now see "reload" instead of a silent revert.
- Evidence (local Postgres): `preserves a piece-free sibling save across a
  ReadCommitted split lane rewrite` fails without the fix ("successful sibling save
  must survive the split lane flush", value lost) and passes with it (409, values
  unchanged). The resource-reorder case only proves serialization; its RR rewrite
  already returned 409 before the fix.
- The tombstone due-scope test now expects the state lock (still no `sessaku`
  logical lock). `keeps an override on a same-logical-key winner…` in the board
  integration suite also fails on unchanged HEAD and is unrelated.

## FHINCD Investigation

Resource-part minute writes use `z.string().trim()`, and piece operation lookups
and definition reconciliation also use `trim()` and exact matching. These rules
agree. Neither side performs NFKC normalization or case folding. No change to the
resource-minutes/capacity files is required for this mismatch investigation.

## Validation

Unit tests cover unit growth, 50-piece overflow, protected evidence, independent
later links, operation removal/addition/empty definitions and parent audit failure.
DB cases are added to `sessaku-pieces.integration.test.ts` for user execution;
no DB connection or `.env` read is part of this local validation.

## References

- [Quantity planning](../../apps/api/src/services/production-schedule/sessaku-pieces/piece-quantity.ts)
- [Operation reconciliation](../../apps/api/src/services/production-schedule/sessaku-pieces/piece-operation-definitions.ts)
- [Parent commands](../../apps/api/src/services/production-schedule/production-schedule-command.service.ts)

## テスト加工の棒

- テスト加工はサイト別の独立表で管理し、公開IDは `test:<UUID>`。削除は論理削除で連番を再利用しない。
- 独自割当の資源内順位は通常棒と共有し、分割・まとめ・自動1台ずつ分割でも相対位置を維持する。
- 自動並べ替え・納期順はテスト棒のスロットを固定し、テスト棒の後は同品番でも段取りを付け直す。
- 完了・削除済みを除く時間を両時間ソースの合計と負荷へ加算する。変更はボード版を上げてキャッシュを更新する。
- 元割当は通常棒の既存順を保ち、テスト棒を保存順位に表示・集計する。編集は独自割当で行う。
- 対象検証: `grinding-planning-board.integration.test.ts`、`planning-board-test-bar-lanes.test.ts`、`PlanningBoardTestBars.test.tsx`。
- フォロー修正: テスト棒を含むレーンの保存前スナップショット・入荷フィルター中のundo・自動提案の現在順が
  `alternateRank` だけで並び、帯ごとの順位が混ざって `SPECIAL_DUE_ORDER_BAND_MISMATCH` になっていた。
  表示と共通の「特別納期の期限帯→帯内順位」で揃え、テスト棒は帯なしとして同じ帯へのドラッグだけを許可する。
- 自動提案の保存は `preview.sourceRevision` を優先し、提案後の別端末更新を競合として扱う。
  提案中はテスト棒の変更操作も無効になる。提案以外の保存はキューの最新リビジョンを使う。

## 1台の棒を工程で分ける (2026-11-12)

- 1台の棒の「数量」窓で「工程の数」(1〜6)と各工程の1台の時間を入れ、「{n}工程にする」で分ける。品番の値が未登録でも使える。
- API `POST .../pieces/ops/configure` は、その機械×品番の品番の値を1件だけ保存(既存は置き換え)し、同じロットの数量1・未完了の片すべての分け目を `fromOpNo` = 2..n にそろえる。品番の値の保存と分割は1トランザクションで、片セットの version と品番の値の期待値で衝突を検出する。
- 初期値は、未登録なら2工程で元の1台の時間を均等割り(0.5 丸め)、登録済みなら登録値。空欄は残り時間の均等割りで保存する。
- 段取りは窓に出さない。既存登録があれば工程番号で引き継ぎ、未登録なら1工程目に今の段取りを入れる。2台目以降の段取りは従来どおり先頭の台だけ。
- 対象は同じロットの数量1・未完了で、先頭の棒が押した棒と同じ機械にある片と、押した片そのもの。完了済みや、先頭の棒を別の機械へ移した片は触らない(後ろの工程の棒だけがこの機械にあっても触らない)。対象の片に工程完了記録があれば 409。
- 窓の操作で版が古いと 409 になり、ほかの片の操作と同じ「表示中のデータが更新されています。最新状態を取得してください。」を出してボードを読み直す。
- 工程番号は残す既存番号を引き継ぎ、新しい工程はそれより大きい番号にする(20 を超えると 409 `OPERATION_NUMBER_LIMIT`)。工程を減らして消える番号を対象外の片の分け目が使っていれば 409 `OPERATION_SPLIT_IN_USE`(先にそのロットをまとめる)。
- `POST .../pieces/ops/clear` は「まとめる」(scope=piece: その片の分け目を全部消す)と「全部まとめる」(scope=set: 未完了の全片)。✂ で入れた分け目も含めて消し、一部だけ残すことはしない。工程完了記録があっても実行でき、記録と品番の値の登録は残る。
- ガントでは同じ台の工程の棒をすき間なしで並べ、台の間を約8px空け、台ごとに途切れる製番色の下線を引く。後の工程ほど白を22%ずつ混ぜる(上限66%)。棒の中に番号は出さない。同じ片の工程が続くときは各工程の段取りを数え、それ以外は直前と同じ品番なら段取りを省く従来の規則のまま。この規則は通常ガント・「今日から」・負荷の振り分けで共通。
- 対象検証: `piece-op-splits.service.test.ts`、`PlanningBoardUnitOpEditor.test.tsx`、`planningBoardGanttLayout.test.ts`、`PlanningBoardGanttView.test.tsx`。
