# D社日程会議議事録エクセルから製番ボード・順位ボードの最新納期を取り込む

この ExecPlan は生きた文書であり、`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を作業の進行に合わせて更新する。書式と運用はリポジトリ直下の `.agent/PLANS.md` に従う。

## Purpose / Big Picture

生産日程 CSV（Gmail で毎日届く「生産日程」）の納期は初期日程にすぎない。実際の納期は日々変わり、担当部署が週に 1 回、件名に「D社日程会議議事録」を含むメールで「YYYYMMDD D社日程会議議事録.xlsx」を送ってくる。現在はこの最新納期をボードへ手で入れるしかなく、ほとんど反映されていない（本番の手入力の製番納期は 87 件で、最終更新は 2026-07-28）。

この変更の後は、メールが届くと自動でエクセルを読み取り、製番ごとの最新の「部品完成」日を保存する。製番ボードと順位ボードは、既定ではこのエクセルの日程を納期として表示する。いまの日程は生産管理システム SCAW から来ており、これも残す。メニューに「SCAW」ボタンを置き、オンにすると今までどおり SCAW の日程で表示する（既定はオフ）。エクセルに載った製番は、両ボードの左側の登録製番に自動で登録する。あわせて、協力会社へ出す軸の目印（(X)、(YZ) など）、時間のかかる表面処理部品の処理出し日（カレンダー欄の ★）、メモを製番に付けて表示する。読み取りに失敗したり表の形が想定から外れたりしたときは、取り込みを止めるか、該当箇所だけを飛ばして、フローティングチャットへ知らせる。

動作の確かめ方は次のとおり。管理画面の CSV 取込スケジュールから「D社日程会議議事録」を手動で実行すると、取込履歴に成功と警告件数が出る。キオスクの製番ボード（`/kiosk/production-schedule/planning-board`）と順位ボード（`/kiosk/production-schedule/leader-order-board`）を開くと、エクセルに載った製番が登録製番に入っており、その納期がエクセルの部品完成日（1 行目）になっている。「SCAW」ボタンを押すと、同じ製番の納期が SCAW の日程に戻り、もう一度押すとエクセルの日程に戻る。

## Progress

- [x] (2026-11-04 06:00Z) 5/15 版と 10/30 版の 2 ファイルを解析し、ルールで読めることを確かめた（scratchpad の試作 `robust.py`、`stars2.py`）。
- [x] (2026-11-04 07:30Z) 本番 DB を読み取り専用で照合した。10/30 版の主製番 71 件のうち 70 件が生産日程にあり、無いのは BF4R2302 の 1 件。別名製番 2 件はどちらも生産日程にある。71 件とも手入力の製番納期は無い。
- [x] (2026-11-04 08:00Z) 既存の Gmail 取込、納期の書き戻し、通知の仕組みを調べた（Codex 読み取り専用調査、主要箇所を目視確認）。
- [x] (2026-11-04 08:30Z) この設計案を書いた。
- [x] (2026-11-04 12:00Z) ユーザーの返事を反映した。手入力納期との優先は案どおり。括弧の製番は部品を調べて両方使うと決めた。SCAW ボタンでの表示切替と、登録製番への自動登録を加えた。
- [x] (2026-11-04 12:30Z) 登録製番の上限を 100 件に上げると決めた（ユーザー決定）。変更箇所をマイルストーン 2 に書いた。
- [x] (2026-11-04 09:16Z) マイルストーン 1: エクセル解析器（純粋関数）と合成フィクスチャ。19 テスト、対象限定の型検査、ESLint が成功。API 全体の指定型検査は既存 tsconfig の TS6059 により未完了（下記参照）。
- [x] (2026-11-04 09:33Z) マイルストーン 2 / 保存: 2 モデルと `20261104093305_d_schedule_minutes` migration、主・別名の反映、日付変更時刻、警告、同一内容の冪等性。
- [x] (2026-11-04 09:46Z) マイルストーン 2 / 納期: 純粋関数の 576 ケース、手入力の更新元の照合、両ボードの dueSource、順位ボードの親行 SQL ソート、分割片の boardDueDate、snapshot/cache の分離。
- [x] (2026-11-04 09:46Z) マイルストーン 2 / 登録: 全拠点・共有履歴への登録、登録先別の所有権、前回からの所有権継承、古い自動登録の解除、409 の 1 回再試行、上限 100 件。
- [x] (2026-11-04 09:46Z) マイルストーン 2 / 検証: 指定 API テスト 898 passed / 54 skipped、API/Web 型検査、API ESLint、Web 96 tests、shared-types 8 tests、50/100 件のサービス読み取り計測。
- [ ] (2026-11-04 09:46Z) マイルストーン 2 / 残りの仕様確認: 順位ボードの分割片を親行をまたいで納期順に並べるか。現状は既存の親行順＋分割順を維持する。完全な display-item SQL 順序一致と「Excel 未保存時は既存結果と一致」は既存実装上両立しないため、ユーザーへ確認中。
- [x] (2026-11-04 11:13Z) マイルストーン 3: Gmail の対象 xlsx 選択、原本保存、スケジュール登録、履歴集計、警告の SYSTEM_NOTICE 通知。指定範囲と関連経路の 473 tests、build tsc、変更ファイルの ESLint が成功。
- [x] (2026-11-04 11:44Z) マイルストーン 4: 合意モックに沿った両ボードの SCAW 切替、端末保存、納期表示、協力会社の目印・処理出し日・メモの表示、専用読取APIを実装。Web 758 tests / API 3 tests、両型検査、変更ファイルの ESLint が成功。ガント内の★は Claude が追加。メニューバーの幅は 1920px のモックで実測済み（ガントON時で残り約47px、比較中は SCAW を隠す）で、実画面の幅は本番反映後に確認する。
- [ ] マイルストーン 5: 本番での試行取込と確認。

## Surprises & Discoveries

- Observation: schema.prisma と既存 migration 履歴には、この作業と無関係な差分がある。最初の編集スクリプトを誤った cwd で実行し、その失敗後にも migrate dev を続けたため、無関係な DROP/ALTER をローカル試験 DB へ適用してしまった。
  Evidence: 誤生成 `20261104093216_d_schedule_minutes` の DDL。既存 migration 列から逆差分を作って DB 構造を復元し、誤生成物とその試験 DB 台帳行だけを除いた。最終 migration は create-only 後に今回の 2 テーブルの DDL だけへ限定して適用した。失われた可能性のある既存試験データは復元していない。本番への接続は無し。復元後の DB と全 migration 列の `prisma migrate diff --exit-code` は No difference detected（exit 0）。

- Observation: 順位ボードの SQL は親行を選び、後段で分割片へ展開する。分割片は資源内手動順位、親行の取得順、splitNo の順で並び、現在も分割納期による親行をまたぐ全体ソートではない。
  Evidence: `leaderboard-shell-row-projection.sql.ts` と `order-split/production-schedule-order-split.service.ts` の `sortExpandedProductionScheduleRowsByManualOrder`。新しい SQL 式へ split 式を渡した場合の純粋関数との一致は DB テストで確認したが、これは display-item 全体の API 並びを変更する証拠ではない。

- Observation: 世代トークンに空の Excel 情報を無条件に追加すると既存のキー一覧のテストが失敗した。
  Evidence: 指定 API テスト初回 886 passed / 1 failed / 54 skipped。Excel 行が無い場合は既存トークンの形を維持する実装へ直し、既存の期待値は変更せず 898 passed / 54 skipped。

- Observation: `buildTextConditions` はカンマ区切り検索を 8 語に制限している。これは登録履歴の上限とは別の既存仕様である。
  Evidence: 50 製番を q へ直接渡した計測では 8 行だけが返った。計測は製番 prefix と 50/100 件の productNos による同一範囲へ変更した。この 8 語制限は今回変更していない。

- Observation: ローカル試験データ 50/100 行でサービス読み取りの中央値は、製番ボード 10.6/14.1 ms、順位ボード 14.1/17.0 ms だった。
  Evidence: 各条件 1 回 warmup 後の 3 回、fresh snapshot store、includeLoad=false のサービス呼び出し。行数も 50/100 件と照合し、fixture 行・拠点・board state は finally で除去した。HTTP や本番性能を示す値ではない。

- Observation: ExcelJS 4.4 は、結合元が空の結合セルについて従属セルの `cell.text` を読むと例外になる。文字は `cell.master.text` から読む必要がある。
  Evidence: 月見出しを空にする合成テストで `MergeValue.toString` が `null.toString` に失敗した。修正後は `UNDETERMINABLE_CALENDAR` を返し、19 テストが成功。

- Observation: ExcelJS の `collapsed` は outlineLevel と worksheet の outlineLevelRow / outlineLevelCol から算出される。AutoFilter の条件自体は評価されず、保存済みの除外状態は `row.hidden` として読む。
  Evidence: 合成ワークブックを writeBuffer / load で往復させ、hidden 行、outline 行・列を除外し、非表示の行・列にあるカレンダーの ★ を読むテストが成功。

- Observation: 指定の `tsc --noEmit -p .` は既存設定の `rootDir: src` に対して `prisma/seed.ts`、3 つの scripts、`vitest.config.ts` が include され、TS6059 で失敗する。
  Evidence: 2026-11-04 の実行で上記 5 ファイルの TS6059。設定を変更せず、一時 tsconfig で新規ディレクトリだけを対象にした strict 型検査は成功。API 全体の型検査成功は未確認。

- Observation: 見出しの位置が版ごとにずれる。5/15 版はデータが 10 行目から、10/30 版は 8 行目から始まる。MEMO 列（担当、MEMO、ANS）も 5/15 版は BA〜BC 列、10/30 版は CE〜CG 列にある。
  Evidence: 固定位置で読む試作は 10/30 版で全件ずれた。見出し文字で探す方式に変えると両方で同じ結果になった。

- Observation: 「注文書納期」の見出しは見出し 3 行目にあるが、値はブロックの 4 行目に入っている。見出しの縦位置からブロック内の行を決めると外れる。
  Evidence: 見出し位置で読むと注文書納期がほぼ空になり、4 行目で読むと日付が並ぶ。

- Observation: ファイル内の作成日欄（BC1）は古いことがある。10/30 版で 2026-07-24 だった。
  Evidence: `openpyxl` で BC1 を読んだ値。

- Observation: 毎週のファイルは直近の一部だけを載せる。5/15 版は 433 製番、10/30 版は 71 製番。
  Evidence: 両ファイルの製番ブロック数。

- Observation: 2 枚目のシート「在庫状況とLSLH処理出し」は貼り付けた EMF 画像 2 枚で、セルとしては読めない。同じ ★ は 1 枚目の日程表の隠れたカレンダー列にセルとして入っている。
  Evidence: `xl/drawings/drawing2.xml` が `xl/media/image1.emf` と `image2.emf` を参照し、セル値は無い。

- Observation: `GmailApiClient.getFirstAttachment()`（`apps/api/src/services/backup/gmail-api-client.ts:637`）は拡張子も MIME も見ずに最初の添付を返す。署名画像が先に付いたメールでは xlsx を取り逃がす。
  Evidence: 同関数のコード。

- Observation: 括弧付きの製番は、製番が付け替わった案件だが、構成部品は新しい製番には載っていない。新しい製番（例 BA1S9340）には完成品の品目 MH100060301 だけがあり、括弧の中の古い製番（例 BA1S7332）に旧品目 MH100060300 と構成部品（クロスローラ塗装指示図、スケールヘッドベース）がある。BA1SA349(BA1S9316) も同じ形。
  Evidence: 本番 DB（読み取り専用）で `CsvDashboardRow` の FHINCD を比べた結果。主製番は品目 1 種で 4 行、古い製番は品目 3 種で 7 行、共通の品目は 0。

- Observation: 10/30 版の製番は 71 件あり、登録製番の上限 50 件を超える。上限は製番ボードが `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardSeibanDrawer.tsx:11` と API 側の書き込み検査、順位ボードが `packages/shared-types/src/common/production-schedule-search-limits.ts:5` の `KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX`。
  Evidence: 各ファイルの定数。

- Observation: `CsvDashboardIngestRun`（`apps/api/prisma/schema.prisma:1552`）には警告を入れる欄が無い。`CsvImportHistory.summary`（Json）だけが構造化した結果を入れられる。
  Evidence: schema.prisma の該当モデル。


- Observation: 両版とも非表示の B 列に製番が 4 行繰り返され、A 列は 1〜4。下段見出しの J 列にも「製番」があるが、ブロックの識別には B 列を使う。
  Evidence: ユーザー提供の実レイアウト情報を両版の合成 fixture と製番・別名の検証へ反映。

- Observation: データより上に A 列が 1〜4、B 列が 0 のテンプレートブロックがある。これは不正製番の警告対象ではない。
  Evidence: 両版の合成 fixture で `INVALID_SEIBAN` が無いことを検証。

- Observation: カレンダーは結合された月見出し、曜日、日の 3 行構成で、月は日の直上ではない。10 月版は 10 月から 11 月へ続く。
  Evidence: 合成 fixture の月見出しを結合し、曜日行を挟み、11 月列の ★ が `2026-11-01` になることを検証。

- Observation: 「組立\n納期」「出荷\n日」「最終\n部品完」は改行を含み、MEMO 見出しは「MEMO \n黒字：前回まで\n青字：新規」という凡例付きである。
  Evidence: 合成 fixture で改行付き日付見出しの目印と、凡例付き MEMO 列の架空メモの取得を検証。

- Observation: 2026 年 5 月版には「★LSLH最終処理出」という旧表記がある。
  Evidence: May fixture の旧表記が `surfaceSendOutDates` に入ることを検証。

- Observation: フィルタ等で非表示の行のブロックは ★ があっても対象外。表示ブロックの非表示カレンダー列にある ★ は対象である。
  Evidence: 非表示行ブロックの不在と、表示ブロックの非表示列にある処理出し日の取得を合成テストで検証。過去の非表示行の ★ に関する記録を置き換える。

## Decision Log

- Decision: 解析でブロックを飛ばしても、その回の警告に製番が残っていれば自動登録の解除対象にしない。既存の所有権は次回へ引き継ぎ、警告だけの製番は新規登録しない。
  Rationale: 読取不能とファイルからの削除を区別し、本当に不在となった回にだけ自動登録を解除する（Task A）。
  Date/Author: 2026-11-04 / Codex

- Decision: apply の advisory lock・同一メール判定の後、書込前に会議日が今回より古い最新 SUCCESS と比較する。主・別名の一意製番数が前回の 0.5 未満、または既存と新規の読取可能な部品完成日を10件以上比較して絶対差60日以上の割合が0.3超なら全体を取り消す。初回は比較しない。単発の大幅変更は保存して `LARGE_DUE_CHANGE` をフローティングチャットへ通知し、スキップ件数には含めない。不在製番の保存値は維持する。
  Rationale: ファイル異常による大量変更を防ぎ、比較失敗は専用エラーから Gmail の恒久コンテンツエラーへ変換する。メールは既読にし、既存の失敗アラートを使う（Task B）。閾値は `D_SCHEDULE_MINUTES_MIN_SEIBAN_RATIO`（既定0.5）、`D_SCHEDULE_MINUTES_LARGE_CHANGE_DAYS`（60）、`D_SCHEDULE_MINUTES_MAX_LARGE_CHANGE_RATIO`（0.3）、`D_SCHEDULE_MINUTES_MIN_COMPARED`（10）で設定でき、テストでは apply の任意 `thresholds` 引数で上書きする。
  Date/Author: 2026-11-04 / Codex

- Decision: Milestone 4 の追加情報は `GET /kiosk/production-schedule/d-schedule-minutes` の専用キオスク読取APIで返す。既存ボードと同じ端末認証を通し、ボードと同じ固定 `PRODUCTION_SCHEDULE_DASHBOARD_ID` に属する最新行を製番順に取得する。応答は `{ rows: [{ fseiban, outsourceMarks, surfaceSendOutDates: [{ date, note }], memo }] }`、ページングなし、`Cache-Control: no-store` とする。
  Rationale: 既存のボード応答・snapshot・ETag を変更せず、両画面で共有する追加情報だけを30秒間隔で読み直す。解析器が除外した「戻」は復元しない。納期ソースは各ボードの既存パラメーターキーへ加え、順位ボードの端末キャッシュと continue も同じソースで分離する。
  Date/Author: 2026-11-04 / Codex

- Decision: 製番ボードの SCAW ボタンはガントのセグメント直後・外側に置き、`orderPreview` 中だけ非表示にする。他のボタンは変更しない。
  Rationale: 合意モックの比較表示では、1920px幅・高さ66pxのツールバーに SCAW を残すと30pxはみ出すというユーザーの実測に従う。表示位置・押下状態・比較中非表示はコンポーネントテストで確認した。今回の1920px実機ブラウザ計測は、利用可能な bundled headless shell が macOS sandbox の `bootstrap_check_in: Permission denied` で起動できず省略した。
  Date/Author: 2026-11-04 / Codex

- Decision: 製番ボードの保存キーは既存ガント設定と同様の端末ローカルな `kiosk-planning-board-scaw-mode` とし、`{ schemaVersion: 1, enabled }` を保存する。順位ボードは `persistedLeaderBoardGanttModeStorageKey` の兄弟関数で `kiosk-leader-order-board-scaw-mode:<site>\0<device>` に分ける。いずれも既定OFF、ストレージ失敗時はセッション内で切替を継続する。
  Rationale: 製番ボードの既存フックは拠点キーを持たないため、その命名・保存粒度を維持する。順位ボードは既存の拠点・端末切替時の hydration 保護を踏襲する。
  Date/Author: 2026-11-04 / Codex

- Decision: 製番ガントの各行に、その行に載る製番の処理出し日を★として日付欄に描く（`gantt/PlanningBoardGanttSendOutStars.tsx`）。Codex は「1製番1行ではない」として省いたが、合意モックでは★を描いていたため、行に載る全製番の★を日ごとに1つにまとめて描く形で実装した。SCAW の切替に関係なく描く。
  Rationale: 合意済みのモックと揃える。行は部品や資源ごとで複数製番を含むが、同じ日の★は1つにまとめれば重ならない。
  Date/Author: 2026-11-04 / Claude
  Validation: apps/web の `pnpm exec tsc --noEmit -p .` は exit 0 / 0 errors。対象2機能・製番ページ・追加情報・API引数テストは99 files / 757 tests passed、追加の順位ボタンテストは1 file / 1 test passed（ともに exit 0、合計758件、skipなし）。apps/api の `pnpm exec tsc -p tsconfig.build.json --noEmit` は exit 0 / 0 errors、新規ルートテストは1 file / 3 tests passed / exit 0。変更した Web 24 / API 3 TypeScript ファイルの ESLint は、import順序とページ行数上限への局所修正後に exit 0 / 0 errors / 0 warnings。DB・外部サービス・秘密情報・本番接続・Git書込みは使用していない。

- Decision: Milestone 3 の候補メールは先に取得して `internalDateMs` 昇順で処理する。製番ごとの既存値の source run がより新しい `meetingDate` を持つ場合は更新も変更/不変の集計も行わず、製番ごとに `STALE_FILE` を1件記録する。通知文は「より新しい議事録の内容を残しました」。同日・新しいファイルは従来どおり適用する。
  Rationale: Gmail の新着順応答や古い議事録の遅延再送による巻き戻りを、取込順とDBの両方で防ぐ。自動登録は既存ロック内で最新の SUCCESS/APPLIED の会議日を確認し、古いファイルでは全体を省略して run の `autoRegisteredSeibans.autoRegistrationSkipped: STALE_FILE` と履歴のメール別 summary に残す。前回成功の所有権を引き継ぎ、次回の reconcile は成功 run の会議日降順で所有権を参照する。メール単位の失敗は未読・ラベル未付与のまま集約し、他メールの適用・確定後に失敗IDと理由をまとめて throw し、既存の失敗履歴・アラートを維持する。
  Date/Author: 2026-11-04 / Codex
  Validation: 指定の `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return pnpm exec vitest run src/services/production-schedule/d-schedule-minutes src/services/imports` は apps/api で 37 files / 325 tests passed（skipなし、15.02秒）。先行の対象3ファイルは29 tests passed。`pnpm exec tsc -p tsconfig.build.json --noEmit` は exit 0 / 0 errors、変更した8 TypeScriptファイルへの `pnpm exec eslint` は exit 0 / 0 errors / 0 warnings。新着順の2通が古い順に適用され新しい日付が残ること、古い会議日の製番更新を抑止すること、同日の更新を許可すること、自動登録の省略と所有権保持、致命的メールの後の正常メール確定、全失敗ID・理由の集約、既存失敗履歴・アラート継続を確認した。実Gmail・外部サービス・秘密情報・Git書込みは使用せず、既存WIPを保持した。

- Decision: Milestone 3 の組み込み行は `d-schedule-minutes-gmail`、専用 target は `dScheduleMinutesGmail`、cron は `23 * * * *`（Asia/Tokyo）とする。件名は予約済みの `D社日程会議議事録` に固定し、検索後も件名の部分一致を確認する。送信元は既存どおり `storage.options.gmail.fromEmail`、未設定なら旧 `storage.options.fromEmail` を使う。既存行・既存設定を保持し、不在の場合だけ行を追加する。
  Rationale: 到着曜日が不定の週次メールを毎時確認し、設備稼働ログの毎時47分や5分刻みの行から分をずらす。xlsx を CSV 解析器へ渡さず、既存スケジュールをそのまま稼働させる。
  Date/Author: 2026-11-04 / Codex

- Decision: 原本は耐久ファイルストアの `csv-dashboards/d-schedule-minutes/<SHA-256>.xlsx` に create-only・整合性記録付きで解析前に保存し、その相対キーを `originalFilePath` に保持する。同じ原本がある場合は整合性を検証して再利用する。
  Rationale: 調査した現行 machine-signal Gmail 経路は添付列挙の手本だが、CSVをDBへ保存するだけで原本保存は存在しない。xlsx 原本保存は既存 AssemblyCheckSheetService の耐久ストア方式を用い、既存 `csv-dashboards` 名前空間へ収める。実際の保存先は `FILE_STORAGE_ROOT` 配下（既定 `/opt/RaspberryPiSystem_002/storage`）。新しい依存・DDLは不要。
  Date/Author: 2026-11-04 / Codex

- Decision: apply の日付比較と registration の既存 reconcile 結果から集計し、run の既存 `autoRegisteredSeibans` Json に追加の `metrics` を保持する。履歴は `summary.dScheduleMinutesGmail` に集計とメール別 `runs` を保存する。製番数は主・別名の一意数、登録・解除数は全登録先で実際に追加・解除した製番の一意数、スキップ数は読めずに飛ばした箇所の製番・セルの一意数とする。保存対象外の製番でも最新値自体は保存されるため、`NOT_IN_SCHEDULE` はスキップに含めない。
  Rationale: 日付や登録の既存挙動を変えず、APPLIED の途中再開でも最初の変更件数と完了済み登録先の集計を保持する。件数は拠点数によって水増ししない。既存の登録所有権と成功状態は引き続き同じ用途で使う。
  Date/Author: 2026-11-04 / Codex

- Decision: 警告は `deliverSystemNotice` にメールID由来のキーと `once: true` を渡して直接通知する。本文は製番・セル・元の文字・警告コード別の日本語説明を最大20件、各文字列最大120文字とし、残り件数を表示する。once 通知は既存の transaction/advisory lock 内で、解決済みを含む同じキーのスレッドがあれば再送しない。
  Rationale: 汎用ファイルアラート本文では警告内容が伝わらず、Slack 配送経路も通す必要がない。通知失敗時はメールを未読のまま残し、SUCCESS run を再適用せず通知とメール後処理だけ再試行する。成功メールの後処理は既存と同じ `trashMessage`（処理済みラベル付与後ゴミ箱移動）→ `markAsRead`。
  Date/Author: 2026-11-04 / Codex

- Evidence (2026-11-04, parser hardening): 指定実ファイルの変更前出力は参照 35/71 ブロックに一致。厳密ルール適用後もブロック識別は一致するが、許容範囲外の部品完成 N38 / N17 が各 1 件 null になる。警告は 6/8 件（古い日付、結果なし数式、※等のカレンダー記号）であり、日付完全一致・警告 0 の条件とは衝突する。例外を作って抑制せず、ユーザーへ判断を照会した。
- Evidence (2026-11-04, false-alarm correction): ±3 年と cached result 判定修正後、May 35 / October 71 ブロック行は before1 / before2 と byte 一致し、N38 / N17 の日付も復元。指定の新 UNKNOWN_STAR 条件では AG132 / BD240 が各 1 件残るため、警告 0 条件との衝突を照会中。parser 70 tests、build tsc、変更 TypeScript の ESLint は成功。tsx CLI は sandbox IPC の EPERM で起動できず、同じ runner を node --import tsx で実行した。
- Decision (2026-11-04, parser hardening): 全日付欄で基準日 −3 年〜+3 年を採用範囲とし、数値 serial は 20000 以上のみ読む。範囲外は `UNREADABLE_DATE` と null にする。
- Decision (2026-11-04, parser hardening): データセルは全列で merge master の行を当該 4 行内に限定し、越境は `MERGED_ACROSS_BLOCKS` として読まない。
- Decision (2026-11-04, parser hardening): A 列 1〜4 と同一製番が揃わないブロックは `BLOCK_SHAPE`。先頭行の A=1 と製番が有効なら部品完成と MEMO は保持するが、★と他の日付欄の選択行は読まない。
- Decision (2026-11-04, cached formula correction): ExcelJS の `cell.value` は falsy な formula result をコピー時に落とすため、結果の有無は merge master の `cell.result` が null / undefined かで判定する。0 / 空文字は結果ありとして扱い、製番 0 のテンプレートは警告しない。
- Decision (2026-11-04, parser hardening): 製番・部品完成など読取対象の結果なし数式は `FORMULA_NO_RESULT`。最初の有効ブロックより前のテンプレートは警告しない。
- Decision (2026-11-04, parser hardening): 同列の積層見出しは列内の最上段見出しからの物理行差を各読取行に使う（部品完成は常に先頭行）。単独見出しの既存スコア選択は維持し、同じセルの同じ警告は重複しない。
- Decision (2026-11-04, parser hardening): 有効なファイル名日付と受信日時の差が 45 日を超えたら `FILENAME_DATE_MISMATCH`。基準日は引き続きファイル名を優先する。
- Decision (2026-11-04, parser hardening): 空白除去・NFKC 後の完全一致「日程表」を優先し、なければ部分一致、なければ先頭シート。候補複数なら有効ブロック最多を選び `MULTIPLE_SCHEDULE_SHEETS`。
- Decision (2026-11-04, parser hardening): カレンダーは NFKC 後に ☆ 始まり、または ★ で始まらず「処理出」「処理品」を含む場合だけ `UNKNOWN_STAR`。戻を含む文字列は除外する。※要調整やＬＳＬＨ完などの注記は警告しない。
- Decision (2026-11-04, parser hardening): 製番と別名は NFKC 後に大文字化する。近い年候補 2 件の距離差が 30 日以内なら `AMBIGUOUS_YEAR` を出し最短候補は保持する。非表示の先頭行を持つブロックは除外するが、表示ブロック内の非表示行の ★ は読む（従前の非表示行記述よりこの例外を優先）。

- Decision: Milestone 2 の `NOT_IN_SCHEDULE` 判定は、主製番と別名をまとめて `readWinnerRowsByFseibans` で取り込みごとに一度取得し、製番ボードの登録検証と同じ winner 集合を使う。
  Rationale: 生の CSV 行だけが残る製番を登録対象から除外し、後続拠点・共有履歴の更新と SUCCESS 到達を妨げない。非 winner を含む apply → 自動登録の回帰テストで確認する。
  Date/Author: 2026-11-04 / Codex

- Decision: 手入力納期の更新元時刻は `BOARD_DUE_JOINS_SQL` の LATERAL で一度計算し、SELECT と納期・ソート式は同じ列を参照する。`OFFSET 0` で PostgreSQL の pull-up による副問い合わせの複製を防ぐ。
  Rationale: Excel 納期なしの CASE 分岐と SCAW の `COALESCE("n"."dueDate", "supplement"."plannedEndDate")` を保持し、既存の更新元時刻と TS resolver との一致を保ったまま重複評価を除く。
  Date/Author: 2026-11-04 / Codex

- Decision: 部品完成以外の選択行の同率時は最上段を採る。目印と日付欄メモは選択行から集め、MEMO はブロック 1 行目を読む。受信日時の代替基準日は UTC 日付とする。
  Rationale: 返却契約には部品完成以外の日付フィールドが無い。履歴の目印やメモの混入を避け、同一入力に対する出力を一定にする。
  Date/Author: 2026-11-04 / Codex

- Decision: 非表示ブロックは通常値を読まず、認識できたカレンダーの ★ がある場合だけ、製番と処理出し日を持つブロックとして返す。80% 判定は表示ブロックを分母とする。月の日が戻るのに月ラベルが変わらない場合は致命的とする。
  Rationale: 非表示行の ★ を読む例外を維持し、非表示の日付や不明な翌月を推測して取り込むことを避ける。
  Date/Author: 2026-11-04 / Codex

- Decision: 1 製番は 4 行のブロックとし、各列の 1 行目を最新値、2〜4 行目を変更前の値（履歴）として扱う。
  Rationale: ユーザーの説明による。
  Date/Author: 2026-11-04 / ユーザー

- Decision: ボードの納期として使うのは「部品完成」列の 1 行目。
  Rationale: ユーザー決定。
  Date/Author: 2026-11-04 / ユーザー

- Decision: 日付の後ろの (X)、(YZ) などは「その軸の部品だけ協力会社へ依頼する」目印として、日付と分けて保存し表示する。依頼先は MEMO 列に書かれることがあるので、MEMO 列も保存する。
  Rationale: ユーザーの説明による。
  Date/Author: 2026-11-04 / ユーザー

- Decision: 見えている行と列だけを読む。隠れた行、折りたたまれた列、オートフィルタで隠れた行は読まない。例外として、隠れたカレンダー列にある ★ は読む。
  Rationale: ユーザー決定。★ は 2 枚目の画像と同じ情報をセルで持っているため。
  Date/Author: 2026-11-04 / ユーザー

- Decision: ★ は処理出し日として扱う。対象は「★LSLH最終処理品」と「★LSLH処理出」の両方。「〜戻」の ★ は使わない。「（ＣＴ以外）」のような ★ への書き足しはメモとして表示する。2 枚目のシートは読まない。
  Rationale: ユーザー決定（11/04）。
  Date/Author: 2026-11-04 / ユーザー

- Decision: 日付の年はファイル名の YYYYMMDD を基準に決める。ファイル名から取れなければメールの受信日を使う。BC1 は使わない。
  Rationale: BC1 が古いことがあるため。M/D だけの日付は、基準日から前 6 か月〜後 6 か月に入る年を選ぶ。
  Date/Author: 2026-11-04 / Claude

- Decision: 列の位置を固定せず、上から 30 行以内で見出し文字を探して列を決める。ブロック内の何行目に値があるかは、見出しの位置ではなく、候補の行ごとに日付として読めた割合を数え、最も多い行を採る。
  Rationale: 見出しのずれと注文書納期の行ずれの両方に対応できる。
  Date/Author: 2026-11-04 / Claude

- Decision: ファイルに載っていない製番は、消さずに今の値を保つ（部分更新）。
  Rationale: 毎週のファイルは直近の一部だけを載せるため。
  Date/Author: 2026-11-04 / ユーザー同意

- Decision: （初版の案を取り下げ）エクセルの日付を製番納期や行の納期へ書き戻さない。エクセルから読んだ値は新しいテーブルに出典付きで保存し、両ボードは表示のときに「エクセルの日程」と「SCAW の日程」のどちらかを選んで納期を決める。メニューに「SCAW」ボタンを置き、既定はオフでエクセルの日程を出す。オンにすると今の表示（SCAW の完了予定日と、ボードでの手入力）をそのまま出す。ボタンの状態は端末ごとに保存する。
  Rationale: ユーザーから「今の日程は SCAW のもので、これは残したい。SCAW ボタンをメニューに追加して既定はオフ、既定はエクセルの日程を表示」と指示があった。書き戻すと SCAW の日程が見えなくなるため、表示の切り替えにする。
  Date/Author: 2026-11-04 / ユーザー

- Decision: ボードで手入力した納期との関係は「エクセルの値が前回のエクセルから変わったら、エクセルを優先する。変わっていなければ、それより後に手入力された納期を優先する」とする。エクセルの日程の表示では、製番ごとに、エクセルの値が最後に変わった時刻と、手入力の製番納期・処理別納期の更新時刻（`ProductionScheduleSeibanDueDate.updatedAt`、`ProductionScheduleSeibanProcessingDueDate.updatedAt`）を比べ、新しいほうを出す。分割納期と製番ボードの項目ごとの個別設定は、範囲が細かいので今までどおりこれより優先する。
  Rationale: 毎週同じ日付が載り続けても、現場がボードで直した値を消さないため。値が変わったときは日程会議で決まった新しい納期なので優先する。ユーザー承認済み。本番では 71 件とも手入力が無いので、初回に衝突は起きない。行の備考（`ProductionScheduleRowNote`）の更新時刻は備考の編集でも変わるので比べる材料にしない。
  Date/Author: 2026-11-04 / ユーザー承認

- Decision: 処理出し日（★）、協力会社の目印、メモは表示専用とし、納期の書き戻しには使わない。処理別納期（`ProductionScheduleSeibanProcessingDueDate`）にも入れない。
  Rationale: 処理別納期は「その処理の納期」であり、処理出し日とは意味が違う。混ぜると既存の納期計算が変わる。
  Date/Author: 2026-11-04 / Claude

- Decision: 製番が「BA1S9340(BA1S7332)」のように括弧付きで書かれているときは、前を主製番、括弧の中を別名製番とし、同じ納期を両方に反映する。
  Rationale: ユーザーは「製番が変わった案件で、構成部品は変わっていないはず。合っていれば括弧の製番は不要かも」と見ていた。本番で調べると、新しい製番には完成品の品目しか無く、構成部品の行は括弧の中の古い製番にだけある。括弧の製番を捨てると、研削や切削で扱う部品の行に新しい納期が付かないので、両方に同じ納期を付ける。
  Date/Author: 2026-11-04 / Claude（調査結果を報告済み）

- Decision: エクセルに載った製番を、両ボードの左側の登録製番に自動で登録する。製番ボードは拠点ごとのリスト（`ProductionScheduleGrindingPlanningBoardState.seibanOrder`）なので全拠点に、順位ボードは全体で共有のリスト（`KioskProductionScheduleSearchState`）に入れる。人が手で登録した製番は消さない。自動で入れた製番は、次のエクセルに載らなくなったら外す。そのために、自動で入れた製番の一覧を取り込み側のテーブルに持つ。
  Rationale: ユーザー指示「左ペインの登録製番もエクセルの日程の製番を自動で登録して」。手で登録した製番を消すと現場の作業が崩れる。
  Date/Author: 2026-11-04 / ユーザー（外す条件は Claude 案）

- Decision: 登録製番の上限を 50 件から 100 件に上げ、エクセルの製番を絞らずに全部登録する。10/30 版は主製番 71 件と括弧の製番 2 件で 73 件になり、手で登録する分を足しても 100 件に収まる。100 件を超えた場合は、エクセルの部品完成日が近い順に入れ、入りきらない製番を警告に残す。
  Rationale: ユーザー決定「上限を上げる」。
  Date/Author: 2026-11-04 / ユーザー（100 件と超過時の扱いは Claude 案）

- Decision: 揺れの扱いは 2 段階にする。致命的な揺れでは取り込み全体を止めて今の値を保ち、通知する。部分的な揺れでは該当箇所だけを飛ばして残りを取り込み、警告として通知する。基準の数値は「致命的な揺れ」の節に書く。
  Rationale: 人が作る表なので、一部の書き崩れで全体を止めると毎週止まる。逆に表の形そのものが変わったときに読み進めると、間違った日付が大量に入る。
  Date/Author: 2026-11-04 / Claude

- Decision: 実ファイルはリポジトリに入れない。テストには、構造上の癖を残したまま製番やメモを架空の値に置き換えた合成ファイルを使う。
  Rationale: 実ファイルには客先の製番と社内のメモが入っている。
  Date/Author: 2026-11-04 / Claude


- Decision: 非表示行のブロックは ★ の有無にかかわらず `result.blocks` から除外する。非表示カレンダー列の ★ は表示ブロックで読む。上記の非表示ブロックを返す旧決定を置き換える。
  Rationale: 実ファイルのフィルタによる対象外行を取り込まないため。
  Date/Author: 2026-11-04 / Codex

- Decision: 「★LSLH最終処理出」は「★LSLH最終処理品」の旧表記として処理出し日に採用する。
  Rationale: 2026 年 5 月版の実レイアウトとの整合を合成テストで固定するため。
  Date/Author: 2026-11-04 / Codex

- Decision: manualUpdatedAt は、行備考の dueDate と一致する処理別納期の updatedAt、無ければ一致する製番納期の updatedAt とする。処理種別は既存 writeback と同じく品番の処理種別を優先し、無ければ行備考の処理種別を使う。一致する正本の無い旧行備考の納期には null を渡す。
  Rationale: `due-management-command.service.ts` は製番納期変更時に処理別指定を除外し、処理別指定の解除時には製番納期を戻す。行備考の updatedAt は備考編集でも変わるため採用しない。正本時刻不明の手入力は Excel の時刻付き日付より優先しないが、Excel の値が無ければ既存どおり行備考を返す。
  Date/Author: 2026-11-04 / Codex

- Decision: excelChangedAt は保存時の実時刻とし、部品完成日が変わった場合だけ更新する。同じ内容なら sourceRunId や updatedAt も変更しない。異なるメール ID は監査用の run を別に残すが、同じセル内容の最新値は元の provenance を保つ。
  Rationale: 毎週同じ日付のファイルで手入力との優先順位を逆転させず、「同じファイルは no-op」を最新値にも適用する。既存の parser 型には MEMO 原文の独立フィールドが無いため、memo と rawPartsCompleteText をそのまま保存し、解析器の契約は広げない。
  Date/Author: 2026-11-04 / Codex

- Decision: autoRegisteredSeibans は Json の `{ planningBoards: Record<siteKey, string[]>, searchHistory: string[] }` とする。今回追加したものと、前回から引き続き保持する自動登録の所有権を保存する。新規 board が共有履歴から初期化された場合は、その履歴由来の自動登録の所有権も継承する。
  Rationale: 単一の製番配列では、A 拠点で自動追加した同じ製番が B 拠点の手動登録だった場合に誤削除する。継続する所有権を次の run に渡さなければ 2 回目以後の古い自動登録を削除できない。
  Date/Author: 2026-11-04 / Codex

- Decision: 登録は既存の並び順を残し、追加分を部品完成日の昇順（null は最後）で末尾へ加える。上限の判定と警告は登録先別に行い、警告一覧では製番ごとに重複除去する。登録先の集合は Site と既存 board state の union とする。
  Rationale: 現場が並べた既存項目を動かさず、どの拠点でも上限を守る。状態のある旧拠点も取り残さない。
  Date/Author: 2026-11-04 / Codex

- Decision: 保存 transaction の完了後に自動登録を呼ぶ。run は APPLIED から SUCCESS へ進み、登録先ごとの所有権を保存する。同じ Gmail ID の APPLIED は登録を再開し、SUCCESS は no-op とする。登録先の 409 は reread して 1 回のみ retry する。
  Rationale: 既存の board/search-state サービスがそれぞれ transaction と version/ETag 検査を持つため、直接テーブルを書かずに再試行可能にする。Gmail や scheduler の配線は Milestone 3 に残す。
  Date/Author: 2026-11-04 / Codex

- Decision: dueSource は省略を excel に正規化し、snapshot の filter fingerprint に含める。canonical row cache は Excel と手入力の生値・時刻を保持し、レスポンスへ展開するときに source を再評価する。Excel 最新値の件数と max(updatedAt) は行がある場合に世代トークンへ入れる。
  Rationale: ソース切替で別の並びを流用せず、Excel の更新後に古い日付を返さないため。Excel 未保存時の既存トークン形状も維持する。順位ボードの既存 dueDate は書き換えず、新しい boardDueDate を追加した。
  Date/Author: 2026-11-04 / Codex

- Decision: 製番ボードの明示的な dueDateCleared は、既存の項目単位設定として SCAW 完了予定日へのフォールバックを維持する。
  Rationale: 既存の明示クリアと restore の区別を壊さないため。通常の項目個別日付・分割日付は共通関数で優先する。
  Date/Author: 2026-11-04 / Codex

- Decision: 分割片を親行をまたいで納期順へ変える解釈は、今回未確定として残す。Excel の親行 SQL の納期ソートと、分割片ごとの boardDueDate の追加まで実装する。
  Rationale: 既存の親行・分割片の順序を変えると、ユーザーの「Excel が無ければ既存結果と一致」と衝突する。質問を提示したが、このログ時点で回答は無い。SQL 式自体の分割優先の DB テストだけで API 全体の受入完了とは扱わない。
  Date/Author: 2026-11-04 / Codex（ユーザー確認待ち）

- Decision: ★ の無い「セラミック処理出」「※カニゼン処理出し」など、処理出・処理品を含むが ★ で始まらない書き込みは、毎週出ても `UNKNOWN_STAR` 警告のままにする。ボードの処理出し日には使わない。
  Rationale: 処理出し日の書き方が ★ の決まりから外れたことに気付けるほうがよい(ユーザー決定)。
  Date/Author: 2026-11-04 / user

## Outcomes & Retrospective

マイルストーン 3 をローカル実装した。新規の Gmail 取込サービスと集計型、組み込み行の追加・専用targetの設定/API/CSV経路の分岐、既存 apply/auto-register の集計、SYSTEM_NOTICE の一度限りの通知と本文、新規合成テストを追加した。既存WIPは保持し、パーサー、SeibanDueDate / ProcessingDueDate / RowNote の書込みは変更していない。

`apps/api` から `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return pnpm exec vitest run src/services/production-schedule/d-schedule-minutes src/services/imports src/services/kiosk-inquiry/__tests__/system-notice.service.test.ts src/services/kiosk-inquiry/__tests__/system-notice-sources.test.ts src/services/gmail/__tests__/gmail-subject-reservation.policy.test.ts src/routes/__tests__/imports-schedule.integration.test.ts` は 41 files / 473 tests passed、skipなし（33.32秒）。先行の対象3ファイルは21 tests passed。その後、登録集計の途中再開テストを加えて上記全範囲で成功した。`pnpm exec tsc -p tsconfig.build.json --noEmit` は exit 0 / 0 errors。変更した19個のTypeScriptファイルを対象とする `pnpm exec eslint` は0 errors、重複importの2 warningsを整理後、該当2ファイルの再検査は警告も0件。初回の型検査で新規件名定数の重複importを検出し、同じ原因の新規テスト失敗とともに修正した。実Gmail・外部サービス・実顧客ファイルは使用せず、新規DDLも実行していない。commit / push / PR / merge / deploy とマイルストーン4〜5は未実施。

今回の変更ファイル（既存WIPとの差分）: `apps/api/src/routes/imports/schedule.ts`、`services/backup/backup-config.ts`、`services/gmail/gmail-subject-reservation.policy.ts`、`services/imports/` の `csv-import-execution.service.ts`、`csv-import-process.service.ts`、`csv-import-source.service.ts`、`csv-importer.types.ts`、`fkojunst-import-schedule.ensure.ts`、`import-schedule-admin.service.ts`、`system-csv-import-schedule-builtin-rows.ts`、`__tests__/d-schedule-minutes-gmail.test.ts`、`services/kiosk-inquiry/` の `system-notice-sources.ts` と `system-notice.service.ts`、`services/production-schedule/d-schedule-minutes/` の `apply-d-schedule-minutes.service.ts` とそのテスト、`auto-register-d-schedule-minutes.service.ts` とそのテスト、`import-summary.ts`、`d-schedule-minutes-gmail-ingestion.service.ts`、およびこのExecPlan。`services/` で始まるパスは `apps/api/src/` 相対。

マイルストーン 2 の API と共有上限を実装し、指定 API テスト 898 passed / 54 skipped、API/Web 型検査と API ESLint、Web 96 tests、shared-types 8 tests が成功した。分割片の全体並びの解釈だけは未確定であり、Milestone 2 全体の受入完了とはしない。Gmail、scheduler、HTTP import route、ボード UI の切替、本番反映は未実施。既存の Milestone 1 の未追跡ファイルは保持し、ExecPlan の進捗・決定・発見を更新した。

マイルストーン 1 の純粋解析器と合成ワークブックの 19 テストを実装した。対象限定の型検査と ESLint は成功した。指定の API 全体型検査は既存設定の TS6059 で未完了。マイルストーン 3〜5、commit、push、本番反映は未実施。設計の段階で、2 つの実ファイルをルールだけで読めること、10/30 版の製番がほぼ全部（71 件中 70 件）生産日程とつながることを確かめた。

## Context and Orientation

このリポジトリは工場の Raspberry Pi 群を動かすシステムで、API は `apps/api`（Fastify と Prisma、DB は PostgreSQL）、画面は `apps/web`（React）にある。本番の API と DB は Pi5 上の Docker（`infrastructure/docker/docker-compose.server.yml`）で動く。生産日程は「CSV ダッシュボード」という仕組みで取り込まれ、ダッシュボード ID は `PRODUCTION_SCHEDULE_DASHBOARD_ID`（`apps/api/src/services/production-schedule/constants.ts`、値は `3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01`）。生産日程の 1 行は `CsvDashboardRow` で、製番は `rowData->>'FSEIBAN'` に入る。

用語を定める。「製番」は製造番号で、8 文字の英数字（例 BA1S9340）。「ブロック」は日程表の中で 1 製番が占める連続 4 行で、A 列に 1〜4 の番号、B 列に製番が入る。「部品完成」は日程表の N 列付近にある見出しで、ブロック 1 行目が最新の部品完成予定日。「処理出し日」は、時間のかかる表面処理（LSLH など）に部品を出す日で、日程表右側のカレンダー列に ★ で書かれる。「協力会社の目印」は日付の後ろの (X) や (YZ) で、その軸の部品だけ外へ依頼することを示す。

納期の持ち方は次のとおり。製番単位の納期は `ProductionScheduleSeibanDueDate`（`csvDashboardId` と `fseiban` で一意、`apps/api/prisma/schema.prisma:2115`）。処理別の納期は `ProductionScheduleSeibanProcessingDueDate`。ボードが行ごとに読むのは `ProductionScheduleRowNote.dueDate` で、製番納期を変えると `apps/api/src/services/production-schedule/due-management-command.service.ts` が `writebackSeibanDueDateToRowNotes` を呼んで各行へ書き戻す。順位ボードは分割納期、行の納期、補助の完了予定日の順で表示納期を決め（`apps/web/src/features/kiosk/productionSchedule/plannedDueDisplay.ts:30`）、製番ボードも同じ行の納期を元に、ボード独自の個別設定を上に重ねる（`apps/api/src/services/production-schedule/grinding-planning-board-projection.ts`）。ここで「SCAW の日程」と呼ぶのは、生産日程 CSV と一緒に届く補助データの完了予定日（`ProductionScheduleOrderSupplement.plannedEndDate`）のこと。

両ボードで納期を決める場所は非対称である。製番ボードは API が納期を決めて返す。`apps/api/src/services/production-schedule/grinding-planning-board-projection.ts:467` で親の元の納期（行の納期、無ければ SCAW の完了予定日）を作り、`resolveGrindingPlanningBoardItemDueDate`（同ファイル :143）で個別設定、分割納期、親の納期の順に決める。Web 側は `apps/web/src/features/kiosk/grindingPlanningBoard/sortGrindingPlanningBoardItems.ts:42` の `resolveGrindingPlanningBoardDueDate` で表示と並べ替えに使う。順位ボードは API が行の納期と SCAW の完了予定日を別々に返し（`apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-row-projection.sql.ts:89`）、Web の `apps/web/src/features/kiosk/leaderOrderBoard/normalizeLeaderBoardRow.ts:42` が `resolveDisplayDueDate` で表示納期を決める。ただし並べ替えは API の SQL 式 `LEADERBOARD_SHELL_DUE_SORT_EXPR`（同ファイル :14）で行うので、表示と並び順の両方を切り替えないとずれる。

メニューの場所も違う。製番ボードは上部のツールバー `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardToolbar.tsx` にボタンが並ぶ（例「製番ごとに色分け」:242、`aria-pressed` で押下を示す）。順位ボードには上部のツールバーが無く、左側の縦のボタン列 `apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx` がメニューの役をする（例「ガント」:423）。端末ごとにオンとオフを覚える手本は、製番ボードの `usePlanningBoardLargeScreen.ts`、順位ボードの `usePersistedLeaderBoardGanttMode.ts`（どちらも localStorage に `{schemaVersion:1, enabled}` を保存）。

左側の登録製番は 2 つのボードで別々に持つ。製番ボードは拠点ごとの `ProductionScheduleGrindingPlanningBoardState.seibanOrder`（`apps/api/prisma/schema.prisma:1980`、API は `PUT /kiosk/production-schedule/grinding-planning-board/seiban-order`、サービスは `apps/api/src/services/production-schedule/grinding-planning-board/write.ts`）。順位ボードは全体で共有の `KioskProductionScheduleSearchState`（`apps/api/prisma/schema.prisma:2103`、`state.history` が製番の配列、API は `GET/PUT /kiosk/production-schedule/search-state`、サービスは `apps/api/src/services/production-schedule/production-schedule-search-state.service.ts`）。どちらも上限は 50 件で、新しく足した製番が先頭に来る。

メールの取り込みは次の流れ。スケジュールは `apps/api/src/services/imports/system-csv-import-schedule-builtin-rows.ts` に組み込み行として登録し、`apps/api/src/services/imports/csv-import-scheduler.ts` が cron で動かす。件名の条件は `CsvImportSubjectPattern`、送信元は Gmail 設定の `fromEmail`、検索は件名と送信元と未読で行う。実行は `CsvImportExecutionService` から `CsvDashboardImportService.ingestTargets()` を経て、取り込み後の後処理を `CsvDashboardPostIngestService` が行う。成功したメールには処理済みラベルを付けて既読にする。ただしこの経路は添付を UTF-8 の CSV として読むので、xlsx はそのままでは読めない。xlsx を別の経路で読む手本として、設備稼働の Gmail 取込（`apps/api/src/services/machine-signal/machine-signal-gmail-ingestion.service.ts`）が添付を列挙して選び、専用の解析と保存へ渡している。xlsx の読み取りには `apps/api` が依存済みの `exceljs` を使い、手本は `apps/api/src/services/assembly/check-sheet/check-sheet-xlsx-parser.ts` の `parseCheckSheetXlsx()`。

実行の記録は `CsvImportHistory`（状態、開始と終了、`summary` Json、`errorMessage`）に残る。失敗すると既存のアラート（`csv-import-failure`）が出る。アラートはファイルアラートの取り込みから `SYSTEM_NOTICE` のスレッドになり、キオスクのフローティングチャット（Hermes）に未読として出る（`apps/api/src/services/alerts/alerts-ingestor.ts`、`apps/api/src/services/kiosk-inquiry/system-notice-sources.ts`）。今の一般アラートの本文は決まり文句なので、警告の中身を見せるには本文を組み立てる処理が要る。

## Plan of Work

### マイルストーン 1: エクセル解析器

DB にも Gmail にも触らない純粋な関数として、xlsx のバイト列とファイル名と受信日を受け取り、製番ごとの構造化した結果と警告の一覧を返す解析器を作る。新しいファイルは `apps/api/src/services/production-schedule/d-schedule-minutes/` に置く。

読み取りの手順は次のとおり。まず、名前に「日程表」を含むシートを選ぶ（無ければ先頭のシート）。セルの文字は NFKC で正規化し（全角英数字を半角にする）、前後の空白を除く。上から 30 行の中で見出し「仕様」「製番」「出図」「部品完成」「組立完」「出荷」「組立納期」「出荷日」「注文書納期」「最終部品完」「担当」「MEMO」「ANS」を探し、列を決める。カレンダーは、1〜31 の整数が最も多く並ぶ行を日の行とし、その上の行の「N月」で月を決め、列ごとに日付を割り当てる（10/30 版では V 列が 2026-10-01、CD 列が 2026-11-30）。

次に、B 列が製番の形（NFKC 後に英数字 8 文字、括弧付きなら主と別名）で、A 列が 1 の行をブロックの先頭とし、4 行を 1 ブロックとして読む。隠れた行（行の hidden、アウトラインで折りたたまれた行、オートフィルタで隠れた行）と隠れた列は読まない。ただしカレンダー列の ★ だけは隠れていても読む。

日付のセルは次の形を受け付ける。Excel の日付値、Excel のシリアル値、「2026/07/14」、「4/30」のような月日、「確定\n4/30」のように前に語が付いたもの、「10/30(X)」のように後ろに括弧の目印が付いたもの。目印は日付と分けて保存する。「無し」「-」や空欄は値なしとし、警告にしない。「※材料：4/17発注」のように ※ や「発注」を含む文はメモとして保存し、日付としては使わない。これ以外で日付として読めないものは、そのセルの警告にする。

ブロック内で各見出しの値が何行目にあるかは、全ブロックを通して候補の行（1〜4 行目）ごとに日付として読めた数を数え、最も多い行を採る。部品完成は 1 行目と決まっているので、1 行目の読めた割合が低いときは表の形が変わったとみなす。

★ は、各ブロックの 4 行のうちカレンダー列で「★」を含むセルを探す。文字が「★LSLH最終処理品」または「★LSLH処理出」で始まるものを処理出し日とし、その列の日付を使う。続く書き足し（例「（ＣＴ以外）」）はメモにする。「戻」を含む ★ は使わない。それ以外の ★ は警告にする。

### マイルストーン 2: 保存と反映

新しいテーブルを 2 つ作る。1 つは取り込み 1 回分の記録で、メール ID、件名、ファイル名、会議日（ファイル名の日付）、受信日、原本の保存先、状態、警告の一覧（Json）、この回で自動登録した製番の一覧を持つ。もう 1 つは製番ごとの最新値で、ダッシュボード ID と製番で一意にし、部品完成日、日付が最後に変わった時刻、協力会社の目印、処理出し日の一覧、メモ、MEMO 列の文字、元のセルの文字、どの取り込み回のどの行から来たか、主製番か括弧の中の製番かを持つ。括弧の中の製番も 1 行として保存し、主製番と同じ日付を持たせる。

保存は次のとおり。製番ごとに、今回の部品完成日を前回の値と比べ、変わっていれば日付と「最後に変わった時刻」を更新する。変わっていなければ時刻は変えない。ファイルに載っていない製番の行には触れない。生産日程に無い製番も保存はするが、警告に残す。製番納期、処理別納期、行の備考のテーブルは書かない。

次に、納期を決める純粋な関数を API に 1 つ置き、両ボードがそれを使う。入力は、表示の選び方（エクセルか SCAW か）、エクセルの日付と最後に変わった時刻、手入力の納期とその更新時刻、分割納期と製番ボードの個別設定、SCAW の完了予定日。SCAW を選んだときは今までと同じ結果を返す。エクセルを選んだときは、分割納期と個別設定を先に見て、無ければ手入力とエクセルのうち新しいほう、どちらも無ければ SCAW の完了予定日を返す。製番ボードは `grinding-planning-board-projection.ts:467` の親の納期の作り方をこの関数に置き換える。順位ボードは API の行の投影にエクセルの日付を加え、並べ替えの SQL 式もエクセルを選んだときは同じ順で決めるように分ける。表示の選び方は両ボードの読み取り API に `dueSource=excel|scaw` の引数で渡し、省略時は `excel` とする。

自動登録は保存のあとに行う。今回のファイルの製番（主製番と括弧の中の製番。生産日程に無いものは除く）のうち、登録製番に無いものを、製番ボードの全拠点のリストと順位ボードの共有リストへ足す。前回の取り込みで自動登録した製番のうち、今回のファイルに無いものは外す。人が手で登録した製番は、自動登録の一覧に入っていないので外さない。書き込みは既存のサービス（製番ボードは `write.ts` の製番順の更新、順位ボードは検索状態の更新）を通し、版番号の衝突（409）は読み直して 1 回だけやり直す。上限は 100 件に上げる。共有の定数 `KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX`（`packages/shared-types/src/common/production-schedule-search-limits.ts:5`）を 100 にし、50 を直接書いている箇所もこの定数に置き換える。直接書いている箇所は `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardSeibanDrawer.tsx:11`、`apps/api/src/routes/kiosk/production-schedule/grinding-planning-board.ts:119` の `fseibans` の検査、`apps/api/scripts/site-scope-merge.mjs:33`。この定数は生産スケジュール画面（`apps/web/src/pages/kiosk/ProductionSchedulePage.tsx:539`）と手動順位画面（`ProductionScheduleManualOrderPage.tsx:560`）の検索条件にも使われているので、そちらも 100 件まで入るようになる。登録製番が 100 件のときの両ボードの読み取り API の応答時間を、手元の試験データで 50 件のときと比べて確かめる。

### マイルストーン 3: Gmail 取込と通知

組み込みスケジュールに「D社日程会議議事録」の行を足し、件名の条件をそれに合わせる。実行時は、メールの添付を列挙し、拡張子が `.xlsx` で名前に「日程会議議事録」を含むものを選ぶ（最初の添付をそのまま使う `getFirstAttachment()` は使わない）。原本を保存してから解析と反映を行い、成功したら既存どおり処理済みラベルを付けて既読にする。同じメールを二度処理しないことは、この処理済みラベルと、取り込み記録のメール ID の一意制約で守る。

結果は `CsvImportHistory.summary` に、読んだ製番数、日付が変わった数、変わらなかった数、自動登録と解除の数、飛ばした数、警告の一覧を入れる。致命的な揺れのときは状態を失敗にして既存の失敗アラートを出す。警告があるときは、`SYSTEM_NOTICE` として、警告ごとに製番、セルの位置（例 N23）、元の文字を並べた本文でフローティングチャットへ送る。Slack には送らない。

### マイルストーン 4: ボード表示

両ボードのメニューに「SCAW」ボタンを置く。製番ボードは上部のツールバー、順位ボードは左側のボタン列に、既存のガントや色分けのボタンと同じ形で置く。既定はオフ（エクセルの日程）で、状態は端末ごとに localStorage に保存する（キーは既存の手本にならい、拠点と端末で分ける）。押すと読み取り API を `dueSource=scaw` で読み直し、納期の表示、並び順、ガントの位置が SCAW の日程に変わる。あわせて、協力会社の目印、処理出し日、メモを製番に付けて出す。キオスクの画面は先に動くモックを Artifact で作ってユーザーと合意し、それから実装する。補助のラベルや説明文は足さず、配置で伝える（AGENTS.md の UI の決まり）。

### マイルストーン 5: 本番での試行

デプロイの後、管理画面からスケジュールを手動で 1 回動かし、10/30 版（または最新版）のメールで結果を確かめる。

## 致命的な揺れと部分的な揺れ

次のどれかに当たれば致命的とし、何も反映せず、今の値をそのまま保つ。見出し「製番」「部品完成」のどちらかが見つからない。カレンダーの月日が決められず、★ の日付を割り当てられない。製番ブロックが 1 つも無い。部品完成の 1 行目を日付として読めたブロックが全体の 80% 未満。ファイル名からもメールの受信日からも基準の日付が取れない。致命的なときは、取込履歴が失敗になり、既存の失敗アラートがフローティングチャットに出る。メールは未読のまま残るので、担当部署に直してもらったファイルが届けば、次の実行で取り込まれる。

次のものは部分的な揺れとし、その箇所だけを飛ばして残りを取り込み、警告として通知する。日付として読めないセル。製番の形に合わない B 列の文字。生産日程に無い製番（今の例では BF4R2302）。知らない種類の ★。初めての製番で手入力の納期がある場合。

## Concrete Steps

作業ディレクトリは `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--d-schedule-excel-due-import`。

マイルストーン 1 のテストは次で走らせる。

    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/d-schedule-minutes

合成フィクスチャは `apps/api/src/services/production-schedule/d-schedule-minutes/__fixtures__/` に、テストの中で `exceljs` を使って組み立てる。5/15 版の形（データ 10 行目から、MEMO が BA〜BC）と 10/30 版の形（データ 8 行目から、MEMO が CE〜CG）の 2 種類を作り、括弧付き製番、「確定\n4/30」、「10/30(X)」、日付欄のメモ、隠れた列、隠れたカレンダーの ★、「〜戻」の ★ を入れる。

マイルストーン 2 の後は、Prisma のマイグレーションを作ってから API のテストを流す。

    pnpm --filter @raspi-system/api exec prisma migrate dev --name d_schedule_minutes
    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule

## Validation and Acceptance

解析器のテストでは、2 種類の合成ファイルから同じ製番、同じ部品完成日、同じ目印、同じ処理出し日が出ることを確かめる。見出しの「部品完成」を消したファイルは致命的、1 セルだけ「4月末」のような文字にしたファイルはそのセルだけが警告になり残りは読めることを確かめる。

保存と納期決定のテストでは、次を確かめる。前回と同じ日付なら「最後に変わった時刻」が動かない。SCAW を選ぶと今までと同じ納期になる（既存のボードのテストがそのまま通る）。エクセルを選ぶと、手入力がエクセルの変更より新しければ手入力、古ければエクセルになる。分割納期と個別設定はどちらを選んでも優先される。ファイルに無い製番は変わらない。括弧の中の製番にも同じ日付が付く。順位ボードの並び順が表示の納期と同じ順になる。

自動登録のテストでは、手で登録した製番が残ること、次のファイルに無い自動登録の製番が外れること、同じファイルを二度取り込んでも登録製番が変わらないことを確かめる。

本番の試行では、取込履歴に成功と件数が出ること、両ボードの登録製番にエクセルの製番が入ること、その納期が部品完成の 1 行目の日付になっていること、「SCAW」ボタンを押すと SCAW の日程に戻ること、BF4R2302 が警告としてフローティングチャットに出ることを見る。

2026-11-04 の Milestone 2 検証は、ローカルの `postgresql://postgres:postgres@localhost:5432/borrow_return` に限って行った。`apps/api` で `pnpm exec vitest run src/services/production-schedule src/routes/kiosk/production-schedule` は 147 files passed / 5 files skipped、898 tests passed / 54 skipped（43.49 秒）。既存の dedicated DB 限定 54 件は skip のままで、新しい保存・SQL parity テストはこの明示許可済みローカル DB で実行した。純粋関数は 2 tests 内で計 576 組の presence/timestamp ケースを検査する。`pnpm exec tsc -p tsconfig.build.json --noEmit` と対象 ESLint は exit 0。`apps/web` の `pnpm exec tsc --noEmit -p .` は exit 0、変更したページの vitest は 96 passed。shared-types の build と該当 vitest 8 件も成功した。初回の世代トークンの 1 failure は実装側で修正し、納期に関する既存の期待値は変更していない。50 を直接 assert していた上限テストだけは指定どおり 100 の境界へ変更した。

## Idempotence and Recovery

同じメールは処理済みラベルとメール ID の一意制約で二度取り込まれない。同じ内容のファイルを別のメールで送られても、前回と値が同じ製番は書かないので結果は変わらない。新しいテーブルは追加だけで、既存のテーブルの形は変えない。問題が出たときは、スケジュールを無効にすれば取り込みが止まる。既存の納期のテーブルは書かないので、表示がおかしいときは「SCAW」ボタンをオンにすれば今までの表示に戻る。全端末で戻す必要があれば、読み取り API の `dueSource` の既定値を `scaw` に変えて反映する。自動登録した製番は取り込み記録に一覧があるので、それを使って外せる。

## Artifacts and Notes

10/30 版の照合結果（本番 DB、読み取り専用）:

    main   total 71  in_schedule 70  has_board_due 0
    alias  total  2  in_schedule  2  has_board_due 0
    手入力の製番納期 全 87 件、最終更新 2026-07-28

試作の解析スクリプトは会話用の一時フォルダにあり、リポジトリには入れない。

## Interfaces and Dependencies

`apps/api/src/services/production-schedule/d-schedule-minutes/parse-d-schedule-minutes.ts` に次を定義する。

    export type DScheduleMinutesBlock = {
      seiban: string;
      aliasSeibans: string[];
      partsCompleteDate: string | null;   // YYYY-MM-DD
      outsourceMarks: string[];           // 例 ['X'], ['Y','Z']
      surfaceSendOutDates: { date: string; label: string; note: string | null }[];
      memo: string | null;
      sourceRow: number;
      rawPartsCompleteText: string | null;
    };
    export type DScheduleMinutesWarning = { code: string; seiban: string | null; cell: string | null; rawText: string | null };
    export type DScheduleMinutesParseResult =
      | { ok: true; meetingDate: string; blocks: DScheduleMinutesBlock[]; warnings: DScheduleMinutesWarning[] }
      | { ok: false; reason: string; warnings: DScheduleMinutesWarning[] };
    export async function parseDScheduleMinutesXlsx(input: { buffer: Buffer; filename: string; receivedAt: Date | null }): Promise<DScheduleMinutesParseResult>;

納期を決める関数は `apps/api/src/services/production-schedule/d-schedule-minutes/resolve-board-due-date.ts` に置く。

    export type BoardDueSource = 'excel' | 'scaw';
    export function resolveBoardDueDate(input: {
      source: BoardDueSource;
      itemOverride: string | null;        // 製番ボードの項目ごとの個別設定
      splitDueDate: string | null;
      manualDueDate: string | null;       // 行の納期（手入力・処理別納期の書き戻し）
      manualUpdatedAt: Date | null;       // 製番納期・処理別納期の更新時刻
      excelDueDate: string | null;
      excelChangedAt: Date | null;
      scawPlannedEndDate: string | null;
    }): string | null;

`apply-d-schedule-minutes.service.ts` の `applyDScheduleMinutes({ result, metadata })` は ok:true の既存解析型と `{ gmailMessageId, subject, filename, receivedAt, originalFilePath? }` を受け取り、保存後に `autoRegisterDScheduleMinutes({ runId, blocks })` を呼ぶ。新テーブルは `ProductionScheduleDScheduleMinutesImportRun` と `ProductionScheduleDScheduleMinutes`。同じ Gmail ID の SUCCESS は再適用しない。順位ボードの新しい `boardDueDate` は Date/null のレスポンスフィールドで、既存の dueDate と plannedEndDate は保持する。次の UI マイルストーンで boardDueDate を表示へ接続する。

使うライブラリは依存済みの `exceljs` だけで、新しい依存は足さない。`ProductionScheduleSeibanDueDate`、`ProductionScheduleSeibanProcessingDueDate`、`ProductionScheduleRowNote` は書かない。

## 改訂メモ

2026-11-04: 初版。2 ファイルの解析、本番照合、既存コード調査の結果から作成した。

2026-11-04: ユーザーの返事を受けて改訂した。エクセルの日付を既存の納期へ書き戻す案をやめ、「SCAW」ボタンで表示を切り替える方式にした（SCAW の日程を残すため）。登録製番への自動登録を加えた。括弧の製番は構成部品が古い製番側にあると分かったので両方使う。登録製番の上限は 100 件に上げる（同日、ユーザー決定）。

2026-11-04: マイルストーン 1 を実装。合成テストの結果、ExcelJS の非表示・結合セルの挙動、読み取りの解釈、API 全体型検査の既存阻害要因を記録した。

- 2026-11-04: 実レイアウト情報に合わせて合成 fixture と回帰テストを更新。非表示行の除外と旧表記の採用を記録し、パーサーの挙動は変更しない。

2026-11-04: Milestone 2 の保存・共通納期・read API・自動登録・上限 100 を実装し、検証結果を記録した。分割片の全体順序の条件衝突、migration の既存差分と試験 DB への誤適用・構造復元、検索 8 語制限、50/100 件の計測を明記した。

2026-11-04: Milestone 3 のGmail取込・原本保存・履歴集計・一度限りの警告通知を実装。到着曜日不定のため毎時23分を採用し、既存machine-signal経路に原本保存がない差異、集計の定義、モック/ローカルDBの検証結果を記録した。

2026-11-04: マイルストーン4を実装。合意モックの配置、比較中SCAW非表示、製番ボードの既存キー形式、専用追加情報API、両納期ソースの表示条件、検証結果とブラウザ・ガント内★の省略理由を記録した。既存のマイルストーン1〜3の未コミット変更は保持した。
