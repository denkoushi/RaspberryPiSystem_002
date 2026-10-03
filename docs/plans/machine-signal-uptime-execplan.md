# 設備稼働：信号灯センサーの日報から、機械を長く止めずに動かす手がかりを出す

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Follow `.agent/PLANS.md`.

## Purpose / Big Picture

2つの工場の加工機・ロボット・ラインには信号灯（赤・黄・緑の積層ランプ）を読むセンサーが付いていて、1台ごとに1日1ファイルの「日報CSV」を出す。毎日、件名 `AirGridFlexSignal` のメール1通に全センサー分（2026-10-01 は50ファイル）が添付されて届く。これまでこのデータは誰も見ておらず、どの機械がどれだけ止まっているかは人がCSVを開いて読むしかなかった。

この変更で、キオスクに「設備稼働」タブが加わる。開くと「全体」ページが出て、全機械×24時間のうち何%動いていたか、残りの時間がどこへ行ったか（短い停止、長い停止、動かさなかった、記録なし）、赤ランプが長い機械・細かく止まる機械・長く止まった機械の上位、直近で悪くなってきた機械が1画面で分かる。機械名を押すと「機械別」ページに移り、その機械の24時間の帯、停止の長さ別の内訳、長い停止の一覧、30日の推移が見られる。目的は稼働率の報告ではなく、リーダーと作業者が「どの機械を、どう直せば長く止めずに動かせるか」をひと目で決められることである。

管理コンソールには「設備稼働」ページが加わり、センサーごとの表示名・工場・種別・稼働予定時間・消費電力・ランプの読み替え、全体の判定しきい値、過去分の日報の一括取り込みを設定できる。

画面の見た目は `https://claude.ai/artifact/D5hRVyF26cPFExgvcSZDgM` のモックに合わせた（ユーザー承認済み）。

## Progress

- [x] (2026-10-02) 日報CSV 50件の解析、方針決定、モック作成、ユーザー承認
- [x] (2026-10-02) API: 日報の解析、共通6区分への分類、指標の計算（純関数とテスト）
- [x] (2026-10-02) DB: 4テーブルを追加する migration（外部キーなし、追加のみ）
- [x] (2026-10-02) API: 取り込み保存、設定、日別集計・推移・悪化検知、Gmail取り込みと毎時スケジューラ、ルート
- [x] (2026-10-02) Web: キオスク「設備稼働」（全体・機械別）、管理コンソール「設備稼働」、ヘッダータブ
- [x] (2026-10-02) ローカル検証: API 関連テスト 96件＋取り込み保存 5件、Web 関連テスト、lint、型検査、実DBへの migration 適用と実データ50件の取り込み、実画面の表示
- [x] (2026-10-02) PR #1637 を main へ squash merge（655b6596）、Pi5 標準デプロイ（run 20261002-055008-ba0a6b、failed=0）。本番で migration の適用、キーなしの 401、画面の 200、スケジューラの起動ログを確認（追跡セッションが読み取りで確認）
- [x] (2026-10-02) 追加（1段目）: CSV取込が取込種別 `machineSignalGmail` を受け付けて専用の取り込みへ振り分けるようにした（行はまだ足さない）。管理コンソール「設備稼働」を1画面の構成に作り直した（モック https://claude.ai/artifact/D6zvMk3pUxx4ZC2n8YKDUP、ユーザー承認）
- [x] (2026-10-02) 追加分（1段目）の PR #1651 を main へ squash merge（1d755105）、Pi5 標準デプロイ（run 20261002-092631-6805e7、failed=0）。ユーザーが本番で、管理コンソールの新しい画面と工場・種別の設定を確認
- [x] (2026-10-02) ヘッダーで選択中のグループ名が白地に白文字になる不具合を修正（PR #1646、43febc37、run 20261002-064538-8f7a11）。Mac と Pi4 での見え方の確認は 2026-10-05（ユーザー）
- [x] (2026-10-02) 追加（2段目）を実装: 起動時に CSV取込の一覧へ設備稼働の行（名前「設備稼働」、毎時47分）を足し、専用スケジューラを外した
- [ ] 2段目の PR、CI、main への統合、Pi5 デプロイ。本番の CSV取込 に「設備稼働」が毎時47分・有効で出ることを確認
- [ ] 本番で Signal 番号ごとの工場・種別を設定する（ユーザー）
- [ ] OneDrive の2024年からの過去分を管理コンソールから取り込む（ユーザー）
- [ ] 実機（キオスク）での見え方の確認（ユーザー）

## Surprises & Discoveries

- 日報は表形式ではない。1行目が `日報データ,日付,機械名`、続いて稼働時間などの集計、1時間ごとのカウント、状態ごとの合計、ランプごとの合計、最後に状態遷移ログ（開始, 終了, 秒数, 赤, 黄, 緑, …, 状態定義）が並ぶ。ログの合計は集計部と50件すべてで秒単位まで一致した。
- 状態の名前と定義はセンサーごとに違う（50件で28通り。「設備稼働」「稼働(緑点灯)」「自動運転中_ロボット動作状態」など）。共通なのはランプ列のコードだけで、1＝消灯、2＝点灯、4＝点滅、空欄＝その状態の判定に使っていない、である。
- 日報の「稼働時間」「異常時間」はセンサーごとの設定で決まり、1つの規則では再現できない（緑ランプ基準で一致するのは45件中38件）。「稼働率」の分母は全消灯の待機を除く監視時間なので、50分しか動いていない機械が95.7%になる。機械をまたいだ比較には使えない。
- 機械名は一意ではない（`MCR-A5C` が Signal5 と Signal22 にある。2工場に同じ機種がある）。ファイル名 `DailySummary_Signal<番号>_<日付>.csv` の番号だけがセンサーを識別する。
- 1日の区切りは 08:00〜翌08:00 で、日報の「カウント HH:MM」の先頭行から読める。
- 既存の汎用 Gmail CSV 取り込み（`GmailStorageProvider`）は1メールにつき最初の添付1つしか取らない。50添付のメールは `GmailApiClient` を直接使う専用の取り込みが必要だった。
- 本番デプロイには migration の「追加のみ」検査（`scripts/deploy/validate-expand-only-migrations.py`）があり、`ADD CONSTRAINT ... FOREIGN KEY` と `INSERT` は拒否される。新テーブルは `@relation` を張らずスカラ列で持つ。
- アプリ全体の multipart 上限は1リクエスト10ファイル（`apps/api/src/app.ts`）。`request.parts({ limits })` でルート単位に上書きでき、実サーバーへ60ファイルを1回で送れることを確認した。受信時にファイル名のフォルダ部分は落ちるが、日付は日報の1行目から取るので取り込みには影響しない。

## Decision Log

- Decision: 機械をまたぐ比較は、ランプ色から決める共通6区分（稼働・稼働中異常・停止・異常停止・待機・記録なし）で行う。緑が点いていれば稼働、赤が点いていれば異常。日報の稼働率は使わない。
  Rationale: 状態名はセンサーごとに違い、日報の稼働率は分母も定義も揃っていない。ランプ列のコードだけが全センサーで共通だった。
  Date/Author: 2026-10-02 / Claude（ユーザー承認）

- Decision: 区分の例外は、センサーごとに「ランプの組み合わせ→区分」の上書きとして管理コンソールで設定する。
  Rationale: 黄＋緑を「稼働中停止」と呼ぶ機械や、全点灯を「自動運転完了」と呼ぶロボットがあり、一律の規則では合わない。導入時期によりセンサーの仕様も違う。
  Date/Author: 2026-10-02 / Claude（ユーザー指示「設定できるように」）

- Decision: 稼働率の分母は24時間。稼働予定時間を設定したセンサーだけ、予定外の時間を停止に数えず「予定外」として分ける。
  Rationale: 分母を揃えないと機械同士を比べられない。一方で「止まった」と「止めた」はログから区別できないため、区別したい機械だけ予定時間を入れられるようにした。
  Date/Author: 2026-10-02 / Claude（ユーザー承認）

- Decision: 日報は1センサー×1日を1行とし、状態遷移ログは JSON 列（`[開始秒, 継続秒, 赤, 黄, 緑, 状態名index]` の配列）で持つ。指標は保存せず、読むたびに計算する。
  Rationale: しきい値・読み替え・稼働予定を後から変えても、過去分を取り込み直さずに再計算できる。行数は1日約50行で、ログを1行ずつ持つ場合（1日約7,000行）より軽い。50台×1日の集計は実DBで35msだった。
  Date/Author: 2026-10-02 / Claude

- Decision: 同じセンサー・同じ集計日の日報は上書きする。日報の原本ファイルは保存しない。
  Rationale: 再送や取り込み直しで重複させないため。解析結果は状態ごとの合計を除いてすべて保存しており、合計はログから再計算できる。
  Date/Author: 2026-10-02 / Claude

- Decision: Gmail の取り込みは、CSV取込の一覧の1行（id `machine-signal-gmail`、取込種別 `machineSignalGmail`、既定は毎時47分）へ移す。ただし2段階で行う。1段目は種別を受け付けて専用の取り込みへ振り分けるだけにし、行は足さず、専用スケジューラ（毎時47分）を残す。2段目で行を自動で足し、専用スケジューラを外す。
  Rationale: 本番で使い始めたユーザーから「CSV取込の一覧に無い」と指摘を受けた。一覧に載せれば、時刻の変更・停止・履歴をほかの取込と同じ画面で扱え、時刻の重なりにも気づける。一方、`BackupConfigLoader` は backup.json の検証に失敗すると既定の設定を返す。新しい取込種別の行を書いた直後に前の版へ戻すと、古い版は行を検証できず、CSV取込・バックアップ・Gmail 連携がすべて既定に落ちる。先に「読める版」を本番に置いてから「書く版」を出せば、どの時点で戻しても読めない行は存在しない。1段目の専用スケジューラは、一覧に設備稼働の行があれば何もしないので、2段目から1段目へ戻しても二重に取りに行くことはない。2段目を、種別を読めない版（1d755105 より前）まで戻してはならない。
  Date/Author: 2026-10-02 / Claude（ユーザー指示。段階分けは Claude）

- Decision: 過去分は、管理コンソールでフォルダを選んでアップロードする（50ファイルずつ送信）。zip は使わない。
  Rationale: OneDrive には日付フォルダごとにCSVが入っている。API に zip のライブラリは無く、フォルダ選択なら追加の依存が要らない。
  Date/Author: 2026-10-02 / Claude

- Decision: 電力は、センサーごとに稼働中・停止中の消費電力（kW）を設定した場合だけ、状態別の時間から推定して出す。
  Rationale: 日報に電力の実測値は無い。環境負荷を見たいという要望に、設定した機械だけ目安を出す形で応える。
  Date/Author: 2026-10-02 / Claude

- Decision: 「長く止まった」の上位からは、稼働が「ほぼ停止」の上限に満たない機械を外す。
  Rationale: 実データで確認したところ、ほとんど動いていない機械が上位を占め、直す対象を示せなかった。それらは「ほぼ停止」として別に出る。
  Date/Author: 2026-10-02 / Claude

- Decision: 管理コンソール「設備稼働」は、全センサーを1画面の盤に並べ、選んだ行のすぐ隣に編集を開く。複数台はチェックで選び、押した項目だけをまとめて設定する。
  Rationale: 最初の版は一覧の下に編集フォームを出す作りで、約50台を1台ずつ設定するには遠く、手数も多かった。モックの段階で「編集が選んだ場所から遠い」という指摘を受け、行の隣（保存は上端）に開く形にした。判定の設定には、条件ごとに最新の日報で何台が該当するかを出し、数字を変えた結果をその場で確かめられるようにした。
  Date/Author: 2026-10-02 / Claude（ユーザー承認）

## Outcomes & Retrospective

2026-10-02 に最初の版（PR #1637、655b6596）を本番へ反映した。同日、本番で使い始めたユーザーの指摘を受けて、管理コンソールの作り直しと CSV取込の一覧への組み込みを追加した。作り直しと組み込みの1段目（PR #1651、1d755105）は本番へ反映済み。行を足す2段目は別 PR で、統合とデプロイは未完了。

10/01 の実データでは、50台×24時間のうち稼働は30.5%、最大のロスは3時間超の停止（431時間、36%）だった。予兆（悪化の検知）は直近7日とその前の28日を比べるため、過去分を取り込むまで何も出ない。

## Context and Orientation

リポジトリは pnpm のモノレポで、API は `apps/api`（Fastify と Prisma）、画面は `apps/web`（React と Tailwind）、共有型は `packages/shared-types` にある。

用語を先に定める。「センサー」は信号灯を読む装置1台で、日報ファイル名の Signal 番号で識別する。「日報」は1センサー×1日のCSV。「集計日」は日報1行目の日付で、既定では 08:00 から翌 08:00 まで。「区分」は共通6区分のこと。「気づき」は一覧で機械に付ける短い判定（異常 多、チョコ停 多、長時間停止、ほぼ停止、記録なし、良好）。「チョコ停」は短い停止（既定で5分以下）のこと。

API 側の中心は `apps/api/src/services/machine-signal/` である。`signal-daily-report.parser.ts` が日報を解析し（行位置ではなく内容でブロックを見分け、UTF-8 で読めなければ Shift_JIS とみなす）、`signal-metrics.ts` が区分の決定と1日分の指標の計算を行う。どちらもDBに触れない純関数である。`signal-report-import.service.ts` が保存、`machine-signal-settings.service.ts` が設定、`machine-signal-insights.aggregate.ts` と `machine-signal-insights.service.ts` が画面用の集計、`machine-signal-gmail-ingestion.service.ts` が Gmail からの取り込みを担い、`machine-signal-admin.service.ts` が管理画面の上段に出す取り込みの状況を返す。定期実行は CSV取込のスケジューラ（`apps/api/src/services/imports/`）が行う。起動時に `apps/api/src/services/imports/machine-signal-import-schedule.policy.ts` が、一覧に設備稼働の行（id `machine-signal-gmail`、名前「設備稼働」、毎時47分）が無ければ足す。管理者が時刻や有効・無効を変えた行には触らない。ルートは `apps/api/src/routes/machine-signal/index.ts` で、`/api/machine-signal` 配下に置く。

DB のモデルは `apps/api/prisma/schema.prisma` の末尾にある `MachineSignalSensor`（センサーの設定。主キーは Signal 番号）、`MachineSignalDailyReport`（日報。Signal 番号と集計日で一意）、`MachineSignalSettingsConfig`（全体設定の単一行。キーは `shared`）、`MachineSignalImportRun`（取り込みの記録）の4つである。

画面側は `apps/web/src/features/machine-signal/` に部品と表示用の純関数があり、キオスクのページは `apps/web/src/pages/kiosk/KioskMachineSignalPage.tsx`（パス `/kiosk/machine-signal`）、管理コンソールのページは `apps/web/src/pages/admin/MachineSignalAdminPage.tsx`（パス `/admin/machine-signal`）である。キオスクのヘッダータブは ID `machine_signal` として `packages/shared-types/src/kiosk/kiosk-header-tab-order.ts` に登録した。

## Plan of Work

認可は2段に分けた。日別の集計と1台の推移（`GET /machine-signal/day`、`GET /machine-signal/sensors/:signalNo/trend`）は、キオスクのクライアントキーまたはログイン済みの利用者が読める。設定・センサー・取り込み・取り込み履歴・Gmail の手動確認は ADMIN または MANAGER のログインが必要である。

Gmail の取り込みは、`subject:"AirGridFlexSignal" in:inbox is:unread` で最大3通を探し、添付のCSVを1つずつ順に取って保存する。1件でも保存できたメールは既読にしてゴミ箱へ移す（既存の `GmailApiClient.trashMessage` が処理済みラベルを付ける）。1件も読めなかったメールは受信箱に残し、次回の定期実行からは飛ばす（`MachineSignalImportRun` に FAILED で残る）。管理コンソールの「Gmailを今すぐ確認」は、飛ばしたメールも読み直す。Gmail の利用枠は既存の `GmailRequestGateService` を通るので、冷却中は延期になる。

悪化の検知は、表示中の集計日を含む直近7日と、その前の28日を比べる。記録のある日が直近3日以上・比較元7日以上あるセンサーだけを対象に、連続稼働の平均が設定割合（既定30%）以上短くなった、赤ランプが増えた（1日あたり3回以上かつ設定割合以上）、短い停止が増えた（同5回以上）のいずれかで知らせる。

## Concrete Steps

作業ディレクトリはリポジトリのルート。共有パッケージを先にビルドする（しないと API の型検査が通らない）。

    pnpm -r --filter "./packages/*" build

API の関連テスト、lint、型検査。

    cd apps/api
    pnpm exec vitest run src/services/machine-signal src/routes/machine-signal src/services/gmail/__tests__/gmail-subject-reservation.policy.test.ts src/bootstrap/__tests__/start-post-listen-schedulers.test.ts src/services/kiosk/__tests__/kiosk-header-tab-order.service.test.ts
    pnpm exec eslint src/services/machine-signal src/routes/machine-signal --max-warnings=0
    pnpm exec tsc --noEmit -p tsconfig.build.json

Web の関連テスト、lint、型検査。

    cd apps/web
    pnpm exec vitest run src/features/machine-signal src/pages/kiosk/KioskMachineSignalPage.test.tsx src/pages/admin/MachineSignalAdminPage.test.tsx src/features/kiosk
    pnpm exec eslint src/features/machine-signal src/pages/kiosk/KioskMachineSignalPage.tsx src/pages/admin/MachineSignalAdminPage.tsx --max-warnings=0
    pnpm exec tsc -b

migration を空のDBへ適用して、新テーブルにスキーマとの差が無いことを見る（他のセッションと衝突しないよう、専用の名前とポートでコンテナを立てる）。

    docker run -d --name pg-machine-signal -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=borrow_return -p 55439:5432 pgvector/pgvector:pg15
    cd apps/api
    DATABASE_URL=postgresql://postgres:postgres@localhost:55439/borrow_return pnpm exec prisma migrate deploy
    docker rm -f pg-machine-signal

## Validation and Acceptance

管理コンソールの「設備稼働」で、日付フォルダ（中に `DailySummary_Signal<番号>_<日付>.csv` が並ぶ）を選ぶと、進捗が「50 / 50 件 ・ 取り込み 50 ・ 失敗 0」のように出て、センサー一覧に Signal 番号と機械名が並ぶ。同じフォルダをもう一度選んでも、日報とセンサーの件数は増えない。

キオスクの「設備稼働」タブを開くと「全体」ページが出る。2026-10-01 の50件を取り込んだ場合、稼働は30%、時間の行き先は 正常に稼働 345時間、稼働中に赤ランプ 21時間、5分以下の停止 16時間、5分〜3時間の停止 171時間、3時間超の停止 431時間、動かさなかった 95時間、記録なし 120時間で、合計は 1,200時間（50台×24時間）になる。気づきは 異常 多 12、チョコ停 多 11、長時間停止 13、ほぼ停止 5、記録なし 5、良好 2 である。機械名を押すと「機械別」に移り、その機械が選ばれている。

管理コンソールでセンサーに工場を入れると、キオスクに工場の切り替えが出る。稼働予定を 08:00〜20:00 にすると、その機械の夜間の停止は「予定外」に移る。ランプの読み替えで「赤消 黄点灯 緑点灯」を停止にすると、その機械の稼働時間が減る。

ログインなし・クライアントキーなしで `GET /api/machine-signal/day` を呼ぶと 401、クライアントキーだけで `GET /api/machine-signal/settings` を呼ぶと 401 が返る。

## Idempotence and Recovery

取り込みは何度実行しても同じ結果になる（センサー番号と集計日で上書き）。途中でDBエラーが起きたメールは既読にもゴミ箱にも移らないので、次の定期実行でやり直される。

migration は4つの新テーブルと索引を作るだけで、既存のテーブルには触れない。デプロイを巻き戻す場合、古いアプリは新テーブルを参照しないので、テーブルを残したまま動く。

汎用のCSV取り込み（管理コンソールのCSV取り込み設定や、CSVダッシュボード）に件名 `AirGridFlexSignal` に一致するパターンが登録されていると、この変更の後は登録や実行が「設備稼働ログ専用の件名です」のエラーになる。本番にそのような登録が残っていないかを、デプロイ前に確認して外す。

## Artifacts and Notes

実DB（空のDBに migration を適用し、2026-10-01 の50件を取り込んだもの）での確認結果。

    import  status PARTIAL, fileCount 51, importedCount 50, failedCount 1（日報でない memo.csv）
    reimport SUCCESS 50 / reports 50 / sensors 50
    day 2026-10-01 machines 50（集計 35ms、応答 約118KB）
    runRatio 0.305
    loss(時間) 正常 345.4 / 稼働中異常 20.6 / 短い停止 16.5 / 中間 170.6 / 長い停止 431.4 / 未始動 95.5 / 記録なし 120
    実サーバーへの一括アップロード: 60ファイルを1リクエストで受信し、50件取り込み・10件は日報でないとして記録

`prisma migrate diff` は新テーブルについて差を出さなかった（`WorkInstructionSourceVersionStep` と `photo_tool_similarity_gallery` の差は main に元からあるもの）。

## Interfaces and Dependencies

新しい依存パッケージは無い。CSV の解析は既存の `csv-parse`、文字コードの変換は既存の `iconv-lite` を使う。

`apps/api/src/services/machine-signal/signal-daily-report.parser.ts` は次を公開する。

    export function parseSignalFileName(fileName: string): { signalNo: number; reportDate: string } | null;
    export function parseSignalDailyReport(content: Buffer): ParsedSignalDailyReport;

`apps/api/src/services/machine-signal/signal-metrics.ts` は次を公開する。

    export function classifySignalLamps(red: LampCode, yellow: LampCode, green: LampCode, overrides?: SignalCategoryOverrides): SignalCategory;
    export function computeSignalDayMetrics(input: SignalDayInput, thresholds: SignalThresholds): SignalDayMetrics;
    export function decideSignalHint(metrics: SignalDayMetrics, thresholds: SignalThresholds): SignalHint;

`apps/api/src/services/machine-signal/signal-report-import.service.ts` は次を公開する。Gmail と管理コンソールのアップロードの両方がこれを呼ぶ。

    export async function importSignalReportFiles(files: SignalReportFile[], options: { source: 'GMAIL' | 'UPLOAD'; gmailMessageId?: string }): Promise<SignalReportImportSummary>;

API のルートは次のとおり（すべて `/api` 配下）。

    GET  /machine-signal/day?date=YYYY-MM-DD&site=工場名      閲覧（キオスクまたはログイン）
    GET  /machine-signal/sensors/:signalNo/trend?endDate=&days=30|90   閲覧
    GET  /machine-signal/settings        PUT /machine-signal/settings          管理
    GET  /machine-signal/sensors         PUT /machine-signal/sensors/:signalNo 管理
    GET  /machine-signal/import-runs     POST /machine-signal/import（multipart、1回200ファイルまで） 管理
    POST /machine-signal/gmail-import/run                                      管理
    GET  /machine-signal/admin/overview  PUT /machine-signal/sensors/bulk      管理
