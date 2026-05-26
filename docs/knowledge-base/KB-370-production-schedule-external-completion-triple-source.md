---
title: KB-370 生産スケジュール「実効完了」の外部要因（手動・FKOJUNST_Status）
tags: [生産スケジュール, CSV, FKOJUNST, 外部完了, 順位ボード]
audience: [開発者, 運用者]
last-verified: 2026-05-26
category: knowledge-base
---

# KB-370: 生産スケジュール「実効完了」の外部要因

## Context

順位ボード等で参照する **実効完了** を、手動完了と FKOJUNST_Status 由来の完了で一貫させる必要がある。

## 2026-05-26 現行正本

実効完了は次の **論理 OR**（いずれかが真なら完了扱い）:

1. **手動**: `ProductionScheduleProgress.isCompleted`
2. **工順ST（FKOJUNST_Status メール同期 → `ProductionScheduleFkojunstMailStatus`）**
   - **`statusCode` が `C` または `X`** のとき外部完了
   - **`S` / `R`**: 一覧表示・未完了
   - **`O` / `P`**: 一覧非表示・未完了（製番進捗 total には残る）

**生産日程CSV消滅完了は 2026-05-26 に廃止**。`externallyCompletedFromScheduleCsvDisappeared` は後方互換列として残すが、新規同期では true にせず、実効完了へ寄与させない（[ADR-20260526](../decisions/ADR-20260526-production-schedule-completion-status-only.md)）。

## Historical: 2026-05-25 以前の3系統OR

2026-05-25 以前は、実効完了を次の **論理 OR** で扱っていた:

1. **手動**: 既存 `ProductionScheduleProgress.isCompleted`
2. **工順ST（FKOJUNST_Status メール同期 → `ProductionScheduleFkojunstMailStatus`）**
   - **`statusCode` が `C` または `X`** のとき外部完了（**2026-05-08 改訂**: 旧 **dedupe キー消失**・**`O`/`P` による完了**は廃止。`externallyCompletedFromFkojunstDisappeared` は再計算で **常に false**）
   - **`O` / `P`**: 一覧非表示だが **未完了**（製番進捗 total に残る）
3. **生産日程CSV取込（消滅完了、2026-05-26 廃止）**
   - **2026-05-09 改訂**: **「`FKOJUNST` メール同期済み winner のうち **メール由来完了（`C` / `X`）以外**」**（SQL 上は `UPPER(BTRIM("fkmail"."statusCode")) NOT IN ('C','X')` 相当）かつ「`occurredAt` が基準日時の UTC **±3 カ月**」**に入る論理キー**を母集団とし、**母集団 − 現 winner（2026-05-16 以降の正本は下項）の論理キー** を **消滅**とみなして `externallyCompletedFromScheduleCsvDisappeared` を更新する（**`C`/`X` は母集団から除外**・`C` 除外の主因は [KB-373](./KB-373-fkojunst-status-c-key-domain-mismatch.md) の **キー空間不一致**。`X` は **2026-05-18** に **同一カテゴリへ揃え**、CSV 取込漏れ是正後の運用と整合）。**旧仕様（〜2026-05-08 以前）**: 取込直前スナップショットと取込後キーの差分・**`S`/`R` winner に限定**する記述は **本項で置換**（正本は [deployment.md §2026-05-09 消滅窓](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)）。
   - **2026-05-16 改訂（正本Cの current keys・第一段）**: **`ProductionScheduleCanonicalCurrentKeysService`** により **今回バッチで確定した生産日程本体 CSV の dedupe winner** から論理キーを構築し、[`applyPostIngestFromSnapshot`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-csv-ingest-external-completion-sync.service.ts) に渡す。**`FKOJUNST_Status` メールに行が載っていない（FK が無い）ことだけでは**本体 winner を **現集合から落とさない**（過剰な消滅完了を防ぐ）——**2026-05-17 改訂（下項）で「2CSV照合交差」へ拡張**。
   - **2026-05-17 改訂（2CSV 照合・正本C current keys）**: 消滅差分の **現キー集合**は、上記 dedupe winner の **論理キーのうち**、**生産日程CSV取込完了時刻 `tA` 以下で最新完了の `FKOJUNST_Status` ingest run** を **`tB`** として選び、その **原本CSV 1件**（`CsvDashboardIngestRun.csvFilePath`）から復元した Status スナップショット（`FUPDTEDT` 最新で dedupe 済み）と **ADR-20260509** の **3キー（FKOJUN + `FKOTEICD`/`FSIGENCD` + `FSEZONO`/`ProductNo`）** が一致するものに限定する（[`schedule-csv-disappearance-canonical-keys.builder.ts`](../../apps/api/src/services/production-schedule/external-completion/schedule-csv-disappearance-canonical-keys.builder.ts)・[`production-schedule-canonical-current-keys.service.ts`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-canonical-current-keys.service.ts)）。**Status 幕は `dateColumnName` が無く `occurredAt`≈取込時刻**のため、**`tA` は本体CSVの日付列ではなく取込完了時刻**とする。**`tA` 以前に完了 ingest run が無い**、または **原本CSVを正規化しても Status 行が 0 件**のときは **差分消失同期のみスキップ**（手動・メール完了は維持）。**±3ヶ月×（メール完了 `C`/`X` 以外）の母集団**・**空 winner ガード**は変更なし。
   - **空 winner ガード**（`empty_schedule_csv`）は変更なしだった。

論理キーは運用どおり **`FKOJUN` + TAB + 正規化資源CD + TAB + 製造order（ProductNo）**（`FSIGENCD` は trim・大文字化して共通関数で生成）。

## Data model

- `ProductionScheduleExternalCompletion` に由来別フラグを保持する。2026-05-26 以降、同期時の **`isExternallyCompleted` は `externallyCompletedFromFkojunstMailStatus` と同じ意味**:
  - `externallyCompletedFromFkojunstDisappeared`（**2026-05-08**: メール再計算で **常に false**。列は後方互換のため保持）
  - `externallyCompletedFromFkojunstMailStatus`（**`fkmail` の `C`/`X`**）
  - `externallyCompletedFromScheduleCsvDisappeared`（**2026-05-26**: 完了判定から廃止。列は後方互換のため保持し、false へ収束）
- 生産日程CSV用スナップショット: `ProductionScheduleCsvIngestLogicalKeySnapshot`（**2026-05-09**: 消滅差分の主計算からは外し、**DB／repository は互換で存続**）

## Migration

- `apps/api/prisma/migrations/20260506150000_triple_source_external_completion/migration.sql`
- 既存 `isExternallyCompleted = true` は **消滅由来列**へバックフィル（移行方針はマイグレーションコメント参照）
- `apps/api/prisma/migrations/20260526030000_disable_schedule_csv_disappearance_completion/migration.sql`
- 既存 `externallyCompletedFromScheduleCsvDisappeared = true` は false へ収束し、`isExternallyCompleted` は `externallyCompletedFromFkojunstMailStatus` のみに再計算する。

## 主な実装参照

- `apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.repository.ts`
- `apps/api/src/services/production-schedule/external-completion/production-schedule-csv-ingest-external-completion-sync.service.ts`
- `apps/api/src/services/production-schedule/external-completion/schedule-csv-logical-key-snapshot.repository.ts`（**2026-05-09**: 消滅主経路では非参照・互換保持）
- `apps/api/src/services/production-schedule/external-completion/production-schedule-canonical-current-keys.service.ts`（**2026-05-16–17**: 消滅差分の **正本C**。**17 以降は 2CSV 3キー交差 + `tA` ペアリング**）
- `apps/api/src/services/production-schedule/external-completion/schedule-csv-disappearance-canonical-keys.builder.ts`（**2026-05-17**: 本体×Status の交差キー生成・純関数）
- `apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts`（**`loadFkojunstMailNormalizedRowsFromCsvFile`**・原本CSV 1件の正規化再利用）
- `apps/api/src/services/production-schedule/external-completion/production-schedule-nonc-window-winner-key.query.ts`（**メール完了 `C`/`X` 以外 × `occurredAt` 窓**の母集団キー）
- `apps/api/src/services/production-schedule/policies/schedule-csv-disappearance-occurred-at-window.policy.ts`（**UTC ±3 カ月**）
- `apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts`（`buildFkojunstScheduleCsvDisappearanceEligibleScalarSql`・**メール完了 `C`/`X` 以外**・正本は [`fkojunst-mail-status-completion.policy.ts`](../../apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts) の `buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql`）
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`（DEDUP + 生産日程時の post-ingest 外部完了同期）
- `apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts`
- `apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts`

## Verification（ローカル）

- Vitest: `src/services/production-schedule/external-completion/__tests__/`、`src/services/csv-dashboard/__tests__/`、`src/services/production-schedule/completion/__tests__/fkojunst-mail-status-completion.policy.test.ts`、`src/services/production-schedule/policies/__tests__/fkojunst-production-schedule-list-visibility.policy.test.ts`

## Production（2026-05-08 · **FKOJUNST_Status を一覧・メール由来外部完了の唯一正本に統一**） {#production-2026-05-08-fkojunst-sole-source}

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4／Pi3 **no hosts matched**）。
- **ブランチ**: **`feat/fkojunst-status-cx-completion`**（代表 **`d12b40de`**）。
- **標準手順**: [deployment.md §FKOJUNST 唯一正本（2026-05-08）](../guides/deployment.md#fkojunst-status-sole-source-2026-05-08)。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-192843-15997`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**
  - **新規マイグレーション**: **なし**（`prisma migrate deploy` / `status` は playbook 内 **成功**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 188s**）。
- **仕様差分（メール由来）**: **完了は `C`/`X` のみ**（`externallyCompletedFromFkojunstMailStatus`）。**`externallyCompletedFromFkojunstDisappeared`** は再計算で **常に false**（キー消失完了は廃止）。
- **歴史的メモ（本番当時の CSV 消滅）**: 当時は **生産日程CSV消滅**を **`fkmail` が `S`/`R` の winner** に限定する記述で運用。**2026-05-09** に **メール完了以外×±3ヶ月窓**へ改訂（下記 [#production-2026-05-09-schedule-csv-disappearance-nonc-window](#production-2026-05-09-schedule-csv-disappearance-nonc-window)）。
- **トラブルシュート（追補）**: 下記 **「実効完了が付かない／期待とずれる」** の **メール status** は **`C`/`X` のみ**と読み替える（歴史的に **`P`/`O` 完了**と書かれた箇所は **2026-05-08 以前の経緯**）。

## Production（2026-05-09 · **生産日程CSV消滅・非C × `occurredAt` ±3ヶ月母集団**） {#production-2026-05-09-schedule-csv-disappearance-nonc-window}

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4 キオスク／Pi3 **no hosts matched**・**Pi3 専用手順不要**）。
- **ブランチ**: **`feature/external-completion-schedule-disappearance-non-c`**（代表 **`89086089`**。**`main` マージ後は先端を正**）。
- **標準手順**: [deployment.md §schedule-csv-disappearance-nonc-window-2026-05-09](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260509-170432-1808`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**・ローカル **`--follow` 約 705s**・**`Git: changed`**・**Docker 再起動あり**
  - **新規マイグレーション**: **なし**（`prisma migrate deploy` / `status` は playbook 内 **成功**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 190s**・Tailscale）。
- **知見（運用）**: 生産日程 CSV は **日付窓で切られる**ため、**旧スナップショット差分**だけでは **窓外落下を「消滅」**と誤判定し得る。**`FKOJUNST_Status` はより広い窓**で届く。**メール由来完了（`C`/`X`）** は **消滅母集団から除外**（`C` 除外の主因は [KB-373](./KB-373-fkojunst-status-c-key-domain-mismatch.md) の **キー不整合**。`X` は **2026-05-18** に **同一扱いへ揃え**、実効完了は **`C`/`X` メール由来**に寄せる）。
- **ローカル検証（開発時）**: 一時 Postgres で **メール完了以外・窓内・winner が日程 CSV から消えたケース**で `externallyCompletedFromScheduleCsvDisappeared` が立ち、**`C`/`X` は対象外**・**行が再出現すると消滅由来が解除**されることを確認済み（Vitest＋Docker 一時DB・検証後コンテナ削除）。

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
  - **母集団**は **2026-05-09** の **（メール完了 `C`/`X` 以外）×±3ヶ月窓 winner** が正本のまま（**2026-05-18**: `X` も **母集団外**と明示）。**差分の片側**であった **「今回CSVに残っている winner」** を **メール JOIN の有無で間接絞り**すると **FK 未同期の本体行**まで **欠落キー扱い**になり、**CSV 消滅完了の早期成立**につながり得た。
  - **`ProductionScheduleCsvIngestLogicalKeySnapshot`** は **変わらず主経路非使用**（互換のみ）。
  - **`currentWinnerKeys` 引数名**は **deprecated エイリアス**。**観測・ログ**は **`canonicalScheduleDisappearanceCurrentKeys`** を正と読む。
- **トラブルシュート**:
  - **消滅だけ妙に付く／付かない** → **まず ±3ヶ月×（メール完了 `C`/`X` 以外）の母集団**が **2026-05-09 項**どおりか。次に **Pi5 が `09f06ebf` 以降**か（**正本C current keys** 未反映なら **旧入力**のまま）。
  - **デプロイ前に script が止まる** → **未コミット・未追跡**（stash / commit）。
  - **Trivy 再発** → **`.trivyignore`** の運用方針（上記 CI 項）へ。

## Production（2026-05-17 · **2CSV 交差・正本C current keys（本体 × Status 原本CSV）**） {#production-2026-05-17-schedule-csv-disappearance-2csv-current-keys}

- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**。Pi4 キオスク／Pi3 **no hosts matched**・**Pi3 専用手順は本変更では不要／未実施で正**）。
- **ブランチ**: **`fix/kiosk-completion-csv-pairing`**（実装 tip **`ed733bfe`**）。**`main`**: [PR #290](https://github.com/denkoushi/RaspberryPiSystem_002/pull/290) **squash** **`f252793d`**。
- **標準手順**: [deployment.md §2026-05-17](../guides/deployment.md#schedule-csv-disappearance-2csv-intersection-2026-05-17)。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260517-151209-29249`**
  - **`PLAY RECAP`**: `ok=131` `changed=3` `failed=0` `unreachable=0`・リモート **`exit 0`**・ローカル **`--follow` 約 302s**・**`Git: changed`**
  - **Docker compose 再ビルド／再起動**: **`skipping`**（当該 run 記録）。**`prisma migrate deploy` / `status`**: **`ok`**（**新規マイグレなし**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **最終 PASS 43 / WARN 0 / FAIL 0**（本記録 **約 140s**・Tailscale）。
  - **1 回目**: Pi5 へ SSH 中に **`Connection closed by … port 22`** が出て **`backup.json` 存在確認** のみ **FAIL**（**42/0/1**）。**2 回目（直後再実行）**: **43/0/0**。
- **運用観測（ログ）**: 取込時 **`[CsvDashboardIngestor] Schedule CSV disappearance sync skipped (2CSV pairing / status snapshot)`** の **`reason` / `diagnostics`**（**`no_status_ingest_run_at_or_before_reference_at`** 等）で **差分消失スキップ**頻度を追う。**残留が続く**場合は **交差後 current keys 件数**と **母集団（メール完了以外×±3ヶ月）** を分離して切り分ける（下記 **Troubleshooting**・旧 **Follow-up 会話整理**）。
- **デプロイ前 TS（補足）**: **`update-all-clients.sh`** が **ローカルロック**（別プロセスが同一スクリプト実行中）で失敗した場合は **完了待ち**または **該当 pid 終了**後に再実行。

## Production（2026-05-18 · **消滅母集団から `X` をコードで `C` と同列に除外**） {#production-2026-05-18-schedule-csv-disappearance-exclude-x-code-alignment}

- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**。Pi4 キオスク／Pi3 **no hosts matched**・**Pi3 専用手順は不要／未実施で正**）。
- **ブランチ**: **`fix/kiosk-completion-exclude-x-from-disappearance`**（機能 **`49d19dce`** **`fix: exclude FKOJUNST X from schedule disappearance candidates`**·CI **`2170bb18`** **`fix(ci): suppress current api image libcap2 trivy finding`**）。**`main`**: [PR #294](https://github.com/denkoushi/RaspberryPiSystem_002/pull/294) **squash** **`e2abadce`**。
- **標準手順**: [deployment.md §2026-05-18](../guides/deployment.md#schedule-csv-disappearance-exclude-x-code-alignment-2026-05-18)。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260518-175005-7497`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`·リモート **`exit 0`**·ローカル **`--follow` 約 987s**·**Summary success: true**·**`Git: changed`**·**Docker restart** **`ok`**·**`prisma migrate deploy` / `status`**: **`ok`**（**新規マイグレなし**）
  - **補助ファイル**: **`alerts/alert-20260518-175009.json`**・**`alerts/alert-20260518-180620.json`**（**正常完了でも生成され得る**。**正本は recap / summary**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**`real` 約 81s**・Tailscale）。
- **仕様（要点）**: **`buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql`** を **一覧の消滅候補**と **母集団 winner キー抽出**の双方から再利用し、**`UPPER(BTRIM("fkmail"."statusCode")) NOT IN ('C','X')`** に統一（**`NULL`/空白はメール完了扱いにしない**）。
- **CI**: API イメージ **`libcap2`** **CVE-2026-4878** は **`.trivyignore`** + **workflow の API scan に `trivyignores`**（**`2170bb18`**）。
- **トラブルシュート**:
  - **`X` と完了の解釈がズレる** → **実装が本項の単一ビルダー経由か**・Pi5 ref が **`49d19dce` 以降（または `main` マージ後 HEAD）**か。
  - **デプロイが ~15–20min** → **compose 再作成付近から完了待ち**。**`--follow` を切らない**。

## 運用: Gmail 取込スケジュールと 2CSV 照合の成立条件（2026-05-17 追補） {#kb-370-2csv-schedule-operational-pairing}

2CSV 交差は **実装（PR #290 / `f252793d`）** と別に、**本番の Gmail 取込スケジュールと ingest 履歴**が条件を満たさなければ **`no_status_ingest_run_at_or_before_reference_at` 等で差分消失のみスキップ**しうる。**切り分けの正本**をここに固定する。

### 設定の正本（コード定数ではない）

- **管理コンソール**: CSV インポートスケジュール（例: `/admin/csv-import-schedule`。ラベルは UI 版に従う）。
- **Pi5 永続化**: **`config/backup.json` の `csvImports`**。更新は **`ImportScheduleAdminService`** 経由で **`backup.json` 保存 → `scheduler.reload()`**（[`import-schedule-admin.service.ts`](../../apps/api/src/services/imports/import-schedule-admin.service.ts)）。
- **リポジトリのビルトイン（[`system-csv-import-schedule-builtin-rows.ts`](../../apps/api/src/services/imports/system-csv-import-schedule-builtin-rows.ts)）**: **システム予約 ID** の **ensure / 初期マージ**に使われるが、**`enabled` や cron の実効値は `backup.json` 側が優先**されうる。**`FKOJUNST_Status` メール取込はビルトイン上 `enabled: false` になり得る**一方、**本番では管理画面から有効化されている**のが普通にあり得る。**ソースの定数だけから「本番で無効」とは言えない**。

### `tA` / `tB` と「タイミングが妥当か」

- **`tA`**: 当該バッチの **生産日程本体 CSV の DEDUP 取込完了時刻**（ingestor が `scheduleIngestCompletedAt` として渡す）。
- **`tB`**: **`tB <= tA` を満たす**範囲で **最新の完了 `FKOJUNST_Status` ingest run**（`CsvDashboardIngestRun.completedAt`）。その run の **原本 CSV 1件**だけを Status スナップショットの入力に使う。
- **実務上の含意**: **同一暦日（または同一取込サイクル）で、少なくとも1件の完了済み Status ingest が `tA` より前に存在する**状態が取りやすい。**cron 上、Status が本体より先に回る**（例: 早朝に Status、その後に本体）構成であれば **`tB <= tA` は成立しやすい**。**具体の時刻・曜日は必ず `backup.json` / 管理画面を正**とする（ビルトインは参考）。

### 管理コンソールのスケジュールとの整合

- **単一の仕組み**: `CsvImportScheduler`（[`csv-import-scheduler.ts`](../../apps/api/src/services/imports/csv-import-scheduler.ts)）が **`backup.json` からロードした各行**を **`node-cron`（tz: `Asia/Tokyo`）** で実行する。管理画面で変えた cron / 有効フラグは **reload 後のアクティブスケジュール**に反映される。
- **観測例（2026-05-17・場内確認）**: **`ProductionSchedule_FKOJUNST`** と **`ProductionSchedule_FKOJUNST_Status`** が **どちらも「有効」**で、かつ **Status 側が本体より前の时刻帯**に走っている場合、**2CSV の前提（`tB` 選択可能）は満たしやすい**。環境ごとに数値は変わるため **スクショや固定時刻のハードコードは KB に書かず、総則と確認手順を正**とする。

### トラブルシュート／調査上の注意（再発防止）

- **`no_status_ingest_run_at_or_before_reference_at` が出る** → **`FKOJUNST_Status` 用スケジュールが無効**、**まだ一度も成功 ingest が無い**、**本体だけが先に走る日しか無い**、などを疑う。確認は **`csvImports`**・**`CsvDashboardIngestRun`**（対象 dashboardId）・ingestor の **`2CSV pairing / status snapshot`** warn。
- **誤調査の典型**: ビルトインの **`enabled: false`** だけを根拠に **本番で Status 取込が止まっていると決めつける**こと。**正しくは `backup.json` と管理画面**。
- **ユーザーが述べていない運用仮定を足さない**: 調査説明に **根拠のないシナリオ**（未取得の手動再取込タイミング等）を付け足すと、**現場の質問とズレた結論**になりうる。**ログ・DB・実際の schedule** に限定して述べる。

## Follow-up（2026-05-17 · **2CSV 照合 current keys の実装**）

- **実装ブランチ**: **`fix/kiosk-completion-csv-pairing`**（**`origin` へ push 済み**）。**`main` 取り込み**: [PR #290](https://github.com/denkoushi/RaspberryPiSystem_002/pull/290) **squash** **`f252793d`**。本番 Detach・Phase12 記録は上記 **[#production-2026-05-17-schedule-csv-disappearance-2csv-current-keys](#production-2026-05-17-schedule-csv-disappearance-2csv-current-keys)**。
- **要点**: 消滅の **current keys** を **本体 dedupe winner ∩（`tB <= tA` の最新完了 Status ingest run の原本CSVで復元したスナップショットと3キー一致）** に変更。**`tA`** = 生産日程 DEDUP 取込完了時刻（ingestor が **`scheduleIngestCompletedAt`** として渡す）。
- **残検証**: 本番データで **残留ケースが解消するか**・**Status 先行遅延**で skip が増えないかを **`[CsvDashboardIngestor] Schedule CSV disappearance sync skipped`** ログで継続監視。

## Follow-up（2026-05-17 · **未解決残留ケースの会話整理**・旧）

> **追補**: 本節は **2CSV 実装着手前**の会話整理の保存。**実装・Pi5 本番・Phase12**の正本は [§Production 2026-05-17](#production-2026-05-17-schedule-csv-disappearance-2csv-current-keys) および [Follow-up（2CSV 実装）](#follow-up2026-05-17--2csv-照合-current-keys-の実装)。

以下は **実装前**の会話メモ。**解決方針は上記「2CSV 照合」項に統合**。

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
  - よって、**当該会話時点ではコード未着手**。**追補**: **同日以降**に **PR #290**（**`main` squash `f252793d`**）で実装・本番反映まで完了した。当時は **会話で得た仕様整理を文書へ固定**してから **実データ確認 → 実装修正**に進む前提だった。
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

## Production（2026-05-26 · **生産日程CSV差分消失完了の廃止**） {#production-2026-05-26-schedule-csv-disappearance-disabled}

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4／Pi3 **no hosts matched**・**Pi3 専用手順不要**）
- **ブランチ**: **`fix/kiosk-completion-status-only`**（代表 **`a970e795`**）
- **標準手順**: [deployment.md §2026-05-26](../guides/deployment.md#kiosk-completion-status-only-2026-05-26)
- **Detach Run ID**: **`20260526-121604-8450`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**
  - **`Run prisma migrate deploy`**: **成功**（**`20260526030000_disable_schedule_csv_disappearance_completion`**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **30s**）
- **CI**: **`26429750347`** **success**
- **事後検証（Pi5 DB）**:
  - **`externallyCompletedFromScheduleCsvDisappeared = true`** → **0 件**
  - **`isExternallyCompleted`** は **`externallyCompletedFromFkojunstMailStatus` と一致**（`C`/`X` のみ外部完了）
- **調査事例（BA1S6202）**: 5/22 の誤グレーは **消失フラグ継続**が主因。**本番反映後**は **`csv_disappeared=f`**。当該資源 **`035`** は **`fk_status=C`** のため **メール正本どおり完了表示**（Status が **`R` のまま未完に見えたい**場合は上流 Status 是正または手動未完）
- **トラブルシュート**:
  - **`R`/`S` なのにグレー** → **Pi5 HEAD `a970e795` 以降**か・**`csv_disappeared` はもう完了根拠にならない**（手動完了・**`mail_cx`** を確認）
  - **消滅完了の件数を日次で見ていた** → **2026-05-26 以降は指標廃止**。代替は **メール `C`/`X` 件数**・**手動完了**・必要なら **監査用 SQL**（[KB-377 §運用近似（履歴）](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md#運用上の実務近似ユーザー合意)）

## Troubleshooting

- **本番 Postgres で「JST の当日」の CSV 点数・完了件数が 0 に見える／前日まで混じる**
  - **暦日ウィンドウの SQL** が **`TimeZone` セッション依存の誤パターン**（例: `(date)::timestamp AT TIME ZONE 'Asia/Tokyo'` だけに頼る）になっていないか確認する。**正しい midnight 拘束 + `AT TIME ZONE 'Asia/Tokyo'` の例**: [KB-377 Appendix `#kb-377-appendix-counting`](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md#kb-377-appendix-counting)。あわせて **`FKOJUNST_Status` メール用 `csvDashboardId` と本体 `PRODUCTION_SCHEDULE_DASHBOARD_ID` を取り違えていないか** を確認する（同 Appendix）。
- **順位ボードで資源コード（例: `021`）のチップだけグレーアウトしない**
  - まず **`row.isCompleted`（実効完了）が false の理由**へ分解する（メール **`C`/`X`**・手動 **`/completion`**）。**2026-05-26 以降、CSV 差分消失は完了根拠にならない**。**`S`/`R` は可視未完**。**詳細ナレッジ**: [KB-377](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md)。
- **`[CsvDashboardIngestor]` warn と `empty_schedule_csv`**
  - **0 件 winner** 時の **想定どおりのスキップ**。上流の生産日程CSV・取込ダッシュボード・DEDUP 設定を確認（本当に行が 0 であるべきか）。
- **実効完了が付かない／期待とずれる**
  - **現行（2026-05-26 以降）**: 実効完了は **手動完了** OR **メール status `C`/`X` のみ**（[ADR-20260526](../decisions/ADR-20260526-production-schedule-completion-status-only.md)・[#production-2026-05-26-schedule-csv-disappearance-disabled](#production-2026-05-26-schedule-csv-disappearance-disabled)）。
  - **メール status**: **`C`/`X` のみ**メール由来完了（`?` / 空 / **`O`/`P`** は **未完了**。**`O`/`P`** は一覧にも出ない）。
  - **生産日程CSV（消滅・履歴）**: **2026-05-26 に完了判定から廃止**。旧ロジックの調査は [deployment.md 消滅窓項](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09) 等を参照。**本番で `csv_disappeared` が true の行が残る**場合は **マイグレ未適用**または **Pi5 が `a970e795` より前**を疑う。
- **マイグレ未適用**
  - Pi5 で **`prisma migrate status`** が **`20260506150000`** を **Applied** と報告するか（デプロイ playbook の migrate ログが正本）。

## References

- ブランチ: `feat/completion-triple-source-unification`（**`main`**: [PR #263](https://github.com/denkoushi/RaspberryPiSystem_002/pull/263) **squash**・先端 **`4af94e05`** を正とする）
- **空 winner ガード + axios**: **`fix/schedule-csv-empty-guard`**（**`main`**: [PR #264](https://github.com/denkoushi/RaspberryPiSystem_002/pull/264) **squash**・**`f9b1683e`** を正とする）·デプロイ記録は [deployment.md](../guides/deployment.md)（2026-05-06 · 空 winner ガード 項）
- デプロイ記録: [deployment.md](../guides/deployment.md)（2026-05-06 · 実効完了3系統OR·**2026-05-09 · 消滅窓** [#schedule-csv-disappearance-nonc-window-2026-05-09](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)·**2026-05-18 · `X` 除外コード整合** [#schedule-csv-disappearance-exclude-x-code-alignment-2026-05-18](../guides/deployment.md#schedule-csv-disappearance-exclude-x-code-alignment-2026-05-18)·**2026-05-16 · 正本C current keys** [#schedule-csv-disappearance-canonical-current-keys-2026-05-16](../guides/deployment.md#schedule-csv-disappearance-canonical-current-keys-2026-05-16)）
- **会話整理（2026-05-17・実装前）**: 本ファイル **Follow-up（2026-05-17 · 未解決残留ケースの会話整理・旧）** 節
