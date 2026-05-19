---
title: KB-374 leaderboard-board/continue の cursor 契約と HTTP 400（Zod）
tags: [kiosk, production-schedule, leader-order-board, leaderboard-board, api, web]
audience: [開発者, 運用者]
last-verified: 2026-05-19
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
| 初回は速いが全件揃うまで遅い | **continue ラウンド数**・**prefix 装飾**を疑う | 第2弾: prefix 装飾キャッシュ・continue 並列化・COUNT 再利用（[KB-369](./KB-369-leader-order-board-api-internal-latency.md)） |
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

## 装飾後取り + 初回80/continue40（2026-05-19 · `feat/kiosk-leaderboard-deferred-decorations-fast-initial`）

**目的**: 初回は **行の骨格のみ**を先に描画し、機種名・顧客名・資源CDチップは **`leaderboard-decorations` POST** で後取りする。全 continue 完了後の **id / total / 装飾 / `leaderboardFooterChipsByPartKey`** は eager（`includeDecorations` 省略＝**true**）経路と同値。

### 仕様（実装の正本）

| 層 | 内容 | モジュール |
| --- | --- | --- |
| API 契約 | `includeDecorations`（GET query / continue body、**省略時 true**） | [`shared.ts`](../../apps/api/src/routes/kiosk/production-schedule/shared.ts) |
| API `false` | shell/continue は **light rows のみ**（board 内装飾スキップ） | [`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts) |
| API continue prefix | **snapshotId** 単位の light 行キャッシュで prefix 再 hydrate 削減 | [`leaderboard-composite-board-prefix-row-cache.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-prefix-row-cache.ts) |
| Web 初回 GET | `pageSize=80`・`includeDecorations=false` | [`constants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)·[`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) |
| Web continue | `pageSize=40` 固定・`includeDecorations=false` | [`buildLeaderboardBoardContinuePayload.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) |
| Web 装飾 | **未装飾 rowId のみ**増分 POST → 累積マージ | [`useLeaderboardDeferredBoardDecorations.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardDeferredBoardDecorations.ts)·[`mergeLeaderboardBoardWithDecorations.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardWithDecorations.ts) |

**UX 契約**: チップ未到着時は **行だけ先表示**（レイアウト伸び許容）。`isLoading` は **light rows が無い間のみ**。

### 本番デプロイ

**未実施**（ローカル実装・テストのみ。コミット前）。

### ローカル回帰（実装時）

- API 統合: `kiosk-production-schedule.integration.test.ts` — `leaderboard-board continue profile logs`（初回 **80**・continue **40**・`includeDecorations=false`・完了後 id/total 一致）
- Web: `mergeLeaderboardBoardWithDecorations`·composite hook·`buildLeaderboardBoardContinuePayload` の Vitest

## References

- **cursor 契約（2026-05-09）**: 代表 **`6bfd2c2b`**（ブランチ **`fix/kiosk-leaderboard-board-continue-cursor`**）·[deployment §cursor](../guides/deployment.md#leaderboard-board-continue-cursor-contract-2026-05-09)。
- **本件（2026-05-19 · pageSize 80 系）**: **`371a1ce2`** / **`f627dcb0`** / **`f6a220e0`**（ブランチ **`feat/leaderboard-continue-delta-safe`**）·**`main`**: [PR #297](https://github.com/denkoushi/RaspberryPiSystem_002/pull/297) **squash** **`fae56edd`**。
- **初回10/追補40（2026-05-19）**: **`1e214213`**（ブランチ **`feat/leaderboard-board-initial-10-continue-40`**）·Pi5 Detach **`20260519-125903-25635`**·**`main`**: [PR #298](https://github.com/denkoushi/RaspberryPiSystem_002/pull/298) **squash** **`5c2bceec`**·[§初回10/追補40](#第1段階-pagesize-初回10--追補40--continue-装飾分離2026-05-19--featleaderboard-board-initial-10-continue-40)。
- **装飾後取り（2026-05-19）**: ブランチ **`feat/kiosk-leaderboard-deferred-decorations-fast-initial`**（**未マージ・未デプロイ**）·[§装飾後取り](#装飾後取り--初回80continue402026-05-19--featkiosk-leaderboard-deferred-decorations-fast-initial)。
- 関連: [KB-369](./KB-369-leader-order-board-api-internal-latency.md)·[KB-380](./KB-380-kiosk-leaderboard-network-error-resilience.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。
