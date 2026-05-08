# ADR-20260508: 順位ボード集約 API（leaderboard-board）

- **Status**: accepted
- **Context**: 多資源スロット画面がカードごとに `leaderboard-shell` / `leaderboard-total` / `leaderboard-shell/continue` を fan-out し、初回表示と追補で HTTP 回数が資源数に比例して増えていた。
- **Decision**:
  - 既存 phased エンドポイントは後方互換のまま維持する。
  - 追加で `GET /kiosk/production-schedule/leaderboard-board` と `POST /kiosk/production-schedule/leaderboard-board/continue` を提供する。
  - サーバは `apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts` にオーケストレーションを集約し、既存の `listLeaderboardShellProductionScheduleRows` / `listLeaderboardShellContinuationProductionScheduleRows` / `countProductionScheduleDashboardVisibleRowsFromListFilters` / `decorateLeaderboardShellRowsForKiosk` を再利用する。
  - Web の `useCompositeLeaderboardPhasedScheduleWithAutoAppend` は上記集約 API と単一 React Query 取得＋追補ループに切り替える（カード別 feed マウントを廃止）。
- **Consequences**:
  - クライアント側の並列リクエストが削減され、初回・追補の往復が資源数で線形に増えにくい。
  - 応答に `resources[]`（スロットごとの snapshot / cursor / hasMore / total）を含め、従来のカード単位意味を保持する。
- **References**:
  - `apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts`
  - `apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts`
  - `apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`
