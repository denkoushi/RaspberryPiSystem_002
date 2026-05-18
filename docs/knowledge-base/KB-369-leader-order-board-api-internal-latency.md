---
title: KB-369 キオスク順位ボード API の内部レイテンシ（COUNT + 行取得）
tags: [kiosk, production-schedule, leader-order-board, api, performance]
audience: [開発者]
last-verified: 2026-05-18
category: knowledge-base
---

# KB-369: キオスク順位ボード API の内部レイテンシ（COUNT + 行取得）

## Context

本 KB は **「順位ボード遅延」に関する技術ナレッジの収束先**として機能する。単一エンドポイント内の SQL 最適化（COUNT 並列・winner materialization）に加え、**段階取得**・**資源カード単位 phased**・**snapshot + cursor** など、**プロトコルとクライアント構造**の変更も同一ファイルに時系列で記録する。2026-05-08 追補の **board 集約 API（`leaderboard-board` / `leaderboard-board/continue`）** は、**多資源スロット画面でブラウザが資源カードごとに `leaderboard-shell` 等を fan-out していた負荷**を、**サーバ側でスロット順にオーケストレーションして応答を束ねる**アプローチであり、意思決定の正本は [ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)。**`leaderboard-board/continue` の `cursor` 契約と HTTP 400** は [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md) に分離記録する。**2026-05-18 追補**: **`continue` 応答の任意 `deltaRows`（dual payload）** と Web 側の **ID 整合検証つきマージ**の要点も [KB-374 · Dual payload](./KB-374-leaderboard-board-continue-cursor-contract.md#dual-payload-deltarows-2026-05-18) に収束させる。

- **運用・合意上の制約（イニシアチブ共通）**: **表示内容を削って速く見せる**ことは禁止。**データ意味・並びの定義・装飾の契約**は従来と同値。改善は **HTTP 形状・クエリ評価・クライアントの取得パターン**に限定する。
- **対象（一覧 monolithic）**: `GET /api/kiosk/production-schedule`（`responseProfile=leaderboard`）
- **主経路（当該プロファイル）**: `listProductionScheduleRows` → 可視行 `COUNT(*)` + `fetchLeaderboardScheduleRowsWithSeibanAwarePriority`
- **目的**: **UI/API 契約・並び・件数定義を変えず**、サーバ内部および **ブラウザ↔API 往復**の待ち時間を短縮する

## Symptoms

- 順位ボード初回表示で API 応答が遅い（体感遅延）
- 計測・調査では **COUNT と leaderboard 行 SELECT の合算**が支配的になりやすい

## Investigation

- **仮説**: `leaderboard` 経路で COUNT 完了を待ってから行取得を開始していたため、壁時計時間が **2 クエリの直列和**になっていた
- **検証**: COUNT は行 SELECT の結果に依存しない（同一 `baseWhere` + `queryWhere` + Fkojunst 可視 WHERE）
- **結果**: **CONFIRMED**（並列化しても意味は不変）

## Root cause

- `responseProfile=leaderboard` 時に **COUNT の `await` の後に** `fetchLeaderboardScheduleRowsWithSeibanAwarePriority` を実行していた

## Fix（最小変更・仕様同一）

1. **COUNT 専用関数**に抽出: [`production-schedule-list-count.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-list-count.service.ts)（SQL は従来の `COUNT(*)` と同一条件）
2. **leaderboard 経路**: `Promise.all([count, rowSelect])` で **COUNT と行取得を並列実行**
3. **enrich + footer**: `enrichLeaderboardListRowsAndFooter` に集約（機種名・顧客名・`leaderboardFooterChipsByPartKey` は従来どおり）

`responseProfile=full` はもともと `Promise.all([count, mainSelect])` のため論点は leaderboard 側。

### 追補（2026-05-06）: ProductNo winner の materialization（相関除去・仕様同一）

- **課題**: `baseWhere` に含まれる `buildMaxProductNoWinnerCondition`（同一論理キー内で最大 ProductNo の行）は **WHERE ごとに相関評価**され、順位ボードの **複数クエリ × ページ行** でコストが積み上がることがある。
- **方針（同値変換のみ）**: 正本の PARTITION / ORDER は [`max-product-no-winner-spec.ts`](../../apps/api/src/services/production-schedule/row-resolver/max-product-no-winner-spec.ts) に集約し、**`fetchMaxProductNoWinnerRowIdsForDashboard`**（`ROW_NUMBER … rn=1`）で winner id を **1 クエリ確定**。`responseProfile=leaderboard`・`listLeaderboardShellProductionScheduleRows`・装飾 **hydrate**・**段階取得の `leaderboard-total`（総件数）**では、`buildProductionScheduleLeaderboardMaterializedBaseWhere` / `resolveLeaderboardMaterializedBaseWhere` 由来の **`csvDashboardId` + `id IN (...)`** を **`COUNT`**・**`fetchLeaderboardScheduleRowsWithSeibanAwarePriority`**・**hydrate** が **共有**（hydrate は呼び出し側から任意で `leaderboardMaterializedBaseWhere` を注入可能）。`prepareProductionScheduleDashboardFilters` の correlated `baseWhere` は **`full` 一覧**など従来どおり維持。
- **索引（2026-05-06 追補）**: `ProductionScheduleGlobalRowRank` に `csvDashboardRowId` 単独 INDEX を追加し、globalRank 相関サブクエリの探索を補助（定義・返却内容は不変）。
- **関連モジュール**: [`max-product-no-winner-materialization.ts`](../../apps/api/src/services/production-schedule/row-resolver/max-product-no-winner-materialization.ts)·[`leaderboard-row-selection.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts)（`leaderboardMaterializedBaseWhere` 引数へ変更）·[`leaderboard-shell-hydrate.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-hydrate.service.ts)

## Prevention

- [`production-schedule-query.service.test.ts`](../../apps/api/src/services/production-schedule/__tests__/production-schedule-query.service.test.ts)（leaderboard を含むケース）。**追補**: [`max-product-no-winner-materialization.test.ts`](../../apps/api/src/services/production-schedule/__tests__/max-product-no-winner-materialization.test.ts)（モック）。
- [`kiosk-production-schedule.integration.test.ts`](../../apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts) の **winner materialization と相関 winner の集合一致**（シード済みダッシュボード）。

## Production deploy & verification（2026-05-06 · leaderboard-shell winner materialization）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 は **必須対象外**（play **no hosts matched**。**Pi3 専用手順不要**）。
- **リポジトリ**: **`main`**: [PR #265](https://github.com/denkoushi/RaspberryPiSystem_002/pull/265) **squash**・**`ae5f938a`**（ブランチ **`fix/leaderboard-shell-winner-materialization`**・実装代表 **`b05baa5f`**）。
- **標準手順**: [`deployment.md` のデプロイ運用](../guides/deployment.md) と同じく **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·**`--detach --follow`**）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-190944-2060`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 888s**）。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 132s**・Tailscale）。
- **トラブルシュート**: 体感が変わらない／挙動が期待と違う → Pi5 **`api` イメージ**が当該コミット以降か（detach ログ・`git log -1`）。**相関 winner と materialize の集合**は統合テストで一致を確認済み。

## Production deploy & verification（2026-05-06 · leaderboard COUNT 並列化）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 は **本変更の必須デプロイ対象外**（inventory 上 **no hosts matched**）。
- **リポジトリ**: ブランチ **`fix/leaderboard-internal-query-latency`**・代表コミット **`35629338`**（**`main` マージ後は `main` 先端**を正とする）。
- **標準手順**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・**`--detach --follow`**）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-103441-24679`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**）。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 80s**・Tailscale）。

## Production deploy & verification（2026-05-06 · 段階取得 leaderboard-shell／total／decorations）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 は **必須対象外**（play **no hosts matched**）。
- **リポジトリ**: ブランチ **`feat/leaderboard-phased-fetch-2s`**・代表実装コミット **`cd751a2a`**（**`main` で squash マージされたら `main` 先端 SHA を正とする**）。
- **標準手順**: [`deployment.md` のデプロイ運用](../guides/deployment.md) と同じく **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・**`--detach --follow`**）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-113443-32585`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 849s**）。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 74s**・Tailscale）。
- **知見（装飾 hydrate の raw SQL）**: `Prisma.sql` の **`Prisma.join(array, ',')`** は **カンマ区切りの単一プレースホルダ**ではなく **断片連結**として解釈されるため、**`ARRAY[...]::uuid[]`** や **`IN (...)`** には **`Prisma.join` を 1 回だけ**渡す。**UUID 順序付け**は **`::text` 比較の `text[]` + `array_position`** が型安全。**Fkojunst 可視 SQL** は既存 leaderboard と同様、**連結済みフラグメントの先頭に余計な `AND` を付けない**（二重 AND になる）。

## Production deploy & verification（2026-05-07 · 段階取得 total の materialized COUNT 整合・globalRank 索引・Web stale 最小追随）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 は **必須対象外**（play **no hosts matched**。**Pi3 専用手順不要**）。
- **変更概要（仕様不変）**:
  - **API**: `leaderboard-total`（`countProductionScheduleDashboardVisibleRowsFromListFilters`）の **COUNT** を **相関 winner の `prepareProductionScheduleDashboardFilters().baseWhere`** ではなく、**`resolveLeaderboardMaterializedBaseWhere` と shell/leaderboard 本体と同じ materialized winner** に揃え、プランナ負荷のみ低減（件数定義は同一）。
  - **API**: `resolveLeaderboardMaterializedBaseWhere` 薄い境界・hydrate への **任意 `leaderboardMaterializedBaseWhere` 注入**・**`globalRank` 相関サブクエリの SQL 断片共通化**（[`leaderboard-global-rank-scalar.sql.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-global-rank-scalar.sql.ts)）。
  - **DB**: マイグレーション **`20260506170000_add_global_row_rank_csv_dashboard_row_id_index`**（`ProductionScheduleGlobalRowRank.csvDashboardRowId` 索引のみ・意味変更なし）。
  - **Web**: 段階取得 3 フックの **`staleTime` / `refetchOnWindowFocus: false`**・順位ボードページの **`useKioskProductionScheduleHistoryProgress({ enabled: scheduleEnabled })`**（表示内容は不変・再取得抑制のみ）。
- **リポジトリ**: ブランチ **`feat/leaderboard-output-stable-speedup`**・代表コミット **`137e7e07`**（**`main` で squash マージ後は `main` 先端 SHA を正とする**）。
- **標準手順**: [`deployment.md` のデプロイ運用](../guides/deployment.md) と同じく **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・**`--detach --follow`**）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260507-073532-249`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 739s**）。Ansible の **`Run prisma migrate deploy`** **成功**（索引マイグレーション適用）。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 27s**・Tailscale）。
- **トラブルシュート**:
  - **総件数（leaderboard-total）が一覧 shell とズレるように見える** → Pi5 **`api`** が **`137e7e07` 以降**（または **`main` マージ後の先端**）か。旧経路は相関 winner COUNT・新経路は materialized COUNT で **定義は同値だが**、イメージが古いと **レスポンスだけ**ズレたように見える。
  - **マイグレ未適用** → Pi5 `api` ログの **`prisma migrate deploy`** と `prisma migrate status`。索引名 **`ProductionScheduleGlobalRowRank_idx_csv_dashboard_row_id`**。
  - **Web の挙動が古い** → Pi5 **`web` コンテナ**の ref とキオスク [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 **強制リロード**。

## Production deploy & verification（2026-05-07 · 段階取得 append・`leaderboard-shell/continue`）

- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 順次**）。**Pi3 は対象外**（提示スコープ外）。
- **変更概要**: 初回 shell が **`pageSize` 未満**のとき **`POST …/leaderboard-shell/continue`** で続きを **同一フィルタ・同一並び**のまま追加（統合テストで monolithic `id` 一致を確認）。**マイグレなし**。
- **リポジトリ**: [PR #268](https://github.com/denkoushi/RaspberryPiSystem_002/pull/268) **squash**・**`main` `1baaee98`**。先行デプロイ時の実装 tip は **`2dd3c9b2`**。
- **Detach Run ID**（`ansible-update-`）: **`20260507-090345-18842`**（Pi5）/ **`20260507-091500-1467`**（`raspberrypi4`）/ **`20260507-093553-18573`**（`raspi4-robodrill01`・初回 `20260507-092030-22339` は `status-agent` 失敗→rollback 後に再試行成功）/ **`20260507-094833-877`**（`raspi4-fjv60-80`・初回 `20260507-093945-11807` 同様）/ **`20260507-095322-14546`**（`raspi4-kensaku-stonebase01`）。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（全台完走後。途中では `deploy-status` が **一時メンテナンス**で **FAIL 1** になり得る）。
- **トラブルシュート**: **Pi4 `status-agent.service` 再起動失敗** → rollback 後 **同一 `--limit` で再実行**。rescue 経路の **`utf-8` surrogate deserialize** は **付随**。**deploy-status** → 連続デプロイでは **`isMaintenance:true`** が残り得るため **完了後に再検証**。

## Production deploy & verification（2026-05-07 · サーバ内 snapshot・`snapshotId` / `snapshotExpired`）

- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 順次**）。**Pi3 は対象外**。
- **変更概要（HTTP 契約は維持）**:
  - shell が **`snapshotId`（任意）** を返し、continue が **`snapshotId` + `excludeRowIds`/`pageSize`** で **軽量追補**（未送信・不明・失効は **`excludeRowIds` フォールバック**）。
  - **TTL** 付き **プロセス内メモリ** `LeaderboardShellSnapshotStore`・**世代トークン**でソースデータ更新時の失効。**continue は同一 snapshot 内を直列化**（ロック）。
  - **`snapshotExpired: true`** 時、Web は **shell/total を invalidate**（`useLeaderboardPhasedScheduleWithAutoAppend`）。
- **リポジトリ**: [PR #269](https://github.com/denkoushi/RaspberryPiSystem_002/pull/269) **squash merge**・**`main` `fa3f3f2c`**（ブランチ **`fix/leaderboard-shell-snapshot`** は履歴用）。
- **標準手順**: [`deployment.md` の snapshot 項（2026-05-07）](../guides/deployment.md) と同様に **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・**`--detach --follow`**）。
- **Detach Run ID**（`ansible-update-`）: **`20260507-163719-11899`**（Pi5）/ **`20260507-164825-22626`**（`raspberrypi4`）/ **`20260507-165243-2819`**（`raspi4-robodrill01`）/ **`20260507-165602-24775`**（`raspi4-fjv60-80`）/ **`20260507-165951-8928`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **30s** 規模・Tailscale）。
- **トラブルシュート**:
  - **デプロイスクリプトが未コミット変更で止まる** → 無関係差分は **`git stash`**（本番とは別ブランチ／別意図の変更を混ぜない）。
  - **`snapshotExpired` が妙に多い** → **API が複数プロセスのとき snapshot はプロセスローカル**（振り分けで continue が別インスタンスに当たると失効やフォールバックが増えうる）。**ADR [ADR-20260507](../decisions/ADR-20260507-leaderboard-shell-snapshot.md)** の注意と **`LEADERBOARD_SHELL_SNAPSHOT_TTL_MS`** を確認。
  - **Web ビルドで型エラー（shell ログが `total` を参照）** → 契約上 shell に **`total` が無い**場合はデバッグログを **`hasSnapshotId` 等**へ（`apps/web/src/api/client.ts`）。

## Production deploy & verification（2026-05-07 · 資源CDカード単位 phased・同一製番展開の条件付き無効化）

- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 順次**）。**Pi3 は対象外**（本変更の必須反映対象外）。
- **変更概要**:
  - **API**: `resourceCds` が **ちょうど 1 件**の leaderboard phased 問い合わせでは、[`leaderboard-row-selection.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts) の **同一製番展開（`seibanExpansion`）をオフ**。**0 件・2 件以上**では従来どおり展開あり（互換・一括一覧相当）。
  - **Web**: [`useCompositeLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) が **資源 CD ごと**に段階取得し、**装飾 POST はマージ後行 ID で 1 回**。ページ: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)。
  - **検証**: Vitest [`production-schedule-query.service.test.ts`](../../apps/api/src/services/production-schedule/__tests__/production-schedule-query.service.test.ts)·[`useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx)。
- **リポジトリ**: ブランチ **`feature/kiosk-leaderboard-card-scope`**・代表コミット **`30a664f1`**（**`main` マージ後は `origin/main` HEAD を正とする**）。
- **標準手順**: [`deployment.md` のカード単位項（2026-05-07）](../guides/deployment.md) と同様に **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・**`--detach --follow`**）。
- **Detach Run ID**（`ansible-update-`）: **`20260507-212820-17030`**（Pi5）/ **`20260507-213838-14511`**（`raspberrypi4`）/ **`20260507-214421-9979`**（`raspi4-robodrill01`）/ **`20260507-214913-28430`**（`raspi4-fjv60-80`）/ **`20260507-215416-19850`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 121s**・Tailscale）。
- **トラブルシュート**:
  - **全カードの見た目納期が同一に偏る** → 旧挙動（一括プール＋製番展開）の疑い。API/Web の **ref** と Network の **shell ごとの `resourceCds`**（1 要素であること）を確認。
  - **append / snapshot / 装飾** → 直前の snapshot+cursor・サーバ内 snapshot 項と [ADR-20260507](../decisions/ADR-20260507-leaderboard-shell-snapshot.md) を参照。

## Production deploy & verification（2026-05-07 · continue の snapshot+cursor）

- **対象ホスト**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 順次**）。**Pi3 は対象外**。
- **変更概要**: continue を **`snapshotId` + `cursor`** 主軸にし、**`excludeRowIds`** は後方互換のみ。shell に **`nextCursor` / `hasMore`**。slice 境界は [`leaderboard-shell-continue.slice.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-continue.slice.ts)。Web は cursor ループ・**`appendError`**・**`snapshotExpired` 時に decorations も invalidate**。
- **リポジトリ**: [PR #270](https://github.com/denkoushi/RaspberryPiSystem_002/pull/270)（**squash マージ後は `main` 先端 SHA を正とする**）。実装ブランチ tip **`52b68c8c`**。
- **標準手順**: [`deployment.md` の snapshot+cursor 項（2026-05-07）](../guides/deployment.md) と同様に **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・**`--detach --follow`**）。
- **Detach Run ID**（`ansible-update-`）: **`20260507-190947-13634`**（Pi5）/ **`20260507-192208-14169`**（`raspberrypi4`）/ **`20260507-192734-3017`**（`raspi4-robodrill01`）/ **`20260507-193134-2805`**（`raspi4-fjv60-80`）/ **`20260507-193553-4333`**（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 104s**・Tailscale）。
- **トラブルシュート**:
  - **画面上に追補エラー** → **`appendError`** のメッセージと Network の **`leaderboard-shell/continue`** を確認。
  - **snapshot 系の失効・複数 API プロセス** → 上記 **サーバ内 snapshot** 項と [ADR-20260507](../decisions/ADR-20260507-leaderboard-shell-snapshot.md) を参照。

## Production deploy & verification（2026-05-08 · board 集約 API / fan-out 撤去）

- **対象ホスト**: 仕様上は **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 順次**）。**2026-05-08 時点の実施済み**は `raspberrypi5` と `raspberrypi4`。
- **変更概要（仕様不変）**:
  - **API**: `GET /api/kiosk/production-schedule/leaderboard-board` と `POST /api/kiosk/production-schedule/leaderboard-board/continue` を追加し、資源カードごとの shell/continue/total/装飾を **サーバ内で集約**して返す。
  - **Web**: 資源カードごとの fan-out ループを撤去し、単一 hook が board 集約 API を主経路として使用。
  - **既存 phased API は維持**し、互換性を壊さない。
- **リポジトリ**: ブランチ **`fix/leaderboard-shell-bounded-filler-fetch`**（マージ後は `main` を正本とする）。
- **標準手順**: [`deployment.md` のデプロイ運用](../guides/deployment.md) と同じく `update-all-clients.sh`（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`--detach --follow`）。
- **Detach Run ID**（`ansible-update-`）: **`20260508-175314-10578`**（Pi5）/ **`20260508-181440-11189`**（`raspberrypi4`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**。
- **広域自動検証（途中）**: `./scripts/deploy/verify-phase12-real.sh` は **PASS 42 / WARN 0 / FAIL 1**（約 **77s**）。FAIL は **`deploy-status raspberrypi4` が `isMaintenance:true`** のため。
- **API 計測（補助）**: `GET …/leaderboard-board?q=A&boardResourceCds=1,2&pageSize=160&responseProfile=leaderboard`（`x-client-key: client-key-raspberrypi4-kiosk1`）は **HTTP 200 / 5.43s・6.01s**（2 回）。この時の payload は **rows 0 件**で、重負荷データ条件の代表計測ではない。
- **トラブルシュート**:
  - **deploy-status が `isMaintenance:true` のまま** → 連続デプロイ中/直後は残留しうる。全対象ホスト完了後に再検証、または Pi5 `config/deploy-status.json` を確認。
  - **デプロイスクリプトの fail-fast（ローカル差分）** → `git stash push -u` で作業ツリーをクリーン化してから再実行。
  - **性能判断が不安定** → 空データ計測のみで「改善」と断定しない。運用相当データで再計測する。

## Open work（board 集約 API・2026-05-08 時点）

以下は **実装マージ済み／一部本番反映済み**だが、**運用・測定として未完了**の項目である。

1. **残りキオスク 3 台へのデプロイ**  
   **`raspi4-robodrill01`**, **`raspi4-fjv60-80`**, **`raspi4-kensaku-stonebase01`** には、2026-05-08 時点では **board 集約（API+Web）の反映が未記録**。手順は [deployment.md の 2026-05-08 項](../guides/deployment.md) と同一で、**`main`（または合流済みブランチ）**を **`--limit` 1 台ずつ**適用する。

2. **広域 Phase12 の「緑」再確認**  
   Pi5/Pi4 反映直後に **`verify-phase12-real.sh`** を走らせた記録では **PASS 42 / FAIL 1**（**`deploy-status raspberrypi4` が一時 `isMaintenance: true`**）。連続デプロイでは **メンテフラグ残留**が起きうるため、**全ホスト完了後に再実行**し **PASS 43 / FAIL 0** を狙う。

3. **本番相当データでの latency 証跡**  
   記録済みの **curl** は **`rows 0 件`** 条件下で **約 5.4〜6.0s**。**空結果はプランナ・I/O の経路が実データと異なる**ため、**「board 集約で十分速い」ことの根拠にはならない**。多資源・多行・代表的検索語での **ブラウザ Network（board 往返）**または **API サーバ側の構造化ログ**で **P95 帯**を取る。

4. **初回 shell の全件順序コスト**  
   board 集約は **往復数**を抑えるが、**初回一覧の選定・並び確定**が重い場合は **サーバ CPU/DB 時間**として残る。続柄の **cursor 化された continue** や snapshot TTL は別途議論（[ADR-20260507](../decisions/ADR-20260507-leaderboard-shell-snapshot.md)）。

5. **集約後の API プロセス負荷**  
   1 リクエストが複数スロット分の shell/total/装飾を扱うため、**同時リクエストが少数でも DB 並行性・プール枯渇**に触れうる。アルート別メトリクスや **遅いクエリログ**で監視対象に追加することを推奨。

## Troubleshooting

- **まだ遅い／反映されない**: Pi5 の **`api` コンテナ**が当該コミット以降か（detach ログの **`Git: changed`**・リモート `git log -1`）。**Mac 側 `--follow` が途中で途切れても**、**`PLAY RECAP` / `summary.json` / `*.exit`** を正本とする（[deployment.md](../guides/deployment.md) の detach 運用どおり）。
- **キオスク側の挙動（COUNT 並列化のみ）**: 当該リリースは **API のみ**。ブラウザは **強制リロード**（[verification-checklist.md](../guides/verification-checklist.md) §6.6.4）。
- **段階取得（API+Web）**: 初回のみ **複数 GET/POST**。挙動が古いときは Pi5 **`api` と `web` の両方**を確認し、同上 **強制リロード**。**装飾欠落の切り分け**は上記 **hydrate raw SQL** 知見と Network 順序を参照。

## 段階取得（leaderboard-shell / leaderboard-total / leaderboard-decorations）

順位ボードページは **初回のみ** 互換の単一 `responseProfile=leaderboard` ではなく、責務分割した以下を利用できる（**並びは `fetchLeaderboardScheduleRowsWithSeibanAwarePriority` 再利用・再ソートしないマージ**）。

| メソッド | パス | 役割 |
|---------|------|------|
| GET | `/api/kiosk/production-schedule/leaderboard-shell` | 装飾なし行（`pageSize` 既定 160・上限 160） |
| POST | `/api/kiosk/production-schedule/leaderboard-shell/continue` | 続き行。**推奨**: `snapshotId` + **`cursor`**（shell の `nextCursor`）+ `pageSize`≤160。**後方互換**: `excludeRowIds`（最大 900・プレフィックス一致検証） |
| GET | `/api/kiosk/production-schedule/leaderboard-total` | 一覧と同一条件の可視行件数のみ |
| POST | `/api/kiosk/production-schedule/leaderboard-decorations` | `{ rowIds[], targetDeviceScopeKey? }` で機種名・顧客名・フッターチップ（`rowIds` は表示順のまま。**上限 20000**） |

### 追補（2026-05-07）: `snapshotId` + `cursor` による continue（900 件 `excludeRowIds` 上限の回避）

- **課題**: 旧 continue は取得済み行 ID を毎回 **最大 900 件**までボディに載せ、件数増加で **payload 肥大化**・**全件追補不能**になった。
- **方針**: shell 応答に **`nextCursor`**（これまでに返した行数）と **`hasMore`** を付与し、continue は **`snapshotId` + `cursor`** のみで次チャンクを取得。並びの正本は従来どおり **インメモリ snapshot の `orderedRowIds`**（[`leaderboard-shell-snapshot.store.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-snapshot.store.ts)）。
- **slice 境界**: [`leaderboard-shell-continue.slice.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-continue.slice.ts)（cursor 進行・旧 exclude プレフィックス検証の純関数）。
- **Web**: [`useLeaderboardPhasedScheduleWithAutoAppend.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardPhasedScheduleWithAutoAppend.ts) が snapshot あり時 **cursor ループ**。**`snapshotExpired`** 時は shell / total に加え **`leaderboard-decorations` を predicate invalidate**。追補 API 失敗時は **`appendError`** をページに表示（[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)）。
- **残課題**: 初回 shell は引き続き **全件順序を一度確定**するため、極大件数では初回レイテンシは別途最適化の余地あり（全件性・cursor 化とは独立）。

### 追補（2026-05-08）: Web 初回表示 fastpath（`total` 非依存・1カード20件）

- **目的**: KPI を **「初回に一覧が見え始めるまでの時間」** に固定し、件数確定より **行の先出し**を優先。
- **Web**: [`useLeaderboardPhasedScheduleWithAutoAppend.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardPhasedScheduleWithAutoAppend.ts) は **`hasFreshTotal` を append 開始条件から外し**、shell 応答があれば total 未確定でも continue を開始する。
- **件数表示**: total 未確定中は **`mergedRows.length` を暫定 total** として扱い、取得後に確定値へ置換する。**total 単独失敗では shell rows を全体エラー扱いしない**。
- **初回件数**: Web の [`LEADER_ORDER_BOARD_SHELL_PAGE_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts) を **20** に変更。API の許容上限 **160** は維持しつつ、**1資源CDカード20件**で初回負荷を抑える。

実装: [`leaderboard-phased-read.ts`](../../apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts)・[`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts)（`listLeaderboardShellProductionScheduleRows` 等）。統合テスト: [`kiosk-production-schedule.integration.test.ts`](../../apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts) の phased ケース。

### 追補（2026-05-18）: board `continue` の winner materialization 共有・純粋組み立て分離（出力不変）

- **課題**: `continueLeaderboardCompositeBoard` の資源ループ内で、`fetchLeaderboardScheduleHydratedRowsOrderedByIds` 経路が従来 **`resolveLeaderboardMaterializedBaseWhere` を資源ごとに呼び得た**（同一リクエスト内で winner id 集合は不変のため冗長）。
- **方針（仕様同一）**: `resolveLeaderboardMaterializedBaseWhere(prisma)` を **リクエスト内 1 回**だけ実行し、得られた `Prisma.Sql` を全資源の hydrate / assemble に渡す（[`resolveLeaderboardMaterializedBaseWhere` の `precomputed` 引数意図と整合](../../apps/api/src/services/production-schedule/row-resolver/max-product-no-winner-materialization.ts)）。
- **構造（SOLID）**: continue の prefix/チャンク合成ロジックを [`leaderboard-composite-board-continue-assembly.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-continue-assembly.ts) に分離し、HTTP オーケストレーションは [`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts) に閉じる。
- **装飾**: `decorateLeaderboardShellRowsForKioskFromHydratedRows` への `preferredDisplayRowIds` は **`normalizeLeaderboardDisplayRowIdScope` を 1 回**だけ適用した配列を渡す（二重正規化の回避のみ・返却内容は不変）。
- **Web**: 集約フック [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) で、`scheduleEnabled=false` 時の `scheduleQuery` に **同一オブジェクト参照**を返し下流の派生再計算を抑制（表示データは不変）。
- **検証**: 統合テスト [`kiosk-production-schedule.integration.test.ts`](../../apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts) の `leaderboard-board continue profile logs: multi-resource append reaches hasMore=false` で、**continue ループ完了後の `rows[].id` 列および `total` が、単一 `GET …/leaderboard-board`（同一 `boardResourceCds`・十分な `pageSize`）と一致**することを assert。

## Production deploy & verification（2026-05-18 · output-stable internal optimization）

- **対象ホスト（ユーザー指定 5 台のみ・順次）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（各 `--limit` で **1 台ずつ**）。
- **本番デプロイ（実績）**: `./scripts/update-all-clients.sh perf/leaderboard-board-output-stable-v2 infrastructure/ansible/inventory.yml --limit <host> --detach --follow`。
- **Detach Run ID**（`ansible-update-`）: **`20260518-205259-21751`**（Pi5・`ok=134 changed=4 failed=0 unreachable=0`）/ **`20260518-210326-27579`**（Pi4・`ok=122 changed=10 failed=0`）/ **`20260518-210844-6675`**（robodrill01・`ok=122 changed=9 failed=0`）/ **`20260518-211243-7536`**（fjv60-80・`ok=122 changed=9 failed=0`）/ **`20260518-211700-30413`**（stonebase01・`ok=129 changed=10 failed=0`）。全 run でリモート **`exit 0`**・`Summary success: true`。
- **Pi3 方針**: 本件は Pi3 を対象に含めず、各 run の Pi3 play は **`skipping: no hosts matched`**（Pi3 専用手順は未適用で正）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 67s、Pi5 API `100.106.158.2`、`deploy-status` 4 台 PASS）。
- **回帰（Mac 単体）**: Docker Postgres + `kiosk-production-schedule.integration.test.ts -t "leaderboard-board continue profile logs"` を再実行し、`continue` 完了後の `rows[].id` / `total` が単一 GET と一致することを確認（出力不変）。
- **トラブルシュート**:
  - `gh run watch` のローカル timeout は CI 実行失敗を意味しない。`gh run view` で run 終了状態を別途確認する。
  - 連続デプロイ中の `deploy-status` は `isMaintenance` 残留で一時 FAIL し得るため、全台完了後に `verify-phase12-real.sh` を再実行して最終判定する。

## References

- [ADR-20260508 · board 集約 API（意思決定・代替案・ロールアウト）](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)
- 計画メモ（ローカル）: 「仕様不変の順位ボード高速化計画」（`leaderboard-spec-preserving-speedup`）
- [deployment.md](../guides/deployment.md)（2026-05-06 · winner materialization 項·leaderboard COUNT 並列化項·段階取得項·**2026-05-07 · total materialized 整合・索引・Web stale 項**·**2026-05-07 · append（continue）項**·**2026-05-07 · snapshot（サーバ内 TTL・`snapshotId`）項**·**2026-05-07 · 資源CDカード単位 phased 項**·**2026-05-08 · board 集約 API 項**）
- [ADR-20260507-leaderboard-shell-snapshot](../decisions/ADR-20260507-leaderboard-shell-snapshot.md)
- [KB-297 · COUNT 並列化（2026-05-06）](./KB-297-kiosk-due-management-workflow.md#leader-order-board-api-count-parallel-2026-05-06)
- [KB-297 · 段階取得（2026-05-06）](./KB-297-kiosk-due-management-workflow.md#leader-order-board-leaderboard-phased-fetch-2026-05-06)
