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

## References

- **cursor 契約（2026-05-09）**: 代表 **`6bfd2c2b`**（ブランチ **`fix/kiosk-leaderboard-board-continue-cursor`**）·[deployment §cursor](../guides/deployment.md#leaderboard-board-continue-cursor-contract-2026-05-09)。
- **本件（2026-05-19）**: **`371a1ce2`** / **`f627dcb0`** / **`f6a220e0`**（ブランチ **`feat/leaderboard-continue-delta-safe`**）。
- **`main`**: [PR #297](https://github.com/denkoushi/RaspberryPiSystem_002/pull/297) **squash** **`fae56edd`**。
- 関連: [KB-369](./KB-369-leader-order-board-api-internal-latency.md)·[KB-380](./KB-380-kiosk-leaderboard-network-error-resilience.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。
