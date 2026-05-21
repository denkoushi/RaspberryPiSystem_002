---
title: KB-374 leaderboard-board/continue の cursor 契約と HTTP 400（Zod）
tags: [kiosk, production-schedule, leader-order-board, leaderboard-board, api, web]
audience: [開発者, 運用者]
last-verified: 2026-05-22
category: knowledge-base
---

# KB-374: `leaderboard-board/continue` の `cursor` 契約と HTTP 400（Zod）

## Context

複合順位ボード（[`useCompositeLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx)）が **`POST /api/kiosk/production-schedule/leaderboard-board/continue`** を呼ぶ経路で、**`hasMore: true` かつ `snapshotId` があるのに `cursor` が欠ける**と **HTTP 400** になる事象があった。board 集約の背景は [ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)・収束 KB は [KB-369](./KB-369-leader-order-board-api-internal-latency.md)。

## Symptoms

- ブラウザ Network で **`leaderboard-board/continue`** が **400**。
- API ログまたは応答が **Zod バリデーション失敗**（ボディに **`cursor` が必須**な条件で欠落）。

## Investigation

- **仮説**: 応答の **`nextCursor`** が **`undefined`** のとき、クライアントが **`cursor` プロパティを JSON に載せない**（`undefined` を omit）ため、**`snapshotId` + `hasMore` がある続きリクエスト**でも **`cursor` 欠落**になりうる。
- **検証**: `leaderboard-composite-board.service` の shell／continue 応答と Web のペイロード組み立てを追跡。**結果**: **CONFIRMED**。

## Root cause

1. **サーバ**: 資源スロットごとの **`nextCursor`** が、計算上 **`undefined`** になり得た（クライアントはそれを **`cursor` として返す想定**）。
2. **クライアント**: JSON シリアライズで **`cursor: undefined` がキーごと落ちる**ため、スキーマ上 **`snapshotId` がある続き**では **`cursor` が無い不正ボディ**になる。

## Fix（最小変更）

1. **API**: [`leaderboard-board-resource-cursor.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-board-resource-cursor.ts) の **`resolveFiniteLeaderboardBoardNextCursor`** で、`shell`／`continue` が返す各 **`resources[].nextCursor`** を **有限のカーソル値へ正規化**（既存の `cursor`・行 ID・別経路のフォールバック連鎖）。[`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts) から利用。
2. **Web**: [`buildLeaderboardBoardContinuePayload.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) で、`hasMore && snapshotId` のとき **`cursor` を必ず載せる**（必要なら **`0` フォールバック**）。[`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) がこれを呼ぶ。
3. **テスト**: `leaderboard-board-resource-cursor.test.ts`・`buildLeaderboardBoardContinuePayload.test.ts`・複合 hook の **`cursor: 0`** ケース。

## Prevention

- **continue 系の契約変更**は **`shared.ts` の Zod** と **Web ペイロードビルダー**を **対で**見る（片側だけ直すと再発）。
- **`undefined` omit** に依存しない。**「続き」を意味するフラグがあるなら必須フィールドを明示的に送る**。

## Dual payload: deltaRows (2026-05-18)

- **`POST …/leaderboard-board/continue` のみ**、`rows`（累積・従来互換）に加え **`deltaRows` を省略可能で追加**。**旧クライアント**は未定義フィールドを無視し、これまでどおり **`rows`** のみで表示する。
- **付与条件（サーバ）**: 集約続き読みにおいて **全資源スロットとも**、`leaderboard-composite-board-continue-assembly` の **軽量チャンク合成**により「このラウンドで追加された continuation チャンク」が明示できる場合のみ **`deltaRows`** を載せる。いずれかのスロットで **チャンク空・ID ずれ・安全 hydrate フォールバック**等により差分意味を持てないときは **`deltaRows` キーごと省略**する（旧挙動＝ **`rows` 正本**）。
- **並び**: `deltaRows` は **`boardResourceCds` のスロット順**で、スロット内のcontinuationで増えた行を **順に連結**した配列（スロットに追加チャンクが無いときは **`[]`** のスライス）。
- **Web**: [`mergeLeaderboardBoardContinueResponse.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardContinueResponse.ts) が **`FSIGENCD`（大文字小文字無視）**で `rows` / `deltaRows` をスロット分割し、`prevRows`＋`deltaRows` の合成が **応答の累積 `rows` と同じ ID 列**になることを検証。失敗時は **サーバの `rows` オブジェクト**をそのまま採る（出力不変・安全側）。
- **段階導入（完了・2026-05-19）**: **Pi5 API 先行**（`deltaRows`）→ **Pi5 再デプロイ**（表示安定化 + pageSize 80）→ **Pi4×4 順次**（3 機能まとめて Web+API 同梱）。手順・Detach 実績: [deployment.md §deltaRows](../guides/deployment.md#kiosk-leaderboard-continue-deltarows-dual-payload-2026-05-18)·[§表示安定化](../guides/deployment.md#kiosk-leaderboard-display-stability-refetch-2026-05-19)·[§pageSize 80](../guides/deployment.md#kiosk-leaderboard-pagesize-80-phase1-2026-05-19)。

## Web 表示安定化: refetch 時の追補巻き戻し防止（2026-05-19）

- **症状**: 順位ボードで行が **一時的に減ってから戻る**／体感が遅い。`deltaRows` 導入後に顕在化しやすい。
- **根因**: [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) が **`boardQuery.dataUpdatedAt` 更新ごと**に continue 追補を **shell 起点で再開**し、表示が途中段階へ戻っていた（120秒ポーリングと整合）。
- **Fix（Web・契約不変）**:
  - [`leaderboardBoardAppendSessionPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendSessionPolicy.ts) … shell **内容指紋**と追補完了状態で **不要な再開を抑止**。
  - [`leaderboardBoardDisplayPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardDisplayPolicy.ts) … **追補済み行数 ≥ shell** のとき表示を維持（refetch 巻き戻し防止）。
  - [`mergeLeaderboardBoardContinueResponse.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardContinueResponse.ts) … `canMergeLeaderboardContinueDelta` で **マージ可否を明示**し、失敗時は **`rows` 正本**。
- **検証**: Web Vitest（追補完了後 refetch でも行数維持）·統合テスト `leaderboard-board continue profile logs`（出力同値）。

## 製番 OR フィルタ解除と placeholder shell（2026-05-19）

- **症状**: 順位ボード左ペインの登録製番を **OFF（OR 検索解除）** しても、一覧行数が **絞り込みのまま**戻らない（再描画されていないように見える）。仕様は [KB-297 §製番チップ・複数選択](./KB-297-kiosk-due-management-workflow.md#leader-board-seiban-or-filter-2026-04-29)（`activeQueries` 空 → `q` なしで全件）。
- **調査（Pi5 実機）**: `GET leaderboard-board` は **`q` 解除後に行数が増える**（API は正常）。**CONFIRMED**: Web が React Query の **`placeholderData`** により **旧 `paramsKey`（`q` 付き）の shell** を、**新 `paramsKey` 取得中も表示**に使っていた。旧 `useLeaderboardPhasedScheduleWithAutoAppend` は `!isPlaceholderData` でガードしていたが、集約 hook では未適用。
- **Fix（Web・契約不変）**:
  - [`leaderboardBoardShellFreshnessPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardShellFreshnessPolicy.ts) … **`lastCommittedParamsKey` と現 `paramsKey` が不一致のときだけ** placeholder shell を表示から除外（**同一 params の refetch placeholder は維持** — 上節の巻き戻し防止と両立）。
  - [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) … `resolvedShell`・append 開始ガード・解除直後の短い `isLoading`。
- **Prevention**: `isPlaceholderData` 単体では不足。**検索条件変更（`paramsKey`）** と **最後に確定した params** を併用する。Vitest: `leaderboardBoardShellFreshnessPolicy.test.ts`・`useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx`（params 変更後 placeholder）。
- **追補（`426889d6` 副作用と本修正 `08613580`）**:
  - **症状（Pi5 実機・2026-05-19）**: 登録製番フィルタは **1 回目だけ効く**／**OFF で全件に戻らない**／修正デプロイ後は **リロード後に全件表示すらされない**。API の `GET leaderboard-board` は **`q` 解除後に行数が増える**（API 正常）→ **Web の追補・表示合成**が原因。
  - **根本原因（CONFIRMED）**: stale override 防止のため append 用 `useEffect` の deps に **`appendOverrideForCurrentParams`**（= `setAppendOverride` 連動）を追加（**`426889d6`**）。**`setAppendOverride` のたびに effect cleanup → `cancelled=true` で continue 中断**。`shouldBeginLeaderboardAppendSession` により **同一 shell 指紋では再開しにくい** → 本番相当（初回 shell 多行でも **複数資源 `hasMore` 残り**）で追補未完。副次: **ref と state の非同期ずれ**（`appendOverrideParamsKeyRef` は一致するが state が遅れ、表示用 override を捨てる）。
  - **Fix（`08613580`・契約不変）**:
    - [`leaderboardBoardAppendOverrideScopePolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendOverrideScopePolicy.ts) … **現 `paramsKey` に属する override のみ**返す（**ref + `overrideParamsKey` が正本**）。
    - [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) … 表示・loading・ループ開始はスコープ済み override。**append effect の deps から override 状態を除外**（`b0343567` の placeholder 抑制は **維持**）。
    - `snapshotExpired` 時は **`appendOverrideParamsKeyRef` もクリア**。
  - **検証**: Vitest — `leaderboardBoardAppendOverrideScopePolicy.test.ts`・`hasMore` あり continue 完走 → 製番 OFF → placeholder → 全件 shell（`useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx`）。
  - **現場（Pi5→Pi4×4 本番反映後）**: **動作 OK**（ユーザー確認・2026-05-19）。

## 第1弾 pageSize 80（continue 回数削減・2026-05-19）

- **背景**: 表示安定化（上節）後も **全行揃うまでの体感**が遅い。`deltaRows` は **差分のみ取得ではなく**、クライアント最適化用の任意フィールド（**正本は累積 `rows`**）。遅延の主因は **`pageSize` 小さめ + continue 直列**による **HTTP 往復回数**（Mac ベンチ: 2資源×140行で pageSize 20→80 で完了時間約75%短縮・整合性 OK）。
- **Fix（Web のみ・契約不変）**: [`LEADER_ORDER_BOARD_SHELL_PAGE_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts) を **20 → 80**。API Zod 上限 **160** 内。`rows` 正本・`deltaRows` 失敗時フォールバック・refetch 巻き戻り防止は **変更しない**。
- **対象外（第2弾）**: continue 内 COUNT/装飾の再利用、continue 並列化、`deltaRows` 契約変更。
- **ロールバック**: 不整合・体感悪化時は定数を **20 に戻す**（1点）。
- **展開**: **Pi5 先行**（Web+API コンテナ）→ ゲート通過後 **Pi4 順次**（キオスクは Pi4 Web が `pageSize` を送るため、体感改善には Pi4 反映が必須）。
- **Pi5 ゲート**: 2分以上ちらつきなし・体感短縮・Network で continue 回数減・行 ID/件数が単発 GET と一致。
- **検証**: Web Vitest（`useCompositeLeaderboardPhasedScheduleWithAutoAppend` 等）·統合テスト `leaderboard-board continue profile logs`（API 変更なしでも回帰）。

## Production deploy & verification（2026-05-19 · `feat/leaderboard-continue-delta-safe`）

**ブランチ**: **`feat/leaderboard-continue-delta-safe`**（実装 tip 順: **`371a1ce2`** `deltaRows` · **`f627dcb0`** 表示安定化 · **`f6a220e0`** pageSize 80）。**新規マイグレーションなし**。

### 仕様要約（後続スレッドのコンテキスト用）

| 層 | 内容 | 契約 |
| --- | --- | --- |
| API | `POST …/leaderboard-board/continue` に任意 **`deltaRows`**（累積 **`rows` は従来どおり正本**） | 旧クライアントは `deltaRows` 未定義を無視 |
| Web | refetch 時の追補巻き戻し防止（append session 指紋 + display policy） | HTTP 契約不変 |
| Web | `LEADER_ORDER_BOARD_SHELL_PAGE_SIZE` **20→80** | Zod 上限 160 内・API 変更なし |

### 本番デプロイ（Detach Run ID・`ansible-update-` 接頭辞）

**標準**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/leaderboard-continue-delta-safe infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。

| 段階 | ホスト | Detach Run ID | 備考 |
| --- | --- | --- | --- |
| Pi5 先行（`deltaRows` API） | `raspberrypi5` | **`20260518-222320-4985`** | `Git: changed`・Docker 再起動 |
| Pi5（表示安定化 + pageSize 80） | `raspberrypi5` | **`20260519-094525-13421`** | `Rebuild/Restart docker compose` **changed**・`prisma migrate` **ok** |
| Pi4 順次（3 機能同梱） | `raspberrypi4` | **`20260519-095716-15636`** | `kiosk-browser` / `status-agent` 再起動 |
| 同上 | `raspi4-robodrill01` | **`20260519-100222-24882`** | 同上 |
| 同上 | `raspi4-fjv60-80` | **`20260519-100620-10211`** | 同上 |
| 同上 | `raspi4-kensaku-stonebase01` | **`20260519-101025-2757`** | 同上 |

いずれも **`PLAY RECAP failed=0` / `unreachable=0`**・リモート **`exit 0`**・サマリ **`success: true`**。**Pi3** は各 run で **`no hosts matched`**（専用手順未実施で正）。

### 実機検証

- **自動**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 API `100.106.158.2`・Tailscale）。
- **`deploy-status`（Pi4×4）**: すべて **PASS**。
- **Pi4 `status-agent`**: 4 台すべて **PASS**。
- **現場（ユーザー）**: 各キオスクで順位ボードを開き **表示正常**・**体感速度維持**を確認（pageSize 80 含む）。

### ローカル回帰（実装時）

- **Web Vitest**: `leaderOrderBoard/__tests__`（追補完了後 refetch・pageSize 80・delta merge 等）。
- **API 統合**: `kiosk-production-schedule.integration.test.ts -t "leaderboard-board continue profile logs"`（`deltaRows` 配列・完了後 `rows`/`total` が単一 GET と一致）。

### Troubleshooting

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| 行が一瞬減って戻る（2 分ポーリング前後） | Pi4 **Web** が **`f627dcb0` 未反映**、または追補完了前 | 当該ホスト Detach の **`Git: changed`**・キオスク強制リロード。表示安定化は **Web のみ** |
| 全行揃うまで遅い・continue が多い | Pi4 Web が **pageSize 20 のまま** | **`f6a220e0` 以降**を Pi4 に再デプロイ（**Pi5 のみではキオスク体感は変わらない**） |
| 表示の並び・件数がおかしい | `deltaRows` マージ失敗 | クライアントは **`rows` 正本にフォールバック**（出力不変）。Network で continue 応答の **`rows` と UI** を照合 |
| `leaderboard-board/continue` が **400** | `cursor` 欠落（別件） | [KB-374 §Root cause](#root-cause)·[`buildLeaderboardBoardContinuePayload`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) |
| 体感は遅いが continue 回数は減った | 第2弾対象（COUNT/装飾再利用・並列化） | 本リリース範囲外。ロールバックは **`LEADER_ORDER_BOARD_SHELL_PAGE_SIZE=20`** の 1 点 |

## 第1段階 pageSize 初回10 / 追補40 + continue 装飾分離（2026-05-19 · `feat/leaderboard-board-initial-10-continue-40`）

**目的**: 初回表示を **スロットあたり10行**に抑えて「読み込み中…」から一覧が出るまでを短くする。追補は **`pageSize=40` 固定**（`board.pageSize` に依存しない）。**全 continue 完了後**の `rows`（id 列・`total`・装飾・`leaderboardFooterChipsByPartKey`）は **pageSize 80 系と同値**（統合テスト `leaderboard-board continue profile logs` が正本）。

### 仕様（実装の正本）

| 層 | 内容 | 定数 / モジュール |
| --- | --- | --- |
| Web 初回 GET | `leaderboard-board?pageSize=10`（スロットあたり） | [`LEADER_ORDER_BOARD_SHELL_INITIAL_PAGE_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)（**10**） |
| Web continue POST | `body.pageSize` は常に **40** | [`LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)·[`buildLeaderboardBoardContinuePayload.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) |
| Web legacy | `useLeaderboardPhasedScheduleWithAutoAppend` の continue も **40 固定** | 同上 |
| API shell | 装飾は従来どおり `decorateLeaderboardShellRowsForKiosk`（行数のみ **N×10** に縮小） | [`leaderboard-composite-board-decoration.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-decoration.service.ts) `decorateLeaderboardCompositeBoardShell` |
| API continue | **増分行**を `decorateLeaderboardShellRowsForKioskFromHydratedRows`、**prefix 行**は `fetchLeaderboardScheduleHydratedRowsOrderedByIds` + machine/customer enrich、**フッタ**は **enrich 前の merged light 行**で `buildLeaderboardFooterChipsByPartKeyForScheduleRows` | 同上 `decorateLeaderboardCompositeBoardContinue` |
| API フォールバック | `canAttachDelta` 不可時は **累積 merged 全行**を従来どおり一括装飾（出力不変） | 同上 |

**意図的に触らない**: `deltaRows` 契約、`mergeLeaderboardBoardContinueResponse`、refetch 時の表示安定化（[`leaderboardBoardAppendSessionPolicy`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendSessionPolicy.ts) 等）。

**代表コミット**: **`1e214213`**（`feat(kiosk): leaderboard board initial 10 rows and continue chunk 40`）。

### 本番デプロイ（Pi5 のみ · Pi4 展開なし）

**方針（2026-05-19）**: **実機検証のため Pi5 のみ先行反映**。**Pi4 キオスク群へのデプロイは実施しない**（体感が **pageSize 80 本番より遅い**との現場フィードバックのため）。

| 項目 | 値 |
| --- | --- |
| ホスト | **`raspberrypi5` のみ**（`--limit raspberrypi5`） |
| ブランチ | **`feat/leaderboard-board-initial-10-continue-40`**（tip **`1e214213`**） |
| Detach Run ID | **`20260519-125903-25635`**（`ansible-update-` 接頭辞） |
| PLAY RECAP | **`ok=134` `changed=4` `failed=0` `unreachable=0`** |
| サマリ | **`Git: changed`**・Docker 再起動 **`ok`**・リモート **`exit 0`** |
| Pi4 / Pi3 | **`no hosts matched`**（Pi4 未展開は **意図的**） |

**標準コマンド（記録）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/leaderboard-board-initial-10-continue-40 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`

### 実機検証

| 種別 | 結果 |
| --- | --- |
| 自動 | `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **35s**） |
| API スモーク | `GET …/leaderboard-board?…&pageSize=10` → 応答 **`pageSize: 10`**・`resources[].pageSize: 10`（当該資源に行が無い環境では **`rows: 0`** もあり得る） |
| **現場（Pi5・ユーザー）** | 順位ボードの **表示速度が pageSize 80 展開時より遅くなった**（**初回だけ速い**仮説は **未確認** — **全件揃うまでの体感**が悪化した可能性） |

### 遅延の切り分け（調査メモ · INCONCLUSIVE 〜 仮説）

1. **continue 往復回数の増加**: 初回 **10/スロット**・追補 **40/回**のため、**全件到達までの HTTP ラウンド数**は **pageSize 80 一括初回**より **増えうる**（Mac 統合テストは **最終 id/total 同値**のみ保証し、**途中の壁時計**は測っていない）。
2. **continue 装飾の prefix 再処理**: 各 continue で **累積 prefix 行**に対し hydrate + enrich を **毎ラウンド再実行**（件数は増分行より軽い設計だが、**累積が大きいと DB/CPU が支配**しうる）。
3. **増分 enrich 内のフッタ計算**: `decorateLeaderboardShellRowsForKioskFromHydratedRows` は内部でフッタを計算するが、本実装は **merged light 行で別途フッタ**を正本としており、**増分経路のフッタは破棄**（無駄 DB は残りうる）。
4. **Pi5 のみ更新**: キオスク **Web が Pi4 上**の場合、**Pi5 API だけ新挙動**でも **クライアントが旧 `pageSize` のまま**なら体感は変わらない — 今回の **「Pi5 で遅い」**は **Pi5 上のキオスク／同一 API 利用端末**での観測として記録する。

### Troubleshooting（本件）

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| **pageSize 80 より遅い**（Pi5 に本ブランチ反映済） | Network で **初回 `pageSize=10`** と **continue 回数・各応答時間**を確認。サーバログで **continue あたりの装飾時間** | **Pi4 へは展開しない**（2026-05-19 決定）。ロールバックは Pi5 を **`main`（pageSize 80 系）**へ再デプロイ、または定数 **10/40 → 80/80** へ戻して再検証 |
| 初回は速いが全件揃うまで遅い | **continue ラウンド数**・**prefix 装飾**・**continue あたり COUNT** を疑う | **第1弾 COUNT 再利用**は [§continue COUNT 再利用](#continue-時-count-再利用第1弾--api-のみ--出力不変)（**Pi5 本番・現場 OK**）。残り: prefix 装飾キャッシュ・continue 並列化（[KB-369](./KB-369-leader-order-board-api-internal-latency.md)） |
| 件数・装飾がおかしい | 統合テスト相当の **完了後 id/total** を単発 GET と照合 | `canAttachDelta` 失敗時は **累積全行装飾**フォールバック（出力不変） |
| Pi4 が旧挙動のまま | **本ブランチ未デプロイ**（意図どおり） | Pi4 展開する場合は **5 台順次**（[deployment.md §初回10/追補40](../guides/deployment.md#kiosk-leaderboard-initial-10-continue-40-phase1-2026-05-19)）— **現時点では実施しない** |

### ローカル回帰（実装時）

- Web: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard/__tests__`（**113 passed**）
- API 単体: `leaderboard-composite-board-decoration.service.test.ts`（**3 passed**）
- API 統合: `kiosk-production-schedule.integration.test.ts -t "leaderboard-board continue profile logs"`（初回 **10**・continue **40**・完了後 id/total 一致）

### 次の施策候補（スコープ外 · 記録のみ）

- 列ごと先出し API（計画第2フェーズ）
- continue 中の進捗 UI
- リスト仮想化
- **prefix 装飾のラウンド間キャッシュ**（continue ごとの hydrate/enrich 削減）

## continue 時 COUNT 再利用（第1弾 · API のみ · 出力不変）

**目的**: `POST …/leaderboard-board/continue` の各ラウンドで、スロット数ぶんの `countProductionScheduleDashboardVisibleRowsFromListFilters` を再実行しない。追補セッション中はフィルタ不変のため、shell 時点の **スロット別 `total`** を正本として再利用する。

**ブランチ**: **`perf/leaderboard-board-continue-reuse-totals`**（マージ済み）。**`main` squash**: **`cabd0889`**（[PR #300](https://github.com/denkoushi/RaspberryPiSystem_002/pull/300)）。**実装系列**: **`438adb0c`**（COUNT 再利用本体）· **`ec938f31`**（Pi5 Web イメージ **Caddy v2.11.3** — **CVE-2026-45135**）· **`a3a4724f`**（本番・現場 OK ドキュメント）。**以降の運用デプロイ引数**は **`main`**（**`origin/main` HEAD**）。

### Context（調査・2026-05-19 以前）

- **症状**: 装飾後取り（初回80 / continue40）導入後も、**全スロットの行が揃うまで**の壁時計が長い（成功基準は **B: 各スロット行がすべて揃うまで**）。
- **切り分け（Mac + コード追跡）**: ボトルネックは **Web 再グループより API**。特に **`leaderboard-board/continue` 1 回あたりスロット数ぶんの COUNT**（例: 6 スロット × 100 行/スロットで continue 1 回の `countMsSum` 約 **177ms**、2 スロットで約 **21ms**）。
- **事前合意（確定）**:
  - 成功基準 **B**（全スロット行が揃うまで）
  - 装飾は **後取り維持**（最終表示は同値）
  - **pageSize 80** 維持（Web 変更なし）
  - スコープ **API のみ**
  - 本番ゲート **Pi5 キオスク実機**（Mac テスト後）

### 仕様（実装の正本）

| 層 | 内容 | モジュール |
| --- | --- | --- |
| shell | 各 `resources[]` の **`total` 確定後**、`snapshotId` キーで **プロセス内 TTL キャッシュ**に seed | [`leaderboard-composite-board-snapshot-totals.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-snapshot-totals.ts)·[`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts) |
| continue | 各スロットの `snapshotId` でキャッシュヒット → **COUNT 省略**；**ミス**（TTL 切れ・未 seed・別プロセス）→ **従来どおり COUNT**（**出力同値・安全側**） | [`resolve-leaderboard-board-resource-totals-for-continue.ts`](../../apps/api/src/services/production-schedule/leaderboard/resolve-leaderboard-board-resource-totals-for-continue.ts) |
| TTL | **`LEADERBOARD_SHELL_SNAPSHOT_TTL_MS`**（既定 **5 分**·最小 **30s**·[`leaderboard-composite-board-prefix-row-cache.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-prefix-row-cache.ts) と同型） | snapshot-totals |
| 触らない | Web・`pageSize`・装飾後取り・`deltaRows` 契約 | — |

**データフロー（後続スレッド用）**:

```mermaid
sequenceDiagram
  participant Client as Kiosk_Web
  participant API as Pi5_API
  participant Cache as snapshot_totals_Map
  participant DB as Postgres

  Client->>API: GET leaderboard-board (shell)
  API->>DB: COUNT per slot + fetch rows
  API->>Cache: seed(snapshotId, total) per resource
  API-->>Client: resources[].snapshotId, total, rows chunk

  loop until all slots hasMore=false
    Client->>API: POST leaderboard-board/continue
    API->>Cache: resolve(snapshotId)
    alt cache hit
      API-->>API: skip COUNT
    else cache miss
      API->>DB: COUNT (legacy)
    end
    API->>DB: fetch continue rows
    API-->>Client: deltaRows/rows, resources[].total unchanged semantics
  end
```

**契約不変**:

- 全 continue 完了後の **`rows[].id` 列**・**`total`**・**`resources[].total`**・装飾後取り完了後の表示は、COUNT 再利用 **あり/なし**で同値（統合テスト **`leaderboard-board continue profile logs`** が正本）。
- **`snapshotExpired`** 時は従来どおりクライアントが shell 再取得（キャッシュは **プロセスローカル**·[KB-369](./KB-369-leader-order-board-api-internal-latency.md) の snapshot 注意と同型）。

### ローカル検証（Mac + Docker Postgres）

```bash
./scripts/test/start-postgres.sh
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return
pnpm --filter @raspi-system/api exec prisma migrate deploy
pnpm --filter @raspi-system/api test -- \
  src/services/production-schedule/leaderboard/__tests__/leaderboard-composite-board-snapshot-totals.test.ts \
  src/services/production-schedule/leaderboard/__tests__/resolve-leaderboard-board-resource-totals-for-continue.test.ts
pnpm --filter @raspi-system/api test -- kiosk-production-schedule.integration.test.ts -t "leaderboard-board"
docker stop postgres-test-local && docker rm postgres-test-local
```

| テスト | 件数 | 確認内容 |
| --- | --- | --- |
| `leaderboard-composite-board-snapshot-totals.test.ts` | 4 | TTL·seed·resolve·gc |
| `resolve-leaderboard-board-resource-totals-for-continue.test.ts` | 2 | ヒット時 COUNT 未呼び出し・ミス時フォールバック |
| 統合 `continue skips COUNT` | 1 | shell 後 continue で `countProductionScheduleDashboardVisibleRowsFromListFilters` **呼び出し回数が増えない** |
| 統合 `continue profile logs` / `slot scale profile` | 2 | 完了後 id/total 同値・プロファイル |

### CI（機能ブランチ）

- **PR [#300](https://github.com/denkoushi/RaspberryPiSystem_002/pull/300)**·ブランチ **`perf/leaderboard-board-continue-reuse-totals`**
- 初回 CI: **`security-docker` 失敗** — Trivy が Caddy **CVE-2026-45135**（v2.11.2）を検出 → **`ec938f31`** で **`Dockerfile.web` を v2.11.3** に更新後 **全ジョブ success**（run **`26090279283`** 付近）。
- **注**: ブランチ名 `perf/**` は **`ci.yml` の push トリガー対象外**のため、**PR 作成後**に CI が走る。

### 本番反映（2026-05-19 · **`raspberrypi5` のみ**）

- **対象**: **`raspberrypi5` のみ**（**API のみ**·キオスク Pi4 は **Pi5 API** を参照するため **Pi4 順次不要**）。**Pi3**: play **`no hosts matched`**（未適用で正）。
- **コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh perf/leaderboard-board-continue-reuse-totals infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。
- **Detach Run ID**: **`20260519-192007-12328`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit 0`**·ローカル **`--follow` 約 1030s**·サマリ **`Git: changed`**·**Docker 再起動 `ok`**·**`prisma migrate deploy` OK**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **81s**）。
- **実機（現場）**: 順位ボード **動作 OK**（全スロット行の完走・表示同値）（**ユーザー確認 2026-05-19**）。

### Troubleshooting（本件）

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| continue は速いが **total/行数が shell 直後とズレる** | Pi5 **`api`** が **`438adb0c` 以降（または `main` HEAD）**か。キャッシュ **ミス**で COUNT フォールバックしているか（ログ・統合テスト同型） | 旧イメージなら **再デプロイ**。データ更新直後は **`snapshotExpired`** で shell 再取得が正 |
| **体感が変わらない**（Pi4 キオスク） | Pi4 **Web は未変更でも** API は Pi5 — **Pi5 のみ**デプロイで足りる。Network で **continue 応答時間**と **COUNT 相当の待ち** | Pi5 Detach **`Git: changed`** と **api コンテナ再作成**を確認 |
| **`snapshotExpired` が多い** | API **複数プロセス**でキャッシュがプロセスローカル | [KB-369](./KB-369-leader-order-board-api-internal-latency.md) の snapshot 節·TTL·sticky なしは仕様 |
| CI **`security-docker` のみ失敗**（Caddy HIGH） | Trivy **`CVE-2026-45135`** | **`Dockerfile.web` `caddy/v2 v2.11.3`**（**`ec938f31`**）または [ci-troubleshooting](../guides/ci-troubleshooting.md) |
| デプロイ前にスクリプトが **未コミットで停止** | `update-all-clients.sh` preflight | **`git status` クリーン化**（stash/commit） |

### 知見

- **COUNT 再利用は「追補セッション内・同一フィルタ」前提**。フィルタ変更・`snapshotExpired` 後は shell が total を再確定し **再 seed** される。
- **prefix row cache**（light 行）と **snapshot totals cache**（件数）は **別 Map** だが **TTL 解決ロジックは意図的に同型**（重複は許容·変更時は両方確認）。
- **第2弾候補**（本件スコープ外）: prefix 装飾のラウンド間キャッシュ・continue 並列化·列ごと先出し API（[KB-369](./KB-369-leader-order-board-api-internal-latency.md)）。

## 装飾後取り + 初回80/continue40 + append スコープ（2026-05-19 · `feat/kiosk-leaderboard-deferred-decorations-fast-initial`）

**目的**: 初回は **行の骨格のみ**を先に描画し、機種名・顧客名・資源CDチップは **`leaderboard-decorations` POST** で後取りする。全 continue 完了後の **id / total / 装飾 / `leaderboardFooterChipsByPartKey`** は eager（`includeDecorations` 省略＝**true**）経路と同値。**製番 OR フィルタ・リロード・追補**は同一 [`useCompositeLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) 経路。

**ブランチ**: **`feat/kiosk-leaderboard-deferred-decorations-fast-initial`**。**代表コミット（時系列）**: **`50e8649a`**（装飾後取り API+Web）· **`b0343567`**（製番 OFF 時 placeholder shell 抑制）· **`426889d6`**（stale override 防止・**副作用で continue 中断**）· **`08613580`**（append スコープポリシー + effect deps 修正）。**新規マイグレーションなし**。

### 仕様（実装の正本）

| 層 | 内容 | モジュール |
| --- | --- | --- |
| API 契約 | `includeDecorations`（GET query / continue body、**省略時 true**） | [`shared.ts`](../../apps/api/src/routes/kiosk/production-schedule/shared.ts) |
| API `false` | shell/continue は **light rows のみ**（board 内装飾スキップ） | [`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts) |
| API continue prefix | **snapshotId** 単位の light 行キャッシュで prefix 再 hydrate 削減 | [`leaderboard-composite-board-prefix-row-cache.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-prefix-row-cache.ts) |
| Web 初回 GET | `pageSize=80`・`includeDecorations=false` | [`constants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)·[`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) |
| Web continue | `pageSize=40` 固定・`includeDecorations=false` | [`buildLeaderboardBoardContinuePayload.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) |
| Web 装飾 | **未装飾 rowId のみ**増分 POST → 累積マージ | [`useLeaderboardDeferredBoardDecorations.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardDeferredBoardDecorations.ts)·[`mergeLeaderboardBoardWithDecorations.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardWithDecorations.ts) |
| Web placeholder | **paramsKey 変更時のみ** 旧 shell 非表示（同一 params の refetch placeholder は維持） | [`leaderboardBoardShellFreshnessPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardShellFreshnessPolicy.ts)（**`b0343567`**） |
| Web append スコープ | **現 paramsKey の override のみ**表示・ループ開始；append effect は **override 状態を deps に含めない** | [`leaderboardBoardAppendOverrideScopePolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendOverrideScopePolicy.ts)（**`08613580`**） |

**UX 契約**: チップ未到着時は **行だけ先表示**（レイアウト伸び許容）。`isLoading` は **light rows が無い間のみ**（params 変更直後は [§製番 OR](#製番-or-フィルタ解除と-placeholder-shell2026-05-19) の短い loading あり）。

**データフロー（後続スレッド用）**:

```mermaid
sequenceDiagram
  participant Page as LeaderOrderBoardPage
  participant Hook as useCompositeLeaderboardPhasedScheduleWithAutoAppend
  participant RQ as ReactQuery_leaderboard_board
  participant Dec as leaderboard-decorations_POST

  Page->>Hook: activeQueries to q, boardResourceCds
  Hook->>RQ: GET leaderboard-board includeDecorations=false pageSize=80
  Hook->>Hook: shellFreshness + scopedAppendOverride
  Hook->>RQ: POST continue while hasMore includeDecorations=false
  Hook->>Dec: 未装飾 rowId のみ増分
  Hook->>Page: mergeLeaderboardBoardWithDecorations
```

### 本番デプロイ（2026-05-19 · Pi5→Pi4×4 · 完了）

**標準**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-deferred-decorations-fast-initial infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。**1 台ずつ順次**。

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
| --- | --- | --- | --- |
| `raspberrypi5`（最終・`08613580` 含む） | **`20260519-172543-21009`** | `ok=134` `changed=4` `failed=0` | Docker 再起動·`prisma migrate` **ok** |
| `raspberrypi5`（中間・`426889d6` のみ先行） | **`20260519-160314-32708`** | `failed=0` | 本番不具合再現の中間点（記録） |
| `raspberrypi4` | **`20260519-174536-24483`** | `ok=122` `changed=10` `failed=0` | `kiosk-browser` / `status-agent` **ok** |
| `raspi4-robodrill01` | **`20260519-175108-2934`** | `ok=122` `changed=9` `failed=0` | 同上 |
| `raspi4-fjv60-80` | **`20260519-175540-20432`** | `ok=122` `changed=9` `failed=0` | 同上 |
| `raspi4-kensaku-stonebase01` | **`20260519-180012-22517`** | `ok=129` `changed=10` `failed=0` | 同上 |

**Pi3**: 各 run **`no hosts matched`**（専用手順未実施で正）。

### 実機検証

| 種別 | 結果 |
| --- | --- |
| 自動（Pi5 デプロイ後） | `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **77s**） |
| 自動（Pi4 全台後） | 同上 → **PASS 43 / WARN 0 / FAIL 0**（約 **104s**） |
| **`deploy-status`（Pi4×4）** | すべて **PASS** |
| **現場（ユーザー）** | 順位ボード **動作 OK**（リロード・製番 ON/OFF・全件表示・追補） |

### ローカル回帰（実装時）

- **API 統合**: `kiosk-production-schedule.integration.test.ts` — `leaderboard-board continue profile logs`（初回 **80**・continue **40**・`includeDecorations=false`・完了後 id/total 一致）
- **Web Vitest**: `leaderOrderBoard/__tests__/` — ポリシー単体・composite hook（placeholder・stale continue・**hasMore + 製番 OFF**）· **24 tests PASS**（対象 3 ファイル実行時）

### Troubleshooting（本件）

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| 製番 OFF でも行数が絞り込みのまま | Network: **`q` なし GET は行数増**するか | API 正常なら Web。**`b0343567` 未反映** or **`426889d6` の continue 中断**を疑う |
| リロード後に全件出ない・continue が途中で止まる | append effect が **`setAppendOverride` で再実行**されていないか | **`08613580` 以降**を Pi5+Pi4 に反映。deps に **scoped override 状態を入れない** |
| 製番 OFF 直後に一瞬 0 行 | **意図**（placeholder shell 抑制 + 新 shell 待ち） | 数秒以内に全件 shell。長引く場合は **GET 失敗**・**paramsKey** を確認 |
| 装飾チップだけ遅い | **`leaderboard-decorations` POST** の遅延 | 行骨格は先に出る設計。**UX 契約**どおり。全件 id/total は continue 完了後に確定 |
| Pi5 だけ更新してキオスクが旧挙動 | キオスク Web は **Pi4 上** | **Pi4×4 も同ブランチ**をデプロイ（pageSize 80 系と同じ 5 台パターン） |
| `leaderboard-board/continue` **400** | cursor 欠落（別件） | [§Root cause](#root-cause) |

## 端末キャッシュ Phase 1（IndexedDB + 裏同期）（2026-05-19 · `feat/kiosk-leaderboard-terminal-cache-phase1`）

**目的**: API 最適化（pageSize 80・装飾後取り・COUNT 再利用）後も残る **端末 cold start**（Pi4 再起動・リロード時の「読み込み中…」）を、**出力同値**のまま短縮する。**Web のみ**·**API 契約変更なし**。

**設計 ADR**: [ADR-20260519](../decisions/ADR-20260519-leaderboard-terminal-cache-phase1.md)。

**ブランチ**: **`feat/kiosk-leaderboard-terminal-cache-phase1`**。**代表コミット**: **`072054f9`**（本体）· **`3ae93221`**（真っ白画面 fix）。**依存**: `idb` **^8.0.3**（[`apps/web/package.json`](../../apps/web/package.json)）。

### 仕様（実装の正本）

| # | 要件 | 実装 |
| --- | --- | --- |
| 1 | 鮮度 **120s** | `LEADERBOARD_BOARD_CACHE_MAX_AGE_MS` = `LEADER_BOARD_SCHEDULE_REFETCH_MS` |
| 2 | 不一致 **常にサーバ正** | `reconcileLeaderboardBoardCacheWithServer` → `serverWins` で `delete` |
| 3 | キー = **`siteKey` + `paramsKey`** | [`buildLeaderboardBoardCacheKey`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheKey.ts)（**`paramsKey` は常に string** — 未就绪時 `''`） |
| 4 | 通信失敗 **キャッシュ継続** + 警告 | [`LEADERBOARD_BOARD_CACHE_SYNC_WARNING`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheConstants.ts)·Page バナー |
| 5 | 保存 = **continue 完走後** + 120s ポーリング成功 | `isCompleteLeaderboardBoardSnapshot` + `networkBoardComplete` |

**表示優先**: ネットワークに有効な shell/append 行がある間は **ネットワーク正**。IDB は **初回 loading・placeholder 抑制中の bootstrap** のみ（[`shouldShowLeaderboardBoardTerminalCache`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheDisplayPolicy.ts)）。

**reconcile 直後の put 抑止**: mismatch で purge した **`networkSyncToken`（= shell 指紋）** では同一サイクル **`store.put` しない**（[`skippedNetworkSyncTokenRef`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardBoardTerminalCache.ts)）。

**ロールバック**: `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false`（省略時 **true**）。

**データフロー（後続スレッド用）**:

```mermaid
sequenceDiagram
  participant Page as LeaderOrderBoardPage
  participant Hook as useCompositeLeaderboardPhasedScheduleWithAutoAppend
  participant TC as useLeaderboardBoardTerminalCache
  participant IDB as IndexedDB
  participant Net as ReactQuery_network

  Page->>Hook: siteKey, scheduleEnabled, boardQueryParams
  Hook->>TC: networkDisplayBoard, paramsKey, shellFingerprint
  TC->>IDB: get(cacheKey) on mount
  alt cache hit and bootstrap policy
    TC-->>Page: displayBoard from IDB (instant)
  end
  Hook->>Net: GET/POST leaderboard-board + decorations
  Net-->>Hook: complete board
  Hook->>TC: reconcile + put on aligned
  TC->>IDB: put or delete
```

### ローカル検証

```bash
pnpm --filter @raspi-system/web test -- src/features/kiosk/leaderOrderBoard
```

| テスト群 | 件数（記録時点） | 確認内容 |
| --- | --- | --- |
| `cache/__tests__/*` | ポリシー・key・record | reconcile・maxAge・`paramsKey undefined` ガード |
| `useLeaderboardBoardTerminalCache.test.tsx` | hook 統合 | hydrate・network error 警告・reconcile purge・120s 超過非表示 |
| `useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx` | composite | `isShowingCachedData` / `cacheSyncWarning` |

**CI（機能）**: **`26093399804`** **success**（`072054f9`）。

### 本番反映（2026-05-19 · **`raspberrypi5` のみ** · Pi4 未展開）

| 段階 | Detach Run ID | コミット | 結果 |
| --- | --- | --- | --- |
| 初回 | **`20260519-203723-29020`** | **`072054f9`** | **`failed=0`**·現場 **真っ白画面** |
| fix 再デプロイ | **`20260519-205437-31528`** | **`3ae93221`** | **`failed=0`**·Mac/Pi5 **表示 OK** |

- **標準**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-terminal-cache-phase1 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **Pi4×4**: **未デプロイ**（IDB は **各ブラウザローカル** — Pi4 実機効果には **Pi4 Web 更新が必要**）
- **Pi3**: **`no hosts matched`**（対象外）

### Troubleshooting（本件）

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| **真っ白画面**（`#root` 空） | DevTools **`trim` of undefined** at `buildLeaderboardBoardCacheKey` | **`3ae93221` 以降**を Pi5（+ 必要なら Pi4）へ再デプロイ。**ハードリロード** |
| 常に「読み込み中…」（改善なし） | IDB 空（初回）または **120s 超過キャッシュ**は表示しない | 1 回 **continue 完走**後に保存される。**2 回目以降**の cold start で効く |
| 警告「前回保存分です」 | ネットワーク失敗中 | [KB-380](./KB-380-kiosk-leaderboard-network-error-resilience.md) と併読。キャッシュ継続は **意図** |
| reconcile で一瞬古い表示 | mismatch → purge 後 **同一 sync token では put しない** | 次ポーリングでサーバ版に収束 |
| Pi5 だけ更新 | Pi4 キオスク Web が旧 bundle | **Pi4×4 順次**（装飾後取りと同じ 5 台） |
| キャッシュ無効化 | 緊急 | ビルド時 **`VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false`** |

### 知見

- **cold start 改善は「2 回目以降」**が主戦場（初回は IDB 空のため従来と同じネットワーク完走）。
- **`JSON.stringify(undefined)` は `undefined` を返す**（`"undefined"` 文字列ではない）— **`paramsKey` 境界は string 正規化必須**。
- **Mac から Pi5 URL での検証**は Playwright **`ignoreHTTPSErrors: true`** または証明書例外後に DevTools で **pageerror** を確認するのが早い。
- **Phase 2 候補**（スコープ外）: React Query persist との役割分担見直し・差分 sync API。

## 端末キャッシュ Phase 2（SWR + 書き込み同期）（2026-05-20）

**目的**: Phase 1 の bootstrap 以外に、**製番 OR / `paramsKey` 変更**・**120s 再検証中**もキャッシュを表示し、**自端末の書き込み**を IDB にミラーする。**Web のみ**·**API 不変**·**出力同値**。

**設計 ADR**: [ADR-20260520](../decisions/ADR-20260520-leaderboard-terminal-cache-phase2-swr.md)。

**ブランチ（実装）**: **`feat/kiosk-leaderboard-terminal-cache-phase2-swr`**（tip **`2300da83`**）·**PR [#302](https://github.com/denkoushi/RaspberryPiSystem_002/pull/302)**。

### 仕様要約

| # | 要件 | 実装 |
| --- | --- | --- |
| 1 | SWR 表示（120s 鮮度） | [`leaderboardBoardSwrDisplayPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardSwrDisplayPolicy.ts) |
| 2 | `paramsKey` 変更直後も IDB 即表示 | `suppressPlaceholderShell` 時も cache 優先（旧 placeholder shell は非表示のまま） |
| 3 | reconcile 不一致 → サーバ正 | 変更なし |
| 4 | 書き込み成功 → IDB patch | [`leaderboardBoardCachePatchPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePatchPolicy.ts) + [`productionScheduleWriteSuccessListeners.ts`](../../apps/web/src/features/kiosk/productionSchedule/productionScheduleWriteSuccessListeners.ts) |
| 5 | IDB put は **内容指紋**（順位・備考・納期・完了含む） | [`leaderboardBoardCachePersistPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePersistPolicy.ts) |
| 6 | 完了フィルタ既定 **未完** | [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) `useState('incomplete')` |
| 7 | 他端末 SLA **120 秒** | `LEADER_BOARD_SCHEDULE_REFETCH_MS` 維持 |

**ロールバック**: `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR=false` で Phase 1 表示ポリシーへ（端末キャッシュ全体オフは Phase 1 と同じ `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false`）。

**検証（ローカル）**: `pnpm --filter @raspi-system/web test -- src/features/kiosk/leaderOrderBoard` → **174 PASS**（2026-05-20 記録）。**CI（PR #302）**: **lint-build-unit / e2e / security-docker** すべて **success**（mutation テストは **`onSuccess` コールバック期待**で初回失敗 → **`2300da83`** で修正）。

### 本番デプロイ・実機検証（2026-05-19）

**方針**: Phase 1 と同型で **Pi5 先行 → Pi4 キオスク 4 台順次**（**1 台ずつ `--limit`**）。**Web のみ**·API 不変。

**標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-terminal-cache-phase2-swr infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。

| ホスト | 現場名 | Detach Run ID | 備考 |
| --- | --- | --- | --- |
| `raspberrypi5` | サーバ（Web+API） | **`20260519-215631-11713`** | **`Git: changed`**·**Docker 再起動 `ok`**·`prisma migrate` **ok** |
| `raspberrypi4` | 第2工場 kensakuMain | **`20260519-220153-2826`** | **`kiosk-browser` / `status-agent` 再起動** |
| `raspi4-robodrill01` | RoboDrill01 | **`20260519-220731-12252`** | 同上 |
| `raspi4-fjv60-80` | FJV60/80 | **`20260519-221143-3419`** | 同上 |
| `raspi4-kensaku-stonebase01` | Kensaku StoneBase01 | **`20260519-221558-18199`** | 同上 |

**Pi3**: 各 run で **`no hosts matched`**（サイネージは対象外·**専用手順未実施で正**）。

**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **70s**）·**`deploy-status`（Pi4×4）** PASS·**Pi3 signage-lite/timer** PASS。

**実機（順位ボード・手動チェックリスト）**:

1. **初回**（IDB 空）: 一覧は従来どおりネットワーク完走待ちが主。**異常な真っ白・pageerror なし**（Phase 1 fix **`3ae93221`** 以降の前提）。
2. **2 回目以降**（同一 `paramsKey`）: **リロード直後に前回の一覧が即表示**され、裏で `leaderboard-board` + continue が走る（SWR）。
3. **製番 OR 切替**（`paramsKey` 変更）: 切替直後も **前条件の IDB があれば即表示**（鮮度 120s 内・continue 完走済み）。
4. **自端末書き込み**: 順位・備考・納期・完了の API 成功後、**リロードなしでも IDB に反映**（他端末は最大 120s SLA）。
5. **完了フィルタ**: 初回表示が **未完**（`incomplete`）であること（クライアントのみ）。

**知見**:

- **Pi4 は Phase 1 未展開だった**ため、本デプロイで **Phase 1 bootstrap + Phase 2 SWR を一括初反映**。
- **体感評価は 2 回目以降**（初回 IDB 空は仕様どおり）。
- **Page 配線**: `useLeaderboardBoardCacheMutationBridge` は **`useComposite` より先**に置き、`applyMutationPatch` は **ref で後から接続**（hook 順序・TypeScript エラー回避）。

**トラブルシュート**:

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| 真っ白画面 | DevTools **`reading 'trim'`** | Phase 1 fix **`3ae93221`** 未反映·**Cmd+Shift+R** |
| 1 回目だけ遅い | IDB 空 | **正常**·2 回目以降で SWR を確認 |
| 他端末の変更が遅い | 120s SLA | 意図（`LEADER_BOARD_SCHEDULE_REFETCH_MS`）·即時は自端末書き込みのみ |
| SWR を止めたい | ビルドフラグ | `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR=false`（Phase 1 のみ） |
| キャッシュ全体オフ | 同上 | `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false` |

## 端末キャッシュ Phase 2 改訂（120s 同期・SWR 操作ロック）（2026-05-20 · `feat/kiosk-leaderboard-cache-120s-swr-lock`）

**目的**: [端末キャッシュ Phase 2](#端末キャッシュ-phase-2-swr--書き込み同期2026-05-20) の **体感遅延・キャッシュ未効・再検証中の表示切替・操作可能に見える**問題を、**出力同値**のまま最小変更で抑える。**Web のみ**·**API 不変**。

**設計 ADR**: [ADR-20260520 §Phase 2 改訂](../decisions/ADR-20260520-leaderboard-terminal-cache-phase2-swr.md#phase-2-改訂120s-同期-cadence-安定化2026-05-20)。

**ブランチ（実装）**: **`feat/kiosk-leaderboard-cache-120s-swr-lock`**（tip **`76e265f2`** · `fix(kiosk): stabilize leaderboard cache refresh cadence`）·**CI** run **`26133411712`** **success**。

### 仕様要約（Phase 2 初版からの差分）

| # | Phase 2 初版（`2300da83`） | 本改訂（`76e265f2`） |
| --- | --- | --- |
| 1 | mutation 成功時 **IDB patch**（既定オン） | **120秒ポーリング完走時のみ** IDB `put`（[`leaderboardBoardCacheSyncPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheSyncPolicy.ts)） |
| 2 | `serverWins` → **purge** + 同一 token で put 抑止 | **purge しない**·サーバ正本で **replace put**（`skippedNetworkSyncTokenRef` **削除**） |
| 3 | 再検証中も SWR だが **ネットワーク表示へ切替えうる** | **`isBackgroundRevalidating` 中はキャッシュ固定**·完了時のみ一度切替（[`leaderboardBoardSwrDisplayPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardSwrDisplayPolicy.ts)） |
| 4 | 操作ロックなし（押下は無視されうる） | **`isInteractionLocked`** + Grid/左ペイン **明示 disabled** + 同期中文（[`leaderboardBoardInteractionLockPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardInteractionLockPolicy.ts)） |
| 5 | reconcile fingerprint は常時比較 | **aligned 時のみ** fingerprint スキップ（不一致でもサーバ版を保存） |
| 6 | — | mutation ミラー **`VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=false`**（[`leaderboardBoardCacheConstants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheConstants.ts)） |

**維持**: `paramsKey` / `siteKey`·120s 鮮度·完了フィルタ既定 **未完**·製番 OR クライアントフィルタ（[`feat/kiosk-leaderboard-seiban-or-client-cache-filter`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/filterLeaderboardBoardBySeibanOr.ts)）との併用·**一覧の id 列・total・並び・装飾の意味論**。

**ロールバック**: `VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=true` で mutation 即時 IDB ミラーを復帰（Phase 2 初版に近い）/ `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR=false` / `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false`。

**検証（ローカル）**: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard` → **193 tests PASS**（2026-05-20）·`web build` PASS。

### 本番デプロイ・実機検証（2026-05-20 · 部分反映）

**方針**: ユーザー指定どおり **`raspberrypi5` → `raspi4-kensaku-stonebase01` のみ**（**1 台ずつ `--limit`**）。**Web のみ**·API 不変·**新規マイグレーションなし**。

**標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-cache-120s-swr-lock infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。

| ホスト | 現場名 | Detach Run ID | PLAY RECAP | 備考 |
| --- | --- | --- | --- | --- |
| `raspberrypi5` | サーバ（Web+API） | **`20260520-095018-31166`** | `ok=131` `changed=3` `failed=0` | **`Docker rebuild: false`**（リモート **Already up to date**）·`prisma migrate` **ok** |
| `raspi4-kensaku-stonebase01` | Kensaku StoneBase01 | **`20260520-094455-29939`** | `ok=129` `changed=10` `failed=0` | **`kiosk-browser` / `status-agent` 再起動** |

**Pi3**: **`no hosts matched`**（サイネージは対象外·専用手順未実施で正）。

**Pi4×3 への 120s 改訂単体デプロイ**: 本節記載時点では **未実施**だったが、後続の [§資源CDフッタチップ端末キャッシュ](#資源cdフッタチップ端末キャッシュ永続化2026-05-20--fixkiosk-leaderboard-footer-chips-terminal-cache) で **`fix/kiosk-leaderboard-footer-chips-terminal-cache`**（`main` + **`e24d5885`**）を **Pi4×3 に反映済み**（2026-05-20）。**120s-only put / 操作ロック** は **`main`（PR #304 · `76e265f2`）** 系 bundle に含まれる。

**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **69s**·Tailscale·Pi5 `100.106.158.2`）·**`deploy-status`（Pi4×4）** PASS。

**実機（順位ボード・手動·ユーザー確認）**: **実機検証 OK**（2026-05-20）。

**実機チェックリスト（本改訂の評価ポイント）**:

1. **2 回目以降の cold start**（同一 `paramsKey`）: リロード直後 **IDB 即表示**·裏で network 完走。
2. **120s ポーリング中**: 一覧は **キャッシュ維持**（チラつきで空→再描画しない）·**操作は disabled**（同期中文表示）。
3. **ポーリング完走後**: 一度だけ **ネットワーク結果へ切替**·IDB が **サーバ正本で更新**。
4. **自端末 mutation 直後**: **React Query 表示は即更新**·IDB は **既定では更新されない**（次 120s まで他端末視点は SLA どおり）。
5. **製番 OR**（StoneBase01）: [§製番 OR](#製番-or-クライアントキャッシュフィルタ2026-05-20) と併用·**`paramsKey` 固定 + クライアント絞込**は維持。

### 知見

- **IDB 空窗の主因候補（CONFIRMED）**: `serverWins` 後の **purge** と **`skippedNetworkSyncTokenRef` による同一サイクル put 抑止**が重なると、SWR 表示中に **IDB が空**になり **毎回フル network 待ち**に見えた → **replace put + token 削除**で緩和。
- **mutation 毎の IDB patch** は **120s ポーリングと競合**し、reconcile・表示切替のノイズ源になりうる → **既定オフ**（緊急時のみ env で復帰）。
- **`update-all-clients.sh` ローカルロック**: 同一マシンで **別プロセスが実行中**だと **exit 3**（`logs/.update-all-clients.local.lock`）·**完了待ち**または **オーナー PID 確認**（[KB-374 Phase 1 §知見](#知見) と同型）。
- **デプロイ順**: StoneBase01 を先に完了し Pi5 を後追いしても **Phase12 は広域 PASS**（Pi5 API + 全 Pi4 サービス疎通）·**順位ボード UX は端末ローカル bundle 依存**のため **評価はデプロイ済み端末で実施**。

### Troubleshooting

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| キャッシュが効かない／毎回遅い | DevTools **IndexedDB 空**·`serverWins` 直後 purge | **`76e265f2` 以降** bundle か·**Cmd+Shift+R** |
| 120s ごとに表示がチラつく | 再検証中に **network 表示へ切替** | 本改訂の **`isBackgroundRevalidating`** 配線を確認 |
| 同期中に押せる | **disabled 未配線** | `ProductionScheduleLeaderOrderBoardPage` の **`isInteractionLocked`**·Grid/左ペイン |
| mutation 後 IDB が即更新されない | **`VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=false`** | **意図**·即時ミラーが必要なら env **true** + 再デプロイ |
| `update-all-clients.sh` が即終了 exit 3 | **ローカルロック** | `logs/.update-all-clients.local.lock/owner` の **pid** が生存中か·完了待ち |
| Pi4 3 台で挙動が違う | **未デプロイ** | 上表の **未デプロイ 3 台**を同一手順で **`--limit` 順次** |
| 機能を止めたい | ビルドフラグ | `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false` |

## 操作即表示 × 120秒キャッシュ両立（2026-05-20 · `feat/kiosk-leaderboard-mutation-instant-display`）

**目的**: [Phase 2 改訂](#端末キャッシュ-phase-2-改訂120s-同期swr-操作ロック2026-05-20--featkiosk-leaderboard-cache-120s-swr-lock) の **120秒 SWR / 完走時 IDB put** は維持しつつ、**自端末**の順位・納期・備考・完了を **API 成功直後**に画面へ反映する。**DB は即時**（既存 API）·**他端末は最大 120 秒**（`LEADER_BOARD_SCHEDULE_REFETCH_MS`）·**Web のみ**·**API 不変**。

### 仕様要約

| # | 内容 | モジュール |
| --- | --- | --- |
| 1 | patch 正本を共通化 | [`leaderboardBoardApplyMutation.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardApplyMutation.ts) |
| 2 | 表示正本（shell / appendOverride）へ patch | [`leaderboardBoardDisplayMutationCoordinator.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardDisplayMutationCoordinator.ts) + [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) `applyDisplayMutation` |
| 3 | mutation → IDB 即時ミラー **既定オン** | [`leaderboardBoardCacheConstants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheConstants.ts)（緊急オフ: `VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=false`） |
| 4 | 120秒完走時の scheduled put | 変更なし（[`leaderboardBoardCacheSyncPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheSyncPolicy.ts)） |
| 5 | 操作ロックは **mutation / writePause のみ**（背景再検証中は操作可） | [`leaderboardBoardInteractionLockPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardInteractionLockPolicy.ts) |

**ロールバック**: `VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=false`（IDB 即時ミラーのみオフ·append patch はコード上残る）/ 直前 ref へ再デプロイ。

**ブランチ**: **`feat/kiosk-leaderboard-mutation-instant-display`**·代表コミット **`0d97f0de`**（`fix(kiosk): reflect leaderboard edits before cache refresh`）。**前提**: [Phase 2 改訂](#端末キャッシュ-phase-2-改訂120s-同期swr-操作ロック2026-05-20--featkiosk-leaderboard-cache-120s-swr-lock) / [資源CDフッタチップ](#資源cdフッタチップ端末キャッシュ永続化2026-05-20--fixkiosk-leaderboard-footer-chips-terminal-cache) が各端末に入っていること（**Web bundle は Pi5 の Docker `web` と Pi4 の `kiosk-browser` が別**·キオスク実機は **Pi4 4 台必須**）。

### データフロー（mutation 成功後）

1. **API 成功**（既存）→ DB は **即時**（本機能のスコープ外·変更なし）。
2. **`applyIdbMutationPatch`**（[`leaderboardBoardCachePatchPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePatchPolicy.ts)）→ IDB 行単位 patch（**`VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION` 省略時 true**）。
3. **`resolveDisplayBoardMutationUpdate`**（[`leaderboardBoardDisplayMutationCoordinator.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardDisplayMutationCoordinator.ts)）→ **`shell` 表示**と **`appendOverride`（continue 追補済み一覧）** の両方へ同型 patch。
4. **120秒 scheduled put / SWR / reconcile** → [Phase 2 改訂](#端末キャッシュ-phase-2-改訂120s-同期swr-操作ロック2026-05-20--featkiosk-leaderboard-cache-120s-swr-lock) **どおり**（他端末・サーバ正との最終整合）。

**誤解しやすい点（CONFIRMED）**: 「キャッシュ先 → 120秒後に DB」ではない。**不足していたのは画面（と IDB ミラー）の即時整合**。Phase 2 改訂で **mutation 即時 IDB 既定オフ** + **背景再検証中ロック**を入れた結果、**自端末の編集が画面に残らない**状態が残っていた。

### 検証（ローカル）

```bash
pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard
# 199 tests PASS（2026-05-20·本ブランチ）

pnpm --filter @raspi-system/web build
# PASS
```

- **CI（機能）**: push 後 run **`26140346177`**（head **`0d97f0de`**）— デプロイ前に **完了待ちせず** 本番反映（ユーザー判断·2026-05-20）。

### 本番デプロイ（2026-05-20 · **Pi5→Pi4×4 完了・実機検証 OK**）

**方針**: [deployment.md §操作即表示](../guides/deployment.md#kiosk-leaderboard-mutation-instant-display-2026-05-20) と同型。**1 台ずつ `--limit`**·**Pi3 は `no hosts matched`**。

**標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-mutation-instant-display infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
| --- | --- | --- | --- |
| `raspberrypi5` | **`20260520-131334-15607`** | `ok=134` `changed=4` `failed=0` | **Docker compose 再起動**·Mac→Pi5 URL 検証可 |
| `raspi4-kensaku-stonebase01` | **`20260520-131843-7879`** | `ok=129` `changed=10` `failed=0` | `barcode-agent` ready **1 回リトライ**後成功 |
| `raspberrypi4` | **`20260520-133253-2715`** | `ok=122` `changed=11` `failed=0` | `kiosk-browser` / `status-agent` **ok** |
| `raspi4-robodrill01` | **`20260520-133748-7589`** | `ok=122` `changed=10` `failed=0` | 同上 |
| `raspi4-fjv60-80` | **`20260520-134139-3491`** | `ok=122` `changed=9` `failed=0` | 同上 |

**実機（順位ボード·現場）**: **実機検証 OK**（ユーザー確認·2026-05-20）— 下記チェックリストを満たす。

### 実機チェックリスト（順位ボード）

1. **順位・納期・備考**を変更 → **リロードなしで行が変わる**（自端末）。
2. 上記後に **ハードリロード** → 変更が **IDB 経由で維持**される。
3. **他端末**（または 120 秒待ち）→ 同じ変更が **最大 120 秒以内**に見える（`LEADER_BOARD_SCHEDULE_REFETCH_MS`·変更なし）。
4. **cold start / 120秒ポーリング中**も **一覧が空→全件にチラつかない**（Phase 2 改訂 UX 維持）。
5. **120秒ポーリング中**でも **順位・納期・備考の操作が可能**（背景再検証中ロック解除·`writePause` / mutation 中のみロック）。

### 知見

| 項目 | 内容 |
| --- | --- |
| **主因（CONFIRMED）** | continue 追補後は **`appendOverride` が表示正本**·IDB/shell のみ patch では **画面が更新されない** → **displayMutationCoordinator** で shell + appendOverride を同時更新。 |
| **Phase 2 改訂との関係** | **120s scheduled put / SWR / serverWins replace** は維持·**mutation 即時 IDB は既定オンに戻す**（行 patch のみ·全件 put ではない）。 |
| **操作ロック** | **`isBackgroundRevalidating`（120s poll の `isFetching`）はロックしない**·**`writePause` / mutation 中のみ**（ポーリング中の編集可能）。 |
| **continue 追補中（`isAppending`）** | 従来どおり **revalidating 扱い**·本ブランチでは **未変更**（追補中の即反映は別課題）。 |
| **デプロイ順** | Pi5 + StoneBase01 先行後に Pi4×3 でも **各台 `failed=0`**·**UX は端末 bundle 依存**（Pi5 のみでは Pi4 キオスクに効かない）。 |
| **Ansible ノイズ** | StoneBase01 で **`barcode-agent` ready 待ち 1 リトライ** — 最終 **failed=0**（デプロイ失敗ではない）。 |

### Troubleshooting

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| 操作後も行が変わらない（自端末） | **`appendOverride` 未 patch** の旧 bundle | 上表 Detach·**`0d97f0de` 以降**·**Cmd+Shift+R** |
| IDB は変わるが画面だけ古い | shell のみ更新 | **coordinator + `applyDisplayMutation`** 配線確認 |
| 120秒 poll 中に操作できない | Phase 2 改訂の **背景ロック残存** | **`leaderboardBoardInteractionLockPolicy`**·Page の **`writePause` のみ** |
| mutation 後 IDB が即更新されない | **`VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=false`** | **意図**·既定は **省略時 true** |
| 他端末に即反映されない | **SLA 120秒** | **仕様**·即時は **自端末のみ** |
| Pi4 だけ直らない | **未デプロイ** | 上表の Detach ID |
| 機能を止めたい | env / ref | `VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=false` または直前 ref で **`update-all-clients.sh`** |

**ロールバック**: `VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION=false`（IDB 即時ミラーのみオフ·表示 patch ロジックは残る）/ 直前安定 ref へ **5 台再デプロイ**。

## 製番 OR クライアントキャッシュフィルタ（2026-05-20）

**目的**: 登録製番 OR 切替で **`paramsKey`（無 `q` 完走 board）を固定**し、**IDB 上の全件キャッシュ**をそのままクライアントで絞込表示する。裏で **同じ製番の `q` 付き GET + continue** で照合し、**不一致は常にサーバ正**（Phase 1/2 reconcile と同型）。**Web のみ**·**API 不変**·**ツールバー等の他 `q` は従来どおり API**。

**ブランチ**: **`feat/kiosk-leaderboard-seiban-or-client-cache-filter`**·代表 **`a65c4600`**（`feat(kiosk): add leaderboard seiban OR client cache filter`）·build fix **`84751160`**（`fix(kiosk): make leaderboard seiban filter build-safe`）。**前提**: [端末キャッシュ Phase 2](#端末キャッシュ-phase-2-swr--書き込み同期2026-05-20)（SWR + IDB persist）が各端末に入っていること。

### データフロー

1. **Primary**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) が `leaderboardPhasedBase` から **`q` を除外**し、[`useCompositeLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) に **`seibanOrFilters`** を渡す。
2. **GET**: `boardQueryParams` は **無 `q`**（`clientFilterEnabled` 時）。**`paramsKey` は製番 ON/OFF で変わらない** → continue 完走済み IDB を再利用。
3. **表示**: 完走前でも **手元行に製番完全一致フィルタ**（[`canDisplayLeaderboardSeibanClientFilter`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardSeibanClientFilterPolicy.ts)）。**reconcile** は **完走後のみ**（[`canApplyLeaderboardSeibanClientFilter`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardSeibanClientFilterPolicy.ts)）。
4. **照合**: [`useLeaderboardSeibanOrClientFilterOverlay`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardSeibanOrClientFilterOverlay.ts) が `getKioskProductionScheduleLeaderboardBoard`（`q` 付き）+ 必要なら [`leaderboardBoardAppendSessionRunner`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendSessionRunner.ts) で continue → [`reconcileLeaderboardBoardCacheWithServer`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheReconcilePolicy.ts)。
5. **装飾**: **`leaderboard-decorations` の取得キーは board と同じ `paramsKey`**（製番 OR の ON/OFF で装飾 state をリセットしない）。**資源CDフッタチップ**も **120s IDB** の `decorations.leaderboardFooterChipsByPartKey` を SWR 表示で参照（[`fingerprintLeaderboardBoardDecorations`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePersistPolicy.ts) + [`shouldSkipLeaderboardBoardCachePut`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePersistPolicy.ts)）。**ブランチ**: **`fix/kiosk-leaderboard-footer-chips-terminal-cache`**（2026-05-20）。
6. **Hook 順序**: overlay は **primary の append `useEffect` の後**に配置（前に挟むと append が毎レンダー再開し continue が 1 回で止まる）。

### ガード・ロールバック

| 条件 | 挙動 |
| --- | --- |
| `VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER=false`（[`leaderboardBoardCacheConstants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheConstants.ts)・省略時 **true**） | 従来どおり **`q` を API `boardQueryParams` に載せる**（legacy） |
| 製番トグル | **進行中 primary continue をキャンセル**（`appendRunIdRef` 増分）·**遅延 continue 応答は無視** |
| 製番 OFF + 完走キャッシュ | **即全件表示**（フィルタ解除のみ·**primary continue 増やさない**） |
| reconcile 不一致 | **`serverVerifiedBoard` で表示上書き**（サーバ正） |
| 基底 board の行 ID 集合が変わった | **`serverVerifiedBoard` をクリア**（stale reconcile 防止·overlay 内 `baseBoardRowIdsKey` effect） |

### 実装・レビューで入れた修正

| 項目 | 内容 |
| --- | --- |
| **`boardQueryParams` 依存** | **`seibanOrFiltersKey`**（`JSON.stringify`）のみ。生配列を `useMemo` deps に戻すと **append 毎レンダー再実行** → continue 1 回で停止・製番 ON でも全件に見える |
| **`stableSeibanOrFilters`** | `JSON.parse(seibanOrFiltersKey)` で reconcile 用配列を安定化（lint と append 回帰の両立） |
| **overlay 配置** | `useCompositeLeaderboardPhasedScheduleWithAutoAppend` 内で **append effect の後** |
| **`canDisplay` vs `canApply`** | continue 途中は reconcile 不可だが **手元行の OR 絞込表示は可**（`canDisplayLeaderboardSeibanClientFilter`） |
| **CI `tsc -b`** | [`filterLeaderboardBoardBySeibanOr.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/filterLeaderboardBoardBySeibanOr.ts) の `readRowFseiban`: `(row as unknown as { fseiban?: unknown }).fseiban`（`ProductionScheduleRow` に `fseiban` 型が無いため） |

### 検証（ローカル）

```bash
pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard
# 186 tests PASS（2026-05-20）

pnpm --filter @raspi-system/web build
# CI 初回失敗後 84751160 で PASS
```

- **CI（機能）**: run **`26130113027`** **success**（初回 **`26129746916`** は **`tsc -b`** で `filterLeaderboardBoardBySeibanOr` の cast 失敗 → **`84751160`** で解消）。
- **reconcile テスト**: `getLeaderboardBoardMock` のデフォルト空 board だと **serverWins で空表示** → テストごとに **aligned mock** を設定すること。

### 本番デプロイ（2026-05-20 · 部分反映）

**方針**: Phase 2 と同型で **Pi5 先行 → Pi4 キオスク順次**（**1 台ずつ `--limit`**）。**Web のみ**·API 不変·**新規マイグレーションなし**。

**標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-seiban-or-client-cache-filter infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。

| ホスト | 現場名 | Detach Run ID | PLAY RECAP | 備考 |
| --- | --- | --- | --- | --- |
| `raspberrypi5` | サーバ（Web+API） | **`20260520-080628-31043`** | `ok=134` `changed=4` `failed=0` | **`verify-phase12-real.sh` 43/0/0**（Pi5 デプロイ後） |
| `raspi4-kensaku-stonebase01` | Kensaku StoneBase01 | **`20260520-081732-25804`** | `ok=129` `changed=11` `failed=0` | `kiosk-browser` / `status-agent` 再起動 |
| `raspberrypi4` | 第2工場 kensakuMain | — | **未デプロイ** | |
| `raspi4-robodrill01` | RoboDrill01 | — | **未デプロイ** | |
| `raspi4-fjv60-80` | FJV60/80 | — | **未デプロイ** | |

**Pi3**: **`no hosts matched`**（サイネージは対象外·専用手順未実施で正）。

### 実機チェックリスト（順位ボード）

1. **製番 ON（1 件）**: 即絞込表示 → 裏 `q` 付き GET+continue 後も **サーバ結果と一致**（不一致時はサーバ正で上書き）。
2. **製番 OR 追加**: 登録製番を増やしたとき **OR 拡大**（`paramsKey` は無 `q` のまま）。
3. **製番 OFF**: **完走 IDB があれば即全件**（primary continue を増やさない）。
4. **continue 途中で製番 ON**: 手元行の OR 絞込は効く（`canDisplay`）。reconcile は **primary 完走後**。
5. **ツールバー等の他 `q`**: 従来どおり API 経由（本機能のスコープ外）。

### Troubleshooting

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| 製番 ON でも **全件のまま** / continue **1 回で止まる** | `boardQueryParams` deps に **`seibanOrFilters` 生配列**·overlay が **append effect より前** | **`seibanOrFiltersKey` のみ**·overlay を **append 後**に戻す（本ブランチ正本） |
| reconcile 後に **一瞬古い絞込** | 基底 board 更新後も **`serverVerifiedBoard` 残留** | **`baseBoardRowIdsKey` でクリア**（`84751160` 以降） |
| continue 途中で **フィルタが効かない** | `canApply` のみ見ている | **`canDisplay`** で手元行絞込は可·reconcile は完走後 |
| Vitest reconcile が **空表示** | mock が空 board のまま | テスト内で **server と aligned な board** を設定 |
| CI **`tsc -b` 失敗**（`fseiban`） | 行型に `fseiban` 無し | **`84751160`** の unknown cast パターン |
| 機能を止めたい | ビルドフラグ | **`VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER=false`** + 再デプロイ |

### モジュール

| ファイル | 責務 |
| --- | --- |
| [`leaderboardBoardFetchParams.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardFetchParams.ts) | base / reconcile / legacy params |
| [`filterLeaderboardBoardBySeibanOr.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/filterLeaderboardBoardBySeibanOr.ts) | 完走 board の OR 完全一致絞込（`fseiban` 読取） |
| [`leaderboardBoardSeibanClientFilterPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardSeibanClientFilterPolicy.ts) | 表示可否 / reconcile 可否 |
| [`leaderboardBoardAppendSessionRunner.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendSessionRunner.ts) | reconcile 用 continue ループ |
| [`useLeaderboardSeibanOrClientFilterOverlay.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardSeibanOrClientFilterOverlay.ts) | 表示合成 + reconcile effect |
| [`cache/__tests__/*.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/__tests__/) | params・filter・policy・overlay の単体テスト |

## 資源CDフッタチップ端末キャッシュ永続化（2026-05-20 · `fix/kiosk-leaderboard-footer-chips-terminal-cache`）

**目的**: [製番 OR クライアントキャッシュフィルタ](#製番-or-クライアントキャッシュフィルタ2026-05-20) と [端末キャッシュ Phase 2 改訂](#端末キャッシュ-phase-2-改訂120s-同期swr-操作ロック2026-05-20--featkiosk-leaderboard-cache-120s-swr-lock) 反映後、順位ボードの **行下資源CDフッタチップ**が **空のまま**／**リロード・製番 OR 切替後に出ない**事象を、**API 契約・一覧の id 列・total・並び・表示意味論を変えず**に修正する。**Web のみ**·**新規マイグレーションなし**。

**ブランチ**: **`fix/kiosk-leaderboard-footer-chips-terminal-cache`**·代表コミット **`e24d5885`**（`fix(kiosk): persist leaderboard footer chips in terminal cache`）·**`main` 取り込み後の運用デプロイ引数**は **`main`**。

### Context

- **前提 bundle**: Pi5 は **`main`（PR #304 マージ済）**、キオスク Pi4 は Phase 2 / 製番 OR / 120s 改訂の **部分〜全台**反映済み。StoneBase01 で **製番 OR + 120s 改訂**の実機検証 OK 後、**資源CDチップのみ空**が残った（ユーザー報告·2026-05-20）。
- **契約**: フッタチップは API の `leaderboardFooterChipsByPartKey`（[KB-297 §一覧内包](./KB-297-kiosk-due-management-workflow.md#leader-order-board-leaderboard-footer-chips-contract-2026-05-02)）を、装飾後取り経路では [`leaderboard-decorations`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardDeferredBoardDecorations.ts) 累積 → [`mergeLeaderboardBoardWithDecorations`](../../apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardWithDecorations.ts) で表示。端末キャッシュは **board + decorations** を IDB に保存（Phase 2）。

### Symptoms

- **行本体**（順位・納期・機種名等）は SWR / IDB で即表示されるが、**行下の資源CDチップ帯が常に空**、または **装飾 POST 完了直後だけ出てリロードで消える**。
- **製番 OR を ON/OFF** した直後にチップが消える（行数は製番フィルタどおり）。
- DevTools **IndexedDB** で当該 `cacheKey` の record に **`decorations.leaderboardFooterChipsByPartKey` が空**、または **古い装飾指紋のまま put されない**。

### Investigation

| 仮説 | 検証 | 結果 |
| --- | --- | --- |
| API がチップを返していない | Network で `leaderboard-decorations` 応答の `leaderboardFooterChipsByPartKey` | **REJECTED**（キーあり） |
| IDB put が **行内容指紋のみ**で、チップ増分を「変更なし」と判定 | [`shouldSkipCachePut`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePersistPolicy.ts)（board のみ）と put ログ | **CONFIRMED** |
| 製番 OR で **`decorationParamsKey`** が変わり装飾 state がリセット | [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) の `decorationParamsKey` 組み立て | **CONFIRMED**（`paramsKey` + 製番連結を廃止すべき） |

### Root cause

1. **IDB put スキップ**: [`useLeaderboardBoardTerminalCache.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardBoardTerminalCache.ts) が **`fingerprintLeaderboardBoardContent`（行 ID 列＋順位・備考・納期・完了）のみ**で `shouldSkipCachePut` していた。**行内容は不変でも `leaderboardFooterChipsByPartKey` だけ増える**ケースで **put がスキップ**され、次回 cold start / SWR で **チップ無しキャッシュ**が表示される。
2. **装飾取得キーの揺れ**: 製番 OR 有効時に **`decorationParamsKey = paramsKey + seibanOrFiltersKey`** としていたため、登録製番の追加・削除で **`useLeaderboardDeferredBoardDecorations` が state を空にリセット**し、**120s ポーリング完走前**はチップが描画されない時間帯ができる。

### Fix（最小変更・出力同値）

| 層 | 内容 | モジュール |
| --- | --- | --- |
| 装飾指紋 | **board 指紋 + decorations 指紋**の両方が同一のときだけ put スキップ | [`fingerprintLeaderboardBoardDecorations`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePersistPolicy.ts)·[`shouldSkipLeaderboardBoardCachePut`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePersistPolicy.ts) |
| terminal cache | hydrate / put / reconcile 後の fingerprint 更新で **decorations を追跡** | [`useLeaderboardBoardTerminalCache.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardBoardTerminalCache.ts) |
| 装飾 hook キー | **`decorationParamsKey` を `paramsKey` に固定**（製番 OR の ON/OFF で装飾 state をリセットしない） | [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) |

**意図的に触らない**: API Zod·`leaderboard-board` / `continue` の rows 正本·製番 OR の **表示行絞込**（[`filterLeaderboardBoardBySeibanOr`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/filterLeaderboardBoardBySeibanOr.ts)）·120s ポーリング・操作ロック·`serverWins` replace put。

**データフロー（修正後）**:

```mermaid
sequenceDiagram
  participant Hook as useCompositeLeaderboard
  participant Dec as deferred_decorations
  participant TC as useLeaderboardBoardTerminalCache
  participant IDB as IndexedDB

  Hook->>Dec: paramsKey 固定で増分 POST
  Dec-->>Hook: accumulatedDecorations
  Hook->>TC: board + decorations
  TC->>TC: fingerprint board AND decorations
  alt chips added, rows unchanged
    TC->>IDB: put（スキップしない）
  else both unchanged
    TC-->>TC: skip put
  end
```

### Prevention

- 端末キャッシュの **put スキップ条件**は **表示に使う全サブツリー**（少なくとも **board 行**と **装飾マップ**）で指紋を分ける。**行 ID 列だけ**では不足。
- **React Query / 遅延 hook の `queryKey` / `paramsKey`** は [§製番 OR](#製番-or-クライアントキャッシュフィルタ2026-05-20) の **`boardQueryParams`（無 `q`）** と **装飾取得**で **意図的に分離**する場合、**リセット副作用**をテストで固定する。
- **Vitest**: `leaderboardBoardCachePersistPolicy.test.ts`（チップ追加で decorations 指紋変化・複合 skip）·`useLeaderboardBoardTerminalCache.test.tsx`（decorations 付き put）。

### ローカル検証

```bash
pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard
# 196 tests PASS（2026-05-20）

pnpm --filter @raspi-system/web build
# PASS（pre-commit import 順 lint 修正済み）
```

### 本番デプロイ（2026-05-20 · Pi5 → Pi4×4 · 完了）

**方針**: 標準 **`update-all-clients.sh`**·**1 台ずつ `--limit`**·**Web のみ**（Pi3 **`no hosts matched`** で正）。

**標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/kiosk-leaderboard-footer-chips-terminal-cache infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。

| ホスト | 現場名 | Detach Run ID | PLAY RECAP | 備考 |
| --- | --- | --- | --- | --- |
| `raspberrypi5` | サーバ（Web+API） | **`20260520-103202-24115`** | `failed=0` | 先行デプロイ·`verify-phase12-real.sh` **43/0/0** |
| `raspi4-kensaku-stonebase01` | Kensaku StoneBase01 | **`20260520-103644-1806`** | `failed=0` | **`kiosk-browser` 再起動**·**実機検証 OK**（ユーザー） |
| `raspberrypi4` | 第2工場 kensakuMain | **`20260520-110912-15304`** | `ok=122` `changed=10` `failed=0` | 同上 |
| `raspi4-robodrill01` | RoboDrill01 | **`20260520-111402-16821`** | `ok=122` `changed=9` `failed=0` | 同上 |
| `raspi4-fjv60-80` | FJV60/80 | **`20260520-111744-20691`** | `ok=122` `changed=9` `failed=0` | 同上 |

**Pi4 全台反映後（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **29s**·Tailscale·Pi5 `100.106.158.2`）·**`deploy-status`（Pi4×4）** PASS。

### 実機チェックリスト（順位ボード）

1. **2 回目以降のリロード**（同一 `paramsKey`・continue 完走済み）: **行と資源CDチップが同時に即表示**（SWR）。
2. **装飾 POST 完走後**に **120s ポーリング**が走っても、**チップが消えない**（IDB に decorations 指紋付きで保存）。
3. **製番 OR ON → 追加 → OFF**: 行絞込は従来どおり·**チップ帯が製番切替だけで恒久的に空にならない**。
4. **他端末の変更**: 最大 **120s** で収束（Phase 2 SLA·変更なし）。

### Troubleshooting

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| チップだけ空・行は出る | IDB record の **`leaderboardFooterChipsByPartKey`**·Network **`leaderboard-decorations`** | **`e24d5885` 以降** bundle·**Cmd+Shift+R**·古い IDB は一度削除可 |
| 装飾直後だけ出て消える | **put スキップ**（行指紋のみ） | 本 Fix·[`shouldSkipLeaderboardBoardCachePut`](#fix最小変更出力同値) |
| 製番切替でチップだけ消える | **`decorationParamsKey` が製番連結**の旧 bundle | **`e24d5885` 以降**（`paramsKey` 固定） |
| Pi4 だけ直らない | **未デプロイ** | 上表の Detach Run ID·`deploy-status` |
| 機能を止めたい | ビルドフラグ | `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false`（端末キャッシュ全体オフ） |

### 知見

- **「出力同値」修正でも UI サブリソース（チップ）**は **別指紋**が必要。board 行と **装飾マップは独立に変化**しうる。
- **製番 OR** は **board の API `q`** だけでなく、**遅延装飾 hook のキー設計**まで含めて一体で見る（[§製番 OR §装飾](#製番-or-クライアントキャッシュフィルタ2026-05-20) 5 項を更新済み）。
- **Pi5 先行 → StoneBase01 実機 OK → 残 Pi4×3** の順で、**回帰の切り分けコスト**が小さい（標準 [deployment.md §フッタチップ](../guides/deployment.md#kiosk-leaderboard-footer-chips-terminal-cache-2026-05-20)）。

## 並列化事前検証（Pi5 実データ · 2026-05-20 · 実装前）

**目的**: スロット並列 fan-out が **壁時計短縮**と **Pi5 耐久**の両方を満たすか、本番相当データで判定する（**読み取りのみ**）。

**手順（Mac）**: `NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-board-parallel.mjs --profile <robodrill|fjv|stonebase>`（Tailscale 経由 Pi5 `https://100.106.158.2`·`x-client-key: client-key-raspberrypi4-kiosk1`）。

**資源スロット（DB `ProductionScheduleManualOrderResourceAssignment`）**:

| profile | 端末 | スロット数 | resourceCds |
| --- | --- | --- | --- |
| robodrill | 第2工場 RoboDrill01 | 6 | 500,051,052,070,24M,26M |
| fjv | 第2工場 FJV60/80 | 6 | 080,060,501,502,021,033 |
| stonebase | 第2工場 kensakuMain | 8 | 581,305,584,585,586,587,589,588 |

**比較定義**:

- **直列集約（現行）**: `GET leaderboard-board`（全スロット）→ `POST continue` を **hasMore まで直列**（クライアントと同型）。
- **並列 per-slot（模擬 fan-out）**: 各 `resourceCd` ごとに上記を **独立完走**し **`Promise.all`**（壁時計 = 最遅スロット）。

**結果（pageSize shell=80 / continue=40 · 可視行のみ · 出力件数は両モード一致）**:

| profile | 直列 totalMs | 並列 wallMs | speedup | HTTP 本数 直列→並列 | 可視行 total |
| --- | ---: | ---: | ---: | --- | ---: |
| robodrill | 10,811 | 9,461 | **1.14x** | 4 → 15 | 711 |
| fjv | 17,426 | 24,317 | **0.72x（遅い）** | 9 → 20 | 911 |
| stonebase | 69,376 | 77,507 | **0.90x（遅い）** | 20 → 65 | 2,721 |

**Pi5 負荷（検証後スナップショット）**:

- `docker-api-1` CPU **~137%**（ベンチ直後·単発計測）。
- Postgres `pg_stat_activity` **14** 接続（平常近傍）。
- stonebase **shell×3 同時**（3 キオスク想定）: 各 **14–16s**（単体 shell ~6.8s より **~2.3x 遅延**·**CONFIRMED 競合**）。

**判定（実装前ゲート）**:

| 仮説 | 結果 |
| --- | --- |
| 並列 fan-out で壁時計が劇的短縮 | **REJECTED**（fjv/stonebase は **直列より遅い**·robodrill は **+13%** のみ） |
| 並列は Pi5 負荷を下げる | **REJECTED**（HTTP 本数 **3–3.2 倍**·同時 shell でレイテンシ悪化） |
| ボトルネックは API（continue 1 hop） | **CONFIRMED**（stonebase continue-1 **~5s**·shell **~6.8s**） |

**示唆（出力不変）**:

- **素朴なスロット並列化は採用しない**（Pi5 **DB/API 競合**が支配）。
- 劇的改善の方向性は **① 1 リクエストあたりの API/DB 時間短縮**（prefix 装飾キャッシュ·選定コスト削減）·**② continue chunk 最適化（80/80 等）**·**③ 端末 IDB（2 回目以降）**·**④ サーバ側事前 snapshot 温め**。
- **列ごと先出し**は「並列 fan-out」とは別設計（**1 接続で段階 push** 等）として再評価。

## continue chunk 80/80 事前検証（Pi5 実データ · 2026-05-20 · 実装前）

**目的**: 現行 **shell=80 / continue=40** と **continue=80** を A/B 比較し、**出力同値**と **完走壁時計**を実データで判定する。

**手順（Mac）**: `NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-continue-chunk.mjs`（全 profile）または `--profile stonebase`。

**結果（読み取りのみ·完走後 `rows[].id` 指紋一致）**:

| profile | 40 totalMs | 80 totalMs | speedup | rounds 40→80 | 判定 |
| --- | ---: | ---: | ---: | --- | --- |
| robodrill | 9,820 | 8,506 | **1.15x** | 3→2 | 出力 PASS·**5%+ PASS** |
| fjv | 20,546 | 11,907 | **1.73x** | 8→4 | 出力 PASS·**5%+ PASS** |
| stonebase | 72,786 | 39,636 | **1.84x** | 19→10 | 出力 PASS·**5%+ PASS** |

**付帯計測（stonebase · continue=80 完走後）**:

- **`leaderboard-decorations` 一括 2721 行**: **~4.8s**（continue 完走 ~40s に対し **~11%**·二次的要因）。
- **増分 568+2153 行**: 合計 **~5.0s**（一括と同程度）。

**prefix キャッシュ（現状コード）**:

- **light 行 prefix** は [`leaderboard-composite-board-prefix-row-cache.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-prefix-row-cache.ts) で **continue ラウンド間キャッシュ済み**（装飾後取り経路）。
- 残支配要因は **初回 shell の選定**（~5–7s）と **continue 1 hop の hydrate/合成**（stonebase **~3.4s/hop×10**）。**装飾 enrich のラウンド再実行**は後取り化で continue からは切り離し済み。

**実装前ゲート（continue 80/80）**: **PASS** — **Web 定数 `LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE` 40→80** のみで可（API は `pageSize` 受け入れ済み·上限 160）。

**優先度評価**:

| 施策 | 検証 | 推奨 |
| --- | --- | --- |
| **continue 80/80** | **PASS（実データ）** | **最優先で実装**（低リスク·最大 45% 短縮） |
| スロット並列 fan-out | FAIL | 見送り |
| 装飾 POST 完走後一括 | 一括≈増分 | 効果小（~5s）·UX 契約要確認 |
| shell 選定コスト削減 | 未検証 | 80/80 後の次候補（劇的改善の残り） |

## continue chunk 80/80 実装（Web のみ · 2026-05-21 · 本番反映済み）

**目的**: [§continue chunk 80/80 事前検証](#continue-chunk-8080-事前検証pi5-実データ--2026-05-20--実装前) で **PASS** した **continue `pageSize` 40→80** を本番へ反映し、**HTTP 往復回数**を減らして **全スロット行が揃うまで（成功基準 B）** の壁時計を短縮する。**スロット並列 fan-out** は [§並列化事前検証](#並列化事前検証pi5-実データ--2026-05-20--実装前) で **却下済み**（本件は **直列 continue の chunk 最適化のみ**）。

**ブランチ**: **`feat/kiosk-leaderboard-continue-chunk-80`**（**`main` から分岐**）。**代表コミット**: **`a2a3c960`**（`feat(kiosk): increase leaderboard continue chunk to 80`）·**CI 修正**: **`12c94486`**（`chore(ci): upgrade API image Debian packages for libgnutls CVEs` — 機能変更なし·下記 Troubleshooting）。

### 仕様（実装の正本）

| 層 | 内容 | 定数 / モジュール |
| --- | --- | --- |
| Web shell GET | `leaderboard-board?pageSize=80`（スロットあたり） | [`LEADER_ORDER_BOARD_SHELL_INITIAL_PAGE_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)（**80**·変更なし） |
| Web continue POST | `body.pageSize` は常に **80** | [`LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)（**40→80**）·[`buildLeaderboardBoardContinuePayload.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) |
| Web legacy hook | `useLeaderboardPhasedScheduleWithAutoAppend` の continue も **80 固定** | 同上 |
| API | `pageSize` は既存 Zod（上限 **160**）で受け入れ済み | **変更なし**（Pi5 API 再デプロイは **CI イメージのみ**·下記） |

**意図的に触らない**: `deltaRows` 契約·`mergeLeaderboardBoardContinueResponse`·refetch 表示安定化·装飾後取り（`includeDecorations=false`）·端末キャッシュ（Phase 1/2）·製番 OR クライアントフィルタ·COUNT 再利用（API）·[`kiosk-production-schedule.integration.test.ts`](../../apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts) の **`pageSize: 40`**（API が任意 chunk を受け入れる回帰の意図的固定）。

**現行本番正本（2026-05-21 以降）**: 初回 shell **80/スロット**·continue **80/回**（**80/80**）。**2026-05-21 夜以降**は continue **160/回**（**80/160**）が正本 — [§continue 80/160 実装](#continue-chunk-80160-実装web-のみ--2026-05-21--本番反映済み)。歴史節の「continue **40** 固定」は **2026-05-21 以前**の記録。

**ロールバック**: [`LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts) を **40** に戻し **Pi4×4 Web** を **`main`（または hotfix ブランチ）**で再デプロイ（**env フラグなし**）。API は変更不要。

### ローカル検証（実装時）

```bash
pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard
# 200 tests PASS（2026-05-21）

pnpm --filter @raspi-system/web build
# PASS
```

| テスト群 | 確認内容 |
| --- | --- |
| `buildLeaderboardBoardContinuePayload.test.ts` | continue payload の **`pageSize` = 定数 80** |
| `useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx` 等 | hook が定数参照で continue を組み立てる |
| `useLeaderboardPhasedScheduleWithAutoAppend.test.ts` | legacy 経路も **80** |

**読み取りベンチ（再現·Pi5 実データ）**: `NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-continue-chunk.mjs`（[`scripts/test/benchmark-leaderboard-continue-chunk.mjs`](../../scripts/test/benchmark-leaderboard-continue-chunk.mjs)）。**並列 fan-out 却下根拠**: [`scripts/test/benchmark-leaderboard-board-parallel.mjs`](../../scripts/test/benchmark-leaderboard-board-parallel.mjs)。

### CI

| Run | 結果 | 備考 |
| --- | --- | --- |
| **`26194548007`** | **failure** | **`security-docker`** — Trivy API イメージ **`libgnutls30`** CVE（Debian パッケージ） |
| **`26195283245`** | **success** | **`12c94486`** — [`infrastructure/docker/Dockerfile.api`](../../infrastructure/docker/Dockerfile.api) に **`apt-get upgrade -y`** を追加（機能差分なし） |

**注**: ブランチ名 `feat/**` は push 単体では CI が走らない場合がある — **PR 作成後**に全ジョブが走る（[KB-374 §COUNT 再利用 CI](#ci機能ブランチ) と同型）。

### 本番デプロイ（2026-05-21 · **Pi5→Pi4×4 完了**）

**方針**: 標準 **`update-all-clients.sh`**·**1 台ずつ `--limit`**·**Web のみ**（キオスク体感は **Pi4 Web** が `pageSize` を送るため **Pi4 反映必須**）。**Pi5 API** は chunk 受け入れ済みのため **Web 変更単体でも整合**·**`12c94486`** 反映時は Pi5 で **api イメージ再ビルド**あり。

**標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-continue-chunk-80 infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。

| ホスト | 現場名 | Detach Run ID | 備考 |
| --- | --- | --- | --- |
| `raspberrypi5` | Pi5 サーバ | **`20260521-083210-21952`** | **`failed=0`**·**`Git: changed`**·Docker 再起動 **ok** |
| `raspi4-kensaku-stonebase01` | StoneBase01 | **`20260521-085336-30539`** | **`failed=0`**·**`kiosk-browser` / `status-agent` 再起動 ok** |
| `raspberrypi4` | kensakuMain | **`20260521-085933-4370`** | **`failed=0`** |
| `raspi4-robodrill01` | RoboDrill01 | **`20260521-090422-2566`** | **`failed=0`** |
| `raspi4-fjv60-80` | FJV60/80 | **`20260521-090802-31639`** | **`failed=0`** |

**Pi3**: 各 run **`no hosts matched`**（サイネージは対象外·専用手順未実施で正）。

**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5+StoneBase 後および **Pi4 全台後**·Tailscale·Pi5 `100.106.158.2`）·**`deploy-status`（Pi4×4）** PASS。

### 実機チェックリスト（順位ボード）

1. DevTools Network で **`POST …/leaderboard-board/continue`** の body **`pageSize: 80`**（旧 bundle は **40**）。
2. **continue 回数**が [§事前検証](#continue-chunk-8080-事前検証pi5-実データ--2026-05-20--実装前) の **rounds 40→80** 方向に減っている（例: stonebase **19→10**）。
3. **全スロット行が揃った後**の **行 ID 列・`total`・装飾**が、単発 GET または旧 chunk 完了後と **同値**（出力不変）。
4. **120s ポーリング**で行が一瞬減って戻らない（[§表示安定化](#web-表示安定化-refetch-時の追補巻き戻し防止-2026-05-19) 維持）。
5. 必要ならキオスク **強制リロード**（`Cmd+Shift+R`）で旧 bundle を排除。

### Troubleshooting（本件）

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| continue が **`pageSize=40` のまま** | Pi4 **Web bundle** が未反映 | 上表 Detach·**`a2a3c960` 以降**·**強制リロード** |
| 体感が変わらない（Pi5 のみ更新） | キオスク Web は **Pi4 上** | **Pi4×4** も同ブランチ（pageSize 80 第1弾と同型） |
| 件数・並びがおかしい | 完了後 id/total | 統合テスト同型で照合·`deltaRows` 失敗時は **`rows` 正本**（変更なし） |
| CI **`security-docker` のみ失敗**（`libgnutls30`） | Trivy HIGH on API ベースイメージ | **`12c94486`**（`Dockerfile.api` **`apt-get upgrade`**) または [ci-troubleshooting](../guides/ci-troubleshooting.md) |
| 遅いまま（continue 回数は減った） | 第2弾（shell 選定·prefix 装飾·並列 fan-out） | 本リリース範囲外·[KB-369](./KB-369-leader-order-board-api-internal-latency.md)·ロールバックは **定数 40** |
| `update-all-clients.sh` が **exit 3** | ローカルロック | `logs/.update-all-clients.local.lock`·別プロセス完了待ち（[§Phase 2 改訂 知見](#知見-1)） |

### 知見

- **continue 80/80** は **Web 定数 1 点**で **最大 ~46% 完走短縮**（stonebase 実データ）·**出力同値**が事前ゲート。**API 変更は不要**（Zod 上限内）。
- **並列 fan-out は採用しない** — 重い端末ほど **壁時計が悪化**·Pi5 **同時 shell で ~2.3x 遅延**（[§並列化事前検証](#並列化事前検証pi5-実データ--2026-05-20--実装前)）。
- **装飾 POST**（stonebase 2721 行 ~5s）は continue 完走の **~11%** — chunk 80 の次候補は **shell 選定コスト**（未検証）。
- **CI**: 機能 push 後の **`security-docker`** 失敗は **Debian ベース CVE** — **API ロジック無関係**·**`apt-get upgrade`** で解消（再発時は Dockerfile.api を確認）。

## continue chunk 80/160 実装（Web のみ · 2026-05-21 · 本番反映済み）

**目的**: [§continue chunk 80/80 実装](#continue-chunk-8080-実装web-のみ--2026-05-21--本番反映済み) 本番後、**continue `pageSize` 80→160**（**80/160**）で **HTTP 往復回数**をさらに減らし、**全スロット行が揃うまで（成功基準 B）** の壁時計を短縮する。**出力結果（行 ID 列・件数・装飾）は不変**。**API `pageSize` 上限 160 済み**·**スロット並列 fan-out は却下**（変更なし）。

**ブランチ**: **`feat/kiosk-leaderboard-continue-chunk-160`**。**代表コミット**: **`4471a444`**（`feat(kiosk): increase leaderboard continue chunk to 160`）。**PR**: [#315](https://github.com/denkoushi/RaspberryPiSystem_002/pull/315)。

### 仕様（実装の正本）

| 層 | 内容 | 定数 / モジュール |
| --- | --- | --- |
| Web shell GET | `leaderboard-board?pageSize=80`（スロットあたり） | [`LEADER_ORDER_BOARD_SHELL_INITIAL_PAGE_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)（**80**·変更なし） |
| Web continue POST | `body.pageSize` は常に **160** | [`LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)（**80→160**）·[`buildLeaderboardBoardContinuePayload.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) |
| Web legacy hook | `useLeaderboardPhasedScheduleWithAutoAppend` の continue も **160 固定** | 同上 |
| API | `pageSize` は既存 Zod（上限 **160**）で受け入れ済み | **変更なし** |

**意図的に触らない**: `deltaRows` 契約·装飾後取り·端末キャッシュ（Phase 1/2）·製番 OR·COUNT 再利用（API）·初回 shell **80**。

**ロールバック**: 定数を **80**（または **40**）に戻し **Pi4×4 Web** を再デプロイ（1 点·env なし）。

### ローカル検証（実装時）

```bash
pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard
# 200 tests PASS

pnpm --filter @raspi-system/web build
# PASS

NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/test/benchmark-leaderboard-continue-chunk.mjs
# 80 vs 160 A/B — 全 profile 出力同値 + 5%+ 短縮 PASS
```

**ベンチ結果（Pi5 実データ·本番デプロイ後再計測）**:

| profile | speedup (160 vs 80) | rounds 80→160 | row ids |
| --- | ---: | --- | --- |
| robodrill | **1.42x**（29.4% saved） | 2→1 | 一致 |
| fjv | **1.36x**（26.4% saved） | 4→2 | 一致 |
| stonebase | **1.51x**（33.6% saved） | 10→5 | 一致 |

**注**: 1 hop あたりの continue 時間は **160 の方が長くなる**ことがある（payload 増）が、**rounds 半減**が支配的で **totalMs は短縮**。

### CI

| Run | 結果 | 備考 |
| --- | --- | --- |
| **`26222962417`** | **success** | PR #315 branch push — lint-build-unit / api-db-and-infra / security-docker / e2e 全 success |

### 本番デプロイ（2026-05-21 · **Pi5→Pi4×4 完了**）

**方針**: 標準 **`update-all-clients.sh`**·**1 台ずつ `--limit`**·**Web のみ**（キオスク体感は **Pi4 Web** が `pageSize` を送るため **Pi4 反映必須**）。**デプロイ前**は **`git status` クリーン**（未コミットでスクリプト拒否 — **`git stash push -u`** 可）。

**標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-continue-chunk-160 infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**`main` マージ後は第2引数 `main`**）。

| ホスト | Detach Run ID | 備考 |
| --- | --- | --- |
| `raspberrypi5` | **`20260521-203852-9936`** | **`failed=0`**·**`Git: changed`**·Docker 再起動 **ok** |
| `raspi4-kensaku-stonebase01` | **`20260521-205337-26001`** | **`failed=0`**·**`kiosk-browser` / `status-agent` 再起動 ok** |
| `raspberrypi4` | **`20260521-205915-5232`** | **`failed=0`** |
| `raspi4-robodrill01` | **`20260521-210531-13345`** | **`failed=0`** |
| `raspi4-fjv60-80` | **`20260521-211045-27096`** | **`failed=0`** |

**Pi3**: 各 run **`no hosts matched`**（サイネージは対象外·専用手順未実施で正）。

**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **123s**·Tailscale·Pi5 `100.106.158.2`·`deploy-status` Pi4×4 PASS）。

### 実機チェックリスト（順位ボード）

1. DevTools Network で **`POST …/leaderboard-board/continue`** の body **`pageSize: 160`**（旧 bundle は **80**）。
2. **continue 回数**が [§80/80 本番後ベンチ](#continue-chunk-80160-実装web-のみ--2026-05-21--本番反映済み) の **rounds 80→160** 方向に減っている（例: stonebase **10→5**）。
3. **全スロット行が揃った後**の **行 ID 列・`total`・装飾**が **同値**（出力不変）。
4. **120s ポーリング**で行が一瞬減って戻らない。
5. 必要ならキオスク **強制リロード**（`Cmd+Shift+R`）。

### Troubleshooting（本件）

| 症状 | 切り分け | 対処 |
| --- | --- | --- |
| continue が **`pageSize=80` のまま** | Pi4 **Web bundle** 未反映 | 上表 Detach·**`4471a444` 以降**·**強制リロード** |
| 体感が変わらない（Pi5 のみ更新） | キオスク Web は **Pi4 上** | **Pi4×4** も同ブランチ |
| 件数・並びがおかしい | 完了後 id/total | ベンチ同型で照合·`deltaRows` 失敗時は **`rows` 正本** |
| `update-all-clients.sh` が **未commit** で即終了 | ローカル作業ツリー汚れ | **`git stash push -u`** 等でクリーン化して再実行 |
| 遅いまま（continue 回数は減った） | shell 選定·Pi5 memory | 本リリース範囲外·[KB-369](./KB-369-leader-order-board-api-internal-latency.md) |

### 知見

- **continue 80/160** は **Web 定数 1 点 + ベンチ更新**で **最大 ~34% 追加短縮**（stonebase·80/80 比）·**出力同値**。**160 は API Zod 上限** — それ以上の chunk は API 契約変更が必要。
- **1 hop 当たり continue が遅くなる**（160 行 hydrate）が、**HTTP round-trip 半減**が net positive。
- **次候補（本件範囲外）**: **shell 選定 SQL 最適化**·**Pi5 memory 対策**·**Web 増分 view model**（IDB 2 回目以降の体感）。

## References

- **cursor 契約（2026-05-09）**: 代表 **`6bfd2c2b`**（ブランチ **`fix/kiosk-leaderboard-board-continue-cursor`**）·[deployment §cursor](../guides/deployment.md#leaderboard-board-continue-cursor-contract-2026-05-09)。
- **本件（2026-05-19 · pageSize 80 系）**: **`371a1ce2`** / **`f627dcb0`** / **`f6a220e0`**（ブランチ **`feat/leaderboard-continue-delta-safe`**）·**`main`**: [PR #297](https://github.com/denkoushi/RaspberryPiSystem_002/pull/297) **squash** **`fae56edd`**。
- **初回10/追補40（2026-05-19）**: **`1e214213`**（ブランチ **`feat/leaderboard-board-initial-10-continue-40`**）·Pi5 Detach **`20260519-125903-25635`**·**`main`**: [PR #298](https://github.com/denkoushi/RaspberryPiSystem_002/pull/298) **squash** **`5c2bceec`**·[§初回10/追補40](#第1段階-pagesize-初回10--追補40--continue-装飾分離2026-05-19--featleaderboard-board-initial-10-continue-40)。
- **装飾後取り + append スコープ（2026-05-19）**: ブランチ **`feat/kiosk-leaderboard-deferred-decorations-fast-initial`**·tip **`08613580`**·**Pi5→Pi4×4 本番反映・現場 OK**·[§装飾後取り](#装飾後取り--初回80continue40--append-スコープ2026-05-19--featkiosk-leaderboard-deferred-decorations-fast-initial)·[deployment §装飾後取り](../guides/deployment.md#kiosk-leaderboard-deferred-decorations-fast-initial-2026-05-19)。
- **端末キャッシュ Phase 1（2026-05-19）**: ブランチ **`feat/kiosk-leaderboard-terminal-cache-phase1`**·**`072054f9`** / fix **`3ae93221`**·**Pi5 のみ本番**·Pi4 **未展開**·[§端末キャッシュ](#端末キャッシュ-phase-1-indexeddb--裏同期2026-05-19--featkiosk-leaderboard-terminal-cache-phase1)·[ADR-20260519](../decisions/ADR-20260519-leaderboard-terminal-cache-phase1.md)·[deployment §端末キャッシュ](../guides/deployment.md#kiosk-leaderboard-terminal-cache-phase1-2026-05-19)。
- **端末キャッシュ Phase 2（2026-05-19 本番）**: **`c581c1e1`** / **`2300da83`**·**Pi5→Pi4×4**·[§Phase 2 SWR](#端末キャッシュ-phase-2-swr--書き込み同期2026-05-20)·[ADR-20260520](../decisions/ADR-20260520-leaderboard-terminal-cache-phase2-swr.md)·[deployment §Phase 2](../guides/deployment.md#kiosk-leaderboard-terminal-cache-phase2-swr-2026-05-19)·[PR #302](https://github.com/denkoushi/RaspberryPiSystem_002/pull/302)。
- **端末キャッシュ Phase 2 改訂（120s 同期・SWR 操作ロック・2026-05-20）**: **`76e265f2`**·**Pi5 + StoneBase01 部分本番**·実機 **OK**·[§Phase 2 改訂](#端末キャッシュ-phase-2-改訂120s-同期swr-操作ロック2026-05-20--featkiosk-leaderboard-cache-120s-swr-lock)·[deployment §120s 改訂](../guides/deployment.md#kiosk-leaderboard-cache-120s-swr-lock-2026-05-20)·CI **`26133411712`**。
- **製番 OR クライアントキャッシュフィルタ（2026-05-20）**: **`a65c4600`** / **`84751160`**·**Pi5 + `raspi4-kensaku-stonebase01` 先行本番**·[§製番 OR クライアントキャッシュフィルタ](#製番-or-クライアントキャッシュフィルタ2026-05-20)·[deployment §製番 OR クライアントフィルタ](../guides/deployment.md#kiosk-leaderboard-seiban-or-client-cache-filter-2026-05-20)。
- **資源CDフッタチップ端末キャッシュ（2026-05-20）**: **`e24d5885`**·**Pi5→Pi4×4 本番・実機 OK**·[§資源CDフッタチップ端末キャッシュ](#資源cdフッタチップ端末キャッシュ永続化2026-05-20--fixkiosk-leaderboard-footer-chips-terminal-cache)·[deployment §フッタチップ](../guides/deployment.md#kiosk-leaderboard-footer-chips-terminal-cache-2026-05-20)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。
- **continue chunk 80/80（2026-05-21）**: **`a2a3c960`** / CI **`12c94486`**·**Pi5→Pi4×4 本番**·Detach **`20260521-083210-21952`** 他 4 台·CI **`26195283245` success**·[§continue 80/80 実装](#continue-chunk-8080-実装web-のみ--2026-05-21--本番反映済み)·[deployment §continue 80](../guides/deployment.md#kiosk-leaderboard-continue-chunk-80-2026-05-21)。
- **continue chunk 80/160（2026-05-21）**: **`4471a444`**·**PR [#315](https://github.com/denkoushi/RaspberryPiSystem_002/pull/315)**·**Pi5→Pi4×4 本番**·Detach **`20260521-203852-9936`** 他 4 台·CI **`26222962417` success**·[§continue 80/160 実装](#continue-chunk-80160-実装web-のみ--2026-05-21--本番反映済み)·[deployment §continue 80/160](../guides/deployment.md#kiosk-leaderboard-continue-chunk-160-2026-05-21)。
- **shell 初回最適化 第1弾（2026-05-21 · API のみ · Pi5 本番・実機 OK）**: winner materialization **リクエスト内 1 回共有**·**`hasMore=false` スロットは COUNT await 省略**·**`143c8814`**·**PR [#316](https://github.com/denkoushi/RaspberryPiSystem_002/pull/316)**·CI **`26226698424` success**·Detach Pi5 **`20260521-221507-30100`**·[§shell 第1弾](#shell-初回最適化-第1弾-api-のみ--2026-05-21--本番反映済み)。
- **shell 選定 SQL 第2弾（2026-05-22 · API のみ · Pi5 本番・実機 OK）**: SQL **共通化 + LATERAL JOIN**·prefix **manual LIMIT / expansion スキップ**·**`56490cfd`**·CI **`26257727724` success**·Detach Pi5 **`20260522-081052-2796`**·[§shell 第2弾](#shell-選定-sql-第2弾api-のみ--2026-05-22--本番反映済み)。
- 関連: [KB-369](./KB-369-leader-order-board-api-internal-latency.md)·[KB-380](./KB-380-kiosk-leaderboard-network-error-resilience.md)·[KB-297 §製番チップ](./KB-297-kiosk-due-management-workflow.md#leader-board-seiban-or-filter-2026-04-29)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

## shell 初回最適化 第1弾（API のみ · 2026-05-21 · 本番反映済み）

**目的**: `GET …/leaderboard-board`（初回 shell）の壁時計を **出力同値**のまま短縮する。Web 変更なし。

**変更（API）**:

| 項目 | 内容 | モジュール |
| --- | --- | --- |
| winner 共有 | board shell 1 リクエスト内で `resolveLeaderboardMaterializedBaseWhere` を **1 回**·全スロット `listLeaderboardShellProductionScheduleRows` に `precomputed` 注入 | [`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts)·[`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts) |
| COUNT 条件省略 | **`hasMore=false`（prefix で全件確定）** のスロットは `rows.length` を total 正本とし **COUNT 結果を await しない** | [`resolve-leaderboard-board-shell-resource-total.ts`](../../apps/api/src/services/production-schedule/leaderboard/resolve-leaderboard-board-shell-resource-total.ts) |
| COUNT 並行維持 | hasMore スロット向け COUNT は **shell 選定と同時開始**（従来どおり overlap） | 同上 |
| 未使用 COUNT の reject 握り | hasMore=false 向けに **開始したが await しない COUNT promise** の reject を **`settleUnusedLeaderboardBoardShellCount`** で握りつぶし（未処理 rejection 防止） | 同上 |

**契約不変**: shell 応答の **`rows[].id` 列**·**`total`**·**`resources[].total`** は従来と同値（`hasMore=false` では COUNT 定義と `rows.length` が一致するため省略可能）。

**本番反映（2026-05-21 · `raspberrypi5` のみ）**:

| 項目 | 値 |
| --- | --- |
| ブランチ | **`feat/kiosk-shell-initial-opt-phase1`** |
| 代表コミット | **`143c8814`**（`perf(kiosk): shorten leaderboard board shell critical path`） |
| PR | [#316](https://github.com/denkoushi/RaspberryPiSystem_002/pull/316) |
| CI | **`26226698424` success** |
| Detach Run ID | **`20260521-221507-30100`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit 0`**·ローカル **`--follow` 約 776s**·**`Git: changed`**·**Docker 再起動 ok**） |
| 実機（自動） | `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **64s**） |
| Pi4 / Pi3 | **`skipping: no hosts matched`**（**Pi5 `api` のみ**·Pi4 順次 **不要**） |

**本番 shell ベンチ（Pi5 実データ·デプロイ直後·`runs=2`）** — [`benchmark-leaderboard-board-shell.mjs`](../../scripts/test/benchmark-leaderboard-board-shell.mjs):

| profile | shell median | hasMore / completeInShell | 備考 |
| --- | --- | --- | --- |
| robodrill（6 slots） | **~3017ms** | 4/6 hasMore · **2 completeInShell** | COUNT skip **2 スロット分**が効く |
| fjv（6 slots） | **~3142ms** | **6/6 hasMore** · 0 completeInShell | **winner 共有のみ**（COUNT 省略効果は小） |
| stonebase（8 slots） | **~5058ms** | 7/8 hasMore · **1 completeInShell** | 同上·支配要因は **shell 選定 SQL** |

**知見**:

- **全スロット hasMore**（fjv 等）では第1弾効果は **winner 共有のみ**で体感差は小さめ。**空/小件数スロット混在**（robodrill の completeInShell=2 等）で COUNT await 省略が効きやすい。
- **初回ペイントの壁**は引き続き **shell GET**（全スロット選定 + COUNT）。continue 80/160·装飾後取り·IDB SWR とは **別レイヤ**。
- **第2弾**（manual SELECT LIMIT 化·相関→JOIN）は shell 壁時計の **残支配要因**（[EXEC_PLAN §shell 選定 SQL](../../EXEC_PLAN.md)）。

**トラブルシュート**:

| 症状 | 想定原因 | 対処 |
| --- | --- | --- |
| Pi4 で shell が速くならない | **Pi5 `api` のみ**が対象 | Pi4 順次デプロイ **不要**（Pi4 は Pi5 API 参照） |
| `total` がずれる | **`snapshotExpired`** 後は shell 再取得が正 | キャッシュミス時は COUNT フォールバック（同値） |
| デプロイ中 `ssh: Operation timed out` | Tailscale 一過性 | **`PLAY RECAP failed=0`** と **`Summary success: true`** を正とする |
| COUNT reject で shell 500 | 未使用 COUNT promise 未処理 | **`settleUnusedLeaderboardBoardShellCount`**（統合テストで回帰担保） |

**ローカル検証**:

```bash
pnpm --filter @raspi-system/api exec vitest run \
  src/services/production-schedule/leaderboard/__tests__/resolve-leaderboard-board-shell-resource-total.test.ts
pnpm --filter @raspi-system/api test -- kiosk-production-schedule.integration.test.ts -t "leaderboard-board"
```

**残タスク（第2弾）**: ~~manual 行 SELECT の **LIMIT 押し下げ**·相関サブクエリ JOIN 化~~ → **2026-05-22 完了**（[§shell 第2弾](#shell-選定-sql-第2弾api-のみ--2026-05-22--本番反映済み)）。

## shell 選定 SQL 第2弾（API のみ） — 2026-05-22 — **本番反映済み** {#shell-選定-sql-第2弾api-のみ--2026-05-22--本番反映済み}

**ブランチ**: **`feat/kiosk-leaderboard-shell-sql-phase2`**·**代表コミット**: **`56490cfd`**·**CI**: **`26257727724` success**。

### 背景・目的

[§shell 第1弾](#shell-初回最適化-第1弾-api-のみ--2026-05-21--本番反映済み) で **winner 共有**と **hasMore=false COUNT 省略**を入れた後も、**hasMore スロット**では **manual / expansion / filler の 3 本 SELECT** と **相関サブクエリ（`processingOrder` / `globalRank`）** が **prefix 初回 shell の支配要因**だった。第2弾は **SQL 構造の共通化 + JOIN 化**と **prefix 向け manual LIMIT / expansion スキップ**で、**continue 経路と board 出力契約を変えず**初回 shell の DB 負荷を下げる。

### 仕様（実装）

| 項目 | 内容 |
| --- | --- |
| **Step A — SQL 共通化 + JOIN 化** | `leaderboard-shell-rank-join.sql.ts` で **`ord_pick` / `gr_pick` LATERAL JOIN**·`leaderboard-shell-row-projection.sql.ts` で **manual / expansion / filler 共通 SELECT/FROM/ORDER BY**·`leaderboard-shell-row-query.sql.ts` の **`queryLeaderboardShellScheduleRows()`** に集約 |
| **Step B — prefix 初回のみ LIMIT** | **`fetchLeaderboardShellMergedPrefixRows`** のみ **`prefixLimit`** を渡す·manual は **`LIMIT prefixLimit + 1`（probe）** → **`trimLeaderboardShellManualProbeRows`**·manual **>= prefixLimit** なら **expansion スキップ**（[`leaderboard-shell-priority-fetch-policy.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-priority-fetch-policy.ts)） |
| **continue / full merge** | **`prefixLimit` 未指定** — 従来どおり full manual + expansion（**順序・件数契約不変**） |
| **型分離** | `LeaderboardScheduleRowSql` を [`leaderboard-schedule-row.types.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-schedule-row.types.ts) に分離（循環 import 回避） |
| **不変** | Web·continue 80/160·装飾後取り·第1弾 winner/COUNT·**新規マイグレーションなし**·**出力同値** |

### 接続点

- [`leaderboard-row-selection.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts): **`processingOrderScalar` → `rankJoins`**·prefix 経路は policy 経由で LIMIT / expansion skip
- [`leaderboard-shell-hydrate.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-hydrate.service.ts): 型 import を **`leaderboard-schedule-row.types.ts`** に変更

### ローカル検証

```bash
pnpm --filter @raspi-system/api test -- leaderboard-shell-priority-fetch-policy
pnpm --filter @raspi-system/api test -- leaderboard-shell-row-selection-compare
pnpm --filter @raspi-system/api test -- kiosk-production-schedule.integration.test.ts -t "leaderboard"
```

- fetch-policy **8 PASS**·compare **6 PASS**·leaderboard unit **39 PASS**·統合 `leaderboard` **18 PASS**

### 本番デプロイ（Pi5 のみ）

- **対象**: **`raspberrypi5` のみ**（API コンテナ·**Pi4/Pi3 不要**）
- **Detach Run ID**: **`20260522-081052-2796`**（`ok=134` `changed=4` `failed=0`·**Git changed**·Docker rebuild + **`prisma migrate deploy` ok**）
- **実機（自動）**: `verify-phase12-real.sh` **43/0/0**（約 **31s**）
- **手順正本**: [deployment §shell 第2弾](../guides/deployment.md#kiosk-leaderboard-shell-sql-phase2-2026-05-22)

### Pi5 shell ベンチ（実データ·デプロイ直後·`runs=2`）

[`benchmark-leaderboard-board-shell.mjs`](../../scripts/test/benchmark-leaderboard-board-shell.mjs):

| profile | 第1弾 median（参考） | 第2弾 median | 第2弾 min | hasMore / completeInShell |
| --- | --- | --- | --- | --- |
| robodrill | ~3.0s | ~4.9s | **~3.0s** | 4/6 hasMore · 2 completeInShell |
| fjv | ~3.1s | **~3.1s** | **~2.8s** | 6/6 hasMore |
| stonebase | ~5.1s | ~6.6s | ~5.9s | 7/8 hasMore · 1 completeInShell |

**知見**:

- **fjv** は median **同等〜改善**·**robodrill run1** は第1弾と **min 同等（~3.0s）** だが run2 で伸び **median は悪化**（全スロット並列 COUNT + 合成時間の **run 間分散**）。
- **stonebase** は median **やや悪化** — **expansion スキップ条件**（manual が prefix を埋めないスロット）や **JOIN プラン差**の **EXPLAIN 実測**が第3弾候補。
- **continue 経路**は第2弾の LIMIT 対象外 — **初回 shell のみ**が最適化スコープ。

### トラブルシューティング

| 症状 | 切り分け |
| --- | --- |
| **初回 shell が遅いまま** | 第1弾 COUNT 省略が効く **completeInShell** スロットか確認·**hasMore** スロットは **選定 SQL + COUNT 並列**が支配 |
| **ベンチ median だけ悪化** | **`runs>=2`** で **min/median 併記**·Pi5 **memory 90%+** 時の一過性 503 と相関調査（[EXEC_PLAN Next Steps](../../EXEC_PLAN.md)） |
| **continue 順序ずれ** | continue は **`prefixLimit` なし** — `leaderboard-shell-row-selection-compare` と統合テストで **monolithic 同順**を固定 |
| **Pi4 にデプロイしたが変わらない** | **意図どおり** — 変更は **Pi5 `api` のみ** |

### 残タスク（第3弾候補）

1. **expansion budget LIMIT**（prefix 未充足スロットの expansion 行数上限）
2. **EXPLAIN ANALYZE** + インデックス見直し（stonebase 等 **manual 未充足**スロット）
3. **Web 増分 view model**（IDB 2 回目以降 DOM 最小化）— 出力同値 PoC

**正本**: [EXEC_PLAN §Next Steps](../../EXEC_PLAN.md)·[deployment §shell 第2弾](../guides/deployment.md#kiosk-leaderboard-shell-sql-phase2-2026-05-22)
