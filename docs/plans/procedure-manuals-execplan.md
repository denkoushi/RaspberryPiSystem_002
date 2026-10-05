# 機種×工程ごとの要領書を、組立手順書を正本にして閲覧・作成できるようにする

This ExecPlan is a living document and must be maintained according to `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must stay current while work proceeds.

## Purpose / Big Picture

現場では、機種(型番。例 `DFD6362XYZ-3943173`)ごと、工程(組立工程、検査工程)ごとに「要領書」を見たい。いまは組立キオスクの手順書(`AssemblyProcedureDocument`。画像ページに丸数字・チェック・締付トルクを重ねる文書)が、締付テンプレートの中からしか引けない。閲覧だけしたい人が、作業セッションやテンプレートを作らずに「機種を選ぶ → 工程を選ぶ → 要領書が開く」だけで済むようにしたい。あわせて、これから作る要領書を、素材(文・写真・のちに動画)をメールで送って取り込み、自由に配置して作り込めるようにし、フローティング Chat のナレッジ機能が集めた素材や承認済み手順も同じ要領書に取り込めるようにする。

この計画は、新しい文書エンジンを作らない。文書の正本は既存の `AssemblyProcedureDocument` 系(ページ画像、`AssemblyProcedureOverlayElement` による自由配置、改版 `AssemblyProcedureDocumentRevision`、DRAFT/PUBLISHED)のままとし、その上に「機種×工程の分類」「素材棚」「専用件名の Gmail 取込」を薄く足す。こうすると、ここで作った要領書を締付テンプレートの表示ステップ(`AssemblyTemplateProcedureItem`/`AssemblyTemplateProcedureStep`)にそのまま置けるため、「要領書と締付・チェックの組み合わせ」が変換なしで成立する。ナレッジ(`KnowledgeProcedure` 系)は素材と承認済み手順の供給元として片方向で連携し、文書モデルは統合しない。

利用者から見える完成の証拠は次のとおりである。キオスクの組立ホームに「要領書」の入口があり、開くと機種の一覧(型番、半角大文字で正規化)が出る。機種を選ぶと「組立工程 > 組立工程」「組立工程 > 検査工程」のような工程が出て、工程を選ぶと、その機種×工程に割り当てた要領書が並び順どおりに表示される。要領書は既存の組立手順書ビューア(ページ送り、丸数字などの注記表示)で開く。同じ要領書を複数の機種に割り当てられ、共通作業の文書を 1 つに集めて複数機種から参照できる。割り当てられている要領書は、既存の手順書管理から誤って削除・公開取消できない。

## Progress

- [x] (2026-10-05) 既存 5 系統(組立手順書、作業要領 `WorkInstruction`、キオスク文書 `KioskDocument`、ナレッジ `Knowledge`、kiosk-sop)を Codex(`gpt-6.1-sol`/`high`、read-only)で比較分析し、Claude が根拠行を確認した。結論は「組立手順書を正本に、分類を薄く追加」。
- [x] (2026-10-05) オーナーが設計判断 5 点を決めた(Decision Log 参照)。
- [x] (2026-10-05) feature branch `feat/procedure-manuals-phase1` と worktree を `scripts.git_lifecycle.cli start` で作成(起点 `origin/main` = `e001c7fa`)。
- [x] (2026-10-05) Phase 1 ローカル実装: 工程マスタと機種×工程の割り当てモデル、4 本の API、キオスク閲覧・編集、参照使用判定を実装。Prisma Client 生成成功。
- [x] (2026-10-05) Phase 1 指定検証: API lint / vitest 12 件 / build 用 tsc、Web lint / vitest 4 件 / build がすべて成功。既存 API 回帰 4 件とビューア回帰 4 件も成功。
- [ ] Phase 1 実 DB・実画面確認: マイグレーション適用、実 PostgreSQL 上での並び置換とロールバック、API/Web を起動したキオスク操作は未実施。今回のテストは既存パターンに合わせた Prisma モックと Testing Library による検証。
- [ ] Phase 2: 専用件名の Gmail 素材取込、素材棚、白紙ページ追加、NFC 承認による公開。
- [ ] Phase 3: ナレッジ素材・承認済み手順の片方向連携。
- [ ] 後日: 動画素材(形式未定)。

## Surprises & Discoveries

- Observation: 既存の「機種名ごとの閲覧順」(`AssemblyProcedureOrderSet`/`AssemblyProcedureOrderItem`)は、旧テンプレート向けの読み取り専用互換層で、公開 API から変更できない。
  Evidence: `apps/api/src/services/assembly/assembly-legacy-procedure-order.service.ts` 冒頭のコメント「Read-only compatibility adapter … No public API may mutate this data.」。ここに機種×工程を足さず、新モデルにする。
- Observation: 組立手順書の Gmail 取込は件名 `DocumentASM` の完全一致かつ添付 1 件(PDF または JPEG)という契約で、本文・複数写真・動画を受ける素材取込にはそのまま使えない。
  Evidence: `apps/api/src/services/assembly/assembly-procedure-gmail-import.service.ts` の `hasExactAssemblyProcedureGmailSubject` と `selectSingleAssemblyProcedureAttachment`。
- Observation: 在庫の Gmail 取込は `CsvImportSubjectPattern` ではなく、`backup-config.ts` の専用設定 `itemInventoryGmailIngest`(先頭トークン `[ItemlistRaspi-photo]`)で動く。件名の予約は `apps/api/src/services/gmail/gmail-subject-reservation.policy.ts` に集約されている。
- Observation: オーバーレイの共通型は TEXT/IMAGE/SHAPE のみで、保存できる MIME にも動画がない。共通型の変更は作業要領側にも波及する。
  Evidence: `packages/shared-types/src/overlay/normalized-overlay.ts` の `overlayElementSchema`、`apps/api/src/services/assembly-procedure-assets/local-assembly-procedure-asset-storage.adapter.ts` の `MIME_TO_EXTENSION`。
- Observation: 既存ビューア `AssemblyProcedureSequenceViewer` は締付・チェックのマーカーを省略でき、`KioskDocument`(PDF)と `AssemblyProcedureDocument`(画像)の混在列を表示できる。閲覧ページはこれを流用できる。

- Observation: 既存手順書 summary API は改版の先頭だけを返すため、先頭が DRAFT の系列では旧公開版が一覧に含まれない。
  Evidence: `AssemblyProcedureDocumentService.listSummary` の `isRevisionHead` 条件。編集候補は既存の GET revisions API で最新の active PUBLISHED 版を補完し、Web テストで確認した。
- Observation: Web の `api/client.ts` はドメイン API の再エクスポート専用 facade である。
  Evidence: `export * from './domains/assembly'`。新 API 関数は既存の `api/domains/assembly.ts` に追加し、client からそのまま利用できる。
- Observation: worktree には依存パッケージの dist がなく、初回 API tsc は shared-types / shelf-layout-core 等のモジュール解決で失敗した。また Prisma の通常生成はユーザーキャッシュの utime が EPERM となった。
  Evidence: ワークスペース 4 パッケージの build 後の tsc は成功。既存の Prisma query/schema engine を環境変数で明示した generate も成功。追跡対象の依存ファイルや .env は変更していない。

## Decision Log

- Decision: 文書の正本は `AssemblyProcedureDocument`。新しい文書モデルは作らない。
  Rationale: 自由配置、改版、公開、Gmail 取込、キオスク閲覧がそろっており、締付テンプレートが同じ ID を参照するので「1 と組み合わせる」が自動で満たされる。
- Decision: 機種キーは型番とし、`normalizeMachineNameForCompare`(全角→半角、前後空白除去、大文字化)で正規化した値を比較キーに持つ。表示用には入力時の文字列も保存する。
  Rationale: オーナー決定(2026-10-05)。既存の機種名比較と同じ規則にそろえる。
- Decision: 工程は 2 階層の管理リスト(工程マスタ)とし、初期値は「組立工程」の下に「組立工程」「検査工程」。資源 CD の割り当ては未定なので、任意の `resourceCd` 列を持たせるだけで、いまは使わない。
  Rationale: オーナー決定。資源 CD が決まったときに列を埋めるだけで済むようにする。
- Decision: 1 組の機種×工程に複数の要領書を並び順付きで置ける。同じ要領書(改版ルート)を複数の機種×工程に割り当てられる。
  Rationale: オーナー決定「どちらも必要」「共通作業は共通文書へ集合させたい」。
- Decision: 割り当ては文書の個別版ではなく「改版ルート」(`AssemblyProcedureDocumentRevision.revisionRootId`。改版履歴に属さない文書は自分自身がルート)を指し、閲覧時にそのルート系列の最新 PUBLISHED 版を解決する。
  Rationale: 改版しても割り当てを付け直さずに済み、下書き作成中も旧公開版を表示し続けられる。
- Decision: 新機能で作る要領書の公開は、ナレッジと同じ NFC 承認(社員タグ + 職位)で行う。これは Phase 2 で扱い、Phase 1 は既に PUBLISHED の文書を割り当てて閲覧するだけとする。
  Rationale: オーナー決定「後者(NFC 承認)」。Phase 1 では新しい公開経路を作らないので、既存のパスワード公開と衝突しない。
- Decision: 素材メールは保存成功後にゴミ箱へ移す。動画は形式未定のため後日。Phase 2 で動画を扱う場合も、ページに貼る要素ではなく素材棚からダイアログ再生する添付として扱い、共通オーバーレイ型を変えない。
  Rationale: オーナー決定。共通型の変更が作業要領側に波及するのを避ける。
- Decision: ナレッジ連携は「同じ機種×工程に関連する素材・承認済み手順を一覧し、明示選択で取り込む」片方向のみ。双方向同期はしない。
  Rationale: オーナー決定。AI 再構成と手動配置の衝突を避ける。
- Decision: 割り当てには `KioskDocument`(PDF 要領書)も `AssemblyProcedureDocument` と同じく置ける。
  Rationale: 既存の `AssemblyTemplateProcedureItem` と同じ 2 択の形にすれば、ビューアもそのまま使え、既存 PDF を「ただ見る」用途が Phase 1 で満たせる。

- Decision: 割り当て置換は新しい工程行を FOR UPDATE でロックしてから検証・deleteMany/createMany を同じトランザクション内で実行する。
  Rationale: 割り当てがまだない機種×工程でも置換同士が競合しない。工程単位の短い直列化とし、新たなロック用モデルは追加しない。
  Date/Author: 2026-10-05 / Codex。
- Decision: 参照使用判定は割り当て先ルートと、その系列で閲覧対象になる最新 active PUBLISHED 版を守る。より古い版には追加の割り当てガードを付けない。
  Rationale: 割り当て先と表示中の文書を守りつつ、既存の版履歴・旧版整理の規則を維持する。
  Date/Author: 2026-10-05 / Codex。
- Decision: 新ルートの sequence は既存 DTO の source 値 `primary_fallback` と `stepSource: document_expansion` を再利用する。分類の情報は新ルートの assignments が持つ。
  Rationale: 文書全体を展開する既存ビューア・直列化関数を流用し、既存の共有文書列契約やオーバーレイ型を変更しない。
  Date/Author: 2026-10-05 / Codex。

## Context and Orientation

このリポジトリは pnpm ワークスペースで、`apps/api` が Fastify + Prisma(PostgreSQL)の API、`apps/web` が React(Vite)の Web、`packages/shared-types` が共有の型である。キオスク画面は `apps/web/src/pages/kiosk/` にあり、ルートは `apps/web/src/App.tsx` に列挙されている。組立キオスクのホームは `apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx` で、ナビゲーションのリンク群(`aria-label="組立メニュー"`)から各画面へ飛ぶ。

組立手順書の API は `apps/api/src/routes/assembly/` にあり、文書の一覧・取得・公開は `procedure-documents.ts`、改版は `procedure-document-revisions.ts`、本体のサービスは `apps/api/src/services/assembly/assembly-procedure-document.service.ts` である。閲覧順の解決は `assembly-procedure-sequence.service.ts` が行い、`KioskDocument` と `AssemblyProcedureDocument` を同じ形(`AssemblyProcedureSequenceItemSummary`)にそろえる関数が `assembly-procedure-sequence-item.ts` にある。文書の削除・公開取消の前に参照の有無を数える `getReferenceUsage` が `assembly-procedure-document.service.ts` にあり、新しい参照元はここに加えないと、使用中の文書が消せてしまう。

ルートの認可は `apps/api/src/routes/assembly/index.ts` で定義される `allowView`(閲覧。ユーザー JWT または端末キー)と `allowWriteKiosk`(書き込み。ユーザー JWT が通ればそれを使い、通らなければ端末キーの書き込み権限で判定)を使う。新しいルートも同じ 2 つを使う。

Web 側の API 呼び出しは `apps/web/src/api/client.ts` に関数として追加し、組立機能の型は `apps/web/src/features/assembly/types.ts` に置く。既存ビューアは `apps/web/src/features/assembly/AssemblyProcedureSequenceViewer.tsx` で、`sequence`(文書列と表示ステップ)を渡すと表示し、締付・チェックのマーカーは省略できる。

Prisma のスキーマは `apps/api/prisma/schema.prisma`、マイグレーションは `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` で、既存の運用方針により「追加のみ」(expand-only。既存テーブルの列削除や制約追加はしない)で書く。

## Plan of Work

### Phase 1: 分類と単独閲覧

Phase 1 が終わると、管理者が既存の公開済み手順書(画像)やキオスク PDF を「型番 × 工程」に並び順付きで割り当てられ、現場の誰もがキオスクの組立ホームから「要領書」→ 機種 → 工程 → 文書の順に開いて閲覧できる。割り当てられた文書は、既存の手順書管理から削除・公開取消できなくなる。

データモデルは 2 つ追加する。`ProcedureManualProcess` は工程マスタで、`id`、`parentId`(任意)、`name`、`sortOrder`、`active`、`resourceCd`(任意、いまは未使用)を持ち、マイグレーションで「組立工程」とその子「組立工程」「検査工程」を初期投入する。`ProcedureManualAssignment` は割り当てで、`id`、`modelCode`(入力どおりの型番)、`modelCodeKey`(正規化した比較キー)、`processId`、`kioskDocumentId`(任意)、`assemblyProcedureDocumentId`(任意。改版ルートの文書 ID を入れる)、`sortOrder`、`label`(任意)、`createdAt`、`updatedAt` を持つ。2 つの文書参照はどちらか一方だけが入る。`(modelCodeKey, processId, sortOrder)` を一意にし、文書への外部キーは `onDelete: Restrict` にする。

API は `/assembly/procedure-manuals` 配下に置く。工程マスタの一覧(閲覧)、機種一覧(割り当てが 1 件以上ある `modelCodeKey` を重複なく返す。閲覧)、機種×工程の割り当て一覧と解決済み文書列(閲覧。`assemblyProcedureDocumentId` は改版ルートとして扱い、そのルート系列で `status = PUBLISHED` かつ `isActive` の最新版を返す。見つからなければその項目は「公開版なし」として返し、他の項目の表示を止めない)、割り当ての置換(書き込み。1 つの機種×工程の並びをまとめて受け取り、トランザクションで差し替える)を用意する。文書列は既存の `AssemblyProcedureSequence` の形(`serializeProcedureSequence` が返す形)にそろえ、`stepSource` は文書展開(ページ全体を順に見せる既存の fallback 相当)にする。

`getReferenceUsage` と `isReferenced`、`buildInUseMessage` に `inProcedureManualAssignment` を加え、割り当てられた文書(改版ルートまたはその系列の文書)は削除・公開取消を拒否する。改版ルートで割り当てている以上、系列内の旧版 1 件の整理は妨げない範囲にとどめ、少なくとも「割り当て先の ID と一致する文書」は確実に守る。

Web は `/kiosk/assembly/manuals` に閲覧ページを追加し、`KioskAssemblyHomePage` のナビゲーションに「要領書」リンクを足す。ページは左に機種一覧(検索付き)、機種を選ぶと工程一覧、工程を選ぶと文書列が `AssemblyProcedureSequenceViewer` で表示される 3 段構成とする。管理者向けの割り当て編集は、同じページの「割り当てを編集」ボタンから開くダイアログとし、公開済み文書(`listAssemblyProcedureDocumentSummaries` 相当)とキオスク PDF から選んで並び替え、保存する。閲覧専用端末では編集ボタンを隠す必要はないが、保存時に 403 なら「権限がありません」と表示する。

テストは、API のルート/サービスに vitest を追加し、割り当て置換の一意制約、改版ルートの公開版解決(下書きが先頭でも旧公開版が返る、公開版なしの項目が他を止めない)、`getReferenceUsage` が割り当てを検出すること、Web の 3 段構成の表示と編集ダイアログの保存をテストする。

### Phase 2: 素材取込と作成

専用件名(仮 `[Procedure-material]`。`gmail-subject-reservation.policy.ts` に予約し、CSV 件名パターン登録の拒否と、他の Gmail 消費者の除外にも加える)で届いたメールの本文と複数の写真を、`ProcedureMaterial`(素材棚。文・写真、取込元メール ID、保存先、配置先文書)として保存し、保存成功後にメールをゴミ箱へ移す。検索ポリシー、先頭トークン照合、送信元照合、冪等・再試行、ack は在庫取込(`apps/api/src/services/item-inventory/`)を模倣し、在庫の固定 JSON 契約は流用しない。設定は `backup-config.ts` に専用項目を足す。

編集側は、既存の文書エディタ(`apps/web/src/features/assembly/document-editor/`)に「白紙ページを追加」と「素材棚から配置」を足す。素材の写真は IMAGE オーバーレイとして置き、文は TEXT オーバーレイとして置く。未配置の素材が GC で消えないよう、`assembly-procedure-asset-gc.service.ts` の保持判定に素材参照を加える。公開は、ナレッジの承認(`apps/api/src/services/knowledge/knowledge-position-rank.ts` の `canApprove`、社員タグ照合、`KnowledgeProcedureReview` 相当の記録)と同じ規則を、要領書向けの承認記録として実装する。既存のパスワード公開は締付テンプレート向けに残す。

### Phase 3: ナレッジ連携

機種×工程の閲覧・編集画面から、同じ型番・工程名に関連するナレッジ素材(`KnowledgeProcedureMaterial`)と承認済み手順(`KnowledgeProcedure` の `publishedRevision`)を一覧し、利用者が明示的に選んだものだけを素材棚へコピーして配置できるようにする。出典(ナレッジ側の ID と版)を素材に保持する。ナレッジ側のデータは変更しない。

## Concrete Steps (Phase 1)

作業は worktree `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--procedure-manuals-phase1`(branch `feat/procedure-manuals-phase1`)で行う。

1. `apps/api/prisma/schema.prisma` に `ProcedureManualProcess` と `ProcedureManualAssignment` を追加し、`AssemblyProcedureDocument` と `KioskDocument` に逆参照を足す。`apps/api/prisma/migrations/20261005120000_add_procedure_manual_assignments/migration.sql` を expand-only で書き、工程の初期行を `INSERT ... ON CONFLICT DO NOTHING` で入れる。
2. `apps/api/src/services/assembly/procedure-manual.service.ts`(新規)に、工程一覧、機種一覧、割り当て一覧、公開版解決、割り当て置換を実装する。公開版解決は `AssemblyProcedureDocumentRevision` を `revisionRootId` で引き、無ければ文書自身を対象にする。
3. `apps/api/src/routes/assembly/procedure-manuals.ts`(新規)にルートを置き、`apps/api/src/routes/assembly/index.ts` から既存ルートと同じ方法で登録する。
4. `assembly-procedure-document.service.ts` の `getReferenceUsage`/`isReferenced`/`buildInUseMessage` に割り当て参照を加える。
5. `apps/web/src/api/client.ts` に API 関数、`apps/web/src/features/assembly/types.ts` に DTO、`apps/web/src/features/assembly/procedure-manuals/`(新規)に 3 段構成と編集ダイアログ、`apps/web/src/pages/kiosk/KioskAssemblyManualsPage.tsx`(新規)にページ、`App.tsx` にルート、`KioskAssemblyHomePage.tsx` にリンクを追加する。
6. テストを追加して次を実行する。

       cd apps/api && pnpm lint && pnpm test -- procedure-manual
       cd apps/web && pnpm lint && pnpm test -- procedure-manuals && pnpm build

## Validation and Acceptance (Phase 1)

ローカルで API と Web を起動し、管理者としてキオスクの組立ホームから「要領書」を開く。機種が 0 件なら空の案内が出る。「割り当てを編集」で型番 `dfd6362xyz-3943173` を全角や小文字混じりで入力しても、保存後の機種一覧には `DFD6362XYZ-3943173` が 1 件だけ出る。工程「組立工程 > 組立工程」に公開済み手順書 2 件を並べて保存すると、閲覧側で 2 件がその順で表示され、ページ送りできる。同じ文書を別の型番の同じ工程にも割り当てると、両方の機種から同じ文書が開く。割り当て中の文書を既存の手順書管理から削除しようとすると「要領書の割り当てで使用中」の趣旨のメッセージで拒否される。割り当て中の文書の改版下書きを作っても、閲覧側は旧公開版を表示し続ける。

## Idempotence and Recovery

マイグレーションは追加のみで、初期行の投入は再実行しても重複しない。割り当て置換は 1 つの機種×工程単位のトランザクションで、失敗時は元の並びが残る。Phase 1 は既存テーブルの行を変更しないので、ロールバックは新ルートを使わないだけでよい。

## Artifacts and Notes

- 分析の指示文と結果(2026-10-05、Codex read-only)はセッションのスクラッチに置き、要点は本計画の Surprises & Discoveries に転記した。
- タスクボード: T51「機種×工程ごとの要領書(閲覧特化)」。

## Interfaces and Dependencies

新しいルート `/assembly/procedure-manuals/processes`(GET)、`/assembly/procedure-manuals/models`(GET)、`/assembly/procedure-manuals/models/:modelCodeKey/processes/:processId`(GET。割り当てと解決済み文書列)、同パス(PUT。割り当て置換)。既存の `AssemblyProcedureSequence` の直列化形(`serializeProcedureSequence`)を閲覧側の契約として再利用する。既存の公開契約(`/assembly/procedure-documents/*`、テンプレート、作業セッション)は変更しない。

## Outcomes & Retrospective

Phase 1 のローカル実装と指定の検証を完了した。文書は改版ルートで保存し、閲覧時には最新の active PUBLISHED 版へ解決する。公開版のない項目は個別に「公開版なし」と表示し、正常な項目は既存ビューアで閲覧できる。機種が 0 件でも編集入口から割り当てを作成できる。

実行結果: `apps/api` の `pnpm lint`、`pnpm exec vitest run procedure-manual`（2 ファイル・12 件）、`pnpm exec tsc -p tsconfig.build.json --noEmit` は成功。`apps/web` の `pnpm lint`、`pnpm exec vitest run procedure-manuals`（1 ファイル・4 件）、`pnpm build` は成功。変更境界の既存回帰テストは API 3 ファイル・4 件、Web ビューア 1 ファイル・4 件が成功した。必要な生成物の準備に `packages/shared-types`、`shelf-layout-core`、`part-search-core`、`kiosk-sop-core` の build を実行した。検証の実行・準備は約 7 分（待機・並列実行を含む）。

実 DB への適用と実画面操作は未実施であり、DB 制約・ロールバックの実 PostgreSQL 上の確認は残る。Phase 2 / 3、公開経路、NFC 承認、Gmail 取込は未実装。commit / push / PR / merge / deploy は行わず、差分を作業ツリーに残している。開始時から未追跡だったこの計画ファイルは既存内容を維持して進捗と判断を追記した。

範囲外の観測: Web 検証で baseline-browser-mapping / Browserslist のデータ更新警告と Vite の大きな chunk の警告が出た。今回の依頼では依存更新や既存 bundle の分割を行っていない。
