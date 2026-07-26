---
title: 組立手順 仮想ステップ・矩形フォーカス・全体俯瞰 ExecPlan
status: active
created: 2026-07-26
branch: feat/assembly-procedure-step-storyboard
related:
  - ../decisions/ADR-20260726-assembly-template-procedure-steps.md
  - ./assembly-unified-template-editor-execplan.md
---

# 組立手順 仮想ステップ・矩形フォーカス・全体俯瞰 ExecPlan

この文書は `.agent/PLANS.md` に従う living document である。実装中に判明した事実、判断、検証結果を継続して更新する。

## Purpose / Big Picture

組立テンプレートの文書列とは別に、元ページ全体またはページ上の矩形を「独立した表示ステップ」として最大300件並べられるようにする。同じ元画像を再利用し、画像ファイルは複製しない。作業者は手順全体の位置をストーリーボードと文書区間マップで把握しながら、現在の矩形を拡大して確認できる。

丸数字、チェック、矢視は既存の元文書・元ページ・比率座標を正本とする。矩形内のマーカーだけをステップ内座標へ変換して表示する。閲覧自体は作業完了条件にせず、締付と必須チェックの既存ゲートを維持する。

## Progress

- [x] 2026-07-26: `main` を fast-forward 確認し、`feat/assembly-procedure-step-storyboard` を作成した。
- [x] 2026-07-26: 現行の文書列、マーカー参照、テンプレート改版トランザクション、作業画面resolver、画像配信、migration gate、Docker検証手順を調査した。
- [x] 2026-07-26: Expand-only migration、共有幾何、API契約、専用ステップサービス、参照ガードを実装した。
- [x] 2026-07-26: 統合エディタへ仮想ストーリーボード、矩形drag/四隅編集、指示・重要度、保存前マーカー可視性検証を実装した。
- [x] 2026-07-26: 作業画面へ平坦な前後手順、crop表示、全体マップ、ミニマップ、現在丸数字ジャンプ、最大12件LRUを実装した。
- [ ] Node要件、単体・統合・Playwright、隔離PostgreSQL、SQL制約、EXPLAINを検証する。
- [ ] ADR、INDEX、後継リンク、検証結果、retrospectiveを完成させる。

## Surprises & Discoveries

- 現行migration validatorは、新規テーブル内のFK/CHECK/UNIQUEは許可するが、既存テーブルへの `ADD CONSTRAINT` は許可しない。このためステップは独立した新規テーブルとして追加する。
- 組立手順書PDFは取込時に144 DPIのページ画像へ変換され、元PDFは保持されない。crop派生画像を作っても解像度は増えないため、元画像をCSSで仮想的に切り抜く。
- `@tanstack/react-virtual` と比率座標対応のzoom/pan canvasは既に導入済みである。
- 共有の `scripts/test/start-postgres.sh` は固定コンテナ名と固定ポートを使い、同名コンテナを削除する。今回の検証では使用しない。
- Mac既定Nodeは18だが、Codex同梱Node 24を利用できる。
- Codex同梱runtimeの現在のfallback `pnpm` は11系で、既存pnpm 9配置の`node_modules`再構成を要求した。依存を変更せず、同梱Node 24から既存のPrisma/TypeScript/Vitest実体を直接実行して検証する。
- 既存Web test fixtureの作業手順レスポンスには`pages`がなく`pageUrls`だけのものがある。新viewerの旧契約fallbackは既存`getSequenceDocumentPages` adapterを再利用し、両形式を受ける。

## Decision Log

- 2026-07-26: 表示ステップはテンプレート版が所有する新規テーブルとし、既存テンプレートはDBバックフィルせず文書全ページを動的展開する。
- 2026-07-26: マーカーはステップ固有に複製せず元ページで共有する。明示ステップ保存時は全マーカーが少なくとも1ステップで見えることを検証する。
- 2026-07-26: 閲覧履歴・閲覧完了ゲートは追加しない。
- 2026-07-26: 最大ステップ数は300、cropの各辺は元ページ比率2%以上とする。
- 2026-07-26: v1はcrop画像を永続生成せず、可視項目だけを読み込むLRU BlobキャッシュとCSS clipを使う。
- 2026-07-26: 文書ペインの手動順よりステップ列の最初の出現を優先し、保存payloadの文書集合と主手順書をステップ列から導出する。既存の文書移動UIはステップ順を暗黙に変更しない。

## Context and Orientation

テンプレート版の文書集合は `AssemblyTemplateProcedureItem` が所有し、作業セッションはその版を参照する。現在のresolverは文書ごとに全ページを展開し、Web viewerは文書indexとページindexを別々に移動する。マーカーは `AssemblyTemplateBolt` と `AssemblyTemplateCheckItem` に文書ID、ページ番号、0〜1の座標を持つ。

新しい `AssemblyTemplateProcedureStep` はテンプレート版、元文書、元ページ、表示種別、crop矩形、タイトル、指示、重要度、全体順序を持つ。APIは文書レスポンスを残したまま平坦な `steps` を追加する。保存済みステップがない版では、resolverが現在と同じ全ページ列を合成する。

## Plan of Work

1. 共通パッケージへステップ型・上限・crop幾何を追加し、API/Webが同じ変換を使う。
2. Prisma enumとステップテーブルを新規migrationで追加する。既存行と既存migrationは変更しない。
3. ステップの正規化、参照ページ検証、文書集合との整合、マーカー可視性、保存、改版コピー、互換展開を専用サービスへ分離する。
4. 既存テンプレート作成・改版トランザクションへステップ保存を組み込み、既存入力では未保存の互換展開を維持する。
5. Template DTOとwork-session procedure sequence DTOへ `steps` と `stepSource` を追加する。
6. エディタのドラフト状態を文書、ステップ、工程、マーカーに分離し、仮想ストーリーボード、矩形編集、指示インスペクタ、保存前整合検証を追加する。
7. 作業viewerを平坦なステップindexへ変更し、crop変換、ミニマップ、全体マップ、現在丸数字ジャンプを追加する。
8. 組立手順画像の取得を最大12件のLRU/in-flight dedupeに変更し、可視サムネイルと現在＋次だけを取得する。
9. focused/full tests、Playwright、fresh/upgrade migration、SQL制約、EXPLAINを隔離環境で検証し、文書へ結果を記録する。

## Validation and Acceptance

- 共通幾何は逆向きdrag、境界、最小矩形、元座標との往復、マーカー包含を検証する。
- APIは作成・改版・競合rollback・互換展開・最大件数・無効座標・孤立マーカー・参照削除防止を検証する。
- Webはステップ追加・重複・移動・削除、crop表示、指示、重要度、300件仮想化、LRUを検証する。
- Playwrightは1366×768、1920×1080、900×900で操作、overflow、touch target、canvas幅、座標精度を検証する。
- 固有名の一時 `pgvector/pgvector:pg15` container/volume/networkを動的localhostポートで使い、fresh/upgrade migration、SQL制約、2万件以上のfixtureに対する `EXPLAIN (ANALYZE, BUFFERS)`、関連統合テストを行う。EXIT/INT/TERM trapで必ず削除し残存0件を確認する。

## Idempotence and Recovery

migrationは新規ファイルのみとし、再適用はPrismaのmigration ledgerに委ねる。テンプレート作成・改版は既存のlineage lockと単一トランザクションを使用し、失敗時は文書列・ステップ・工程・マーカーをすべてrollbackする。

Docker検証資源は実行ごとにUUIDを含む名前とlabelを使う。既存コンテナ・DB・volume・networkを停止、再利用、変更しない。終了処理後に同じlabelの資源が0件であることを確認する。

## Outcomes & Retrospective

実装完了時に、利用者が得る動作、互換性、migration/SQL/EXPLAIN、テスト件数、画面検証、残課題、本番未反映であることをここへ記録する。
