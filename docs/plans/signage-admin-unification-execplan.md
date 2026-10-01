# Signage Admin Unification, Web Page Capture Content, and Data Boards（サイネージ管理の1画面統合・ページ撮影・データボード統合）

この ExecPlan は生きた文書である。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は作業の進行に合わせて更新し続けること。本書はリポジトリ直下の `.agent/PLANS.md` に従って維持する。

## Purpose / Big Picture

工場の Pi3（`raspberrypi-2`）などのサイネージ端末は、Pi5 の API が作った 1 枚の JPEG を約 30 秒ごとに取得して表示している。管理コンソールには、その表示を管理するページが「サイネージ（スケジュール＋PDF アップロード）」「サイネージプレビュー」「PDF」「緊急表示」と散らばっており（緊急表示はメニューにすら出ていない）、表示内容の素材を作る「可視化ダッシュボード」「CSV ダッシュボード」も別々のページで、設定の多くを JSON の手書きや二重の列設定に頼っている。

この作業が終わると、管理者は次のことができるようになる。第一に、`/admin/signage` の暗色の 1 画面で、端末ごとの放映中の画像、端末が画像を受け取れているか、週間の予定、使えるコンテンツを同時に見て、予定の追加・変更・緊急表示までをページ遷移なしで行える。第二に、管理コンソール内の既存ページ（開発中の自主検査 KPI 画面など）の URL を指定するだけで、そのページを 1920×1080 で定期撮影してサイネージのコンテンツにできる。既存ページ側にはサイネージ向けの改修を一切入れない。第三に、`/admin/data-boards` の 1 ページで、グラフ系ボード（旧 可視化ダッシュボード）と CSV の表（旧 CSV ダッシュボード）を一覧・プレビュー・設定でき、JSON を書かずにひな形から作れる。

動作確認は、ローカルの開発環境で `/admin/signage` を開き、ページ撮影コンテンツを追加して予定に置き、`GET /api/signage/current-image` の画像にそのページが写ること、および旧 URL（`/admin/signage/schedules` など）が新ページへ転送されることで行う。

見た目の正本は静的モック `docs/design-previews/signage-admin-unification/` の 7 ファイル（`Main.html`、`WebCapture.html`、`ScheduleEdit.html`、`Emergency.html`、`Boards.html`、`BoardsCsv.html`、`BoardsNew.html`）である。ユーザーは 2026-09-30 にこのモックと暗色デザインを承認した。

## Progress

- [x] (2026-09-30 06:40Z) 所見整理とユーザー合意（案A：既存ページ撮影ルート、Chat は補助入口のみ、暗色、データボード 1 ページ化）。
- [x] (2026-09-30 07:10Z) モック 7 画面を作成し、1440×900 で自己確認。`docs/design-previews/signage-admin-unification/` に配置。
- [x] (2026-09-30 07:20Z) 本 ExecPlan を作成（branch `feat/signage-admin-unification`）。
- [x] (2026-09-30 08:10Z) マイルストーン 0 前半：Web 開発サーバに対し、ログイン注入・非表示指定・1920×1080 撮影を確認（約 2.5 秒/回、Node 側メモリ増 約 25MB）。
- [x] (2026-10-01 01:10Z) マイルストーン 0 後半（判断）：撮影ユーザーは MANAGER＋読み取り専用化、到達経路は Docker 内部専用の入口、とユーザーが決定。
- [x] (2026-10-01 03:00Z) マイルストーン 1：API 実装を PR #1598（branch `feat/signage-web-capture`）で提出。実 Chromium で撮影処理を確認（ログイン注入、書き込み通信の遮断、読み込み待ち、非表示指定）。
- [ ] マイルストーン 0 後半（実測）：Pi5 実機での撮影時間とメモリの計測（#1598 のデプロイと撮影用ユーザー設定の後）。
- [ ] マイルストーン 2：API ― サイネージ概況 API（端末ごとの受信・描画・一致状況）と CSV 表のプレビュー画像 API。
- [ ] マイルストーン 3：Web ― `/admin/signage` 1 画面ハブ（暗色）と旧 4 ページからの転送。
- [ ] マイルストーン 4：Web ― `/admin/data-boards` 統合ページと旧 2 ページからの転送。
- [ ] マイルストーン 5：メニュー整理、ドキュメント更新、ローカル通し確認、CI。
- [ ] （ユーザー承認後のみ）commit、push、PR、merge、Pi5 デプロイ。

## Surprises & Discoveries

- Observation: 緊急表示ページ `/admin/signage/emergency` と PDF ページ `/admin/signage/pdfs` は `apps/web/src/layouts/AdminLayout.tsx` のメニューにリンクがなく、URL を知らないと辿り着けない。PDF アップロードはスケジュールページ先頭にも重複して置かれている。
  Evidence: `AdminLayout.tsx` のサイネージ系 NavLink は `/admin/signage/schedules` と `/admin/signage/preview` の 2 つだけ。
- Observation: 可視化ダッシュボードの編集は「データソースタイプ」「レンダラータイプ」の自由文字列と、データソース設定・レンダラー設定の JSON テキストエリアで行う。プリセットはボタン 4 個（未点検加工機、計測機器点検、吊具点検、パレット可視化）で JSON を流し込むだけである。
  Evidence: `apps/web/src/features/admin/visualization-dashboards/VisualizationDashboardEditorForm.tsx` 69〜140 行、`visualizationDashboardPresets.ts`。
- Observation: CSV ダッシュボードは「列定義（internalName、dataType、表示名、CSV ヘッダー候補、必須）」と「サイネージ表示設定（表示列の順序、列幅）」が別の表で、同じ列を 2 回扱う。
  Evidence: `CsvDashboardColumnDefinitionsTable.tsx` と `CsvDashboardTableTemplateSection.tsx`。
- Observation: 管理画面のログイン状態はブラウザの `localStorage` の `factory-auth` キーに `{ token, user, refresh, expiresAt }` の JSON として保存され、起動時に読み込まれる（「ログイン状態を保持」を選んだ場合）。撮影用ブラウザはこのキーを事前に書き込めばログイン済みで開ける見込み。
  Evidence: `apps/web/src/contexts/AuthContext.tsx` 22〜90 行。

- Observation: `localStorage` の `factory-auth` を撮影前に書き込むと、ログイン画面へ飛ばされずに管理画面を開ける。上部メニューは `page.addStyleTag` で消せる。撮影 1 回は開発サーバ相手で約 2.5 秒（ブラウザ起動 0.1〜0.2 秒、ページ表示 2.3〜2.6 秒、画像化 0.03 秒）、Node 側のメモリ増加は約 25MB。
  Evidence: scratch の試作スクリプト出力 `{"redirectedToLogin": false, "launchMs": 86, "gotoMs": 2313, "screenshotMs": 31, "totalMs": 2479}`。
- Observation: Web の画面ガード `apps/web/src/components/RequireAuth.tsx` はログイン有無しか見ないが、API は役割で分かれており、`authorizeRoles` のうち VIEWER を含むのは 29 箇所、ADMIN/MANAGER 限定は 58 箇所ある（例：`GET /api/csv-dashboards` は MANAGER 以上）。VIEWER の撮影ユーザーでは多くの管理画面がデータなしで写る。
  Evidence: `rg -c "authorizeRoles\([^)]*VIEWER" apps/api/src/routes` の合計 29、ADMIN/MANAGER 限定 58。
- Observation: 本番の Caddy は `/admin*` を `ADMIN_ALLOW_NETS` 以外から遮断し（`infrastructure/docker/Caddyfile.local.template` 30 行付近）、HTTPS は自己署名証明書、`:80` は HTTPS へ転送する。API コンテナから `web` へ普通にアクセスすると遮断される可能性が高い。
  Evidence: `docker-compose.server.yml` の web は `80:80`、`443:443` を公開し `ADMIN_ALLOW_NETS` 必須。
- Observation: `networkidle` 待ちだけでは、API が遅い・失敗する場合に「読み込み中...」のまま撮れる。右下の Hermes の丸ボタンも写り込む。
  Evidence: 試作画像で「読み込み中...」表示と右下の H ボタンが写った。
- Observation: 本番の標準リリースは Blue/Green 構成（`infrastructure/docker/docker-compose.phase3.yml`、`release_pi5` ロール）で、Web の各スロット（`web-blue`、`web-green`）は Docker 内部ネットワーク `pi5` 上で HTTP の :80 を待ち受ける（`Caddyfile.slot.template`）。ホストへ公開するのは `gateway` だけである。したがって「内部専用の入口」は既に存在し、Caddy への追加は不要だった。
  Evidence: `docker-compose.phase3.yml` の `web-blue` は `SLOT_API_UPSTREAM: api-blue:8080`、`ports` を持つのは `gateway` のみ。
- Observation: tsx / vitest（esbuild）は `page.evaluate` に渡す関数へ補助コード `__name` を差し込み、ページ側で `ReferenceError: __name is not defined` になる。本番ビルド（tsc）では起きない。ブラウザ内で実行する処理は文字列で渡すことにした。
  Evidence: scratch の実 Chromium 確認で `page.evaluate: ReferenceError: __name is not defined`、文字列化後は成功（撮影 約 1.0 秒）。

## Decision Log

- Decision: 既存ページをサイネージに載せる方法は「Pi5 の API 内のヘッドレス Chromium（Playwright）で URL を開いて撮影し、JPEG をサイネージの 1 コンテンツとして扱う」方式にする。既存ページには一切手を入れない。
  Rationale: Pi5 の API にはすでに Playwright と共有 Chromium（`apps/api/src/services/signage/loan-grid/playwright/playwright-browser-pool.js` の `getSharedChromium`）があり、Pi3 は JPEG を表示するだけの現行方式を変えずに済む。Grafana 等の OSS 可視化ツールは KPI 画面を自作中のため二重管理になり、OSS サイネージ製品への乗り換えは現行の配信・端末管理を捨てることになるので採らない。
  Date/Author: 2026-09-30 / Claude（ユーザー合意済み）
- Decision: Chat からコンテンツを作る経路（A2UI、`apps/api/src/services/signage/signage-a2ui*.ts`）は機能を変えず、新ハブの「Chatで作る」ボタンから既存の `HermesFloatingChat` を開く入口だけを置く。
  Rationale: 精度確認の手間が大きく、当面は補助の位置づけとユーザーが合意した。
  Date/Author: 2026-09-30 / Claude（ユーザー合意済み）
- Decision: 新しい管理画面 2 ページはページ単位で暗色にする（管理コンソール全体の配色は変えない）。
  Rationale: ユーザーが暗色を選択。コンソール全体の配色変更は範囲外。
  Date/Author: 2026-09-30 / ユーザー
- Decision: 可視化ダッシュボードと CSV ダッシュボードは「データボード」1 ページに統合するが、DB モデル（`VisualizationDashboard`、`CsvDashboard`）と既存 API は変更しない。統合は画面側だけで行う。
  Rationale: 両モデルはサイネージ以外（キオスク等）でも使われ、API 変更は影響範囲が広い。画面統合だけで UX 課題は解ける。
  Date/Author: 2026-09-30 / Claude（ユーザー合意済み「今の場所に残してよいが UI/UX は直す、2 ページを 1 ページに」）
- Decision: ページ撮影の対象 URL は、同じ管理 Web のパス（`/` で始まる相対パス）に限定する。撮影時の起点 URL は新しい環境変数 `SIGNAGE_WEB_CAPTURE_BASE_URL` で与える。外部 URL、`//` 始まり、スキーム付きは保存時に拒否する。
  Rationale: 任意 URL を API サーバーから開けると、社内ネットワークの他サービスへ API 経由でアクセスさせる穴（SSRF：サーバー側リクエスト偽造）になる。用途は既存の管理画面の撮影だけである。
  Date/Author: 2026-09-30 / Claude
- Decision: 撮影時のログインは、実在する撮影専用ユーザー（role `MANAGER`）を環境変数 `SIGNAGE_WEB_CAPTURE_USERNAME` で指定し、撮影のたびに API 内で `signAccessToken`（`apps/api/src/lib/auth.ts`）により短命トークンを作って `localStorage` の `factory-auth` に注入する。パスワードは保存しない。撮影ブラウザでは `page.route` により GET・HEAD・OPTIONS 以外のリクエスト（保存・削除など）をすべて中断し、読み取り専用にする。ユーザーが見つからない、または役割が `MANAGER` でない（`ADMIN` も不可）なら撮影を失敗扱いにし、理由を管理画面に出す。
  Rationale: マイルストーン 0 で、API の約 3 分の 2 が ADMIN/MANAGER 限定で、VIEWER では多くの管理画面がデータなしで写ると分かった。ユーザーは 2026-10-01 に「管理者権限＋閲覧だけに制限」を選んだ。トークンは API プロセスの外へ出ず、書き込み系の通信をブラウザ側で止めるので、撮影経路から設定が変わることはない。ADMIN を不可にするのは必要以上の権限を避けるため。
  Date/Author: 2026-10-01 / ユーザー決定、Claude 記録
- Decision: 撮影ブラウザから管理 Web へは、Blue/Green の同じ色の Web スロットの内部入口を使う。`docker-compose.phase3.yml` で `api-blue` に `SIGNAGE_WEB_CAPTURE_BASE_URL=http://web-blue`、`api-green` に `http://web-green` を設定する。Caddy、公開ポート、`ADMIN_ALLOW_NETS` は変更しない。旧構成（`docker-compose.server.yml`）には設定せず、そこでは撮影は「未設定」で無効になる。
  Rationale: ユーザーは 2026-10-01 に「サーバ内部だけの入口を使う」を選んだ。調べると Web スロットは最初から内部ネットワーク専用の HTTP 入口だったため、新しい入口（当初案のポート 8081）を足す必要がなく、より小さい変更で同じ目的を満たせる。同じ色同士にするのは、画面と API の版を揃えるため。
  Date/Author: 2026-10-01 / ユーザー決定、Claude 記録・具体化
- Decision: `web_page` スロットは FULL のみとし、SPLIT（左右分割）は受け付けない。
  Rationale: 1920×1080 で撮ったページを半分の幅に縮めると読めない。既存の JPEG 系コンテンツ（キオスク進捗など）と同じ扱いにする。
  Date/Author: 2026-10-01 / Claude
- Decision: 定期撮影は独立したジョブにせず、既存のサイネージ描画スケジューラの「描画の直前」に同じ排他区間で実行する（`SignageRenderScheduler` の `preRenderTask`）。
  Rationale: 描画は本番では別プロセス（worker）で動き、デプロイ時の一時停止や重複実行の防止がすでに組み込まれている。同じ場所で実行すれば、それらをそのまま使え、Chromium も worker 側の 1 つを共有できる。
  Date/Author: 2026-10-01 / Claude
- Decision: 撮影は「通信が落ち着く」に加えて「画面に『読み込み中』の文字が 1 つもない」ことを最大 20 秒待つ。既定で Hermes の丸ボタン（`HermesFloatingChat` のルート要素）を隠す。
  Rationale: マイルストーン 0 で、データ未取得の画面やボタンが写り込むことを確認したため。
  Date/Author: 2026-09-30 / Claude
- Decision: 予定の追加は、まず「コンテンツを選んで『予定に置く』を押すと編集パネルが開く」方式で実装する。タイムラインへのドラッグ＆ドロップは後続とする。
  Rationale: ドラッグは見栄えは良いが、キーボード操作と誤操作防止の実装コストが高い。モックの「ドラッグしてタイムラインに置く」の文言は「選んで予定に置く」へ置き換える。
  Date/Author: 2026-09-30 / Claude
- Decision: 「プレビューと実機が一致」の判定は、API が `current-image` を端末へ返したときの描画 ID（またはファイルの更新時刻）を端末キーごとにメモリに記録し、最新描画と比べて行う。DB には保存しない。
  Rationale: 追加の DB 変更なしに「端末が最新の画像を受け取ったか」を示せる。API 再起動で記録は消えるが、30 秒以内に再取得で回復するので実害はない。
  Date/Author: 2026-09-30 / Claude

## Outcomes & Retrospective

（未着手。各マイルストーン完了時に記入する。）

## Context and Orientation

このリポジトリは pnpm のモノレポで、API は `apps/api`（Fastify、Prisma、PostgreSQL）、管理コンソールとキオスクの画面は `apps/web`（React、Vite、Tailwind、TanStack Query）にある。本番では Pi5 の Docker で `api` と `web` が動き、Caddy が前段にいる（`infrastructure/docker/docker-compose.server.yml`）。

サイネージの仕組みは次のとおりである。管理者は「スケジュール」（Prisma モデル `SignageSchedule`、`apps/api/prisma/schema.prisma` 1240 行付近）を作る。スケジュールは曜日（`dayOfWeek`）、開始・終了時刻（`startTime`、`endTime`、文字列 "HH:MM"）、優先度（`priority`）、対象端末（`targetClientKeys`、空なら全端末）、そしてレイアウト設定（`layoutConfig`、JSON）を持つ。レイアウト設定は `layout`（`FULL` 全面、`SPLIT` 左右分割、ほかにキャンバス用 `CANVAS`）と `slots` の配列で、各スロットは `kind`（表示するものの種類）と `config` を持つ。種類は `apps/api/src/services/signage/signage-layout.types.ts` の `SignageSlotKind` に列挙され（`pdf`、`loans`、`csv_dashboard`、`visualization`、`kiosk_progress_overview`、`kiosk_leader_order_cards`、`mobile_placement_parts_shelf_grid`、`self_inspection_machine_board`）、保存時の入力検証は `apps/api/src/routes/signage/schemas.ts` の zod スキーマで行う。

API のスケジューラ（`apps/api/src/services/signage/signage-render-scheduler.ts`、既定 30 秒ごと、環境変数 `SIGNAGE_RENDER_INTERVAL_SECONDS`）が、端末ごとに今有効なスケジュールを選び、`apps/api/src/services/signage/signage.renderer.ts` で 1920×1080 の JPEG を作る。`FULL` の場合は 300 行付近の `if (slot.kind === ...)` の連鎖で種類ごとの描画関数を呼ぶ。端末は `GET /api/signage/current-image`（`apps/api/src/routes/signage/render.ts`）でその JPEG を取得する。緊急表示は `SignageEmergency` モデルで、有効な間はスケジュールより優先される。

Playwright（ヘッドレス Chromium を操作するライブラリ）は API にすでに導入済みで、貸出グリッドの HTML 描画（`apps/api/src/services/signage/loan-grid/playwright/playwright-loan-grid-rasterizer.ts`）やキオスク文書の PDF 化で使っている。共有ブラウザは `getSharedChromium()` で得られ、使用可否は `probePlaywrightChromiumAvailability()`（同ディレクトリ `playwright-chromium-availability.ts`）で確認できる。Docker イメージに Chromium を入れるかはビルド引数 `INSTALL_PLAYWRIGHT_CHROMIUM` で決まる。

管理画面側は、ルーティングが `apps/web/src/App.tsx`（395 行付近に `signage` 配下 4 ルート、382 行付近に `visualization-dashboards`、376 行付近に `csv-dashboards`）、メニューが `apps/web/src/layouts/AdminLayout.tsx` にある。サイネージのスケジュール編集は `apps/web/src/features/admin/signage/`（`useSignageScheduleEditor.ts` がデータ取得と保存、`SignageScheduleEditorForm.tsx` がフォーム、`signageLayoutConfigModel.ts` がレイアウト設定の組み立て、`SelfInspectionMachineBoardFields.tsx` などが種類別の入力欄）、PDF は `apps/web/src/components/signage/SignagePdfManager.tsx`、端末選択は `SignageTargetClientsField.tsx`、プレビューは `apps/web/src/pages/admin/SignagePreviewPage.tsx`、緊急表示は `SignageEmergencyPage.tsx`、Chat 経路の画面は `apps/web/src/components/hermes/HermesFloatingChat.tsx` と `HermesChatPanel.tsx` にある。可視化ダッシュボードは `apps/web/src/features/admin/visualization-dashboards/`、CSV ダッシュボードは `apps/web/src/features/admin/csv-dashboards/` に、それぞれ編集用フック（`useVisualizationDashboardEditor.ts`、`useCsvDashboardEditor.ts`）とフォーム部品がある。API は可視化が `apps/api/src/routes/signage/visualization-image.ts`（画像）ほか、CSV が `apps/api/src/routes/csv-dashboards/index.ts`（一覧、取得、作成、更新、削除、アップロード、`preview-parse`）である。

用語を定義する。「ページ撮影コンテンツ」とは、管理 Web のあるページを API 内のヘッドレス Chromium で開いて撮った画像を、サイネージのスロットに置けるようにしたものを指す。「ハブ」とは本計画で作る `/admin/signage` の 1 画面を指す。「データボード」とは、グラフ系ボード（`VisualizationDashboard`）と CSV の表（`CsvDashboard`）をまとめて呼ぶ画面上の呼び名で、DB や API の名前は変えない。

権限は API 側で `authorizeRoles('ADMIN', 'MANAGER')` が管理操作、`VIEWER` を含むものが閲覧である（`apps/api/src/lib/auth.ts`）。

## Plan of Work

作業は、リスクの高い撮影の実現性確認から始め、API、画面の順に進める。各マイルストーンは単独で検証できるようにする。

### マイルストーン 0：ページ撮影の実現性プロトタイプ

目的は、API コンテナから管理 Web のページを、ログイン済みの状態で 1920×1080 撮影できるかを確かめることである。ここで失敗が見つかれば方式を変えるので、本実装より先に行う。

`apps/api/src/services/signage/web-capture/` を新設し、まず試作関数 `captureAdminPage({ baseUrl, path, token, viewport })` を作る。処理は、`getSharedChromium()` で得たブラウザから `newContext({ viewport })` を作り、`context.addInitScript` で `localStorage.setItem('factory-auth', JSON.stringify({ token, user, expiresAt }))` を事前に書き込み、`page.goto(baseUrl + path, { waitUntil: 'networkidle', timeout: 20000 })` で開き、`page.screenshot({ type: 'jpeg', quality: 85 })` を返す。`user` には `{ id, username, role }` を入れる（`AuthContext` が読む形）。

ローカルでは `infrastructure/docker/docker-compose.mac-local.override.yml` を使った開発環境、または `pnpm --filter @raspi-system/api dev` と `pnpm --filter @raspi-system/web dev` で起動し、試作用の一時スクリプト（コミットしない。scratch に置く）から `/admin/visualization-dashboards` などを撮影する。確認することは 4 点である。撮影ユーザーのトークンで対象ページが表示されるか（ログイン画面に飛ばされないか）。`networkidle` 待ちでグラフが描き終わった状態が撮れるか。1 回の撮影にかかる時間。撮影中の API プロセスのメモリ増加量。Pi5 実機での計測はデプロイ後のマイルストーン 5 で行い、ここでは Mac 上の値を記録する。

同時に、API コンテナから Web へ届く URL を決める。`docker-compose.server.yml` の `web` サービス名で内部から届くか（例 `http://web:80`）、Caddy 経由にする必要があるかを確認し、`SIGNAGE_WEB_CAPTURE_BASE_URL` の既定値を Decision Log に記録する。

受け入れ条件は、試作スクリプトが 1920×1080 の JPEG を保存し、画像にログイン後のページ内容が写っていることである。結果（所要時間、メモリ、VIEWER での可否）を `Surprises & Discoveries` に記録する。VIEWER で見られないページがあれば、その扱い（役割を MANAGER にするか、そのページを対象外にするか）をユーザーに確認する。

### マイルストーン 1：API ― ページ撮影コンテンツ

DB に新モデル `SignageWebCapture` を追加する。フィールドは `id`（uuid）、`name`、`path`（`/` 始まりの相対パス）、`viewportWidth`（既定 1920）、`viewportHeight`（既定 1080）、`waitMode`（`network_idle` または `fixed_delay`）、`waitSeconds`（既定 3）、`hideSelectors`（文字列配列。撮影前に `display:none` にする CSS セレクタ）、`clipSelector`（任意。指定時はその要素の範囲だけを切り出す）、`refreshIntervalSeconds`（60、300、900 のいずれか。既定 300）、`enabled`、`lastCapturedAt`、`lastStatus`（`success`、`failed`、`never`）、`lastError`、`lastDurationMs`、`imagePath`、`createdAt`、`updatedAt` とする。マイグレーションは追加のみで、既存テーブルに触れない。コマンドは `apps/api` で `pnpm prisma migrate dev --name signage_web_capture` とする。

撮影サービス `SignageWebCaptureService`（`apps/api/src/services/signage/web-capture/signage-web-capture.service.ts`）を作る。責務は、パスの検証（`/` で始まり、`//` で始まらず、`:` を含まない。`new URL(path, baseUrl).origin === new URL(baseUrl).origin` を必ず確認）、撮影用トークンの発行（`SIGNAGE_WEB_CAPTURE_USERNAME` のユーザーを DB から引き、役割が `MANAGER` であることを確認して `signAccessToken`）、撮影（マイルストーン 0 の関数に `hideSelectors` の `page.addStyleTag`、`waitMode`、`clipSelector` を加える）、画像保存（既存の `signage-rendered-storage` ボリューム配下に `web-captures/<id>.jpg` として保存）、結果の記録（`last*` フィールド）である。撮影は同時に 1 件だけ実行するよう、サービス内に直列キューを持つ。Pi5 の負荷を抑えるためである。

プレビュー用に、撮影時に画面上の主要な領域の候補も返す。`header`、`nav`、`aside`、`[role=banner]`、`[role=navigation]`、`[role=complementary]`、`main`、見出しを持つ `section` について、`getBoundingClientRect()` と一意なセレクタ（id があれば `#id`、なければタグ名と `nth-of-type` の組み合わせ）を集める。画面のプレビュー上でこれらの枠をクリックすると `hideSelectors` に加わる（モック `WebCapture.html` の「＋ プレビューで選ぶ」）。

定期撮影は、既存のサイネージ描画スケジューラの描画直前に実行する（Decision Log 参照）。有効なスケジュールまたは緊急表示から参照されている `SignageWebCapture` だけを対象にし、`lastCapturedAt + refreshIntervalSeconds` を過ぎたものを撮る。参照されていない撮影コンテンツは定期撮影しない。

スロット種別 `web_page` を追加する。`signage-layout.types.ts` に `WebPageSlotConfig { webCaptureId: string }` を加え、`SignageSlotKind` と `SignageSlot['config']` の共用体に足す。`schemas.ts` に `kind: z.literal('web_page')`、`config: z.object({ webCaptureId: z.string().uuid() })` を加える（位置は `FULL`、`LEFT`、`RIGHT` を許可）。`signage.renderer.ts` の `FULL` 分岐に `web_page` を足し、保存済み画像があればそれを 1920×1080 に収めて返し、なければ `renderMessage('ページ撮影待ち')` を返す。`SPLIT` には対応しない（Decision Log 参照）。`signage-pane-resolver.ts` にも種類を追加する。

管理 API は `apps/api/src/routes/signage/web-captures.ts` に置き、`apps/api/src/routes/signage/index.ts` に登録する。`GET /api/signage/web-captures`（一覧、閲覧権限）、`POST`（作成、管理権限）、`PUT /:id`、`DELETE /:id`（スケジュールから参照中なら 409 を返し、参照している予定名を本文に入れる）、`POST /:id/capture`（今すぐ撮影し、画像の URL と領域候補を返す。管理権限）、`POST /capture-preview`（保存前の設定で撮影してプレビューを返す。管理権限）、`GET /:id/image`（最新画像。閲覧権限）を作る。

テストは `apps/api/src/services/signage/web-capture/__tests__/` に置く。パス検証（外部 URL、`//evil`、`javascript:`、`/admin/..%2f` の拒否と、`/admin/self-inspection/kpi` の許可）、撮影ユーザーが MANAGER でないときの拒否、GET 以外のリクエストの中断、直列キュー、定期撮影の対象選別（参照あり・期限切れのみ）を単体テストにする。Playwright 本体は差し替え可能な関数として注入し、テストではダミーを使う。スキーマの `web_page` 受理と不正 config の拒否は既存の `schemas` テストに追加する。レンダラーの `web_page` 分岐は画像あり・なしの 2 通りをテストする。

受け入れ条件は、ローカルで撮影コンテンツを作成し、`web_page` スロットのスケジュールを保存すると、次の描画周期以降に `GET /api/signage/current-image` の画像にそのページが写ることである。

### マイルストーン 2：API ― サイネージ概況と CSV 表プレビュー

ハブ画面の左列と「配信チェック」のために、読み取り専用の `GET /api/signage/management/overview`（管理権限）を作る。返す内容は、サイネージ対象の端末ごとに、名前、`apiKey`、最終通信時刻（`ClientDevice.lastSeenAt` と `ClientStatus.lastSeen`、`apps/api/prisma/schema.prisma` の各モデル）、今有効なスケジュール ID と名前、次に切り替わる時刻とスケジュール名、最終描画時刻と所要時間と成否、端末が最後に受け取った描画 ID と最新描画 ID が一致しているか、使っているページ撮影コンテンツの最終撮影結果である。端末が受け取った描画 ID は、`current-image` の応答時に端末キーごとにメモリの `Map` に記録する（Decision Log 参照）。緊急表示の状態（有効か、期限、内容の要約）も同じ応答に含める。

データボード画面のために、CSV 表のプレビュー画像 `GET /api/signage/preview/csv-dashboard/:id`（管理権限）を作る。中身は `signage.renderer.ts` の `renderCsvDashboard` をそのまま使い、サイネージに映る姿と同じ画像を返す。可視化ボードは既存の `visualization-image.ts` を使う。

テストは、overview の組み立てをサービス層の純関数に切り出して、端末 0 台、応答なし端末、緊急表示中、一致・不一致の各ケースを検証する。

### マイルストーン 3：Web ― `/admin/signage` ハブ

`apps/web/src/features/admin/signage-hub/` を新設し、ページ `apps/web/src/pages/admin/SignageHubPage.tsx` を作る。画面の骨組みはモック `Main.html` のとおり、上に見出し行（ページ名、端末数・本日の枠数・最終描画時刻、「緊急表示」「今すぐ再描画」ボタン）、その下に 3 列（左 264px 端末、中央 放映中プレビューと週間スケジュール、右 384px コンテンツ一覧または編集パネル）を置き、1440×900 でスクロールなしに収める。これより狭い画面では右列を下に回し、縦スクロールを許す。

暗色はページの最上位要素に `data-theme="signage-dark"` を付け、その配下だけに効く CSS 変数（背景 `#0B0C0E`、面 `#14161A`、線 `#23262C`、文字 `#EDEEF0`、補助文字 `#A3A9B1`、アクセント `#FF6A2B`、種類色 ページ撮影 `#C8F26A`・データ `#FF9A5C`・PDF `#7DB2FF`・Chat `#C3A4FF`、緊急 `#FF4D4D`）を定義する。管理コンソールの共通ヘッダーは変えない。書体は IBM Plex Sans JP と IBM Plex Mono を使う予定だが、本番がオフラインの場合に備え、Google Fonts ではなく `@fontsource` パッケージで同梱できるかを確認し、同梱できなければ既存の書体にフォールバックする（Decision Log に記録）。

部品は次のとおり作る。`ScreensColumn`（overview API の端末カード。選択中の端末は大きなサムネイル、応答なし端末は破線枠）。`DeliveryCheckCard`（配信チェック）。`OnAirPreview`（選択端末の `current-image` 画像。既存 `SignagePreviewPage.tsx` の端末別取得処理を関数に切り出して再利用）。`WeekTimeline`（週間スケジュール）。`ContentLibrary`（コンテンツ一覧と、ページ撮影・PDF・Chat の 3 つの追加タイル）。右列の中身を切り替える `InspectorPanel`（`library`、`schedule-edit`、`web-capture`、`pdf-upload`、`emergency` の 5 状態）。

`WeekTimeline` の描画は純関数 `buildWeekTimelineBlocks(schedules, clientKey)` に切り出す。入力はスケジュール一覧と選択端末のキーで、出力は曜日（月〜日）ごとの枠（開始分、終了分、スケジュール ID、表示名、種類色、優先度、重なり時にどちらが勝つか）である。表示範囲は 6:00〜22:00 を既定とし、範囲外の予定がある場合は範囲を広げる。対象端末が空（全端末向け）のスケジュールも含める。現在時刻の縦線と、今日の過ぎた枠の減光もここで計算する。この関数には単体テストを付ける（曜日またがりなし前提、重なりと優先度、全端末向けの扱い、範囲外時刻）。

予定の編集パネル（モック `ScheduleEdit.html`）は、既存の `useSignageScheduleEditor.ts` と `signageLayoutConfigModel.ts` を再利用し、見た目だけを作り直す。「表示するもの」を押すと種類と個別設定の選択に切り替わり、その中で既存の種類別入力欄（キオスク進捗の `deviceScopeKey` など、`SignageScheduleEditorForm.tsx` 内の各分岐と `SelfInspectionMachineBoardFields.tsx`）をそのまま使う。既存の設定項目を一つも失わないこと。旧形式（`contentType` の `TOOLS`、`PDF`、`SPLIT`）のスケジュールは、開いたときに `layoutConfig` 形式へ変換して表示する（既存フォームの「新形式レイアウトを使用」を廃止し、常に新形式で保存する）。この変換が既存の保存結果と同じになることを、`signageLayoutConfigModel.test.ts` にケースを追加して確認する。

ページ撮影の追加パネル（モック `WebCapture.html`）は、マイルストーン 1 の API を使う。「撮り直す」で `POST /capture-preview` を呼び、中央のプレビューに結果と領域候補の枠を重ねる。枠をクリックすると隠す部分に加わる。保存後は「予定に置く」で予定の編集パネルを開き、表示するものに今作った撮影コンテンツを入れておく。撮るページの候補チップには、管理コンソールの主要な閲覧ページのパスを固定で並べる。

PDF の追加パネルは `SignagePdfManager.tsx` のアップロード処理を再利用する。緊急表示パネル（モック `Emergency.html`）は `SignageEmergencyPage.tsx` の取得・保存処理を再利用し、緊急表示中はページ上部に赤い帯を出す。定型文チップは画面側の固定リスト（避難指示、立入禁止、設備停止）とする。「Chatで作る」は既存の `HermesFloatingChat` を開くだけである。

ルートは `App.tsx` の `signage` 配下を `index` に `SignageHubPage` を置く形に変え、`schedules`、`preview`、`pdfs`、`emergency` は `Navigate` で `/admin/signage` へ転送する（`emergency` は `?panel=emergency`、`pdfs` は `?panel=pdf-upload` を付けて該当パネルを開く）。旧ページのファイルは転送が動くことを確認した後に削除する。キオスクの `KioskSignagePreviewModal.tsx` は変更しない。

テストは、`buildWeekTimelineBlocks` の単体テスト、`InspectorPanel` の状態遷移（コンテンツ選択 → 予定に置く → 保存）の React Testing Library テスト、旧 URL の転送テスト（`App` のルーティング）を追加する。既存の `SignagePreviewPage.test.tsx` と `SignageScheduleEditorForm.test.tsx` の検証内容は、新部品のテストへ移してから旧ファイルを削除する。

### マイルストーン 4：Web ― `/admin/data-boards`

`apps/web/src/features/admin/data-boards/` を新設し、ページ `DataBoardsPage.tsx` を作る。骨組みはモック `Boards.html` のとおり、左 288px に一覧（検索、すべて・グラフ・表の切り替え、各行にサムネイル、種類ラベル、サイネージでの使用枠数または取り込み状態）、中央にサイネージでの見え方のプレビューと「使われている場所」「元データ」（CSV 表なら「取り込み履歴」）、右 392px に設定を置く。暗色はマイルストーン 3 と同じ変数を使う。

グラフ系ボードの設定は、既存の `useVisualizationDashboardEditor.ts` と `visualizationDashboardFormModel.ts` を使う。「見せ方」はひな形（`visualizationDashboardPresets.ts` の 4 種と「ひな形なし」）から選び、ひな形ごとに JSON の中の主要キーを通常の入力欄として出す。どのキーを出すかは各ひな形の既定 JSON を読んで決め、フォームモデルに「ひな形 → 入力欄定義」の表として持たせる。入力欄にないキーは JSON のまま保持し、「詳しい設定（JSON）」を開くと全体を編集できる。フォームと JSON の往復で値が失われないことを `visualizationDashboardFormModel.test.ts` に追加して確認する。未点検加工機のひな形が CSV 表を元データに使う点（`UninspectedCsvDashboardPicker.tsx`）は「元データ（表）」の選択欄として出す。

CSV 表の設定は `useCsvDashboardEditor.ts` と `csvDashboardFormModel.ts` を使い、右パネルを「取り込み」「列」「見た目」の 3 つのタブに分ける。「列」タブでは、列定義（表示名、CSV の見出し候補、型、必須）と表示列（表示の有無、順序、幅）を 1 つのリストにまとめる。1 行が 1 列で、並べ替えは上下ボタン（キーボード操作可能）とする。保存時は従来どおり `columnDefinitions` と表示設定の 2 つの構造に書き分ける純関数を `csvDashboardFormModel.ts` に追加し、既存データを読み込んで保存し直しても内容が変わらないことをテストで確認する。最新の取り込み結果で見出しが見つからなかった列には、その行に警告を出す。「取り込み」タブには Gmail 件名パターンと手動アップロード、「見た目」タブには表示期間、日付列、ゼロ件時の文言、文字サイズ、1 ページの行数を置く。

「新しいボード」はモック `BoardsNew.html` のダイアログで、ひな形の絵を選んで作成する。「使われている場所」は、スケジュール一覧を取得し、`layoutConfig` の各スロットがそのボードの ID を参照しているかを画面側で数える純関数で出す（テストを付ける）。

ルートは `data-boards` を追加し、`visualization-dashboards` と `csv-dashboards` は `Navigate` で `/admin/data-boards` へ転送する（`?type=graph`、`?type=table` を付ける）。旧ページファイルは転送確認後に削除する。

### マイルストーン 5：メニュー、ドキュメント、通し確認

`AdminLayout.tsx` のメニューから「可視化ダッシュボード」「サイネージプレビュー」を外し、「データボード」「サイネージ」の 2 つにする。

ドキュメントは、サイネージの正本 `docs/modules/signage/README.md` に新ハブ、ページ撮影コンテンツ、新しい環境変数（`SIGNAGE_WEB_CAPTURE_BASE_URL`、`SIGNAGE_WEB_CAPTURE_USERNAME`）、旧 URL の転送を追記する。KB は `docs/knowledge-base/infrastructure/signage.md` に 1 件追加する。環境変数は `apps/api/src/config/env/signage.ts` に定義し、`infrastructure/docker/docker-compose.server.yml` と Ansible の API 環境変数テンプレート（`rg -n SIGNAGE_LOAN_GRID_ENGINE infrastructure/ansible` で場所を特定）に配線する。撮影用 MANAGER ユーザーの作成手順（管理画面のユーザー管理から作る）を README に書く。ユーザーが未設定でも API は起動し、撮影だけが「撮影用ユーザー未設定」で失敗する設計にする。

最後にローカルで通し確認を行う（Validation and Acceptance 参照）。

## Concrete Steps

作業ディレクトリはすべて `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--signage-admin-unification` とする。

依存を入れる。

    pnpm install

API の対象テスト、型、lint を実行する。

    pnpm --filter @raspi-system/api exec vitest run src/services/signage src/routes/signage
    pnpm --filter @raspi-system/api exec tsc -p tsconfig.json --noEmit
    pnpm --filter @raspi-system/api lint

Web の対象テスト、型、lint を実行する。

    pnpm --filter @raspi-system/web exec vitest run src/features/admin src/pages/admin
    pnpm --filter @raspi-system/web exec tsc -b
    pnpm --filter @raspi-system/web lint

Prisma マイグレーションを作る（マイルストーン 1）。

    cd apps/api && pnpm prisma migrate dev --name signage_web_capture

期待する結果は、すべてのテストが成功し、型エラーと lint エラーが 0 件であることである。失敗した場合は、`.cursor/rules/10-quality-ci-and-tests.mdc` の再実行上限と停止条件に従う。

## Validation and Acceptance

ローカル環境で API と Web を起動し、ADMIN ユーザーでログインして次を確認する。

`/admin/signage` を開くと、1440×900 のウィンドウでスクロールせずに、端末一覧、放映中の画像、週間スケジュール、コンテンツ一覧が見える。旧 URL `/admin/signage/schedules`、`/admin/signage/preview`、`/admin/signage/pdfs`、`/admin/signage/emergency` を開くと `/admin/signage` に転送され、`emergency` と `pdfs` では該当パネルが開いている。

「ページ撮影」タイルから `/admin/data-boards` を撮るコンテンツを作ると、プレビューに管理画面が写り、上部メニューを隠す指定をすると撮り直した画像からメニューが消える。保存して「予定に置く」から今の時間帯を含む予定を作り、保存後 1 分以内に放映中プレビューと `GET /api/signage/current-image?key=<端末キー>` の画像がそのページになる。

緊急表示を有効にすると赤い帯が出て、放映中プレビューが緊急メッセージになり、解除すると元に戻る。

`/admin/data-boards` で、グラフ系ボードを選ぶとサイネージでの見え方と「使われている場所」が出る。ひな形から新しいボードを作り、JSON を書かずに保存できる。CSV 表では、列の表示の切り替えと並べ替えを 1 つのリストで行え、保存後に再読み込みしても設定が保たれ、サイネージの画像に反映される。旧 URL `/admin/visualization-dashboards` と `/admin/csv-dashboards` は `/admin/data-boards` に転送される。

既存の種類（持出一覧、PDF、CSV、可視化、キオスク進捗、順位ボード、配膳部品棚、自主検査ボード）のスケジュールを新画面で開いて保存し直しても、`GET /api/signage/schedules/management` で見た `layoutConfig` が保存前と同じであること（差分なし）を、少なくとも各種類 1 件で確認する。

## Idempotence and Recovery

DB 変更はテーブル追加だけで、既存データを変えない。マイグレーションを戻す必要がある場合は、`SignageWebCapture` を参照するスケジュールを先に削除してからテーブルを削除する。旧ページは転送を確認するまでファイルを残し、問題があればルート定義を戻すだけで旧画面に戻せる。撮影機能は `SIGNAGE_WEB_CAPTURE_USERNAME` を未設定にすれば止まり、他のサイネージ描画には影響しない。撮影に失敗したコンテンツは「ページ撮影待ち」または前回の画像を表示し、描画全体は止めない。

本番デプロイは本計画の範囲外で、ユーザーの明示承認を得てから `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan` で対象を確認し、`--limit raspberrypi5` で Pi5 だけに反映する（Pi3 側の変更はない）。デプロイ後に Pi5 実機で撮影 1 回の所要時間とメモリを測り、`Surprises & Discoveries` に記録する。

## Artifacts and Notes

モックは `docs/design-previews/signage-admin-unification/` にある（静的 HTML、1440×900 前提）。同じモックの編集可能なキャンバスは claude.ai の Artifact（ユーザーの非公開リンク）にもある。

## Interfaces and Dependencies

新しい依存パッケージは原則追加しない（書体の同梱を採用した場合のみ `@fontsource/ibm-plex-sans-jp` と `@fontsource/ibm-plex-mono` を Web に追加する）。

マイルストーン 1 の終了時点で、次の型と関数が存在すること。

    // apps/api/src/services/signage/signage-layout.types.ts
    export interface WebPageSlotConfig { webCaptureId: string }
    // SignageSlotKind に 'web_page' を追加

    // apps/api/src/services/signage/web-capture/signage-web-capture.service.ts
    export interface WebCaptureRegion { selector: string; label: string; x: number; y: number; width: number; height: number }
    export interface WebCaptureResult { jpeg: Buffer; regions: WebCaptureRegion[]; durationMs: number }
    export class SignageWebCaptureService {
      validatePath(path: string): { ok: true } | { ok: false; reason: string };
      captureOnce(settings: WebCaptureSettings): Promise<WebCaptureResult>;
      captureAndStore(id: string): Promise<void>;
      runDueCaptures(now: Date): Promise<void>;
    }

マイルストーン 3 の終了時点で、次の純関数が存在すること。

    // apps/web/src/features/admin/signage-hub/weekTimelineModel.ts
    export function buildWeekTimelineBlocks(schedules: SignageSchedule[], clientKey: string | null, now: Date): WeekTimeline

マイルストーン 4 の終了時点で、次の純関数が存在すること。

    // apps/web/src/features/admin/csv-dashboards/csvDashboardFormModel.ts
    export function toUnifiedColumns(dashboard: CsvDashboard): UnifiedColumn[]
    export function fromUnifiedColumns(columns: UnifiedColumn[], base: CsvDashboard): Pick<CsvDashboard, 'columnDefinitions' | 'templateConfig'>

    // apps/web/src/features/admin/data-boards/boardUsageModel.ts
    export function countBoardUsage(schedules: SignageSchedule[]): Map<string, BoardUsage[]>
