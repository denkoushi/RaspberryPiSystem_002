# 組立要領書を非破壊オーバーレイで編集・版管理する

このExecPlanは living document である。リポジトリルートの `.agent/PLANS.md` に従い、`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を作業の進行に合わせて更新する。この文書だけを読んだ新しい担当者が、背景、設計、実装箇所、検証方法、残作業を再現できる状態を保つ。

## Purpose / Big Picture

利用者は、取り込んだ組立手順書の元ページを壊さず、ページ上の必要な範囲だけをテキスト、画像、直線・矢印・矩形・楕円として編集できる。編集内容は「文書版、ページ、元ページに対する0から1の正規化座標」を正本として一度だけ保存されるため、ページ全体表示と複数のcrop表示に同じ要素ID・同じ修正が投影される。cropとは別画像の複製ではなく、元ページの矩形範囲を見せる仮想的な窓である。

公開済み文書を編集すると新しいDRAFT版が作られ、旧テンプレートと開始済み作業は旧document IDを参照し続ける。新版は明示的に公開し、テンプレート改版時に採用する。OCRが失敗しても手入力、画像差替え、図形作成で編集を完遂でき、通常閲覧時にはOCRや画像切出しを呼ばない。対象入力は現行どおりPDF、PNG/JPEG/WebP、TIFF、最大40ページで、Excel、合成PDF出力、AI背景補完、全ページ自動分解は含めない。

## Progress

- [x] 2026-08-21 09:00+09:00: 現行文書取込、crop投影、テンプレート版、作業セッション、ストレージ、OCR、UI、CI/Docker境界を文書とコードから調査した。
- [x] 2026-08-21 10:00+09:00: lifecycle auditを実行し、`origin/main`の`81b17aa35c2f43bcc1e4d69872a0fec2071e0db6`から`feat/assembly-procedure-overlay-editing`のlinked worktreeを作成した。
- [x] 2026-08-21 14:00+09:00: overlay共有型、座標変換、expand-only sidecar migration、版管理、immutable asset、ROI画像・文字候補抽出を実装した。
- [x] 2026-08-21 17:00+09:00: 既存手順書routeを専用moduleへ分離し、文書詳細、テンプレート、作業手順列へreadonly overlayを統合した。
- [x] 2026-08-21 19:00+09:00: 専用文書editor、draft reducer、localStorage復旧、認証、409競合復旧、3種要素編集、公開・破棄UIを実装した。
- [x] 2026-08-21 20:30+09:00: API mapper/serializerとWeb command hook/selectorを分離し、巨大controller/serviceへの追記を解消した。
- [x] 2026-08-21 21:46+09:00: 一意label付き一時PostgreSQLで全159 migrationと実DB版ライフサイクルtestを完了し、container、volume、networkの残存0を確認した。
- [x] 2026-08-21 21:50+09:00: shared/API/Web build・lint・focused tests、Playwright 5件、17シートのSOP checkを完了した。
- [x] 2026-08-21 21:55+09:00: 責務、依存方向、test境界、判断、検証結果を本書へ反映した。
- [ ] integrationPending: push、PR、merge、deployは別途指示がないため未実施。feature worktree上の実装・検証完了状態を維持する。

## Surprises & Discoveries

- Observation: 現行PDF取込は最大40ページをJPEG化するが元PDFを保存せず、cropは独立画像ではなく元ページと正規化矩形による仮想viewだった。
  Evidence: 既存import serviceとCanvas/crop projectionを追跡し、新規取込だけexact source assetを追加しつつ既存文書は現在のページ画像を背景として扱った。
- Observation: テンプレートと作業セッションはdocument IDを保持するため、文書行を不変版とすると旧表示を自然に固定できる。
  Evidence: 実DB testでv1を参照する既存templateがv2作成・公開後もv1を参照し続けた。
- Observation: production migration gateは既存表へのNOT NULL/default列、後付けFK、unique index追加を拒否する。
  Evidence: 版情報を新規sidecarへ置き、asset owner FKを`ALTER TABLE`ではなく`CREATE TABLE`内へ定義するとexpand-only validatorが`EXPAND_ONLY_VALIDATION_OK`になった。
- Observation: 新規tableのUUIDと`updatedAt`にDB defaultがないと、省略INSERTがNULL制約に違反する。
  Evidence: 一時PostgreSQLの直接SQL検証で検出しmigrationへdefaultを追加した。
- Observation: 通常の`postgres:16-alpine`では既存pgvector migrationを適用できない。
  Evidence: `pgvector/pgvector:pg15`を一時検証imageに使い、全159 migrationをfresh DBへ適用した。
- Observation: 通常GCの最小保持時間を補償削除へ使うと、今回失敗した直後のassetを回収できない。
  Evidence: candidate限定の補償削除だけ`minAgeMs: 0`とし、広域GCは1時間・最大100件を維持した。
- Observation: 実DB testの最初のfixture後始末はrevision rootを守るRESTRICT FKに違反した。
  Evidence: sidecarを先に削除する順へ直し、再実行で1/1成功、`TEMP_RESOURCE_REMAINING=0`を確認した。製品の削除規則は緩めていない。
- Observation: local Playwright設定はWeb serverの事前起動を要求する。
  Evidence: 停止状態では`ERR_CONNECTION_REFUSED`、feature worktreeのViteを明示起動すると同じspecが5/5成功し、その後Viteを停止した。

## Decision Log

- Decision: 元ページ画像を変更せず、単色mask付きoverlayを重ねる。
  Rationale: 既存文書にも適用でき、軽く、元へ戻せ、full/cropを一つの正本から同期できる。
  Date/Author: 2026-08-21 / Codex orchestration team.
- Decision: 公開済み編集は新しい`AssemblyProcedureDocument`行を作り、版情報は1:1 sidecarへ保存する。
  Rationale: 既存参照のdocument IDを版固定に再利用し、既存表を変えないexpand-only migrationと両立する。
  Date/Author: 2026-08-21 / Codex orchestration team.
- Decision: Poppler、Sharp、既存座標付きOCR、Prisma、Reactを再利用し、DGX Sparkと重量級OSSを初回の必須依存にしない。
  Rationale: Pi4閲覧を軽く保ち、Pi5の明示的な編集操作だけでROI処理する。候補抽出不能でも手入力で完遂する。
  Date/Author: 2026-08-21 / Codex orchestration team.
- Decision: 文書編集はtemplate editorから分離した専用画面にする。
  Rationale: 文書版、template版、作業sessionの状態遷移を混在させず、依存方向をUIからdomain/APIへ一方向にする。
  Date/Author: 2026-08-21 / Codex orchestration team.
- Decision: IMAGE overlayは物理的に切り出したimmutable ROI assetを参照し、未使用の二重crop情報をpayloadへ持たない。
  Rationale: UIが内部cropを使わずDBも保存しない状態でのsave/load情報欠落を防ぐ。
  Date/Author: 2026-08-21 / Codex orchestration team.
- Decision: upload assetにはDRAFT owner leaseを持たせ、保存済み参照とownerを双方確認して削除する。
  Rationale: 未保存画像をGCから守り、別DRAFTへの横取りを409で防ぎ、discardではupload-only assetも回収する。
  Date/Author: 2026-08-21 / Codex orchestration team.
- Decision: 合成PDF、OCR job queue、DGX adapterを初回範囲に追加しない。
  Rationale: システム内表示と手動完遂で成功条件を満たすため、実測なしに防御機構を自己増殖させない。
  Date/Author: 2026-08-21 / Codex orchestration team.

## Outcomes & Retrospective

feature worktree上では目的を達成した。ライブラリから公開文書を認証してDRAFT改版し、範囲から文字候補または画像assetを作り、図形を追加し、明示保存・競合復旧・公開できる。readonly rendererはtemplate全体、crop、作業viewで共用され、旧document IDを参照するtemplateと開始済み作業は旧版のままである。OCR/DGXなしでも手入力、upload画像、図形で完遂できる。

責務とtest境界は次のとおりである。「依存先」は利用する下位層、「被依存先」は利用する上位層を表す。

| モジュール | 責務 | 依存先 / 被依存先 | test境界 |
| --- | --- | --- | --- |
| `packages/shared-types/src/assembly/assembly-procedure-overlay.ts` | union、Zod、bbox・clip・full/crop投影・hit test | Zod / API、Web | 純粋単体6件の一部 |
| `assembly-procedure-overlay.persistence.ts` | domain overlayとPrisma row/create入力の変換 | shared-types、Prisma型 / revision service | mapper純粋test 3件 |
| `assembly-procedure-document-revision.serializer.ts` | revision/overlay DTOと共通asset URL | persistence結果 / route、sequence | serializer純粋test 3件 |
| `assembly-procedure-document-revision.service.ts` | 改版、DRAFT再利用、保存、409、公開、破棄 | Prisma、asset lifecycle、mapper / route | mock単体と実Postgres統合1件 |
| `assembly-procedure-document-assets.service.ts`と`services/assembly-procedure-assets/` | immutable asset、Sharp ROI、Poppler、OCR fallback、owner lease | storage/画像/OCR adapter / route、revision | lifecycle、route、storage契約test |
| `routes/assembly/procedure-documents.ts`と`procedure-document-revisions.ts` | HTTP認証、入力検証、status、service合成 | domain services / Web API client | route test 5件 |
| Webのdraft/recovery/conflict/selectors | reducer、z順、dirty、localStorage、409再適用 | shared-types / controller、hooks | 純粋単体test |
| Webのrevision/overlay command hooks | load/save/publish/discardとROI/OCR/upload | API client、draft callback / controller | hook、Screen test |
| `useAssemblyProcedureDocumentEditorController.ts` | reducer、navigation、recovery、command合成 | pure modules/hooks / editor Screen | controller test、約260行 |
| Editor Canvas/Toolbar/Inspector/PageList/Dialog | 専用編集UI | controller state/actions / kiosk page | component、ARIA、viewport E2E |
| `AssemblyProcedureOverlayLayer.tsx` | full/crop共通readonly描画のみ | shared projection / Canvas、template、work | renderer/crop回帰test |
| SOP definitionとcapture adapter | 実画面fixture、画像、操作説明生成 | Playwright/Vite / manual、17 sheets | generator check、目視 |

既存`AssemblyProcedureCanvas`は背景と描画slotの責務が明確なため分割せず、overlay slotだけを追加した。asset serviceはstorage、ページ画像参照、OCR adapterを合成する約300行のapplication serviceとして残したが、I/O portは分離済みで単体差替え可能である。Inspectorは約310行だが一つの選択要素property編集に閉じ、3種の分岐が同じform状態を共有するため、今回さらに分ける利益より変更riskが大きいと判断した。

残る作業はrepository統合だけである。push、PR、merge、deployは許可されていないため行っていない。許可後はfeature branchをreviewし、CI成功、`origin/main`へのmerge、merged-main検証、lifecycle `finish`を別の運用工程として記録する。

## Context and Orientation

monorepoはpnpm workspaceで、`apps/api`がFastify/Prisma API、`apps/web`がReact/Vite kiosk UI、`packages/shared-types`がAPI/Web共通型と純粋計算、`infrastructure`と`scripts`が配備・backup・検証を担う。schemaは`apps/api/prisma/schema.prisma`、migrationは`apps/api/prisma/migrations/20260821120000_assembly_procedure_overlay_editing/migration.sql`である。

`AssemblyProcedureDocument`の一行は一つの不変版である。`AssemblyProcedureDocumentRevision`は系列root、版番号、直前版、head、楽観lock用`editVersion`、原本assetを持つsidecarで、既存文書はsidecarなしの互換版1として遅延解釈する。楽観lockは画面が読んだ`expectedEditVersion`とDBの現在値を保存時に比較し、他の保存が先行したら409を返して上書きを防ぐ仕組みである。

`AssemblyProcedureOverlayElement`はページ、安定ID、種類、正規化bbox、z-index、mask、種別payload、asset参照を持つ。正規化bboxは左上0,0、右下1,1なので、画面サイズやcropが変わっても同じ位置を計算できる。DB CHECKとZod/domainの双方が0..1、正の幅・高さ、ページ内収まりを検証する。

`AssemblyProcedureAsset`は原本または差替え画像をUUID名の不変fileとして管理し、MIME、byte数、SHA-256、storage key、任意のDRAFT ownerを持つ。JSONへbase64は含めず拡張子付きURLで配信する。新規取込失敗時は今回作ったassetだけを補償削除し、共有assetやページ画像は参照数を確認して削除する。

## Plan of Work

Milestone 1ではshared-typesへunionと純粋座標演算を追加し、APIとWebが同じ契約を使う。bbox境界、包含、clip、hit test、full/crop投影の単体testで証明する。

Milestone 2ではPrismaへ3つのadditive tableとindex/check/FKを追加し、durable namespaceをDocker bind、Ansible permission、backup catalog、integrity policyへ通す。既存表の破壊的変更や事前backfillは行わない。fresh DBとmain相当からのupgrade、再適用、直接SQL、EXPLAINで確認する。

Milestone 3では版管理domain、asset lifecycle、ROI/OCR ports/adapters、薄いHTTP routeを実装する。既存URLを保ち、summaryは重いpayloadを返さず、detailと作業sequenceだけページ別overlayを返す。変更系は既存管理passwordを要求し、競合は現在editVersion付き409を返す。

Milestone 4では専用React editorを認証gate、版header、page list、canvas、toolbar、inspector、dialog、pure reducer、I/O commandへ分割する。既存Canvasには描画slotだけを置き、readonly layerをfull/crop/template/workで共用する。localStorage keyはdocument versionとeditVersionを含む。

Milestone 5ではfocused tests、実PostgreSQL、Playwright、SOP生成を行う。通常閲覧がROI/OCRを呼ばないこと、3 viewportで崩れないこと、旧参照が固定されること、OCR不能でも手動成功経路があることを証明する。

## Concrete Steps

作業場所は次のlinked worktreeだけである。

    cd /Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--assembly-procedure-overlay-editing
    git branch --show-current
    # feat/assembly-procedure-overlay-editing

開始時の再現手順は元repoで次のとおりだった。既に開始済みなので同名worktreeを再作成しない。

    cd /Users/tsudatakashi/RaspberryPiSystem_002
    python3 -m scripts.git_lifecycle.cli audit --json
    python3 -m scripts.git_lifecycle.cli start --branch feat/assembly-procedure-overlay-editing

共有型、API、Webの検証はworktree rootから実行する。

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/shared-types test
    pnpm --filter @raspi-system/shared-types lint
    DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused pnpm --filter @raspi-system/api exec prisma validate --schema prisma/schema.prisma
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/web build
    pnpm --filter @raspi-system/web lint

Playwrightはlocal設定上Webを先に起動する。API応答はspecがroute mockする。

    pnpm --filter @raspi-system/web dev --host 127.0.0.1 --port 4173
    PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 PLAYWRIGHT_HTML_OPEN=never pnpm exec playwright test e2e/assembly-procedure-document-editor.spec.ts --workers=1

別terminalで実行し、5 passed後にViteへCtrl-Cを送る。SOPは次を実行する。

    node scripts/kiosk-sop/generate.mjs check --manual assembly-procedure-template
    # Generated assembly-procedure-template kiosk SOP is current.

実DB検証は`pgvector/pgvector:pg15`から一意run IDと専用labelのcontainer、volume、networkを作り、localhost動的portだけを公開する。`EXIT/INT/TERM` trapで今回の3資源を明示削除する。全159 migrationを適用し、`TEST_DATABASE_URL`だけを渡して実DBtestを行う。既存DB、固定名helper、`db reset`、`db push`、`docker system prune`は使わない。

## Validation and Acceptance

2026-08-21の統合状態で次を確認した。

- shared-typesは2 files / 6 tests、build、lintが成功した。
- APIはPrisma validate、build、lint、関連11 files / 30 testsが成功した。
- 一時PostgreSQLへ全159 migrationを適用し、実DB版ライフサイクル1/1が成功した。legacy PUBLISHEDからv2 DRAFT、DRAFT再利用、saveによるeditVersion増加、stale 409とDB不変、publish後の旧template固定、v3 discard後のv2 head復帰を確認した。
- SQL CHECK/FK/UNIQUEへ範囲外bbox、variant不整合、存在しないpage、複数headを直接投入して拒否を確認した。代表queryは`AssemblyProcedureOverlayElement_idx_document_page_z`と`AssemblyTemplate_idx_document_active_updated`を使用した。
- Webはbuild、lint、関連14 files / 49 testsが成功した。範囲選択、3種要素、編集、削除、z順、復旧、full/crop同期、clip、readonly、認証、409保持、keyboard/ARIAを含む。
- Playwrightは5/5成功した。改版、TEXT、ROI IMAGE、ARROW、保存、2つの409復旧選択、公開、1366x768・1920x1080・900x900、readonly経路のROI/OCR request 0を確認した。
- file storage契約Python 4 tests、API backup/storage 2 files / 9 tests、backup shell syntax、source policy compileが成功した。
- SOP checkが成功し、編集導線を含む17 sheetsとHTML previewを生成・目視確認した。
- 一時DB各実行後に`TEMP_RESOURCE_REMAINING=0`、Vite/Playwright停止後にfeature worktree由来の常駐test processなしを確認した。

人が確認する場合は、libraryで公開文書の「編集／改版」を開き、認証後に範囲を選ぶ。TEXTなら候補を修正し、IMAGEなら切出しまたはuploadを選び、SHAPEなら矢印等を置く。保存・公開後、新版を採用したtemplateのfull/cropに同じ変更が見え、旧templateと開始済み作業には変更が見えないことが成功条件である。

## Idempotence and Recovery

migrationはadditiveで、`prisma migrate deploy`再実行は「No pending migrations」になる。既存文書は全件backfillせず、初改版時だけ互換版1のsidecarを作る。同じheadへのDRAFT作成を繰り返すと既存DRAFTを返す。stale saveは409でDBを変えず、UIはlocal draftを保持して再読込または最新版への再適用を選ばせる。

取込やROI作成が途中失敗したら今回作ったassetだけをcandidate指定で補償削除する。通常GCは保持時間と件数上限を持ち、参照中またはactive DRAFT owner付きassetを消さない。公開版はgeneric delete/unpublishせずrevision lifecycle経由で扱う。DRAFT discardは直前版をheadへ戻す。

一時DBは毎回新しい明示名とlabelを使い、trapで正確なcontainer、volume、networkだけを削除する。失敗時もlabel残存数を調べ、0でなければそのrun IDだけを削除する。既存Docker資源を広域削除しない。

## Artifacts and Notes

主要証跡は次のとおりである。

    Test Files  11 passed (11)
         Tests  30 passed (30)       # API focused

    Test Files  14 passed (14)
         Tests  49 passed (49)       # Web focused/related

    ✓ assembly-procedure-document-revision.integration.test.ts (1 test)
    REAL_DB_INTEGRATION_OK migrations=159
    TEMP_RESOURCE_REMAINING=0

    5 passed (17.6s)                 # focused Playwright
    Generated assembly-procedure-template kiosk SOP is current.

SOPは`apps/web/src/generated/kiosk-sop/assembly-procedure-template/`、HTML previewは`docs/design-previews/kiosk-assembly-procedure-template-sop.html`、E2E契約は`e2e/assembly-procedure-document-editor.spec.ts`にある。

## Interfaces and Dependencies

共有contractは`AssemblyProcedureOverlayElementSchema`を中心とする判別可能unionで、TEXTは本文・文字style、IMAGEはasset ID・object fit、SHAPEは種類・線・塗り・始終点を持つ。bboxは`xRatio`、`yRatio`、`widthRatio`、`heightRatio`で表す。APIとWebは同じschemaを使い、PrismaやReactへ業務検証を複製しない。

APIは既存URLを保ち、改版create/get/discard、`expectedEditVersion`付き全体差分save、ROI文字候補、ROI画像asset、multipart upload、DRAFT publishを提供する。変更系は既存`AssemblyTemplateAccessService`のpasswordを要求する。summaryはoverlay payloadを含めず、detailと参照中documentのsequenceだけがページ別overlayを含む。

I/O依存は既存Sharp、Poppler、座標付きOCR、durable storageである。PopplerがデジタルPDFのROI文字を返せなければOCRへfallbackし、低信頼・失敗は空候補として手入力へ戻す。Pi4 browserは選択・描画・投影だけを行い、readonly閲覧で画像処理APIを呼ばない。DGX推論は依存に追加していないが、将来実測不足時にOCR portの別adapterとして追加できる。

Revision note (2026-08-21): 実装完了に合わせ、調査だけの短い計画を自己完結型の実行・引継ぎ文書へ更新した。sidecar設計、asset lease、責務分割、失敗から得た知見、全検証証跡、integrationPendingを記録した。
