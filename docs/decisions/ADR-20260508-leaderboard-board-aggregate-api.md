# ADR-20260508: 順位ボード集約 API（leaderboard-board）

- **Status**: accepted  
- **日付**: 2026-05-08  

## Context

### プロダクト上の前提（変更していないこと）

- **表示のためのデータや並び・件数の意味論を変えない**。速さのために行を減らしたり、装飾（機種名・顧客名・行下工程チップ等）を恒久省略したりしない。
- **体感として「安定して数秒以内に一覧が立つ」**ことを目標にしうるが、断定は **本番相当データでの計測**に寄せる（後述）。

### 経緯（これまでのレイヤーと本 ADR の位置）

順位ボードは、次のような **サーバ側およびプロトコル側の改善**が **本 ADR 以前**から累積している。

- **単一 `responseProfile=leaderboard` 一覧**の内部で、可視行 **COUNT** と行 **SELECT** の **直列待ち**をやめ、**並列化**して壁時計を短縮（COUNT と意味は不変）。
- **同一論理キー内最大 ProductNo（winner）**を、相関サブクエリの繰り返し評価から **1 本の materialized 集合**に寄せ、`COUNT`・行取得・hydrate が **同じ `IN (...)` を共有**する（定義は不変）。
- **段階取得**（`leaderboard-shell` / `leaderboard-total` / `leaderboard-decorations`、および `leaderboard-shell/continue`）で **初回バイトを早める**一方、**並びの正本**は従来どおり再利用し、マージは **rowId ベース**で **再ソートしない**。
- **資源 CD カード単位**に phased を分離し、`resourceCds.length === 1` の問い合わせでは **同一製番展開をオフ**にして **カード内の手順・納期の独立性**を担保（複数資源一括の契約は従来どおり）。
- **snapshotId + cursor** による continue、**サーバ内 snapshot（TTL）** により **payload 肥大と失効**のtrade-offを制御。

それでも **多資源スロット UI** では、**各資源カードが独自に** shell / total / continue /（集約後の）decorations を取りに行く構造（ブラウザ側 **fan-out**）が残り、**資源数に比例して HTTP 往復数と React Query の並列度が増える**ことが、**初回表示・追補の体感**における支配要因になり得た。

### 技術的な問題の整理

- **症状**: 多資源選択時、**ネットワークウォーターフォール**（同一画面内で多数の XHR/fetch が同時多発）となり、特に Pi4 キオスクで **待ち体感**が悪化しうる。
- **主因の一角（クライアント側）**: カード（資源スロット）**単位**に **独立した取得パイプ**を張ると、**スロット数 ×（shell 系 + total + 追補 + 装飾）** にオーダーが伸びうる。
- **サーバ側との関係**: 各エンドポイント単体は最適化済みでも、**ブラウザ発の同時リクエスト数**は別問題として残る。また **本 ADR の集約**は **1 HTTP でサーバが複数スロット分を処理**するため、**API 1 プロセスあたりの仕事は重くなりうる**（負荷の **分散 → 集中**）。これは観測・キャパ計画の対象となる。

## Decision

- 既存の段階取得系エンドポイント（`GET/POST …/leaderboard-shell`・`…/leaderboard-total`・`…/leaderboard-decorations`・`…/leaderboard-shell/continue` 等）は **後方互換のまま維持**する（他クライアント・検証・移行期間のため）。
- **追加で** 次を提供する（実際の HTTP パスはルート定義に準拠し、キオスクでは通常 `/api` プレフィックスが前置される）。
  - `GET …/kiosk/production-schedule/leaderboard-board`
  - `POST …/kiosk/production-schedule/leaderboard-board/continue`
- サーバ側のオーケストレーションは **`apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts`** に集約し、既存の  
  `listLeaderboardShellProductionScheduleRows` / `listLeaderboardShellContinuationProductionScheduleRows` / `countProductionScheduleDashboardVisibleRowsFromListFilters` / `decorateLeaderboardShellRowsForKiosk`  
  を **意味を変えずに再利用**する。
- Web の **`useCompositeLeaderboardPhasedScheduleWithAutoAppend`** は、上記 **board 集約 API を主経路**とする **単一の React Query 系フロー**に切り替え、**資源カード別に複数の独立 hook インスタンスを並列マウントする構成（fan-out）を撤去**する。応答の **`resources[]`** で **スロットごとの snapshot / cursor / hasMore / total** 等を保持し、**従来のカード単位意味**を維持する。

## Alternatives considered

| 案 | 却下または未採用の理由 |
|----|------------------------|
| **クライアント fan-out のまま**、各エンドポイントだけ微最適化を重ねる | スロット数に対して **HTTP 往復が線形**な限り、並列リクエスト数の上限に早くぶつかる。**根本の「N 本のパイプ」**は残る。 |
| **HTTP/2 多重化だけに期待** | 接続は集約できても **サーバ・DB への並列仕事の総量**や **ブラウザの処理**が消えるわけではない。環境依存が大きい。 |
| **BFF 以外の別チャネル（例: WebSocket 一括）** | 接続管理・失効・認可の再実装コストが大きく、既存の **snapshot / continue の契約**と二重化しやすい。 |
| **本 ADR: サーバ集約 API** | クライアント **往復数**を **スロット数に弱依存**に寄せられる。既存サービス関数を **再利用**でき、契約を **resources 配列**に閉じ込められる。 |

## Consequences

### 良い面

- **ブラウザ発 HTTP の本数**が、多資源時に **資源数にほぼ線形に増えにくく**なる（理想的には **board + continue 系の少数往復**に収束）。
- **既存 phased API** を残すため、**ロールバックや段階移行**、**他クライアント**の追従が容易。
- **集約サービス**がオーケストレーションの **単一箇所**になり、将来の計測（ログ・スパン）を入れる余地がある。

### 留意点・トレードオフ

- **単一リクエストが重くなりうる**: スロット数分の処理を **1 API リクエスト**が引き受ける。**ワーカー並列度・DB 同時実行・タイムアウト**は運用上モニタする価値がある。
- **空データ・検索ヒット0件**など **異常に軽い／偏った条件**での **curl タイム**だけでは **「改善実証」に十分でない**（後述の KB に記録）。
- **snapshot のプロセスローカル性**（既存 ADR-20260507 の議論）と組み合わせたとき、**複数 API プロセス**では引き続き **失効・フォールバック頻度**に注意（board 集約は **集約先サービス内**の一貫性に寄与するが、**スケールアウトの境界**は別問題）。

### 運用追補（2026-06-23）

board 集約 API は HTTP fan-out を抑えるが、サーバ内の residual context / summary / per-resource shell / labor lookup が重い場合は単一リクエスト内の待ちとして残る。2026-06-23 の PR #464 では、process-change residual evidence を sync/backfill 時に永続化し、表示時の raw `FKOJUNST_Status` 45万行級読みを避けるようにした。さらに residual summary は正規化キー式インデックスで解決する。

Pi5 503/504 scoped sample:

| Probe | Result |
| --- | --- |
| shell single | **9.24s** (`includeDecorations=false`, `deferTotals=true`) |
| shell 4 parallel | **12.48-13.07s** |
| continue `pageSize=160` | **4.71s** |

この結果は 503/504 の代表条件に対する改善証跡であり、全資源セットのP95保証ではない。次のサーバ側論点は `resourceShell` の row selection / ordering SQL。

## Rollout（本番）

- **2026-05-08 時点の実施済みホスト**: `raspberrypi5`（API）・`raspberrypi4`（キオスク Web を含む通常対象）。**Detach Run ID**（接頭辞 `ansible-update-`）: `20260508-175314-10578`（Pi5）/ `20260508-181440-11189`（`raspberrypi4`）。いずれも **`PLAY RECAP` `failed=0` / `unreachable=0`**。
- **未実施（同一手順で順次想定）**: `raspi4-robodrill01` / `raspi4-fjv60-80` / `raspi4-kensaku-stonebase01`。マージ後の **`main`** を引数にした標準デプロイを **`--limit` 1 台ずつ**。
- **広域検証スクリプト**: 途中実行では **`deploy-status raspberrypi4` が一時 `isMaintenance: true`** となり **`verify-phase12-real.sh` が FAIL 1** になり得る（連続デプロイで既知）。**全台完了後の再実行**または **`deploy-status` の正常化待ち**で切り分け。

## Open questions / 次に検証したいこと

- **本番負荷相当**（複数資源・多行・実際の検索語）で、**board 1 往復**と旧 **fan-out N 往復**の **P95/P99** を比較する（キオスク Network タブとサーバログの双方）。
- **初回 shell が全件順序を確定するコスト**は、continue の cursor 化とは独立に残る。**別イニシアチブ**で「初回のみの縮退」や **選定アルゴリズム**の境界を切るかは、計測後に判断。
- board 集約下での **API レプリカ数・LB の振り分け**と **snapshot ストア**の関係を、運用で **失効率**が上がらないか継続観察。
- **2026-06-23 時点の次論点**: residual evidence / summary は大きく改善済み。次に見るべきは `resourceShell` の行選定・ソート経路と、大規模 multi-resource board での `attachLabor` 増加。

## References

- ナレッジ（計測・デプロイ・トラブルシュート統合）: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)
- 性能回復plan（2026-06-23 residual evidence / index 実測）: [leaderboard-defer-totals-performance-recovery](../plans/leaderboard-defer-totals-performance-recovery.md#pi5-residual-evidence-persistence--residual-key-index-deploy-2026-06-23)
- ルート・集約実装:  
  [`leaderboard-phased-read.ts`](../../apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts)  
  [`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts)
- Web: [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx)
- 関連（snapshot の非共有性等）: [ADR-20260507-leaderboard-shell-snapshot.md](./ADR-20260507-leaderboard-shell-snapshot.md)
- 運用: [deployment.md](../guides/deployment.md) 補足（2026-05-08 · board 集約 API）
- プロジェクト進捗: [EXEC_PLAN.md](../../EXEC_PLAN.md)
