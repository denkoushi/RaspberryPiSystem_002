---
title: 組立矩形ページ 共通マーカー表示編集 Follow-up ExecPlan
status: completed
created: 2026-07-27
branch: fix/assembly-crop-shared-marker-projection
related:
  - ./assembly-procedure-step-storyboard-execplan.md
  - ../decisions/ADR-20260726-assembly-template-procedure-steps.md
---

# 組立矩形ページで共通マーカーを表示・編集する

この文書は `.agent/PLANS.md` に従う living document である。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は実装中も更新する。

## Purpose / Big Picture

組立テンプレートの全体ページと矩形ページは、同じ元ページを見る別の窓である。修正後は、同じ丸数字、チェック、矢視が両方に表示され、矩形上から追加・選択・編集しても元ページ上の一つのマーカーへ保存される。左の手順サムネイルと作業画面も同じ投影結果を使い、締付・チェック状態を重複させない。

現在のエディタは、ページ抽出後の表示マーカーから文書IDを落とした後に文書所属を再判定するため、矩形表示で丸数字とチェックを除外する。矩形表示は矢視レイヤーと配置クリックも持たず、左サムネイルは画像だけを描画している。本計画はこれらをWeb内部の共通投影・描画責務へまとめて修正する。REST API、DB、Prisma migrationは変更しない。

## Progress

- [x] 2026-07-27: `main`のクリーン状態とfast-forward同期を確認し、`fix/assembly-crop-shared-marker-projection`を作成した。
- [x] 2026-07-27: エディタ、crop表示、ストーリーボード、作業viewer、既存単体・Playwright testを調査し、4つの欠落経路を特定した。
- [x] 2026-07-27: ページ所属判定とcrop幾何投影を分離し、共通マーカー描画レイヤーを実装した。
- [x] 2026-07-27: crop上から丸数字、チェック、矢視を元ページ座標で追加・編集できるようにした。
- [x] 2026-07-27: 左サムネイル、中央エディタ、作業画面へ同じ投影結果を接続した。
- [x] 2026-07-27: 共通削除確認、可視範囲変更警告、最後の表示を失う変更の拒否を実装した。
- [x] 2026-07-27: 対象回帰test、Web全test 1,528件、lint、build、Playwright 17件、ドキュメント監査を完了した。
- [x] 2026-07-27: PR #1096の必須CI、CodeQL、secret scan成功後、`dc4f3c63e31016b1d95fc289427ca8dccd91f0bb`としてmainへ統合した。
- [x] 2026-07-27: 標準rolling release `20260727-003217-c1fd9a`で全対象へ反映し、release identity、maintenance解除、Phase12 `PASS 47 / WARN 0 / FAIL 0`を確認した。
- [x] 2026-07-27: `raspi4-assembly-01`の専用検証テンプレートでエディタと作業画面の実機E2Eを完了し、検証作業を監査履歴付きで無効化、検証テンプレートを無効化した。

## Surprises & Discoveries

- Observation: `filterDraftBoltsForPage`と`filterDraftCheckItemsForPage`はページ抽出後に文書参照を持たないcanvas型へ変換する。その戻り値を`transformMarkerForProcedureStep`へ渡すと、同関数の文書所属判定が`undefined`を比較して全マーカーを除外する。
  Evidence: `KioskAssemblyTemplateEditorPage.tsx`の`visibleBolts`から`cropVisibleBolts`への経路と、`assemblyProcedureStepDraft.ts`の文書キー比較。
- Observation: 作業viewerの既存cropテストは丸数字の座標だけを検証し、矢視SVGを検証していない。crop分岐は`AssemblyMarkerOverlay`だけを描画している。
  Evidence: `AssemblyProcedureSequenceViewer.test.tsx`と`AssemblyProcedureSequenceViewer.tsx`。
- Observation: 左ストーリーボードは`AssemblyProcedureCropView`へ画像だけを渡し、マーカー入力を持たない。
  Evidence: `AssemblyProcedureStoryboard.tsx`。
- Observation: 変更前の関連Web testは4ファイル10件すべて成功するため、現象を捕捉する回帰testが不足している。
  Evidence: 2026-07-27に対象Vitestを実行し、`Test Files 4 passed`、`Tests 10 passed`。
- Observation: zoom中の矢視SVG寸法をResizeObserverだけで追うと、画像拡大直後の1描画で古い寸法が残る。
  Evidence: PlaywrightのCSS pixel検証でrendered widthとviewBox widthに165px差が出た。zoom canvasが既に持つ確定layout寸法を共通レイヤーへ渡すことで差を1px未満へ戻した。
- Observation: 実機Firefoxの作業ステップ見出しはAT-SPI上で独立した名前を持たず、ストーリーボード項目とマーカーbuttonが操作可能な正本だった。
  Evidence: NFC認証後の`raspi4-assembly-01`で、全体は丸数字1〜4、cropは同じIDの丸数字1、2、4を公開し、範囲外の丸数字3だけを公開しなかった。作業操作はこの差分と前後遷移で検証した。
- Observation: 作業再開は画面再読込ごとに実在社員NFCを要求し、過去イベントを再利用しない。
  Evidence: 専用検証ロットの開始と再開でそれぞれ新しい物理スキャンを行い、NFC値を取得・記録・代入せずに実機受入を完了した。

## Decision Log

- Decision: 文書・ページ所属判定と、所属判定後の表示マーカーに対するcrop幾何投影を別関数にする。
  Rationale: 表示型へ永続化都合の文書IDを持ち込まず、今回の誤った二重判定を防ぐため。
  Date/Author: 2026-07-27 / Codex
- Decision: 丸数字、チェック、矢視は一つの共通描画レイヤーで描画し、通常表示と読取専用の縮小表示だけを切り替える。
  Rationale: エディタ、作業画面、サムネイルの描画欠落を個別実装で再発させないため。
  Date/Author: 2026-07-27 / Codex
- Decision: マーカー中心が矩形内または境界上なら表示し、矢視線は矩形境界でclipする。矢視だけが交差しても中心が外なら表示しない。
  Rationale: 表示・保存・API検証で同じ明確な包含規則を使うため。
  Date/Author: 2026-07-27 / Codex
- Decision: 同じマーカーは全ビューで同一ID・同一作業状態を共有し、削除は元マーカーの全体削除として影響件数を確認する。
  Rationale: cropを独立作業データにせず、詳細表示として扱う利用者合意を守るため。
  Date/Author: 2026-07-27 / Codex

## Outcomes & Retrospective

PR #1096でWeb内部の投影責務と共通描画レイヤーを統合し、REST API、DB、Prisma migrationを変更せずに全体・cropを同じ元ページのビューとして扱えるようにした。丸数字、チェック、矢視は元ページ上の同じIDと座標を共有し、cropからの追加・編集・削除も元マーカー一件へ反映する。

実機エディタでは、全体から作ったcropに既存丸数字と矢視が表示されること、cropから丸数字4、`CROP-CHECK`、矢視を追加して全体へ反映されること、左サムネイル表示、共通削除の取消・確定、最後の表示を失うステップ削除の拒否を確認した。保存後のAPI正本でも丸数字4とチェックは元ページ比率座標を保持し、丸数字4の矢視先端座標を保持した。

実機作業画面では、全体に丸数字1〜4、cropに同一IDの丸数字1、2、4と同一チェックを表示した。crop上で`CROP-CHECK`を完了するとAPIの必須進捗が`1/1`となり、全体へ戻っても同じチェックが表示された。現在の締付対象は両ビューで同じ丸数字1のIDを共有し、「現在の丸数字へ」はそのマーカーを最初に含む全体ステップへ戻った。締付OKの色状態はWeb回帰testで固定し、実機では物理レンチを代用せず、現在対象の共有状態までを確認した。

専用証跡はテンプレート`【検証用】矩形共通マーカー`、製番`TEST-CROP-20260727`、作業ID`TEST-CROP-20260727-001`で残した。業務テンプレートは変更していない。受入後は作業アイテムを理由付きで無効化し、検証テンプレートを`isActive=false`にした。AT-SPIとxdotoolはDebian packageを`/tmp`へ展開しただけで、検証後にPi4・Pi5双方から削除し、通常の`kiosk-browser.service`へ復帰した。

## Context and Orientation

`apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx`は、文書、表示ステップ、丸数字、チェックのドラフト状態を統合する。`apps/web/src/features/assembly/assemblyProcedureStepDraft.ts`はステップ所属とcrop変換を扱う。`AssemblyProcedureCanvas.tsx`は元ページ上のマーカーと矢視を描画するが、`AssemblyProcedureCropView.tsx`は画像clipだけを担当する。`AssemblyProcedureStoryboard.tsx`は左ペイン、`AssemblyProcedureSequenceViewer.tsx`は作業画面の全体・crop移動を担当する。

元ページ座標は画像左上を`0,0`、右下を`1,1`とする比率座標である。crop内座標も同じ範囲を使う。crop内で受けた座標は`cropPointToAssemblyProcedureSourcePoint`で元ページ座標へ戻し、保存済み丸数字やチェックを複製しない。

## Plan of Work

最初に表示用マーカーの幾何投影を純粋関数へ分ける。文書所属は元ドラフトからページ別表示モデルを作る時点だけで判定し、その後はcrop矩形だけで包含、座標変換、矢視clipを行う。

次に丸数字、チェック、矢視を同じ座標枠へ描く共通レイヤーを作る。既存の全体canvas、crop表示、作業viewerへ通常モードで接続し、ストーリーボードへ小型・非操作モードで接続する。仮想リストと画像LRUは変更しない。

crop表示には配置クリックを追加する。クリック位置をcrop内比率へ変換し、さらに元ページ比率へ戻して既存の丸数字、チェック、矢視作成関数へ渡す。既存マーカーの選択と右ペイン編集は同じIDを更新する。

最後に元マーカー削除前の確認ダイアログと、cropまたはマーカー位置変更が表示ステップ集合を減らす時の警告を追加する。全ステップから見えなくなる変更は既存Web/APIガードで拒否する。

## Concrete Steps

作業ディレクトリはリポジトリルートとする。変更後はCodex同梱Node 24をPATH先頭に置き、対象Vitest、全Web test、lint、build、対象Playwrightを順に実行する。ドキュメントは`node scripts/docs/audit-docs.mjs --write`で生成索引を更新し、続けて`--check`と`git diff --check`を通す。

PRの全必須CI、CodeQL、secret scanが成功した不変SHAだけをmainへ統合する。標準rolling releaseは最初に`--print-plan`で対象を確認し、`scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml`で実施する。実行後はrun status、release identity、maintenance解除、Phase12を確認する。

## Validation and Acceptance

単体testではページ抽出済みマーカーのcrop投影、境界包含、crop外除外、矢視clip、cropから元ページへの逆変換を固定する。コンポーネントtestでは左サムネイル、中央crop、作業cropの丸数字・チェック・矢視、直接追加、共通編集、削除確認を確認する。

Playwrightでは全体ページに作った丸数字と矢視を含むcropを追加し、左・中央・作業画面で同一表示を確認する。cropから丸数字、チェック、矢視を追加して保存payloadが元ページ座標であること、全体へ戻って同じ内容が見えること、状態が重複しないことを確認する。1366×768、1920×1080、900×900で横overflowがなく、cropとマーカーの位置差が1 CSS px以内であることを確認する。

実機では業務テンプレートを変更せず、`【検証用】矩形共通マーカー`で同じ操作を通す。成功後は削除せず無効化して証跡を残す。この一連の操作が成功するまで矩形機能の本番運用開始とは判定しない。

## Idempotence and Recovery

DBとAPI契約を変更しないためmigrationとDocker PostgreSQL検証は不要である。Web変更は同じテストを繰り返し実行できる。デプロイに失敗した場合は手動SSHや状態ファイル編集をせず、rolling releaseのsealed manifestと標準cancel・rollback契約に従う。

## Artifacts and Notes

- Codex同梱Node 24.14.0でWeb全testを実行し、309ファイル、1,528件が成功した。
- Web lintとproduction buildが成功した。新しいproduction chunkには共通投影moduleが分離された。
- 対象Playwright 2 specは17/17件成功した。エディタのcrop直接追加・矢視・サムネイル・削除確認と、作業画面の3解像度を含む。
- PR #1096のmain統合SHAは`dc4f3c63e31016b1d95fc289427ca8dccd91f0bb`。GitHub Actions run `30227297503`とCodeQL run `30227297481`を含む必須checkが成功した。
- rolling release `20260727-003217-c1fd9a`後、Pi5 API/WebとPi4キオスク6台のrelease identityを統合SHAで確認した。
- 実機受入と後処理の完了後にPhase12を再実行し、`PASS 47 / WARN 0 / FAIL 0`だった。

## Interfaces and Dependencies

Web内部に、ページ所属判定、ページ抽出済みマーカーのcrop投影、crop内クリックの元ページ座標変換、共通マーカー描画レイヤー、ステップ別サムネイルViewModelを設ける。既存の`@raspi-system/shared-types`幾何関数、`ImageMarkerCalloutOverlay`、`ConfirmDialog`、React Virtualを再利用し、新しい外部依存は追加しない。
