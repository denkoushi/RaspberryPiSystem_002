# 自主検査画面から作業要領書を閲覧できるようにする

This ExecPlan is a living document and must be maintained according to `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must stay current while work proceeds.

## Purpose / Big Picture

自主検査を行う作業者が、移動票に印字された部品番号 `FHINCD` の1次元バーコードを読み取り、該当する作業要領の撮影対象を選んで、その場で手順と画像を確認できるようにする。既存の製造orderスキャンとは独立した操作であり、部品番号を読んだだけでは要領書を開かない。撮影対象チップを押したときだけ、認証済みの既存WorkInstruction APIから手順を取得してアプリ内全面表示する。

## Progress

- [x] (2026-08-31 00:00Z) 参照タスク、リポジトリ規約、現行の自主検査画面、HIDスキャン、WorkInstruction API・DB・画像認証、Dialog、既存テストを調査した。
- [x] (2026-08-31 00:00Z) `python3 -m scripts.git_lifecycle.cli audit --json` を実行し、mainが `38823350dc3458fa0d959871f317e058ea6dd21b` でcleanであることを確認した。
- [x] (2026-08-31 00:00Z) 正規CLIで `feat/kiosk-work-instruction-viewer` worktreeを同じ `origin/main` SHAから作成した。
- [x] (2026-08-31) 実装前の静的デザインプレビューを作成し、60px上辺、チップ、3/4列カード、画像popupをユーザーが明示承認した。
- [x] (2026-08-31) Web API境界、純粋ロジック、React Query hookとfocused unit testsを追加した。
- [x] (2026-08-31) カード一覧、画像ポップアップ、ProtectedImage連携とcomponent testsを追加した。
- [x] (2026-08-31) 自主検査画面へ独立スキャン、チップ、閲覧状態を小さなcompositionとして配線した。
- [x] (2026-08-31) Playwright 2件、focused Vitest 39件、Web lint/build、`git diff --check` を実行し、すべて成功した。
- [x] (2026-08-31) 隔離Postgres検証で全migration、2回目deploy、status、SQL/EXPLAIN、route/repository tests、画像認証、Docker cleanupを確認した。
- [x] (2026-08-31) Luna Max 3系統の担当外相互レビューとroot統合レビューを行い、画像遅延取得、Dialog終了同期、pure ruleの下位module化、background refetch時のchip保持、遅延NFC応答無効化と追加回帰testを反映した。

## Surprises & Discoveries

- Observation: 現行の60px上辺には固定幅コントロールの後ろに `flex-1` の状態領域があり、画面幅に応じて空き領域を受け持つ。
  Evidence: `apps/web/src/pages/kiosk/KioskSelfInspectionPage.tsx` のtoolbar末尾は `min-w-[7rem] flex-1` である。新しいチップ領域はこの可変領域の中で横スクロールさせ、固定コントロールを折り返さない。
- Observation: WorkInstruction画像は端末キーをHTTP headerへ付ける必要がある。
  Evidence: 既存 `ProtectedImage` と `useProtectedImageBlobUrl` がAxios取得、同時取得の重複排除、Blob URLのLRUと解放を実装しているため、raw `<img src>` は使わない。
- Observation: group一覧APIは1ページ最大100件だがtotalやhasMoreを返さない。
  Evidence: Web clientはoffsetを100ずつ増やし、100件未満のページで停止して撮影対象を重複排除する必要がある。
- Observation: 実装後の1280px E2Eでは、既存toolbarの固定幅コントロール群がチップ領域を0pxまで圧迫した。
  Evidence: 初回Playwrightでチップのbounding box幅が0となった。1280px未満ではなく1280pxを含む狭幅時だけ既存controlのgap、padding、select幅、status表示をコンパクト化し、再実行で1280pxの3列、1920pxの4列、右端button、左側chip、toolbar横overflowなしの2ケースが合格した。
- Observation: card画像を全件mountすると、step数に比例して認証画像を即時取得する。
  Evidence: 最終相互レビューで既存blob hookがmount時に取得することを確認した。IntersectionObserverでviewport近傍320pxに入ったthumbnailだけをmountし、拡大画像は既存の重複排除cacheを引き続き利用するよう修正した。
- Observation: NFC照合中にFHINCD scanへ切り替えると、古いPromise結果が後から氏名filterを適用し得た。
  Evidence: NFC request generationを導入し、HID開始、filter解除、clear後の古い解決結果を無視する遅延Promise回帰testを追加した。

## Decision Log

- Decision: 実装前に静的HTMLでtoolbar、カード、画像popupの全状態を提示し、明示承認までReact実装を止める。
  Rationale: 列数、空白利用、操作順をコード変更前に確認でき、レイアウト認識違いによる手戻りを防ぐ。
  Date/Author: 2026-08-31 / User and Codex
- Decision: 提示した静的プレビューを実装デザインとして承認し、React実装へ進む。
  Rationale: 60px上辺、右端の部品番号スキャン、タイトルなしchip、3/4列card、画像popupと下部memoが要求どおりであるとユーザーが確認した。
  Date/Author: 2026-08-31 / User
- Decision: 製造orderと部品番号は独立した明示ボタンでスキャンし、受付中のHID種別は常に1つにする。
  Rationale: 同じ移動票の別バーコードを自動判別せず、既存orderスキャンの契約を保ったまま誤反応を防ぐ。
  Date/Author: 2026-08-31 / User and Codex
- Decision: 撮影対象チップにはタイトルと `資源` 接頭辞を付けず、`研削`、`切削`、その他の自然昇順で表示する。
  Rationale: ユーザーが求める高密度な上辺配置と、既存APIの撮影対象を直接選ぶ操作に合わせる。
  Date/Author: 2026-08-31 / User
- Decision: viewerは既存Dialogを二層で使い、カードはAPIのflatten済み `steps` のみを描画する。
  Rationale: Portal、focus trap、Escape、scroll lock、focus restorationを再利用し、行由来の重複step番号や保存形式へUIを結合しない。
  Date/Author: 2026-08-31 / Codex
- Decision: Backend API、Prisma schema、migration、外部dependencyは変更しない。
  Rationale: 現行のgroup/list/detail/asset契約で要件を満たせるため、Web側の最小変更に限定する。
  Date/Author: 2026-08-31 / Codex

## Outcomes & Retrospective

専用worktree内で、FHINCDの独立HID scan、タイトルなし撮影対象chip、遅延detail取得、3/4列card viewer、認証付き画像表示、二層Dialogを実装した。業務規則、HTTP I/O、Query state、viewer UI、page compositionを分け、Backend API、Prisma schema、migration、外部dependencyは変更していない。

最終検証はfocused Vitest 8ファイル39件、Playwright 2 viewport、Web lint、production build、`git diff --check` が成功した。Playwrightはchip押下前のdetail未取得、検索条件保持、画像Dialogのviewport相当寸法も確認する。隔離Postgresでは163 migrationの適用、再deployで未適用なし、migration status最新、WorkInstruction route/repository integration 12件、FHINCD/group detail SQL、ANALYZE/EXPLAIN、端末key付き画像bytes取得を確認した。検証用containerとvolumeはtrapで削除され、専用networkは作成せず、前後inventoryに作成物は残っていない。

ユーザーの追加承認により、この最終差分は専用branchへcommitする。push、PR、merge、deployは引き続き承認範囲外であり、実施しない。

## Context and Orientation

作業worktreeは `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--kiosk-work-instruction-viewer`、branchは `feat/kiosk-work-instruction-viewer` である。他worktreeの未コミット変更には触れない。

`apps/web/src/pages/kiosk/KioskSelfInspectionPage.tsx` は自主検査一覧のページcompositionを担当し、現在658行ある。既存の製造orderスキャン、氏名NFC、候補検索、仕掛中一覧、検査workflowを所有するため、新しい業務ロジックはここへ直接積まず、専用feature moduleからstateとeventを配線するだけにする。`apps/web/src/features/barcode-scan` の `useKeyboardWedgeScan` は高速キーボード入力をバーコードとしてまとめる既存hookである。

WorkInstructionのHTTP routeは `apps/api/src/routes/work-instructions/index.ts` に既にあり、一覧 `GET /api/work-instructions/groups?partNumber=...`、詳細 `GET /api/work-instructions/group?partNumber=...&resource=...`、画像 `GET /api/work-instructions/assets/:id` を提供する。DB indexとmigrationは既に導入済みである。Webの通常Axios clientは端末キーを付与する。画像では `apps/web/src/components/ProtectedImage.tsx` と `apps/web/src/hooks/useProtectedImageBlobUrl.ts` を再利用する。

`apps/web/src/components/ui/Dialog.tsx` はPortal、Escape、focus trap、scroll lock、閉じた後のfocus restorationを担う。カードviewerと画像viewerはこのDialogを使い、ブラウザFullscreen API、PDFのpage pair、SOP iframeは使わない。

## Plan of Work

最初のmilestoneでは `docs/design-previews/kiosk-self-inspection-work-instruction-viewer-preview.html` を作る。現行のdark kiosk themeと高さ60pxのtoolbarを再現し、状態ボタンで未スキャン、FHINCD待機、チップ表示を切り替えられるようにする。チップからカード一覧、画像から画像全面表示へ進め、1280px相当3列と1920px相当4列を切り替えられるようにする。画像なし、長いmemo、画像失敗も同じ画面で確認可能にする。ユーザー承認まで以下のReact milestoneへ進まない。

第二のmilestoneでは `apps/web/src/api/domains/work-instructions.ts` にUIが必要とする型とclientを追加する。group一覧は100件ずつ順次取得し、短いページで停止する。詳細呼出しでは `shootingTarget` を既存query名 `resource` へ渡す。対応するReact Query hookは既存のdomain hook配置規約に従う。純粋なNFKC/trim/uppercase正規化、dedupe、`研削`、`切削`、数値自然順のsortは独立moduleへ置きunit testする。

第三のmilestoneではカード一覧、カード、画像popup、チップ列を表示専用componentとして追加する。viewer stateは選択撮影対象と選択画像だけを持つ。カード番号はflatten済み配列indexの1始まりを表示し、元step番号を表示番号にしない。画像のないstepはmemoだけ、画像失敗は明示状態とする。1280pxは3列、1800px以上は4列にする。画像popupを閉じてもカード一覧のscroll位置を維持する。

第四のmilestoneでは自主検査pageへ専用controllerをcompositionする。HID受付状態は `movement | part | null` とし、氏名NFCと相互排他にする。part scan成功では古いpart結果を即時消去し、正規化したpartでgroup一覧を検索してチップだけを表示する。detail queryは撮影対象を押すまでdisabledとする。クリアはpart/chip/viewerも消し、viewer closeはchipを残す。

第五のmilestoneではfocused Vitest、Playwright、lint/build/diff checkを実行する。その後 `scripts/test/work-instructions-validation.sh` で一時pgvector Postgresだけを使い、migrationを2回、status、WorkInstruction tests、SQL、ANALYZE、EXPLAIN、画像認証を再確認する。scriptのtrapが作成したcontainerとvolumeだけを削除したことを前後inventoryで確認する。DB契約不備がなければBackendへ変更を広げない。

Luna Max agentsへはファイル所有を分離して、API client・型・純粋ロジック、viewer UI、Playwright・隔離DB検証を割り当てる。root Codexはpage compositionと統合レビューを所有する。返却物が契約から外れる場合は、原因、期待修正、維持すべき既存契約を添えて同じagentへ差し戻す。

## Concrete Steps

repository rootで完了済み:

    python3 -m scripts.git_lifecycle.cli audit --json
    python3 -m scripts.git_lifecycle.cli start --branch feat/kiosk-work-instruction-viewer

worktreeで、プレビュー承認後にpackage scriptsを確認し、最も狭いtestから実行する。想定する最終検証は次のとおりだが、正確なtest pathとscript名は実装時にpackage.jsonへ合わせてこの節を更新する。

    pnpm --filter @raspi-system/web exec vitest run src/api/domains/work-instructions.test.ts src/api/hooks/work-instructions.test.tsx src/lib/workInstructionRules.test.ts src/features/work-instructions/useSelfInspectionWorkInstructions.test.tsx src/features/work-instructions/WorkInstructionTargetChips.test.tsx src/features/work-instructions/WorkInstructionViewerDialog.test.tsx src/pages/kiosk/KioskSelfInspectionPage.test.tsx src/features/barcode-scan/__tests__/useKeyboardWedgeScan.test.ts
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web build
    PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm exec playwright test e2e/kiosk-self-inspection-work-instruction-viewer.spec.ts --project=chromium --workers=1 --retries=0
    bash scripts/test/work-instructions-validation.sh
    git diff --check

## Validation and Acceptance

未スキャンから「部品番号スキャン」を押してFHINCDバーコードを入力すると、orderスキャンなしでも該当チップがタイトルなしで表示される。scan直後にはDialogがない。`研削`、`切削`、`581`、`582` の順で並び、再scanは古いchipを置き換える。既存orderスキャンはpart scanなしで従来どおり製造order完全一致候補を開く。

chipを押すとdetailが初めて取得され、flatten済みstepが1から連番のcardになる。1280px viewportで3列、1920pxで4列、画像なしstepはmemoのみ、画像失敗は画面全体を壊さない。画像押下で上位Dialogが開き、画像はcontain、対応memoは下部scroll領域、`×`とEscapeは画像だけを閉じる。「自主検査画面に戻る」はカードviewerを閉じ、一覧、検索条件、chipを維持する。

toolbarは60pxを保ち横overflowしない。「部品番号スキャン」は右端、chipは直左でnowrapかつ必要時だけchip領域内を横scrollする。buttonとchipのtouch heightは44px以上とする。既存氏名NFC、候補検索、自動検査方法表示、クリア、記録確認のfocused regressionが通る。

隔離DBでは全migrationが適用され、2回目が未適用なし、statusが最新になる。FHINCDとpart+shootingTargetのSQL結果、順序、`WorkInstructionRow_idx_group` を使うEXPLAIN、端末キー付き画像bytes routeが通る。既存container/DBへ接続せず、前後inventoryにtask作成物が残らないことを受入条件にする。

## Idempotence and Recovery

プレビューとWeb変更は専用worktree内だけで行い、繰り返し実行可能である。API readは外部状態を変更しない。隔離DB scriptは固有名container/volumeと一時storageを作り、success、failure、interruptのいずれでも捕捉した正確なIDだけをtrapで削除する。既存DB、container、volume、networkに対するmigration、write、compose down、pruneは行わない。

agent作業が衝突した場合はそのagentを止め、rootがdiffとownershipを確認してから再割当する。ユーザーがプレビュー修正を求めた場合はReact変更を開始せず、HTMLと本ExecPlanのdecision/progressを先に更新する。push、PR、merge、deployは実施しない。

## Artifacts and Notes

Lifecycle start evidence:

    branch: feat/kiosk-work-instruction-viewer
    worktree: /Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--kiosk-work-instruction-viewer
    origin_main_sha: 38823350dc3458fa0d959871f317e058ea6dd21b
    worktree_created: true
    warnings: []

Preview evidence: local browserでtoolbarの高さ `59.998px`、toolbar `scrollWidth == clientWidth`、部品番号ボタン右余白約8px、chip表示順 `研削, 切削, 581, 582` を確認した。card gridは3列と4列を切替でき、8件、画像なし、長文、画像失敗を表示した。画像popupの下部memoと `aria-label="画像を閉じる"` の可視性を確認し、browser consoleのwarning/errorは0件だった。HTML parserでrepo版と会話表示版のduplicate idが0件、`git diff --check` が成功した。

## Interfaces and Dependencies

Web側で公開する契約は `WorkInstructionGroupSummary`、`WorkInstructionGroup`、`WorkInstructionStep`、`getWorkInstructionGroupsByPartNumber(partNumber)`、`getWorkInstructionGroup(partNumber, shootingTarget)`、`useWorkInstructionGroups(partNumber)`、`useWorkInstructionGroup(partNumber, shootingTarget)` とする。UIはgroup detailのflatten済み `steps` のみに依存する。

pure moduleはpart number normalizationとshooting target dedupe/sortだけをexportし、React、Axios、Queryへ依存しない。API moduleは既存Axios clientにだけ依存する。Query hookはAPI moduleに依存する。表示componentは型とProtectedImage/Dialogに依存するがAPIを直接呼ばない。page/controllerがhookと表示componentをcomposeする。この一方向依存により、業務規則、I/O、UI、状態遷移を個別にunit/component testできる。

Revision note (2026-08-31): approved implementation planからliving ExecPlanを作成し、正規worktree作成の実績と、React実装前のdesign approval gateを記録した。同日、静的プレビューの作成・表示検証結果を追記し、ユーザー承認を受けてReact実装開始へ更新した。

Revision note (2026-08-31): React実装、1280px実測に基づくtoolbar調整、focused/unit/component/E2E/build、隔離DB検証とcleanupまでの完了実績を追記した。

Revision note (2026-08-31): 最終相互レビューの指摘と修正、39件へ増えたfocused test、検索条件保持を含むE2E再検証、commitまでの追加承認を追記した。
