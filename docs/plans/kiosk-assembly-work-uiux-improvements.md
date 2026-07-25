---
title: キオスク組立作業 UI/UX・機種名選択改善 ExecPlan
tags: [kiosk, assembly, uiux, machine-name, execplan]
audience: [operator, developer, reviewer]
last-verified: 2026-07-26
related:
  - ../decisions/ADR-20260725-kiosk-assembly-work-uiux-and-machine-name-picker.md
  - ../design-previews/kiosk-assembly-work-uiux-preview.html
category: plans
update-frequency: high
---

# キオスク組立作業 UI/UX・機種名選択改善 ExecPlan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.
This plan follows `.agent/PLANS.md` and is written so that a developer unfamiliar with
this change can continue from the repository alone.

## Purpose / Big Picture

組立オペレータが「済んだ箇所」「NGの箇所」「今入力する箇所」を同時に区別でき、
現在必要なボタンだけを迷わず選べる作業画面にする。独立したメッセージ行をヘッダー
へ統合して、手順書の表示領域を広げる。組立テンプレートの新規作成では、自由入力の
型番/FHINCD欄を生産日程と補完マスタに存在する機種名の候補選択へ置き換え、テンキー
を主検索、文字入力を補助検索として使えるようにする。

最初の受け入れ可能な成果は、製品コードから独立した操作可能なHTMLプレビューである。
ユーザーがプレビューを承認するまでは、React、API、Prisma、DB関連コードを変更しない。

## Progress

- [x] (2026-07-25) `main` のクリーン状態と `origin/main` への追随を確認した。
- [x] (2026-07-25) `feat/kiosk-assembly-work-uiux` ブランチを作成した。
- [x] (2026-07-25) 関連ADR、組立・自主検査UI、機種名解決、Prismaスキーマ、
  テスト／Docker構成を確認した。
- [x] (2026-07-25) 本Living ExecPlanと提案ADRを作成した。
- [x] (2026-07-25) 操作可能なデザインプレビューを作成し、1920×1080と
  1366×768で確認した。
- [x] (2026-07-25) 提示用のプレビューHTMLと4枚のスクリーンショットを作成した。
- [x] (2026-07-25) ユーザーからV3デザインプレビューの承認とDeploy実行許可を得た。
- [x] (2026-07-25) 共通キオスクマーカー／ボタン／テンキーを抽出し、
  組立作業UIを更新した。
- [x] (2026-07-25) 機種名カタログ境界、候補サービス、読取APIを実装した。
- [x] (2026-07-25) 新規・雛形作成の機種名選択ダイアログを実装した。
- [x] (2026-07-25) focused tests、全API/Webテスト、lint、build、
  隔離Docker/Postgres検証、製品React画面の寸法・目視確認を完了した。
- [x] (2026-07-26) Deploy対象SHA `5dbb98eb488009a6e9351bc0b898b3d39e4869e5`
  を確定し、Release readiness review、GitHub required checks、実対象すべての
  read-only preflightを通過させた。
- [x] (2026-07-26) 標準Deploy run `20260725-150046-020a76` を実行し、
  API/Webと対象キオスク6台の検証、Deploy後のno-op再計画まで完了した。

## Surprises & Discoveries

- Observation: 作業画面は `selectedBoltId` に現在ボルトを渡しており、Canvas側では
  選択色が状態色より優先される。さらに `latestStatusByBolt` が現在位置を `current`
  で上書きするため、OK/NGと現在位置を同時表示できない。
  Evidence: `KioskAssemblyWorkSessionPage.tsx`、`AssemblyProcedureCanvas.tsx`、
  `assemblyTemplateDraft.ts`。
- Observation: `IGNORED` は現在の最新状態計算では直前のOK/NGを上書きする。
  今回の意味体系では履歴だけに残し、マーカー色は直近の有効なOK/NGを維持する必要がある。
- Observation: 独立メッセージ欄は `h-14`（56px）で、画面高さを常時消費している。
  ヘッダー中央には可変幅の未使用領域がある。
- Observation: 初版プレビューでは確認用の画面／状態切替バーを上端へ常設してしまい、
  回収対象と同じ垂直領域をプレビュー自身が消費した。ユーザー指摘を受け、確認操作を
  レイアウト外の開閉式オーバーレイへ退避した。
- Observation: `modelCode` という内部名は既存契約上維持が必要だが、実値は生産日程の
  `FHINMEI`（機種名）と照合されている。利用者向け表示は「機種名」が正確である。
- Observation: 機種名の取得元はwinner判定後の生産日程MH/SH行と機種名補完テーブルで、
  既存の60秒キャッシュとCSV取込後の無効化処理を再利用できる。
- Observation: 既存のDBインデックスで元データ読取を支えられ、候補の部分一致は
  キャッシュ済み集合をメモリ処理できるため、新規migrationは不要である。
- Observation: 一時Postgresの小さいfixtureでは通常のoptimizerがSeq Scanを選んだが、
  診断用transaction内で `enable_seqscan=off` にすると生産日程winner読取は
  `csv_dashboard_row_prod_schedule_winner_lookup_idx` と
  `csv_dashboard_row_winner_lookup_global_idx`、補完読取は
  `PSSeibanMachNmSup_unique_src_fsb` を利用できた。
  Evidence: `EXPLAIN (ANALYZE, BUFFERS)` を
  `kioskux-20260725230444-96208` 一時DBで実行した。
- Observation: ローカルMacのNodeはv18.20.8で、repository指定の20.9以上に対する
  engine警告が出る。ただし全lint、型検査、production build、全API/Web testは成功した。
  この警告をDeployの機能ブロッカーとするかは、対象releaseの実際のbuild/runtimeで
  指定Nodeを満たすかをpreflightで確認して決める。
- Observation: 製品React画面の1366×768実測では、作業ヘッダー58px、
  ドキュメントペイン約655px、履歴約203px、横overflowなしだった。1920×1080相当では
  ドキュメントペイン約967px、履歴約515pxだった。
  Evidence: Viteの実装画面をmock read APIへ接続し、Browser viewportとDOM矩形を計測した。
- Observation: 初回のGitHub full E2Eは、一覧見出しを仕様どおり「型番」から「機種名」へ
  変更した一方、`e2e/assembly-library-editor-ui.spec.ts` が旧文言を固定期待していたため、
  1366×768と1920×1080の同じassertionで失敗した。製品画面のsnapshotは新見出しを正常に
  表示しており、期待値を正式表示名へ更新後、同specの6テストがローカルChromiumで合格した。
  Evidence: GitHub Actions run `30161991786`、job `89688728013` とローカルfocused E2E。
- Observation: 最終SHAのrequired checksはCI `30162222742`、CodeQL
  `30162223659`、gitleaks `30162224702` がすべて成功した。初回E2Eの旧文言期待以外に、
  新API、UI、cache、build成果物を阻害する問題は検出されなかった。
- Observation: 全inventoryを指定しない最終preflightは、今回のmutation、activation、
  verification対象ではない `raspberrypi3` のavailable memoryが120MB基準を下回ったため
  fail-closedで停止した。read-only再計測は約110〜119MBで、同端末を実際の作業対象へ
  含める根拠はなかった。
  Evidence: 最終print-planで同端末はsignageかつ対象外。実作業対象はPi5とキオスク6台で、
  それぞれのread-only preflight run `20260725-145120-ed00ed`、
  `20260725-145335-c8d870`、`20260725-145443-517dc6`、
  `20260725-145546-199ae9`、`20260725-145643-5eb1df`、
  `20260725-145746-66647c`、`20260725-145845-3ea97d` が成功した。
- Observation: ローカルMacのNode engine警告とは独立して、本番candidate imageは
  repository指定どおりNode 20でbuildされ、API/WebのBlue/Green安定監視を通過した。
  したがってローカルNode 18警告は本releaseのruntime機能ブロッカーではなかった。

## Decision Log

- Decision: 作業ブランチを `feat/kiosk-assembly-work-uiux` とする。
  Rationale: 依頼のスコープと一致し、既存Git運用規約のfeature branch方針に従う。
  Date/Author: 2026-07-25 / Codex
- Decision: プレビュー承認を製品実装の必須ゲートとする。
  Rationale: 配色、情報密度、長文時の挙動を実装前に合意し、React/APIの手戻りを防ぐ。
  Date/Author: 2026-07-25 / User and Codex
- Decision: ドキュメント表示領域を最優先し、プレビュー専用操作は画面レイアウトへ
  高さを要求しない開閉式オーバーレイとする。作業ヘッダーも一行66pxへ収める。
  Rationale: 独立メッセージ行の削除で得る高さを別UIへ再配分せず、すべて手順書へ返す。
  Date/Author: 2026-07-25 / User feedback and Codex
- Decision: 文書ビューア内部のタイトル／文書切替とページ送りも一段42pxへ統合し、
  作業ヘッダーを58pxへ縮める。
  Rationale: 初回修正版はこの内部2段を残しており、「ドキュメント表示エリア最大化」
  という最優先要件を満たし切れていなかった。従来の操作要素は削除せず同じ一段へ置く。
  Date/Author: 2026-07-25 / User feedback and Codex
- Decision: 右ペインは「次工程へ／作業完了」を2列、「やり直し」を全幅、
  トレーサビリティ4操作を2列×2段で配置する。
  Rationale: 操作の意味を保ったまま縦方向を3段分回収し、拡大した測定値・判定を持つ
  入力履歴へ表示高を割り当てる。
  Date/Author: 2026-07-25 / User feedback and Codex
- Decision: 作業用 `inputTargetBoltId` と編集用 `selectedBoltId` を分離する。
  Rationale: 作業では状態色と現在位置を重ね、編集では従来の水色選択を維持するため。
  Date/Author: 2026-07-25 / Codex
- Decision: 機種名選択は広いダイアログ、テンキー主検索＋文字補助検索、候補選択必須とする。
  Rationale: 数字をほぼ必ず含む機種名を短い操作で絞りつつ、文字条件も併用できる。
  Date/Author: 2026-07-25 / User and Codex
- Decision: 管理UIの表示名を「機種名」に統一し、内部 `modelCode`、API、DB、
  Excel見出しは変更しない。
  Rationale: 利用者へ正しい意味を示しながら、既存契約との互換性を守る。
  Date/Author: 2026-07-25 / Codex（未回答項目の推奨既定）
- Decision: Prisma schemaとmigrationを変更しない。
  Rationale: 既存データ源、index、TTLキャッシュで要件を満たせる。
  Date/Author: 2026-07-25 / Codex
- Decision: ユーザーの明示許可を受け、本計画の終点を製品実装から標準Deployと
  Deploy後確認まで拡張する。ただし、対象SHA・build成果物・端末状態・rollback経路を
  一括監査し、read-only preflightが合格するまでは実機変更を開始しない。
  Rationale: 実装ごとに異なる新しい失敗点もDeploy開始前にまとめて解消し、
  実行中の個別修正と後戻りを避けるため。
  Date/Author: 2026-07-25 / User and Codex
- Decision: DeployはPi5と、print-planがactivation/verification対象としたキオスク6台を
  明示した標準 `--limit` で実行し、signageの `raspberrypi3` は変更も検証も行わない。
  memory基準、canary hold、rollback、端末証跡のいずれも緩和・迂回しない。
  Rationale: NG基準は実害と適用対象を一致させる必要がある。今回の変更を受け取らない
  signage端末の低メモリは別途扱うべき運用課題であり、本releaseの安全性を表さない。
  Date/Author: 2026-07-26 / Codex

## Outcomes & Retrospective

V3デザインプレビュー承認後、作業画面、共通テーマ、機種名カタログ／候補API、
選択ダイアログを実装した。既存DBへ触れず、一時Postgresへ全153 migrationを適用して
関連34テストとAPI全2,441テストを通し、Web全1,509テスト、root lint、
shared-types/API/Web buildも完了した。製品React画面は2解像度で横overflowなし、
ドキュメント領域と履歴領域の拡大、ダイアログ内包を確認した。

Deploy前にはdeploy safety 841テスト、terminal profile contract 24テスト、
隔離Postgresのdeploy-status 20テスト、Ansible契約と最終GitHub required checksを
通過させた。対象範囲をPi5とキオスク6台へ確定し、各対象のread-only preflight成功後、
標準Deploy run `20260725-150046-020a76` を実行した。Pi5は新SHAへBlue/Green切替後、
5分の安定監視とcleanupまで成功し、キオスクはstonebaseをcanaryとして検証後に残る
5台をrolling activationした。最終状態はAPI/Webが `verified`、全6台が `success`、
failureなしである。Deploy後の同一範囲print-planは `targets: []`、ヘルスAPIは
`status: ok`、Blue/Green runtimeは `cleaned / verified / consistent` となった。

## Context and Orientation

組立作業ページは `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx` が
全体の業務状態と左右ペインを構成する。上段は
`apps/web/src/features/assembly/AssemblyWorkSessionHeader.tsx`、手順書とマーカーは
`AssemblyProcedureSequenceViewer.tsx` と `AssemblyProcedureCanvas.tsx` が担当する。
テンプレート編集の下書きとマーカー状態は `assemblyTemplateDraft.ts` に集約される。

自主検査の配色規則は `apps/web/src/features/selfInspection/` 以下のキオスクテーマと
検査図面マーカースタイルにある。新しい共通テーマをキオスク共通境界へ置き、
自主検査向け既存exportは互換ラッパーとして残す。

機種名解決のAPIサービスは `apps/api/src/services/` 以下にあり、生産日程MH/SH行の
winnerと機種名補完テーブルを読み、60秒キャッシュする。新しいカタログリポジトリは
DB読取とTTLだけを担当し、既存の機種名→製番サービスと新しい候補サービスが依存する。
候補サービスは正規化、重複排除、AND検索、自然順、limitだけを担当する。Reactやroute
handlerへPrismaを漏らさない。

## Plan of Work

### Milestone 1: Design preview and approval gate

`docs/design-previews/kiosk-assembly-work-uiux-preview.html` に、組立作業と機種名選択を
同じHTML内で切り替えられるプレビューを作る。組立作業は一行ヘッダー、状態と現在位置を
重ねた丸数字、業務状態別の右ボタン、拡大履歴、拡大された手順書領域を含む。状態切替で
通常入力、NG入力、次工程待ち、完了待ち、トレーサビリティ各段階、危険な引継ぎ確定を
確認できるようにする。

機種名選択は、確定済み値を持つ編集画面とフォーカスを閉じ込める想定の広いダイアログを
表現する。数字テンキー、文字検索、候補選択、キャンセル、確定、候補なし、40件超過を
操作できるようにする。1920×1080と1366×768で長い機種名・警告メッセージを表示し、
横スクロール、画面外ボタン、ダイアログ切れがないことを確認する。

このマイルストーンの成果をユーザーへ提示し、明示承認を得るまで次へ進まない。

### Milestone 2: Shared visual primitives and assembly work UI

検査図面と組立が参照するマーカーテーマ、キオスクフロー用ボタンテーマ、数字テンキーを
小さな共通モジュールへ抽出する。既存exportとaria-labelを維持する互換ラッパーを置く。
組立Canvasでは `inputTargetBoltId` を追加し、状態色の上へ3pxの水色外周線を描く。
`IGNORED` は状態集計から除外し、編集用 `selectedBoltId` の挙動は変えない。

右ペインの状態判定を純粋関数へ集約する。現在の必須操作だけ緑、補助操作はグレー、
実行不能はdisabled、接続権引継ぎの危険な確定だけ赤とする。やり直しの業務ロジックは
変更しない。ステータスをヘッダー中央へ移し、独立 `h-14` 行を削除する。履歴の測定値と
OK/NGを24px、太字、tabular numbersにする。

### Milestone 3: Machine-name catalog and candidates API

注入可能な機種名カタログリポジトリを作り、生産日程winnerと補完テーブルの読取、
60秒TTLキャッシュ、無効化を担当させる。既存公開関数は互換ラッパーで維持する。
候補サービスで全角英数字の半角化、trim、uppercase、数字抽出、AND部分一致、自然順、
重複排除、limitを実装する。

`GET /api/assembly/machine-name-candidates` を既存 `allowView` 認証下に追加する。
`digitQuery` と `q` は最大120文字、`limit` は既定40・最大100とし、
`{ candidates: string[]; hasMore: boolean }` を返す。DB schemaは変更しない。

### Milestone 4: Machine-name picker UI

新規作成と雛形作成の自由入力を機種名選択へ置換する。既存Dialogと共通テンキーを使い、
200ms debounceと最新リクエスト優先制御を実装する。条件変更時には仮選択を解除し、
「この機種名を使用」でのみ `modelCode` を更新する。キャンセルは確定済み値を保持する。
新規作成では選択済みでなければ保存不可とし、保存ハンドラでも防御する。改版は対象外。

### Milestone 5: Verification and documentation

単体・コンポーネント・API統合テスト、全API/Webテスト、lint、production build、
`git diff --check` を実行する。隔離した一時Postgresへ全migrationを適用し、fixture、
SQL、`EXPLAIN (ANALYZE, BUFFERS)`、関連テストを確認する。最後にPlaywright Chromiumで
2解像度を確認し、本計画とADRへ実測結果を記録する。

### Milestone 6: Release readiness review and Deploy

全実装・検証の完了後、標準Deploy入口とaggregate preflightを再読し、今回の変更に
適用される判定を「守る要件・失敗時の実害・観測方法」まで一括監査する。文字列や
実装形式だけを理由にした誤検知をブロッカーにせず、API互換性、ビルド成果物、対象SHA、
端末状態、rollback経路など実害へ結び付く判定をすべてDeploy開始前に解消する。
`print-plan` と read-only preflight を通過した場合だけ標準Deployを実行し、実行後の
サービス、API、キオスク表示を確認する。

## Concrete Steps

リポジトリルート `/Users/tsudatakashi/RaspberryPiSystem_002` で実行する。

    git status --short
    git checkout main
    git pull --ff-only origin main
    git checkout -b feat/kiosk-assembly-work-uiux

プレビュー承認後、focused testを実装と並行して追加する。最終DB検証では55436〜55445の
最初の空きポートを選び、日時サフィックス付きのcontainer、volume、networkを作成する。
trapで必ず削除し、既存Docker資源は停止・変更しない。DBへ向ける正確なコマンドは、
実装時点のpackage scriptsと環境変数を再確認して本節へ追記する。

最終確認の最低限のコマンド群は以下である。

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api test
    pnpm --filter @raspi-system/web test
    pnpm lint
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/web build
    git diff --check

## Validation and Acceptance

プレビューは以下を満たせば承認待ちへ進める。

- 1920×1080と1366×768でヘッダーが一行に収まり、全体に横スクロールがない。
- 長い警告がヘッダー中央で読め、主要操作とドキュメントを押し出さない。
- OK、NG、未入力、現在位置の意味が同時に判別できる。
- 各業務状態で緑の必須操作が高々一つで、disabledと補助操作が区別できる。
- 履歴の測定値とOK/NGが24px相当で読める。
- 機種名ダイアログが画面内に収まり、テンキー、文字AND検索、選択、確定、
  キャンセル、候補なし、40件超過が操作できる。

製品実装は、計画記載の単体・統合・Docker/Postgres・全体回帰・buildを完了し、
既存契約と既存自主検査の挙動を壊さない場合に受け入れる。

## Idempotence and Recovery

プレビューは単一HTMLで外部サービスへ書き込まず、何度開いても初期状態へ戻せる。
製品実装中のDB検証は既存container、volume、networkを使用せず、固有名の一時資源だけを
trapで削除する。migrationは一時DBにのみ `migrate deploy` する。失敗時は一時資源の
残存を名前サフィックスで検索し、対象が固有名と一致する場合だけ削除する。

作業ツリーの既存変更はユーザー所有として保持する。意図しない差分が見つかった場合は
上書きせず停止して確認する。ユーザーは本変更のDeployを明示許可済みであるため、
標準Deployが要求する対象SHAのcommit/pushは実施できる。PR作成とmainへのmergeは、
標準Deployの必須条件でない限り行わない。

## Artifacts and Notes

- Preview: `docs/design-previews/kiosk-assembly-work-uiux-preview.html`
- Proposed ADR: `docs/decisions/ADR-20260725-kiosk-assembly-work-uiux-and-machine-name-picker.md`
- Screenshots: プレビュー確認時に作成し、この節へ保存先とviewportを追記する。
  - `outputs/kiosk-assembly-work-preview-1920x1080.jpg`
  - `outputs/kiosk-assembly-machine-picker-preview-1920x1080.jpg`
  - `outputs/kiosk-assembly-work-preview-1366x768.jpg`
  - `outputs/kiosk-assembly-machine-picker-preview-1366x768.jpg`
  - Browser DOM実測: 1366×768固定モードでwork main下端768px、右ペイン右端
    1356px、dialog右端1203px・下端710px。横overflowなし。
  - 最大化再設計後の文書表示高: 1366×768は約644px（初版約484pxから約160px、
    約33%増）、1920相当は約950px（初版約795pxから約155px増）。ヘッダー上端は
    viewportの0px、作業ヘッダー高は58px、文書ビューア操作は一段約45px、
    プレビュー操作パネルは通常時 `display:none` でレイアウト高0px。
    右ペイン操作を2列化した後は1366×768でも右ペイン自体の縦スクロールなしで
    履歴3行をすべて同時表示できる。
  - Interaction実測: 通常入力／NG現在位置はトルク記録、次工程待ちは次工程へ、
    完了待ちは作業完了、現物確認は現物確認、使用開始は使用開始のみが緑。
    引継ぎ確定は緑0件、接続権引継ぎのみ赤。ブラウザconsole error 0件。
  - Picker実測: AND検索 `300` + `KP` は4件、候補なしは0件、40件超過は
    全48件中先頭40件と絞り込み案内を表示。確定後の別候補仮選択＋キャンセルで
    確定値が保持された。
- Database evidence: 実装後、一時資源名、migration status、SQL、EXPLAIN要約、
  cleanup確認を追記する。
  - 一時資源suffix: `kioskux-20260725230444-96208`、host port: `55436`。
  - `prisma migrate deploy` で153 migrationを適用し、`prisma migrate status` は
    `Database schema is up to date!`。
  - MH/SH winner、補完、全角名、重複winner、40件超過fixtureを一時DBだけへ投入した。
  - 生産日程winnerと補完の既存indexが利用可能なことを
    `EXPLAIN (ANALYZE, BUFFERS)` で確認した。
  - 関連4 test file・34 testと、API全465 file・2,441 testが合格した。
  - trap後、対象suffixのcontainer、volume、networkはいずれも残存0件。
- Web evidence:
  - Web全305 test file・1,509 testが合格した。
  - root lintは警告0件、shared-types/API/Web production buildは成功した。
  - Browser実測は1366×769（要求768に対してemulation丸め1px）と
    1919×1080（要求1920に対して丸め1px）で、双方ともdocument rootの横overflowなし。
  - 機種名pickerは1366×769のviewport内に収まり、数字`3`と文字`KP`のAND検索を確認した。
- Release evidence:
  - Deploy SHA: `5dbb98eb488009a6e9351bc0b898b3d39e4869e5`。
  - Standard Deploy run: `20260725-150046-020a76`、
    unit: `raspi-release-20260725-150046-020a76.service`。
  - Pi5 API/Webは5分間の安定監視を含むBlue/Green releaseを通過し、
    control-plane claimsはいずれも `verified`。
  - Canary `raspi4-kensaku-stonebase01` と、`raspberrypi4`、
    `raspi4-robodrill01`、`raspi4-fjv60-80`、`raspi4-sessaku-01`、
    `raspi4-assembly-01` は全台 `success`。
  - 終了状態は `state: success`、`phase: completed`、systemd result `success`、
    failureなし。Deploy後print-planはmutation、activation、verification対象が0件。
  - Prisma migrationは追加しておらず、本番DB schema変更も発生していない。

## Interfaces and Dependencies

追加予定の公開インターフェースは次に限定する。

    GET /api/assembly/machine-name-candidates
      ?digitQuery=300
      &q=KP
      &limit=40

    {
      "candidates": ["L300KP", "L300KP-2"],
      "hasMore": false
    }

Web API関数 `listAssemblyMachineNameCandidates`、同DTO、作業用
`inputTargetBoltId`、共通キオスク数字テンキー／フロー操作ボタン／マーカーテーマを追加する。
既存テンプレート作成・改版API、Prismaモデル、Excel形式、作業セッションAPI、
やり直しAPIは変更しない。

## Revision Note

2026-07-25に、V3承認後の実装結果、隔離Postgresと全体回帰の証拠、製品React画面の
実測値を追記した。またユーザーの明示許可に従い、終点をRelease readiness review、
標準Deploy、Deploy後確認まで拡張した。これはDeploy開始後の個別修正と後戻りを避ける
ため、今回新たに加わったAPI、cache、UI、build成果物を実機変更前に一括監査するためである。

2026-07-26に、最終required checks、対象別preflight、NG基準の適用範囲判断、標準Deploy、
canary承認、全対象の最終証跡、no-op再計画を追記し、本ExecPlanを完了した。
