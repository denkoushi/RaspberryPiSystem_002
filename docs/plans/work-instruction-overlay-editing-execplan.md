# Work Instruction Overlay Editing and Versioned Publication

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` current while implementation
proceeds. It follows `.agent/PLANS.md`.

## Purpose / Big Picture

加工要領書のGmail/SharePoint取込原本を変更せず、公開中の原本画像に
TEXT/IMAGE/SHAPE注記を重ねて編集・下書き保存・公開できるようにする。
新しい原本が再取込されても作業者には旧公開版を表示し続け、管理者は旧注記を
新版へ移植・調整して一括公開できる。新版公開後は旧画像bytesだけを明示削除し、
版・注記・公開・削除監査は残す。

## Progress

- [x] 2026-08-31: 現行WorkInstruction、Assembly editor、asset GC、認可、
  Docker検証規約を読み取り専用で調査した。
- [x] 2026-08-31: lifecycle audit後、`origin/main`
  `a8799ef04a01a4de58337ae970e5ec0e7bf17fa3` から
  `feat/work-instruction-overlay-editing` worktreeを作成した。
- [x] 2026-08-31: 共通overlay/image-region primitiveを抽出し、Assembly互換wrapperを維持した。
- [x] 2026-08-31: expand-only migrationと、immutable source version、publication、
  edit revision/overlay、source/edit asset、削除監査、冪等backfillを追加した。
- [x] 2026-08-31: 取込、公開read、editor API、移植、公開、旧画像削除を実装し、
  楽観lock・group境界・asset GC・canonical DTOのreview指摘を解消した。
- [x] 2026-08-31: Viewerと専用Editor route、multi-row controller、local recovery、
  競合回復、比較、未割当先選択、ADMIN削除UIを実装した。
- [x] 2026-08-31: focused test、1280/1800px E2E、disposable Postgresでの
  migration二重適用・SQL制約・ANALYZE/EXPLAIN・integrationを完了した。
- [x] 2026-08-31: PR #1307のkiosk-sop契約で検出されたsheet画像のdecode前撮影を修正し、
  canonical check、artifact semantic/integrity/geometry/visual contract、18件E2Eを完了した。
- [x] 2026-08-31: API全suiteで既存scheduler配線testのFastify stub不足を検出し、
  Editor route登録に必要な`put`/`delete` stubを補ってfocused testを再通過した。

## Surprises & Discoveries

- `WorkInstructionStep` は再取込時に `deleteMany + create` されるため、step UUIDは
  編集の安定キーにできない。
- 表示groupは保存モデルではなく `partNumber + shootingTarget` のread-time集合で、
  永続化の安定単位はsource tupleである。
- 現行GCはcurrent step参照だけを確認するため、source version参照を追加しないと
  旧公開画像を削除してしまう。
- Assembly互換wrapperを残すことで、既存API payloadとtest idを変えずにshared overlay型、
  ROI、OCR adapter、line groupingを中立化できた。
- 初回backend reviewで既存DRAFT読取時のoverlay重複と、旧画像削除のlock・冪等性不足を
  検出したため、統合前に差し戻した。
- mixed rollout時にpublication未作成rowだけをlatest表示へfallbackしないと、一部行が
  groupから消えることを検出し、公開pointerのあるrowをlatest groupへ漏らさないqueryへ直した。
- ROI由来IMAGEは手動uploadと区別できるprovenanceが必要だったため、由来source version、
  step、bboxをedit assetへ保持し、新版copy後に同じbboxから再切り出す設計へ拡張した。
- SQL検証fixtureと同じDBで既存integrationを併走すると、全DB行数を仮定したテストが
  影響を受けた。source identityでfixtureを限定し、独立して並走可能なtestへ修正した。
- SOPの元screen PNGが同一でも、sheet合成時に埋込画像のdecode完了を待たないと、画像領域が
  空白のPNGを生成し得た。全imgの`complete`/`naturalWidth`、font、2 RAFを待つことで決定化した。

## Decision Log

- 既存 `WorkInstructionRow/Step` はlatest取込キャッシュとして維持し、編集しない。
- source tuple単位のimmutable versionとpublication pointerを追加し、group画面では
  複数pointerを合成する。group公開は一transactionで切り替える。
- 再取込はlatestだけ進め、publishedを自動変更しない。
- 旧画像削除は公開transactionから分離し、DB参照解除、DELETE_PENDING、物理削除、
  asset row削除の順で実行する。
- 既存データの初期版化はmigration DMLではなく冪等なapplication backfillとする。

## Context and Orientation

現行schemaは `apps/api/prisma/schema.prisma` の `WorkInstructionRow`、
`WorkInstructionStep`、`WorkInstructionAsset`。取込transactionとGCは
`apps/api/src/services/work-instructions/repositories/prisma-work-instruction.repository.ts`、
公開Viewerは `apps/web/src/features/work-instructions/WorkInstructionViewerDialog.tsx`。
再利用元は `apps/web/src/features/assembly/document-editor` と
`apps/api/src/services/assembly-procedure-assets` だが、Assembly固有文書・PDF・機械・
ボルト・検査項目は加工側へ持ち込まない。

## Plan of Work

1. overlay型・geometry・renderer・editor操作とROI/OCRの純粋境界を中立化し、
   Assembly adapterで既存APIとtest idを保持する。
2. additive Prisma migrationでsource version/step、publication、revision/overlay、
   edit asset、削除監査を追加し、pure domainとPrisma repositoryを分離する。
3. 取込時のversion作成/latest更新、published group query、冪等backfill、revision
   save/publish/discard、移植、asset lifecycle、旧画像削除を実装する。
4. 既存Viewerへ公開overlayを合成し、専用Editor routeへ編集UIを追加する。
5. unit/integration/E2Eを追加し、disposable Postgresでmigration二重適用、SQL、
   ANALYZE、EXPLAIN、resource cleanupを確認する。

## Validation and Acceptance

v1画像A＋注記R1を公開後、v2画像Bを再取込してもViewerはA＋R1を表示する。
R1をBへ移植・調整・公開するとViewerはB＋R2へ切り替わる。旧Aは自動GCされず、
ADMINの明示削除後にbytesとasset rowだけが消え、監査とrevision metadataは残る。
OCR/ROI失敗時も手入力/uploadで完遂でき、stale saveは409でserver/local draftを保つ。

検証は `scripts/test/work-instructions-validation.sh` が作る一時Postgres/volume/storage
だけを使用し、既存Docker資源を変更しない。終了時 `TEMP_RESOURCE_REMAINING=0` を確認する。

## Idempotence and Recovery

source versionはsource identityとcontent hashの一意性で重複作成を防ぐ。backfillは
row単位transactionで再実行可能にする。publishはexpected edit/source versionを検証し、
競合時は旧publishedとdraftを変更しない。物理削除失敗はDELETE_PENDINGと監査を残し、
cleanupで再試行する。

## Outcomes & Retrospective

実装は完了した。責務と依存方向は次の境界に固定した。

- `packages/shared-types/src/overlay` と `apps/web/src/features/overlays` は正規化座標、
  overlay型、geometry、描画primitiveだけを担当し、WorkInstruction/Assemblyの業務規則を知らない。
  Assembly側は互換wrapperを通すため既存payload/test idを維持する。pure unit testが境界である。
- `apps/api/src/services/image-region` は画像読取、ROI、OCR portだけを担当し、Assemblyと
  WorkInstructionはadapterから利用する。Sharp/OCR adapter testが境界である。
- WorkInstruction repositoryはPrisma transaction、immutable source version、publication pointer、
  revision/asset永続化だけを担当し、domainの移植・競合規則は`domain/editing.ts`とedit serviceへ分離した。
  domain unit testとdisposable PostgreSQL integrationが境界である。
- Web editor controllerはAPI DTOをpure draft reducerへ接続し、Canvas/Inspector/Dialogは表示と入力だけを
  担当する。controller/reducer component testとPlaywright E2Eが境界である。

検証結果は、shared-types build/lint/test 12件、API build/lintとfocused 19件、Web build/lintと
WorkInstruction回帰39件、disposable PostgreSQL integration 25件、Playwright 2 viewportが合格した。
migrationはfresh deploy、2回目No pending migrations、status、expand-only candidate preflightを通過した。
SQLでCHECK/FK/UNIQUE/partial head、pointer整合、GC anti-join、削除tombstone/監査を検証し、主要queryの
`EXPLAIN (ANALYZE, BUFFERS)`を取得した。全検証の一時container・volume・storageはtrapで削除され、
`TEMP_RESOURCE_REMAINING=0`を確認した。実装commitをpushしPR #1307を作成した。CIで検出した
kiosk-sop生成の待機不足は追補修正し、同一Docker契約と18件E2Eを再検証した。merge、deployは
別途承認まで実施しない。
