---
title: KB-370 生産スケジュール「実効完了」の外部要因3系統OR統合（手動・工順ST・生産日程CSV）
tags: [生産スケジュール, CSV, FKOJUNST, 外部完了, 順位ボード]
audience: [開発者, 運用者]
last-verified: 2026-05-16
category: knowledge-base
---

# KB-370: 生産スケジュール「実効完了」の外部要因3系統OR統合

## Context

順位ボード等で参照する **実効完了** を、CSV 由来の複数ソースで一貫させる必要があった。

## ガード: 生産日程CSVで winner 論理キーが 0 件

**DEDUP** 取込の本体処理の直前時点で **現 winner の論理キー集合が空** の場合、**CSV 由来の「消滅」差分**と **`ProductionScheduleExternalCompletion` の当該列同期**は **行わない**（戻り値 `skipped: true`, `reason: 'empty_schedule_csv'`）。歴史的経路で **`ProductionScheduleCsvIngestLogicalKeySnapshot` を更新していた**場合も **同 skip で抑止**（**2026-05-09** 以降の主経路校区では当該スナップショットは未使用）。空CSVや事故入力で **DB 上の全 winner を一括「消滅完了」扱いにしない**ため。

取込パイプライン側は [`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts) で当該 skip を **warn**（`dashboardId` / `reason`）し、観測可能にする。

## Decision（仕様の要約）

実効完了は次の **論理 OR**（いずれかが真なら完了扱い）:

1. **手動**: 既存 `ProductionScheduleProgress.isCompleted`
2. **工順ST（FKOJUNST_Status メール同期 → `ProductionScheduleFkojunstMailStatus`）**
   - **`statusCode` が `C` または `X`** のとき外部完了（**2026-05-08 改訂**: 旧 **dedupe キー消失**・**`O`/`P` による完了**は廃止。`externallyCompletedFromFkojunstDisappeared` は再計算で **常に false**）
   - **`O` / `P`**: 一覧非表示だが **未完了**（製番進捗 total に残る）
3. **生産日程CSV取込（消滅完了）**
   - **2026-05-09 改訂**: **「`FKOJUNST` メール同期済み winner のうち `fkmail.statusCode <> 'C'`」かつ「`occurredAt` が基準日時の UTC **±3 カ月**」**に入る論理キー**を母集団とし、**母集団 − 現 winner（2026-05-16 以降の正本は下項）の論理キー** を **消滅**とみなして `externallyCompletedFromScheduleCsvDisappeared` を更新する（**`C` は母集団から除外**・[KB-373](./KB-373-fkojunst-status-c-key-domain-mismatch.md) の **キー空間不一致**対策）。**旧仕様（〜2026-05-08 以前）**: 取込直前スナップショットと取込後キーの差分・**`S`/`R` winner に限定**する記述は **本項で置換**（正本は [deployment.md §2026-05-09 消滅窓](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)）。
   - **2026-05-16 改訂（正本Cの current keys）**: **現 winner の論理キー集合**は **`ProductionScheduleCanonicalCurrentKeysService`** により **今回バッチで確定した生産日程本体 CSV の dedupe winner** だけから構築し、[`applyPostIngestFromSnapshot`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-csv-ingest-external-completion-sync.service.ts) に **`canonicalScheduleDisappearanceCurrentKeys`** として渡す。**`FKOJUNST_Status` メールに行が載っていない（FK が無い）ことだけでは**本体 winner を **現集合から落とさない**（過剰な消滅完了を防ぐ）。**計画ファイル（CSV）は編集しない**。**±3ヶ月×非C の母集団**自体は変更なし。**正本運用ドキュメント**: [deployment §2026-05-16](../guides/deployment.md#schedule-csv-disappearance-canonical-current-keys-2026-05-16)。
   - **空 winner ガード**（`empty_schedule_csv`）は変更なし。

論理キーは運用どおり **`FKOJUN` + TAB + 正規化資源CD + TAB + 製造order（ProductNo）**（`FSIGENCD` は trim・大文字化して共通関数で生成）。

## Data model

- `ProductionScheduleExternalCompletion` に由来別フラグを保持し、同期時に **`isExternallyCompleted` を3列の OR** で更新する:
  - `externallyCompletedFromFkojunstDisappeared`（**2026-05-08**: メール再計算で **常に false**。列は後方互換のため保持）
  - `externallyCompletedFromFkojunstMailStatus`（**`fkmail` の `C`/`X`**）
  - `externallyCompletedFromScheduleCsvDisappeared`
- 生産日程CSV用スナップショット: `ProductionScheduleCsvIngestLogicalKeySnapshot`（**2026-05-09**: 消滅差分の主計算からは外し、**DB／repository は互換で存続**）

## Migration

- `apps/api/prisma/migrations/20260506150000_triple_source_external_completion/migration.sql`
- 既存 `isExternallyCompleted = true` は **消滅由来列**へバックフィル（移行方針はマイグレーションコメント参照）

## 主な実装参照

- `apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.repository.ts`
- `apps/api/src/services/production-schedule/external-completion/production-schedule-csv-ingest-external-completion-sync.service.ts`
- `apps/api/src/services/production-schedule/external-completion/schedule-csv-logical-key-snapshot.repository.ts`（**2026-05-09**: 消滅主経路では非参照・互換保持）
- `apps/api/src/services/production-schedule/external-completion/production-schedule-canonical-current-keys.service.ts`（**2026-05-16**: 消滅差分の **現 winner（正本C）** を **本体CSV dedupe winner** だけから構築）
- `apps/api/src/services/production-schedule/external-completion/production-schedule-nonc-window-winner-key.query.ts`（**非C×`occurredAt` 窓**の母集団キー）
- `apps/api/src/services/production-schedule/policies/schedule-csv-disappearance-occurred-at-window.policy.ts`（**UTC ±3 カ月**）
- `apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts`（`buildFkojunstScheduleCsvDisappearanceEligibleScalarSql`・**`statusCode <> 'C'`**）
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`（DEDUP + 生産日程時の post-ingest 外部完了同期）
- `apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts`
- `apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts`

## Verification（ローカル）

- Vitest: `src/services/production-schedule/external-completion/__tests__/`、`src/services/csv-dashboard/__tests__/`

## Production（2026-05-08 · **FKOJUNST_Status を一覧・メール由来外部完了の唯一正本に統一**） {#production-2026-05-08-fkojunst-sole-source}

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4／Pi3 **no hosts matched**）。
- **ブランチ**: **`feat/fkojunst-status-cx-completion`**（代表 **`d12b40de`**）。
- **標準手順**: [deployment.md §FKOJUNST 唯一正本（2026-05-08）](../guides/deployment.md#fkojunst-status-sole-source-2026-05-08)。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-192843-15997`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**
  - **新規マイグレーション**: **なし**（`prisma migrate deploy` / `status` は playbook 内 **成功**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 188s**）。
- **仕様差分（メール由来）**: **完了は `C`/`X` のみ**（`externallyCompletedFromFkojunstMailStatus`）。**`externallyCompletedFromFkojunstDisappeared`** は再計算で **常に false**（キー消失完了は廃止）。
- **歴史的メモ（本番当時の CSV 消滅）**: 当時は **生産日程CSV消滅**を **`fkmail` が `S`/`R` の winner** に限定する記述で運用。**2026-05-09** に **非C×±3ヶ月窓**へ改訂（下記 [#production-2026-05-09-schedule-csv-disappearance-nonc-window](#production-2026-05-09-schedule-csv-disappearance-nonc-window)）。
- **トラブルシュート（追補）**: 下記 **「実効完了が付かない／期待とずれる」** の **メール status** は **`C`/`X` のみ**と読み替える（歴史的に **`P`/`O` 完了**と書かれた箇所は **2026-05-08 以前の経緯**）。

## Production（2026-05-09 · **生産日程CSV消滅・非C × `occurredAt` ±3ヶ月母集団**） {#production-2026-05-09-schedule-csv-disappearance-nonc-window}

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4 キオスク／Pi3 **no hosts matched**・**Pi3 専用手順不要**）。
- **ブランチ**: **`feature/external-completion-schedule-disappearance-non-c`**（代表 **`89086089`**。**`main` マージ後は先端を正**）。
- **標準手順**: [deployment.md §schedule-csv-disappearance-nonc-window-2026-05-09](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260509-170432-1808`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**・ローカル **`--follow` 約 705s**・**`Git: changed`**・**Docker 再起動あり**
  - **新規マイグレーション**: **なし**（`prisma migrate deploy` / `status` は playbook 内 **成功**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 190s**・Tailscale）。
- **知見（運用）**: 生産日程 CSV は **日付窓で切られる**ため、**旧スナップショット差分**だけでは **窓外落下を「消滅」**と誤判定し得る。**`FKOJUNST_Status` はより広い窓**で届く。**`C` はキー不整合の調査結果**（KB-373）により **消滅母集団から明示除外**し、完了は **`C`/`X` メール由来**に寄せる。
- **ローカル検証（開発時）**: 一時 Postgres で **非C・窓内・winner が日程 CSV から消えたケース**で `externallyCompletedFromScheduleCsvDisappeared` が立ち、**`C` は対象外**・**行が再出現すると消滅由来が解除**されることを確認済み（Vitest＋Docker 一時DB・検証後コンテナ削除）。

## Production（2026-05-16 · **正本C current keys・消滅入力の整理**） {#production-2026-05-16-schedule-csv-disappearance-canonical-current-keys}

- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**。Pi4 キオスク／Pi3 **no hosts matched**・Pi3 は **標準 playbook 未適用／専用手順も本変更では不要**）。
- **ブランチ**: **`feat/canonical-schedule-disappearance-current-keys`**（本体 **`09f06ebf`** **`fix(kiosk): canonicalize schedule disappearance current keys`**·Trivy 抑止 **`0e327378`** **`chore(ci): suppress current caddy trivy findings`**）。
- **標準手順**: [deployment.md §2026-05-16 正本C・消滅 current keys](../guides/deployment.md#schedule-csv-disappearance-canonical-current-keys-2026-05-16)。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260516-181817-25397`**
  - **`PLAY RECAP`**: `ok=131` `changed=3` `failed=0` `unreachable=0`・リモート **`exit 0`**・ローカル **`--follow` 約 286s**・**`Git: changed`**
  - **Docker compose 再起動タスク**: **`skipping`**（当該 run 記録）。**コンテナ稼働確認**と **`prisma migrate deploy` / `status`**: **`ok`**（新規マイグレ **なし**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 140s**・Tailscale）。
- **CI**: **`25956906908`** **success**。直前 **`25956583435`** は **`security-docker`**（web イメージ **`usr/bin/caddy`** の Go stdlib **HIGH**：**CVE-2026-33811**/**33814**/**39820**/**39836**/**42499**）で **failure**→ **`.trivyignore`** 追記で緑化（**恒久はイメージ更新を追跡**・[ci-troubleshooting §Trivy Caddy](../guides/ci-troubleshooting.md#trivy-が-web-イメージの-caddy-バイナリで-cve-を検出してジョブが失敗する)）。
- **知見（設計）**:
  - **母集団**は **2026-05-09** の **非C×±3ヶ月窓 winner** が正本のまま。**差分の片側**であった **「今回CSVに残っている winner」** を **メール JOIN の有無で間接絞り**すると **FK 未同期の本体行**まで **欠落キー扱い**になり、**CSV 消滅完了の早期成立**につながり得た。
  - **`ProductionScheduleCsvIngestLogicalKeySnapshot`** は **変わらず主経路非使用**（互換のみ）。
  - **`currentWinnerKeys` 引数名**は **deprecated エイリアス**。**観測・ログ**は **`canonicalScheduleDisappearanceCurrentKeys`** を正と読む。
- **トラブルシュート**:
  - **消滅だけ妙に付く／付かない** → **まず ±3ヶ月×非C の母集団**が **2026-05-09 項**どおりか。次に **Pi5 が `09f06ebf` 以降**か（**正本C current keys** 未反映なら **旧入力**のまま）。
  - **デプロイ前に script が止まる** → **未コミット・未追跡**（stash / commit）。
  - **Trivy 再発** → **`.trivyignore`** の運用方針（上記 CI 項）へ。

## Follow-up（2026-05-17 · **未解決残留ケースの会話整理**）

- **症状（継続）**: 生産システム上では完了済みのアイテムが、**順位ボードに残り続ける**。対象は **手動完了**ではなく、**生産日程CSV 消滅由来の外部完了**。
- **この時点で確定していること**:
  - **2026-05-16 の修正は「current keys の入力整理」**であり、**「2つのCSVを先に照合した結果を作ってから Pi5 DB と差分を取る」実装そのものではない**。
  - **2026-05-16 の意図**は、**`FKOJUNST_Status` 側に FK が無いだけで本体CSV winner を current から落とさない**ことにあり、**メール JOIN 欠落起因の早すぎる消滅完了**を防ぐ側の修正だった。
  - したがって、**2026-05-16 を入れても「完了済みなのに残る」側の症状が残る**場合、**「本体CSVだけを current keys の正本にしていること」では不足**している可能性がある。
- **会話時点の整理（2026-05-17）**:
  - ユーザーが言う **「2つのCSV同士の参照で前処理してから、Pi5との差分消失を実行する」** とは、**生産日程本体CSV** と **`FKOJUNST_Status` CSV** を先に照合し、**その照合結果を「現時点で存在している集合」として扱う**ことを指す。
  - **現状の実装理解**では、消滅差分の **current keys** は **本体CSV dedupe winner だけ**から組み立てており、**2 CSV 照合結果そのものを current keys の正本にはしていない**。
  - このため、**ユーザーが想定している「2 CSV の照合結果ベースの差分消失」**と、**現行コードの「本体CSVベースの差分消失」**の間に、まだ仕様差が残っている可能性がある。
- **この時点での未確定事項**:
  - 実データ上の残留ケースが、**(a) 母集団から漏れている**, **(b) current keys に残っている**, **(c) ±3ヶ月窓の外に落ちている** のどれで起きているかは、**まだ実データで最終確定していない**。
  - よって、**2026-05-17 時点ではコード未着手**。まず **会話で得た仕様整理を文書へ固定**し、その後に **実データ確認 -> 実装修正**の順で進める。
- **次の実装候補（会話時点の第一候補）**:
  - **「2つのCSVを先に照合した結果を作り、その結果を使って Pi5 DB との差分消失を判定する」** 方向を優先して再設計する。
  - 言い換えると、**Pi5 DB と直接引く前の current keys を、本体CSV単独ではなく 2 CSV の照合結果で組み立てる**候補を最優先で検討する。
  - ただし、**母集団 SQL（`queryNonCScheduleDisappearanceCandidateKeys`）の blind spot** でも同じ症状は起こり得るため、**本番データで残留ケースの所属先を確定してから実装に入る**のが安全。

## Production（2026-05-06）

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4／Pi3 の個別デプロイは不要）。
- **ブランチ**: `feat/completion-triple-source-unification`（代表コミット **`2b8c8427`**）。
- **標準手順**: [deployment.md](../guides/deployment.md) の **2026-05-06 · 実効完了3系統OR** 項。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-152049-17895`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**
  - **`Run prisma migrate deploy`**: **成功**（**`20260506150000_triple_source_external_completion`** 適用）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 138s**・Tailscale）。

### 追補（2026-05-06 · **空 winner ガード本番反映**·**axios**）

- **ブランチ**: **`fix/schedule-csv-empty-guard`**（API [`0fd0f248`](https://github.com/denkoushi/RaspberryPiSystem_002/commit/0fd0f248)·Web lock [`a372ecce`](https://github.com/denkoushi/RaspberryPiSystem_002/commit/a372ecce)）。
- **対象**: **`raspberrypi5` のみ**。[deployment.md](../guides/deployment.md) の **空 winner ガード** 項を正とする。
- **Detach Run ID**: **`20260506-171017-29269`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit 0`**）。
- **Phase12**: **PASS 43 / WARN 0 / FAIL 0**（**約 146s**）。

## Troubleshooting

- **本番 Postgres で「JST の当日」の CSV 点数・完了件数が 0 に見える／前日まで混じる**
  - **暦日ウィンドウの SQL** が **`TimeZone` セッション依存の誤パターン**（例: `(date)::timestamp AT TIME ZONE 'Asia/Tokyo'` だけに頼る）になっていないか確認する。**正しい midnight 拘束 + `AT TIME ZONE 'Asia/Tokyo'` の例**: [KB-377 Appendix `#kb-377-appendix-counting`](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md#kb-377-appendix-counting)。あわせて **`FKOJUNST_Status` メール用 `csvDashboardId` と本体 `PRODUCTION_SCHEDULE_DASHBOARD_ID` を取り違えていないか** を確認する（同 Appendix）。
- **順位ボードで資源コード（例: `021`）のチップだけグレーアウトしない**
  - まず **`row.isCompleted`（実効完了）が false の理由**へ分解する（メール **`C`/`X`**・手動 **`/completion`**・**CSV消失**）。**`S`/`R` は可視未完**。**winner が現集合に残っていれば差分消失は立たない**典型がある。**詳細ナレッジ**: [KB-377](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md)。
- **`[CsvDashboardIngestor]` warn と `empty_schedule_csv`**
  - **0 件 winner** 時の **想定どおりのスキップ**。上流の生産日程CSV・取込ダッシュボード・DEDUP 設定を確認（本当に行が 0 であるべきか）。
- **実効完了が付かない／期待とずれる**
  - **工順ST**: **2026-05-08 以降**は **メール status（`C`/`X`）**と **生産日程CSV消滅**が主因。**2026-05-09 以降**の消滅は **`fkmail.statusCode <> 'C'` かつ `occurredAt` が ±3ヶ月窓内**の母集団と **現 winner（2026-05-16 以降は正本C・本体CSV dedupe winner 由来）**の差分（[deployment.md 消滅窓項](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)·[§2026-05-16 正本C current keys](../guides/deployment.md#schedule-csv-disappearance-canonical-current-keys-2026-05-16)）。旧 **dedupe キー消失**完了は **廃止**（[KB-297 §外部完了](./KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)）。
  - **メール status**: **`C`/`X` のみ**メール由来完了（`?` / 空 / **`O`/`P`** は **未完了**。**`O`/`P`** は一覧にも出ない）。
  - **生産日程CSV（消滅）**: **DEDUP** 取込後に **非C×±3ヶ月母集団** と **現 winner キー**を突合（**2026-05-16 以降、現 winner の正本は本体 CSV の dedupe winner のみ**。**メールに FK が無いだけ**では **現側から除外されない**。詳細は [deployment §2026-05-16](../guides/deployment.md#schedule-csv-disappearance-canonical-current-keys-2026-05-16)）。**`C`** は **消滅母集団に入らない**（完了状態は **`C`/`X` メール由来**で見る）。**窓外**に落ちた行だけが CSV から消えても **消滅完了にならない**のが期待どおり。取込が **`empty_schedule_csv`** で skip されていないか ingestor **warn** を確認。歴史的に **`ProductionScheduleCsvIngestLogicalKeySnapshot`** を参照していた場合は **2026-05-09 以降は主経路未使用**（テーブルは残存し得る）。
  - **2026-05-17 時点の会話上の未解決論点**: **「2 CSV を先に照合した結果で current keys を作るべきか」** と **「母集団 SQL に blind spot が残っているか」** の切り分けがまだ終わっていない。**2026-05-16 は current keys を本体CSV dedupe winner に固定した修正**であり、**2 CSV 照合結果ベースの current keys** は **未実装**。
- **マイグレ未適用**
  - Pi5 で **`prisma migrate status`** が **`20260506150000`** を **Applied** と報告するか（デプロイ playbook の migrate ログが正本）。

## References

- ブランチ: `feat/completion-triple-source-unification`（**`main`**: [PR #263](https://github.com/denkoushi/RaspberryPiSystem_002/pull/263) **squash**・先端 **`4af94e05`** を正とする）
- **空 winner ガード + axios**: **`fix/schedule-csv-empty-guard`**（**`main`**: [PR #264](https://github.com/denkoushi/RaspberryPiSystem_002/pull/264) **squash**・**`f9b1683e`** を正とする）·デプロイ記録は [deployment.md](../guides/deployment.md)（2026-05-06 · 空 winner ガード 項）
- デプロイ記録: [deployment.md](../guides/deployment.md)（2026-05-06 · 実効完了3系統OR・**2026-05-09 · 消滅窓** [#schedule-csv-disappearance-nonc-window-2026-05-09](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)·**2026-05-16 · 正本C current keys** [#schedule-csv-disappearance-canonical-current-keys-2026-05-16](../guides/deployment.md#schedule-csv-disappearance-canonical-current-keys-2026-05-16)）
- **会話整理（2026-05-17）**: 本節 **Follow-up（2026-05-17）**
