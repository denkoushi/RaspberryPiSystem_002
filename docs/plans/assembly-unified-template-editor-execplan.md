---
id: assembly-unified-template-editor-execplan
title: 組立テンプレート・閲覧順統合エディター
status: active
last_verified: 2026-07-26
---

# 組立テンプレート・閲覧順統合エディター

This ExecPlan is a living document and must be maintained in accordance with
`.agent/PLANS.md`.

## Purpose / Big Picture

組立テンプレートの文書閲覧順、工程、締付マーカー、チェックマーカーを一画面・一保存へ統合する。新しいテンプレート版は文書列を自分で所有し、後から機種名別閲覧順が変更されても、開始済み・完了済み作業の表示内容が変化しない。単一文書ではサイドペインを閉じ、手順書canvasを最大化する。

## Progress

- [x] (2026-07-26) 現行ドキュメント、Prisma、assembly API/service、Web editor/order UI、テスト、migration制約を調査した。
- [x] (2026-07-26) 現行Web focused test 34件、Playwright 6件、隔離PostgreSQL上の全153 migrationとassembly API test 23件を確認した。
- [x] (2026-07-26) `feat/assembly-unified-template-editor` を `origin/main` から作成した。
- [x] (2026-07-26) Expand-only schemaとテンプレート所有文書列を実装した。
- [x] (2026-07-26) API互換、系譜lockによる原子的改版、作業セッション解決、参照保護を実装した。
- [x] (2026-07-26) 統合エディター、共通未保存guard、旧導線redirectを実装した。
- [x] (2026-07-26) API全2444件、Web全1511件、Playwright 10件、隔離PostgreSQL上の全154 migration、制約、参照整合性、実行計画を検証した。
- [x] (2026-07-26) local commit後に`validate-candidate-migrations.sh origin/main HEAD`を実行し、既存153 migrationのchecksumと新規migrationのExpand-only契約が成功することを確認した。
- [x] (2026-07-26) ユーザー承認により、旧閲覧順APIの完全削除、push、PR merge、本番デプロイをfollow-up scopeへ追加した。
- [x] (2026-07-26) 旧GET/PUT/auth API、旧Web client/pageを削除し、既存DB行の内部read-only fallbackだけを残した。旧3 endpointの404、新template認証、隔離PostgreSQL上のAPI全2443件、Web全1509件、Playwright 10件を再検証した。
- [ ] feature branchをpushし、PRの必須CI成功後にmainへmergeする。
- [ ] 標準オーケストレーターで本番へローリング反映し、status、health、同一SHAのno-op planを確認する。

## Surprises & Discoveries

- 現行テンプレートエディターは機種名別閲覧順を読み込んでページ候補に使うが、保存payloadには含めない。
- 作業セッションの文書列は固定`templateId`ではなく、毎回`targetUnit`の最新機種名別閲覧順から解決される。
- マーカー文書が閲覧順に属するかは検証されず、表示不能なマーカーを保存できる。
- migration validatorは既存テーブルへの制約追加を許さないが、新規テーブル内のPK/FK/CHECK/UNIQUEはExpand-only契約内である。
- ローカル既定Nodeは18だがrepository要件は20.9以上である。検証ではNode 24を明示して使用する。
- Prismaは`SELECT pg_advisory_xact_lock(...)`が返すPostgreSQLの`void`型を直接deserializeできない。`SELECT 1 FROM (SELECT pg_advisory_xact_lock(...))`として戻り値を整数に限定すると、transaction advisory lockを安全に取得できる。
- 初回の実ブラウザ検証で文書内の前後ページ移動UIが不足していることが判明した。headerに前ページ・次ページ操作を追加し、Playwrightで文書追加、ページ移動、マーカー選択を一連で確認した。
- 新形式APIが任意の`KioskDocument`参照を受理すると、公開済み組立手順書だけを新規追加元とする境界を破る。旧機種別閲覧順または改版元テンプレートに既に存在するKiosk文書だけを引継ぎ可能にし、新規参照を拒否する検証を追加した。

## Decision Log

- Decision: 文書列は機種名ではなくテンプレート版が所有する。
  Rationale: 作業履歴を再現可能にし、手順パターンと版を同じaggregateにするため。
- Decision: 既存行はbackfillせず、保存済み文書列がないテンプレートだけ旧機種名別設定へfallbackする。
  Rationale: Expand-only rolloutを守り、既存本番行の一括変更を避けるため。
- Decision: 新形式payloadだけ2520を必須にし、旧payloadはローリング互換のため受理する。
  Rationale: 新Webを保護しながら、API先行デプロイ時の旧Webを壊さないため。
- Decision: `procedureDocumentId`は文書列で最初に現れる組立手順書と一致させる。
  Rationale: 旧クライアントの単一文書fallbackと省略マーカー参照を維持するため。
- Decision: Kiosk文書は旧機種別閲覧順または改版元テンプレートの既存項目だけを引継ぐ。
  Rationale: 旧データを失わず、新規追加元を公開済み・有効な組立手順書に限定するAPI境界を守るため。
- Decision: 画面の状態更新は純粋なdraft reducer、取得処理はloader、文書ライブラリと文書順ペインは表示コンポーネント、離脱保護は共通hookへ分割する。
  Rationale: 保存transactionを担うAPIと同様に、Webでも取得、状態遷移、表示、ナビゲーション保護を疎結合にして再利用と単体試験を可能にするため。
- Decision: 機種名別閲覧順の外部GET/PUT/auth APIは削除し、既存DB行はread-only compatibility adapterからだけ読む。
  Rationale: 統合後に二つの書込正本を残さず、未改版templateの作業継続と本番データ保護を両立するため。

## Outcomes & Retrospective

テンプレート版が順序付き文書列を所有し、文書順、工程、締付・チェックマーカーを一回の保存で新しい版へ確定できるようになった。作業セッションは版所有の文書列を最優先するため、後から機種名別閲覧順が変わっても開始済みの作業は変化しない。旧テンプレートは機種名別順、主手順書の順に互換読込され、旧クライアントからの改版でも保存済み文書列を引継ぐ。

Webは単一文書で左ペインを閉じ、複数文書で開く統合画面になった。1366x768では単一文書・マーカー未選択時にcanvas比率80%以上、両ペイン表示時に55%以上を実ブラウザで確認した。旧閲覧順URLは対象機種で絞ったテンプレート一覧へ転送され、組立トップの独立導線は削除した。

統合機能の初回最終ソースに対し、API 464 test filesの2444 tests、Web 305 test filesの1511 tests、Playwright 10 testsが成功した。固有名の一時`pgvector/pgvector:pg16`環境では、既存テンプレート行を投入して153 migrationから154 migrationへupgradeし、既存行を変更しないことを確認した。XOR CHECK、順序一意、文書削除RESTRICT、テンプレート削除CASCADEが機能し、`AssemblyTemplateProcedureItem_unique_template_sort`、`AssemblyTemplateProcedureItem_idx_kiosk_document`、`AssemblyTemplateProcedureItem_idx_assembly_document`が各検索の実行計画で使われた。一時container、volume、networkはtrapによる終了処理後に0件である。

follow-upでは、旧`GET/PUT /assembly/procedure-orders`と旧認証endpointを公開routeから完全に削除し、新しいtemplate認証endpointへ置き換えた。旧Web clientと独立設定pageも削除した。隔離PostgreSQLへ全154 migrationを適用した状態でAPI 464 test filesの2443 testsが成功し、旧3 endpointの404と既存DB行からの内部fallbackを同時に確認した。Web 304 test filesの1509 tests、Playwright 10 tests、API/Web lint・build、docs auditも成功した。検証用container、volume、networkは終了後に0件である。

初回計画の実装とローカル検証は完了した。2026-07-26の追加承認により、旧閲覧順API削除と本番反映をfollow-upとして実行中である。

表示単位を文書内の全ページからページ全体／矩形の独立ステップへ拡張する後継計画は
[`assembly-procedure-step-storyboard-execplan.md`](./assembly-procedure-step-storyboard-execplan.md)
で扱う。本計画の履歴と文書列正本は変更しない。

## Context and Orientation

中心となる実装は、APIの`assembly-template.service.ts`、`assembly-template-procedure-sequence.service.ts`、`assembly-procedure-sequence.service.ts`、`assembly-legacy-procedure-order.service.ts`と、Webの`KioskAssemblyTemplateEditorPage.tsx`である。`AssemblyTemplateProcedureItem`が新しい正本であり、`AssemblyProcedureOrderSet`は外部書込を持たない既存行専用fallbackである。

## Plan of Work

1. `AssemblyTemplateProcedureItem`を新規作成し、XOR、順序一意、参照FKをDBとserviceの双方で保証する。
2. 文書列policy/repositoryとテンプレート系譜lockを追加し、template create/revise transactionへ組み込む。
3. template detail/summary DTOとwork-session sequence resolverを拡張し、新形式優先・旧order・primaryの順で解決する。
4. 文書参照件数、削除、公開取消、ライブラリfilterを文書列全体へ拡張する。
5. editor draftと表示部品を分割し、認証、文書追加・並替え・削除、折畳ペイン、一括保存、未保存guardを実装する。
6. 旧閲覧順画面をテンプレート一覧redirectへ置換し、組立トップの独立導線を削除する。
7. Unit/API/E2Eと隔離PostgreSQLでmigration、制約、EXPLAINを検証する。
8. 旧機種名別orderのGET/PUT/auth routeとWeb client/pageを削除する。read-only adapter、既存参照削除guard、旧URL redirectは残す。
9. 必須CI成功後にmainへmergeし、`scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml`だけを使って本番へ反映する。

## Concrete Steps

Repository root:

    git switch feat/assembly-unified-template-editor
    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/web build

隔離DBは固有名container/volume/networkと動的loopback portを使い、shell trapで必ず削除する。既存の`postgres-test-local` helperは固定名containerを削除し得るため使用しない。

## Validation and Acceptance

- 新形式template作成・改版は文書列、工程、bolt/checkを一transactionで保存する。
- v1 sessionはv2作成後もv1文書列を表示する。
- 旧templateは機種名別order、未設定ならprimaryへfallbackする。
- 参照外マーカー、無効/下書き文書、XOR違反、stale reviseは拒否され、active版は変化しない。
- 1366x768の単一文書・マーカー未選択でcanvas workspace幅80%以上、両ペイン表示でも55%以上を確保する。
- API/Web lint・build・全test、対象Playwright、candidate migration validatorが成功する。
- 旧GET/PUT/auth APIが404になり、新しいtemplate認証APIが2520を検証する。
- 未改版templateは既存機種名別DB行を内部fallbackとして引き続き解決できる。
- mainの必須CI成功後、標準deploy runがsuccess、全対象hostがverified、再planがno-opになる。

## Idempotence and Recovery

Migrationは新規テーブル作成のみで再実行可能なPrisma ledgerへ追加する。失敗したtemplate保存はtransaction rollbackされる。Docker検証資源は固有prefixで作り、成功・失敗に関係なくtrapで削除する。既存migrationや本番DBを編集しない。

## Artifacts and Notes

検証結果、SQL plan名、test件数をProgressとOutcomesへ追記する。

## Interfaces and Dependencies

- New DB model: `AssemblyTemplateProcedureItem`
- Extended template input: `procedureItems`, `accessPassword`
- Extended template output: `procedureSequence`, summary `procedureItemCount`
- Sequence source: `template_version | legacy_machine_order | primary_fallback`
- Existing `procedureDocumentId` and work-session response fields remain compatible. The legacy procedure-order API is removed; only the read-only internal fallback for pre-migration templates remains.

Revision note (2026-07-26): 実装結果、API境界で見つかったKiosk文書引継ぎ条件、Prisma advisory lockの実装上の注意、実ブラウザで補ったページ移動、全テストと隔離DB検証の証跡を反映した。その後のユーザー承認に基づき旧API削除、push、merge、本番ローリング反映をfollow-up scopeへ追加し、計画を再度activeにした。
